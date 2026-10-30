import { EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import type { NotifyItem, NotifyRequest } from "@agent-hub/protocol";
import type { ServerConfig } from "./config.ts";
import type { HubDatabase, Row } from "./db.ts";
import { computerEndpoint } from "./relay.ts";

const BATCH_DELAY_MS = 20_000;
const RETRY_DELAY_MS = 60_000;
const ITEM_TTL_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class NotificationOutbox {
  private readonly db: HubDatabase;
  private readonly clock: () => number;
  private readonly fetcher: typeof undiciFetch;
  private readonly computer;
  private readonly dispatcher?: Dispatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private dueAt?: number;
  private retryAt = 0;
  private stopped = false;
  private flushing = false;
  private readonly abort = new AbortController();

  constructor(
    db: HubDatabase,
    config: ServerConfig,
    clock: () => number,
    fetcher: typeof undiciFetch = undiciFetch,
  ) {
    this.db = db;
    this.clock = clock;
    this.fetcher = fetcher;
    this.computer = config.computer;
    if (this.computer) this.dispatcher = new EnvHttpProxyAgent();
  }

  start(): void {
    this.schedule();
  }

  notifyQueued(): void {
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.dueAt = undefined;
    await this.dispatcher?.close();
  }

  private schedule(): void {
    if (this.stopped || this.flushing) return;
    const first = this.db.listUnsentNotifications(1)[0];
    if (!first) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      this.dueAt = undefined;
      return;
    }
    const dueAt = this.computer
      ? Math.max(Number(first.created_at) + BATCH_DELAY_MS, this.retryAt)
      : Number(first.created_at) + ITEM_TTL_MS;
    if (this.timer && this.dueAt === dueAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dueAt = undefined;
      void this.flush();
    }, Math.max(0, dueAt - this.clock()));
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.flushing) return;
    this.flushing = true;
    try {
      const now = this.clock();
      const dropped = this.db.dropExpiredNotifications(now - ITEM_TTL_MS, now);
      if (dropped) process.stderr.write(`Agent Hub dropped ${dropped} expired notification outbox item(s).\n`);
      if (!this.computer) return;

      const rows = this.db.listUnsentNotifications(50);
      const pending: Array<{ row: Row; item: NotifyItem }> = [];
      for (const row of rows) {
        const item = this.itemFor(row);
        if (item) pending.push({ row, item });
        else this.db.markNotificationSent(String(row.workspace_id), String(row.ref), now);
      }
      if (!pending.length) {
        this.retryAt = 0;
        return;
      }

      const body: NotifyRequest = { items: pending.map(({ item }) => item) as [NotifyItem, ...NotifyItem[]] };
      let response: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        response = await this.fetcher(computerEndpoint(this.computer, "notify"), {
          method: "POST",
          dispatcher: this.dispatcher,
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          headers: {
            Authorization: `Bearer ${this.computer.computer_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch {
        this.retryAt = this.clock() + RETRY_DELAY_MS;
        return;
      }

      if (response.status === 204 || (response.status === 503 && await this.isNotConfigured(response))) {
        const sentAt = this.clock();
        for (const { row } of pending) this.db.markNotificationSent(String(row.workspace_id), String(row.ref), sentAt);
        this.retryAt = 0;
      } else {
        this.retryAt = this.clock() + RETRY_DELAY_MS;
      }
    } finally {
      this.flushing = false;
      this.schedule();
    }
  }

  private async isNotConfigured(response: Awaited<ReturnType<typeof undiciFetch>>): Promise<boolean> {
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") return false;
      const error = (body as { error?: unknown }).error;
      return !!error && typeof error === "object" && (error as { code?: unknown }).code === "zalo_not_configured";
    } catch {
      return false;
    }
  }

  private itemFor(row: Row): NotifyItem | undefined {
    const workspaceId = String(row.workspace_id);
    const workspace = this.db.getWorkspace(workspaceId);
    if (!workspace) return undefined;
    const ref = String(row.ref);
    if (ref.startsWith("decision:")) {
      const value = ref.slice("decision:".length);
      const separator = value.lastIndexOf("/");
      if (separator < 1) return undefined;
      const runId = value.slice(0, separator);
      const decisionId = value.slice(separator + 1);
      const decision = this.db.getDecisionBody(workspaceId, runId, decisionId);
      // Answered or cancelled during the batch delay: nothing to tell the user any more.
      if (!decision || decision.local_status !== "PENDING") return undefined;
      return {
        workspace_id: workspaceId,
        workspace_name: String(workspace.name),
        kind: decision.run_id === "inbox" ? "question" : "decision",
        run_id: decision.run_id,
        ref_id: decision.decision_id,
        title: decision.title,
      };
    }
    if (ref.startsWith("command:")) {
      const command = this.db.getUserCommand(workspaceId, ref.slice("command:".length));
      if (!command || (command.type !== "prompt" && command.type !== "reply")) return undefined;
      return {
        workspace_id: workspaceId,
        workspace_name: String(workspace.name),
        kind: "prompt_failed",
        run_id: null,
        ref_id: command.id,
        title: "",
      };
    }
    return undefined;
  }
}
