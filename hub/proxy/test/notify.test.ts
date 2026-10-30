import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.ts";
import { ComputerRelay } from "../src/computer-relay.ts";
import {
  createLinkCode,
  formatNotificationMessage,
  handleComputerNotify,
  handleNotificationStatus,
  handleTestNotification,
  handleUnlink,
  handleZaloSetup,
  handleZaloWebhook,
} from "../src/notify.ts";
import type { Notifier, ZaloSendResult } from "../src/zalo-sender.ts";
import { sendZaloText } from "../src/zalo-sender.ts";

type CodeRow = { code: string; user_id: string; expires_at: number };
type UserRow = { id: string; username: string };
type TargetRow = {
  id: string;
  user_id: string;
  channel: "zalo";
  chat_id: string;
  chat_type: "private" | "group";
  display_name: string | null;
  linked_at: string;
  broken: number;
};
type ComputerRow = { id: string; user_id: string; name: string };

class MemoryDatabase {
  readonly codes = new Map<string, CodeRow>();
  readonly users = new Map<string, UserRow>();
  readonly targets = new Map<string, TargetRow>();
  readonly computers = new Map<string, ComputerRow>();
  readonly usage = new Map<string, number>();

  prepare(sql: string): MemoryStatement {
    return new MemoryStatement(this, sql.replace(/\s+/g, " ").trim().toLowerCase());
  }

  target(userId: string, chatId: string): TargetRow | undefined {
    return [...this.targets.values()].find((row) => row.user_id === userId && row.chat_id === chatId);
  }
}

class MemoryStatement {
  private values: unknown[] = [];

  constructor(private readonly db: MemoryDatabase, private readonly query: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const [a, b, c] = this.values;
    if (this.query.startsWith("select code from notify_link_codes")) {
      const row = this.db.codes.get(String(a));
      return (row ? { code: row.code } : null) as T | null;
    }
    if (this.query.startsWith("select code, user_id from notify_link_codes")) {
      const row = this.db.codes.get(String(a));
      return (row && row.expires_at > Number(b) ? { code: row.code, user_id: row.user_id } : null) as T | null;
    }
    if (this.query.startsWith("select username from users")) {
      const user = this.db.users.get(String(a));
      return (user ? { username: user.username } : null) as T | null;
    }
    if (this.query.startsWith("select sent from notify_usage")) {
      const sent = this.db.usage.get(String(a));
      return (sent === undefined ? null : { sent }) as T | null;
    }
    if (this.query.startsWith("update notify_usage set sent = sent + 1")) {
      const month = String(a);
      const sent = this.db.usage.get(month) ?? 0;
      if (sent >= Number(b)) return null;
      this.db.usage.set(month, sent + 1);
      return { sent: sent + 1 } as T;
    }
    if (this.query.startsWith("select user_id from computers")) {
      const computer = this.db.computers.get(String(a));
      return (computer ? { user_id: computer.user_id } : null) as T | null;
    }
    if (this.query.startsWith("select user_id, name from computers")) {
      const computer = this.db.computers.get(String(a));
      return (computer ? { user_id: computer.user_id, name: computer.name } : null) as T | null;
    }
    void c;
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const userId = String(this.values[0]);
    const includeBroken = !this.query.includes("and broken = 0");
    const rows = [...this.db.targets.values()]
      .filter((row) => row.user_id === userId && (includeBroken || row.broken === 0))
      .sort((left, right) => left.linked_at.localeCompare(right.linked_at));
    return { results: rows as T[] };
  }

  async run(): Promise<{ success: true }> {
    const [a, b, c, d, e, f] = this.values;
    if (this.query.startsWith("delete from notify_link_codes where expires_at")) {
      for (const [code, row] of this.db.codes) if (row.expires_at <= Number(a)) this.db.codes.delete(code);
    } else if (this.query.startsWith("delete from notify_link_codes where user_id")) {
      for (const [code, row] of this.db.codes) if (row.user_id === a) this.db.codes.delete(code);
    } else if (this.query.startsWith("insert into notify_link_codes")) {
      this.db.codes.set(String(a), { code: String(a), user_id: String(b), expires_at: Number(c) });
    } else if (this.query.startsWith("delete from notify_link_codes where code")) {
      this.db.codes.delete(String(a));
    } else if (this.query.startsWith("insert into notify_targets")) {
      const existing = this.db.target(String(b), String(c));
      this.db.targets.set(existing?.id ?? String(a), {
        id: existing?.id ?? String(a),
        user_id: String(b),
        channel: "zalo",
        chat_id: String(c),
        chat_type: String(d) as "private" | "group",
        display_name: (e as string | null) ?? null,
        linked_at: String(f),
        broken: 0,
      });
    } else if (this.query.startsWith("update notify_targets set broken")) {
      const target = this.db.targets.get(String(b));
      if (target) target.broken = Number(a);
    } else if (this.query.startsWith("delete from notify_targets where id")) {
      const target = this.db.targets.get(String(a));
      if (target?.user_id === b) this.db.targets.delete(String(a));
    } else if (this.query.startsWith("insert into notify_usage")) {
      if (!this.db.usage.has(String(a))) this.db.usage.set(String(a), 0);
    } else if (this.query.startsWith("update notify_usage set sent = case")) {
      const month = String(a);
      this.db.usage.set(month, Math.max(0, (this.db.usage.get(month) ?? 0) - 1));
    }
    return { success: true };
  }
}

const USER_ID = "user-1";
const COMPUTER_ID = "c_aaaaaaaaaaaaaaaa";
const FIXED_NOW = Date.parse("2026-10-30T04:00:00.000Z");
const BASE_ENV = {
  ZALO_BOT_TOKEN: "fake-bot-token-for-tests",
  ZALO_WEBHOOK_SECRET: "fake-webhook-secret-for-tests",
  ZALO_BOT_LINK: "https://zalo.me/fake-bot",
  HUB_WEB_URL: "https://agent-hub.example",
} as const;

function setupDatabase(): MemoryDatabase {
  const db = new MemoryDatabase();
  db.users.set(USER_ID, { id: USER_ID, username: "alice" });
  db.computers.set(COMPUTER_ID, { id: COMPUTER_ID, user_id: USER_ID, name: "work laptop" });
  return db;
}

function envFor(db: MemoryDatabase, overrides: Record<string, unknown> = {}): Env {
  return { DB: db as unknown as D1Database, ...BASE_ENV, ...overrides } as Env;
}

function seedTarget(
  db: MemoryDatabase,
  overrides: Partial<TargetRow> = {},
): TargetRow {
  const target: TargetRow = {
    id: "nt_target-1",
    user_id: USER_ID,
    channel: "zalo",
    chat_id: "chat-1",
    chat_type: "private",
    display_name: "Alice",
    linked_at: "2026-10-30T04:00:00.000Z",
    broken: 0,
    ...overrides,
  };
  db.targets.set(target.id, target);
  return target;
}

function webhookRequest(body: unknown, secret = BASE_ENV.ZALO_WEBHOOK_SECRET): Request {
  return new Request("https://proxy.example/api/v1/zalo/webhook", {
    method: "POST",
    headers: { "X-Bot-Api-Secret-Token": secret, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resultNotifier(results: ZaloSendResult[] = [{ ok: true }]): { notifier: Notifier; calls: Array<{ chat_id: string; text: string }> } {
  const calls: Array<{ chat_id: string; text: string }> = [];
  let index = 0;
  const notifier: Notifier = {
    async send(target, text) {
      calls.push({ chat_id: target.chat_id, text });
      const result = results[Math.min(index, results.length - 1)] ?? { ok: true };
      index += 1;
      return result;
    },
  };
  return { notifier, calls };
}

function sampleItem(overrides: Partial<NotifyRequest["items"][number]> = {}): NotifyRequest["items"][number] {
  return {
    workspace_id: "ws_aaaaaaaaaaaaaaaa",
    workspace_name: "agent-kit",
    kind: "question",
    run_id: "inbox",
    ref_id: "D7",
    title: "Push hub/plan now?",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Zalo notification proxy", () => {
  it("creates one live six-digit code per user and removes expired codes", async () => {
    const db = setupDatabase();
    const env = envFor(db);
    const first = await createLinkCode(env, USER_ID, () => FIXED_NOW);
    const second = await createLinkCode(env, USER_ID, () => FIXED_NOW + 1_000);
    db.codes.set("123456", { code: "123456", user_id: "other-user", expires_at: FIXED_NOW + 10 });
    await createLinkCode(env, "another-user", () => FIXED_NOW + 20);

    expect(first.code).toMatch(/^\d{6}$/);
    expect(new Date(first.expires_at).getTime()).toBe(FIXED_NOW + 10 * 60_000);
    expect(db.codes.size).toBe(2);
    expect([...db.codes.values()].filter((row) => row.user_id === USER_ID)).toEqual([
      expect.objectContaining({ code: second.code, expires_at: FIXED_NOW + 1_000 + 10 * 60_000 }),
    ]);
    expect(db.codes.has("123456")).toBe(false);
  });

  it("rejects a webhook with a bad secret", async () => {
    const db = setupDatabase();
    const response = await handleZaloWebhook(webhookRequest({}, "incorrect-secret"), envFor(db));
    expect(response.status).toBe(401);
  });

  it("links a private chat from a code and replies without echoing the code", async () => {
    const db = setupDatabase();
    const env = envFor(db);
    const link = await createLinkCode(env, USER_ID, () => FIXED_NOW);
    const sent = resultNotifier();
    const response = await handleZaloWebhook(webhookRequest({
      message: {
        chat: { id: "private-chat-1", chat_type: "PRIVATE" },
        from: { display_name: "Alice Device" },
        text: ` ${link.code} `,
      },
    }), env, { notifier: sent.notifier, now: () => FIXED_NOW });

    expect(response.status).toBe(200);
    expect(db.target(USER_ID, "private-chat-1")).toMatchObject({ chat_type: "private", display_name: "Alice Device", broken: 0 });
    expect(db.codes.has(link.code)).toBe(false);
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].text).toContain("Connected to Agent Hub (alice)");
    expect(sent.calls[0].text).not.toContain(link.code);
  });

  it("links group chats and does not reply to a group message without a live code", async () => {
    const db = setupDatabase();
    const env = envFor(db);
    const link = await createLinkCode(env, USER_ID, () => FIXED_NOW);
    const sent = resultNotifier();
    await handleZaloWebhook(webhookRequest({
      result: { message: {
        chat: { id: "group-chat-1", chat_type: "GROUP" },
        from: { display_name: "Group member" },
        text: link.code,
      } },
    }), env, { notifier: sent.notifier, now: () => FIXED_NOW });
    await handleZaloWebhook(webhookRequest({
      event_name: "message",
      message: { chat: { id: "group-chat-2", chat_type: "GROUP" }, text: "hello" },
    }), env, { notifier: sent.notifier, now: () => FIXED_NOW });

    expect(db.target(USER_ID, "group-chat-1")).toMatchObject({ chat_type: "group", display_name: "Group member" });
    expect(sent.calls).toHaveLength(1);
  });

  it("stays silent on unknown private text and redacts token and code-like keys from logs", async () => {
    const db = setupDatabase();
    const env = envFor(db);
    const sent = resultNotifier();
    await handleZaloWebhook(webhookRequest({
      message: { chat: { id: "private-chat", chat_type: "PRIVATE" }, text: "hello" },
    }), env, { notifier: sent.notifier, now: () => FIXED_NOW });
    expect(sent.calls).toHaveLength(0);

    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = BASE_ENV.ZALO_BOT_TOKEN;
    await handleZaloWebhook(webhookRequest({ [token]: true, "123456": "hidden" }), env);
    expect(log.mock.calls.flat().join(" ")).not.toContain(token);
    expect(log.mock.calls.flat().join(" ")).not.toContain("123456");
  });

  it("formats batched notifications and drops trailing items at 2,000 characters", () => {
    const env = envFor(setupDatabase());
    const normal = formatNotificationMessage({ items: [
      sampleItem(),
      sampleItem({ kind: "decision", run_id: "hub10", ref_id: "D2", title: "Finish run hub10?" }),
    ] }, env);
    expect(normal).toContain("agent-kit · Q7 question\nPush hub/plan now?");
    expect(normal).toContain("agent-kit · hub10 D2 decision\nFinish run hub10?");
    expect(normal).toContain("https://agent-hub.example/#/w/ws_aaaaaaaaaaaaaaaa/d/inbox/D7");

    const long = formatNotificationMessage({ items: Array.from({ length: 50 }, (_, index) => sampleItem({
      ref_id: `D${index + 1}`,
      title: "x".repeat(500),
      workspace_name: "workspace-".repeat(18),
    })) }, env);
    expect(Array.from(long).length).toBeLessThanOrEqual(2_000);
    expect(long).toMatch(/\+\d+ more in the hub/);
  });

  it("marks a target broken on rejection and retries transient server failures twice", async () => {
    const db = setupDatabase();
    seedTarget(db);
    const env = envFor(db);
    const rejected = resultNotifier([{ ok: false, kind: "rejected" }]);
    const notificationRequest = (): Request => new Request("https://proxy.example/api/v1/computers/c/notify", {
      method: "POST", body: JSON.stringify({ items: [sampleItem()] }),
    });
    const request = notificationRequest();
    const response = await handleComputerNotify(request, env, COMPUTER_ID, {
      notifier: rejected.notifier,
      now: () => FIXED_NOW,
    });
    expect(response.status).toBe(204);
    expect(db.targets.get("nt_target-1")?.broken).toBe(1);

    db.targets.get("nt_target-1")!.broken = 0;
    const retried = resultNotifier([{ ok: false, kind: "server" }, { ok: false, kind: "server" }, { ok: true }]);
    const delays: number[] = [];
    const retryResponse = await handleComputerNotify(notificationRequest(), env, COMPUTER_ID, {
      notifier: retried.notifier,
      now: () => FIXED_NOW,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });
    expect(retryResponse.status).toBe(204);
    expect(retried.calls).toHaveLength(3);
    expect(delays).toEqual([1_000, 3_000]);
    expect(db.usage.get("2026-10")).toBe(1);
  });

  it("stops at the reserved monthly quota without calling Zalo", async () => {
    const db = setupDatabase();
    seedTarget(db);
    db.usage.set("2026-10", 1);
    const env = envFor(db, { ZALO_MONTHLY_LIMIT: "51" });
    const sent = resultNotifier();
    const request = new Request("https://proxy.example/api/v1/computers/c/notify", {
      method: "POST", body: JSON.stringify({ items: [sampleItem()] }),
    });
    const response = await handleComputerNotify(request, env, COMPUTER_ID, {
      notifier: sent.notifier,
      now: () => FIXED_NOW,
    });
    expect(response.status).toBe(204);
    expect(sent.calls).toHaveLength(0);
    expect(db.usage.get("2026-10")).toBe(1);
  });

  it("reports status, returns no_targets, clears broken after a test send, and unlinks a target", async () => {
    const db = setupDatabase();
    const env = envFor(db);
    expect((await handleTestNotification(env, USER_ID)).status).toBe(409);
    seedTarget(db, { broken: 1 });
    db.usage.set("2026-10", 7);
    const status = await handleNotificationStatus(env, USER_ID, () => FIXED_NOW);
    expect(await status.json()).toMatchObject({
      zalo_configured: true,
      bot_link: BASE_ENV.ZALO_BOT_LINK,
      sent_this_month: 7,
      monthly_limit: 3_000,
      targets: [{ id: "nt_target-1", broken: true, chat_type: "private" }],
    });

    const sent = resultNotifier();
    const testResponse = await handleTestNotification(env, USER_ID, {
      notifier: sent.notifier,
      now: () => FIXED_NOW,
    });
    expect(testResponse.status).toBe(204);
    expect(sent.calls[0].text).toBe("🔔 Agent Hub test: notifications work.");
    expect(db.targets.get("nt_target-1")?.broken).toBe(0);
    expect(await handleUnlink(env, USER_ID, "nt_target-1")).toMatchObject({ status: 204 });
    expect(db.targets.has("nt_target-1")).toBe(false);
  });

  it("registers the proxy webhook and returns only safe verification fields", async () => {
    const env = envFor(setupDatabase());
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      result: { verification: { outcome: "verified", hint: "Webhook is active." } },
    }), { status: 200 }));
    const response = await handleZaloSetup(new Request("https://proxy.example/admin/zalo/setup"), env, fetcher as typeof fetch);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: "verified", hint: "Webhook is active." });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("/botfake-bot-token-for-tests/setWebhook");
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://proxy.example/api/v1/zalo/webhook",
      secret_token: BASE_ENV.ZALO_WEBHOOK_SECRET,
    });

    await handleZaloSetup(new Request("https://proxy.example/admin/zalo/setup"),
      { ...env, ZALO_WEBHOOK_URL: "https://web.example/api/zalo-webhook" }, fetcher as typeof fetch);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).url).toBe("https://web.example/api/zalo-webhook");
  });

  it("uses bounded, token-safe Zalo sends and classifies rejection", async () => {
    const env = envFor(setupDatabase());
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(await sendZaloText(env, "chat-id", "hello", fetcher as typeof fetch)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await sendZaloText(env, "chat-id", "x".repeat(2_001), fetcher as typeof fetch))
      .toEqual({ ok: false, kind: "rejected" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const rejectFetcher = async () => new Response(JSON.stringify({ ok: false, error_code: 400 }), { status: 200 });
    expect(await sendZaloText(env, "chat-id", "hello", rejectFetcher as typeof fetch))
      .toEqual({ ok: false, kind: "rejected" });
    const limitedFetcher = async () => new Response("{}", { status: 429 });
    expect(await sendZaloText(env, "chat-id", "hello", limitedFetcher as typeof fetch))
      .toEqual({ ok: false, kind: "rate_limited" });
    const serverFetcher = async () => new Response("{}", { status: 503 });
    expect(await sendZaloText(env, "chat-id", "hello", serverFetcher as typeof fetch))
      .toEqual({ ok: false, kind: "server" });
    const networkFetcher = async () => { throw new Error("do not expose this detail"); };
    expect(await sendZaloText(env, "chat-id", "hello", networkFetcher as typeof fetch))
      .toEqual({ ok: false, kind: "network" });
  });

  it("fires the offline alarm once and clears it when the computer reconnects", async () => {
    const db = setupDatabase();
    seedTarget(db);
    const storageValues = new Map<string, unknown>([["computerId", COMPUTER_ID]]);
    let alarmAt: number | null = null;
    const storage = {
      get: async <T>(key: string): Promise<T | undefined> => storageValues.get(key) as T | undefined,
      put: async (key: string, value: unknown): Promise<void> => { storageValues.set(key, value); },
      delete: async (): Promise<boolean> => false,
      setAlarm: async (value: number | Date): Promise<void> => { alarmAt = value instanceof Date ? value.getTime() : value; },
      getAlarm: async (): Promise<number | null> => alarmAt,
      deleteAlarm: async (): Promise<void> => { alarmAt = null; },
    };
    const state = { storage, getWebSockets: () => [] } as unknown as DurableObjectState;
    let now = FIXED_NOW;
    const env = envFor(db);
    const relay = new ComputerRelay(state, env, () => now);
    relay.webSocketClose({} as WebSocket);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alarmAt).toBe(FIXED_NOW + 10 * 60_000);

    const originalFetch = globalThis.fetch;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    now = alarmAt ?? now;
    await relay.alarm();
    await relay.alarm();
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 1;
    const poll = await relay.fetch(new Request(`https://relay/api/v1/computers/${COMPUTER_ID}/poll?wait=0`));
    expect(poll.status).toBe(200);
    expect(alarmAt).toBe(now + 10 * 60_000);
    expect(storageValues.get("offline_notified")).toBe(false);
    vi.stubGlobal("fetch", originalFetch);
  });

  it("does not log the bot token", async () => {
    const env = envFor(setupDatabase());
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = async () => new Response("{}", { status: 500 });
    await sendZaloText(env, "chat-id", "hello", fetcher as typeof fetch);
    await handleZaloWebhook(webhookRequest({ unknown: true }), env);
    expect(log.mock.calls.flat().join(" ")).not.toContain(BASE_ENV.ZALO_BOT_TOKEN);
  });
});
