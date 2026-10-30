import { LIMITS } from "../../protocol/src/api.ts";
import type { Env } from "./env.ts";
import { notifyComputerOffline } from "./notify.ts";

type Frame = Record<string, unknown> & { type: string };
type Pending = {
  timer: ReturnType<typeof setTimeout>;
  stream: boolean;
  socket?: WebSocket;
  resolve: (response: Response) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  responseStarted: boolean;
};

type RelaySocket = WebSocket & {
  serializeAttachment(attachment: unknown): void;
  deserializeAttachment(): unknown;
};

const encoder = new TextEncoder();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function frameBytes(frame: unknown): number {
  return encoder.encode(JSON.stringify(frame) ?? "").byteLength;
}

function validWorkspaceIndexEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["workspace_id", "name", "status", "last_seen_at"])) return false;
  const timestamp = value.last_seen_at;
  return typeof value.workspace_id === "string" && /^ws_[a-z2-7]{16}$/.test(value.workspace_id)
    && typeof value.name === "string" && value.name.length <= 128
    && ["ONLINE", "OFFLINE", "STOPPED"].includes(String(value.status))
    && (timestamp === null || (typeof timestamp === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(timestamp)));
}

function validResponseFrame(frame: Frame): boolean {
  if (frame.type === "res") return hasOnlyKeys(frame, ["type", "id", "status", "body"])
    && typeof frame.id === "string" && frame.id.length <= 64
    && Number.isInteger(frame.status) && Number(frame.status) >= 100 && Number(frame.status) <= 599
    && Object.hasOwn(frame, "body") && isJsonValue(frame.body);
  if (frame.type === "chunk") return hasOnlyKeys(frame, ["type", "id", "data"])
    && typeof frame.id === "string" && frame.id.length <= 64 && typeof frame.data === "string" && frame.data.length <= 900_000;
  if (frame.type === "end") return hasOnlyKeys(frame, ["type", "id", "status"])
    && typeof frame.id === "string" && frame.id.length <= 64 && Number.isInteger(frame.status);
  if (frame.type === "hello") return hasOnlyKeys(frame, ["type", "protocol", "computer_id", "backend_version", "workspaces"])
    && frame.protocol === 2 && typeof frame.computer_id === "string" && /^c_[a-z2-7]{16}$/.test(frame.computer_id)
    && typeof frame.backend_version === "string" && frame.backend_version.length <= 64
    && Array.isArray(frame.workspaces) && frame.workspaces.length <= 200 && frame.workspaces.every(validWorkspaceIndexEntry);
  if (frame.type === "workspaces") return hasOnlyKeys(frame, ["type", "workspaces"])
    && Array.isArray(frame.workspaces) && frame.workspaces.length <= 200 && frame.workspaces.every(validWorkspaceIndexEntry);
  return frame.type === "pong" && hasOnlyKeys(frame, ["type"]);
}

export class ComputerRelay {
  private readonly state: DurableObjectState;
  private readonly db: D1Database;
  private readonly bindings: Env;
  private readonly pending = new Map<string, Pending>();
  private readonly queuedFrames: string[] = [];
  private readonly pollWaiters = new Set<() => void>();
  private readonly now: () => number;
  private malformedFrames = 0;
  private computerId = "";

  constructor(ctx: DurableObjectState, bindings: Env, now: () => number = Date.now) {
    this.state = ctx;
    this.db = bindings.DB;
    this.bindings = bindings;
    this.now = now;
  }

  private async knownComputerId(): Promise<string> {
    if (!this.computerId) this.computerId = (await this.state.storage.get<string>("computerId")) ?? "";
    return this.computerId;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internal = /^\/internal\/computers\/([^/]+)\/(status|relay)$/.exec(url.pathname);
    if (internal) {
      let computerId: string;
      try { computerId = decodeURIComponent(internal[1]); } catch { return error("not_found", "Route not found.", 404); }
      if (internal[2] === "status" && request.method === "GET") {
        return json({ online: await this.isOnline() });
      }
      if (internal[2] === "relay") return this.relay(request, computerId);
    }
    const cancelRoute = /^\/internal\/computers\/[^/]+\/cancel\/([^/]+)$/.exec(url.pathname);
    if (cancelRoute && request.method === "POST") {
      let requestId: string;
      try { requestId = decodeURIComponent(cancelRoute[1]); } catch { return error("not_found", "Route not found.", 404); }
      this.cancel(requestId);
      return new Response(null, { status: 204 });
    }

    const publicRoute = /^\/api\/v1\/computers\/([^/]+)\/(connect|poll|frames)$/.exec(url.pathname);
    if (!publicRoute) return error("not_found", "Route not found.", 404);
    let computerId: string;
    try { computerId = decodeURIComponent(publicRoute[1]); } catch { return error("not_found", "Computer not found.", 404); }
    if (!/^c_[a-z2-7]{16}$/.test(computerId)) return error("not_found", "Computer not found.", 404);
    if (this.computerId !== computerId) {
      this.computerId = computerId;
      // Persist it: a hibernated object is rebuilt with empty fields before webSocketMessage runs.
      await this.state.storage.put("computerId", computerId);
    }
    if (publicRoute[2] === "connect") return this.connect(request);
    if (publicRoute[2] === "poll") return this.poll(request, computerId, url);
    return this.receiveFrames(request, computerId);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    (socket as RelaySocket).serializeAttachment({ lastSeenAt: this.now() });
    const bytes = typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength;
    if (bytes > LIMITS.relayFrameBytes) {
      this.countMalformedFrame();
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      this.countMalformedFrame();
      return;
    }
    await this.processFrame(frame, socket);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (pending.responseStarted && pending.controller) {
        pending.controller.error(new Error("Computer disconnected."));
      } else {
        pending.resolve(error("computer_offline", "Computer disconnected.", 503));
      }
    }
    await this.scheduleOfflineAlarm();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const computerId = await this.knownComputerId();
    if (!computerId) return;
    if (await this.isOnline()) {
      if (!this.liveSocket()) await this.state.storage.setAlarm?.(this.now() + 10 * 60_000 + 40_000);
      return;
    }
    if (await this.state.storage.get<boolean>("offline_notified")) return;
    await this.state.storage.put("offline_notified", true);
    try {
      await notifyComputerOffline(this.bindings, computerId);
    } catch {
      console.warn(JSON.stringify({ event: "computer_offline_notification_failed" }));
    }
  }

  private async isOnline(): Promise<boolean> {
    if (this.liveSocket()) return true;
    const lastPoll = await this.state.storage.get<number>("last_poll_at");
    return typeof lastPoll === "number" && this.now() - lastPoll <= 40_000;
  }

  private liveSocket(): WebSocket | undefined {
    const now = this.now();
    for (const socket of this.state.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      let attachment: unknown;
      try { attachment = (socket as RelaySocket).deserializeAttachment(); } catch {}
      if (isRecord(attachment) && typeof attachment.lastSeenAt === "number" && now - attachment.lastSeenAt <= 75_000) {
        return socket;
      } else {
        try { socket.close(4001, "stale"); } catch {}
        // Closing it ourselves may not fire webSocketClose, so fail what was sent on it now.
        void this.webSocketClose(socket);
      }
    }
    return undefined;
  }

  private async connect(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return error("bad_request", "A WebSocket upgrade is required.", 426);
    }
    await this.clearOfflineAlarm();
    for (const socket of this.state.getWebSockets()) {
      try { socket.close(4000, "replaced"); } catch {}
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    this.state.acceptWebSocket(pair[1]);
    (pair[1] as RelaySocket).serializeAttachment({ lastSeenAt: this.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async relay(request: Request, computerId: string): Promise<Response> {
    if (request.method !== "POST") return error("bad_request", "Use POST.", 405);
    let source: string;
    try { source = await request.clone().text(); } catch { return error("bad_request", "Request body must be valid JSON.", 400); }
    if (encoder.encode(source).byteLength > LIMITS.relayFrameBytes) {
      return error("payload_too_large", "Relay frames must be at most 900 KB.", 413);
    }
    let frame: unknown;
    try { frame = JSON.parse(source); } catch { return error("bad_request", "Request body must be valid JSON.", 400); }
    if (!isRecord(frame) || frame.type !== "req" || !hasOnlyKeys(frame, ["type", "id", "method", "path", "query", "body", "assertion", "stream"])
      || typeof frame.id !== "string" || !frame.id
      || frame.id.length > 64 || typeof frame.method !== "string" || typeof frame.path !== "string"
      || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(frame.method)
      || frame.path.length > 1024 || !frame.path.startsWith("/api/v1/")
      || typeof frame.query !== "string" || frame.query.length > 2048 || frame.query.includes("?")
      || !Object.hasOwn(frame, "body") || !isJsonValue(frame.body)
      || typeof frame.assertion !== "string" || frame.assertion.length > 2048 || typeof frame.stream !== "boolean") {
      return error("bad_request", "Request body does not match RelayRequest.", 400);
    }
    const requestFrame = frame as Frame;
    const id = requestFrame.id as string;
    const websocket = this.liveSocket();
    if (!websocket && !await this.isOnline()) return error("computer_offline", "Computer is offline.", 503);

    return new Promise<Response>((resolve) => {
      const pending: Pending = {
        timer: setTimeout(() => this.timeout(id), LIMITS.relayTimeoutSeconds * 1000),
        stream: requestFrame.stream === true,
        socket: websocket,
        resolve,
        responseStarted: false,
      };
      if (pending.stream) {
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => { pending.controller = controller; },
          cancel: () => this.cancel(id),
        });
        (pending as Pending & { body: ReadableStream<Uint8Array> }).body = body;
      }
      this.pending.set(id, pending);
      if (request.signal.aborted) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        resolve(error("computer_offline", "Relay request was canceled.", 503));
        return;
      }
      request.signal.addEventListener("abort", () => this.cancel(id), { once: true });
      if (websocket) {
        try { websocket.send(JSON.stringify(requestFrame)); } catch { this.failOffline(id); }
      } else {
        this.queuedFrames.push(JSON.stringify(requestFrame));
        this.wakePollers();
      }
    });
  }

  private async poll(request: Request, computerId: string, url: URL): Promise<Response> {
    if (request.method !== "GET") return error("bad_request", "Use GET.", 405);
    const requested = Number(url.searchParams.get("wait") ?? LIMITS.relayPollSeconds);
    if (!Number.isFinite(requested) || requested < 0) return error("bad_request", "wait must be a non-negative number.", 400);
    const waitSeconds = Math.min(Math.floor(requested), LIMITS.relayPollSeconds);
    await this.clearOfflineAlarm();
    await this.touchComputer(computerId);
    await this.state.storage.put("last_poll_at", this.now());
    if (this.queuedFrames.length === 0 && waitSeconds > 0) await this.waitForPoll(Math.min(waitSeconds * 1000, LIMITS.relayPollSeconds * 1000));
    const frames = this.queuedFrames.splice(0, 50).map((encoded) => JSON.parse(encoded));
    await this.scheduleOfflineAlarm();
    return json({ frames });
  }

  private async receiveFrames(request: Request, computerId: string): Promise<Response> {
    if (request.method !== "POST") return error("bad_request", "Use POST.", 405);
    let body: unknown;
    try { body = await request.json(); } catch { return error("bad_request", "Request body must be valid JSON.", 400); }
    if (!isRecord(body) || !hasOnlyKeys(body, ["frames"]) || !Array.isArray(body.frames) || body.frames.length > 50) {
      return error("bad_request", "Request body does not match RelayFramesRequest.", 400);
    }
    if (body.frames.some((frame) => frameBytes(frame) > LIMITS.relayFrameBytes)) {
      return error("payload_too_large", "Relay frames must be at most 900 KB.", 413);
    }
    await this.clearOfflineAlarm();
    await this.touchComputer(computerId);
    for (const frame of body.frames) {
      if (!isRecord(frame) || typeof frame.type !== "string" || !validResponseFrame(frame as Frame)) {
        this.countMalformedFrame();
        continue;
      }
      if (frame.type === "hello") {
        for (const socket of this.state.getWebSockets()) {
          try { socket.close(4000, "replaced"); } catch {}
          await this.webSocketClose(socket);
        }
      }
      await this.processFrame(frame);
    }
    await this.scheduleOfflineAlarm();
    return new Response(null, { status: 204 });
  }

  private async processFrame(value: unknown, socket?: WebSocket): Promise<void> {
    if (!isRecord(value) || typeof value.type !== "string" || frameBytes(value) > LIMITS.relayFrameBytes) {
      this.countMalformedFrame();
      return;
    }
    const frame = value as Frame;
    if (frame.type === "ping" && hasOnlyKeys(frame, ["type"])) {
      try { socket?.send(JSON.stringify({ type: "pong" })); } catch {}
      return;
    }
    if (frame.type === "hello" || frame.type === "workspaces") {
      if (!validResponseFrame(frame)) {
        this.countMalformedFrame();
        return;
      }
      const computerId = await this.knownComputerId();
      const frameComputerId = frame.type === "hello" ? frame.computer_id : computerId;
      if (typeof frameComputerId !== "string" || frameComputerId !== computerId) {
        this.countMalformedFrame();
        return;
      }
      await this.upsertWorkspaces(frame.workspaces as unknown[], frameComputerId);
      return;
    }
    if (!validResponseFrame(frame)) {
      this.countMalformedFrame();
      return;
    }
    const id = frame.id;
    if (typeof id !== "string") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    if (frame.type === "res") {
      if (!pending.stream) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve(json(frame.body, Number(frame.status)));
        return;
      }
      if (!pending.responseStarted) {
        pending.responseStarted = true;
        clearTimeout(pending.timer);
        const body = (pending as Pending & { body: ReadableStream<Uint8Array> }).body;
        pending.resolve(new Response(body, {
          status: Number(frame.status),
          headers: { "content-type": "application/octet-stream" },
        }));
        if (frame.body !== null) pending.controller?.enqueue(encoder.encode(JSON.stringify(frame.body)));
      }
      return;
    }
    if (frame.type === "chunk") {
      pending.controller?.enqueue(encoder.encode(String(frame.data)));
      return;
    }
    if (frame.type === "end") {
      if (!pending.responseStarted) {
        pending.responseStarted = true;
        const body = (pending as Pending & { body: ReadableStream<Uint8Array> }).body;
        pending.resolve(new Response(body, { status: Number(frame.status) }));
      }
      pending.controller?.close();
      clearTimeout(pending.timer);
      this.pending.delete(id);
    }
  }

  private async upsertWorkspaces(value: unknown[], computerId?: string): Promise<void> {
    if (computerId && !/^c_[a-z2-7]{16}$/.test(computerId)) {
      this.countMalformedFrame();
      return;
    }
    const now = new Date().toISOString();
    if (computerId) await this.touchComputer(computerId);
    for (const item of value) {
      if (!validWorkspaceIndexEntry(item)) {
        this.countMalformedFrame();
        continue;
      }
      const timestamp = typeof item.last_seen_at === "string" ? item.last_seen_at : now;
      if (!computerId) continue;
      await this.db.prepare(
        `INSERT INTO workspace_index (workspace_id, computer_id, name, status, last_seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET computer_id = excluded.computer_id, name = excluded.name,
         status = excluded.status, last_seen_at = excluded.last_seen_at`,
      ).bind(item.workspace_id, computerId, item.name, item.status, timestamp).run();
    }
  }

  private async touchComputer(computerId: string): Promise<void> {
    await this.db.prepare("UPDATE computers SET last_seen_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), computerId).run();
  }

  private async clearOfflineAlarm(): Promise<void> {
    await this.state.storage.deleteAlarm?.();
    await this.state.storage.put("offline_notified", false);
  }

  private async scheduleOfflineAlarm(): Promise<void> {
    if (this.liveSocket()) return;
    await this.state.storage.setAlarm?.(this.now() + 10 * 60_000);
  }

  private async waitForPoll(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.pollWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.pollWaiters.add(finish);
    });
  }

  private wakePollers(): void {
    for (const wake of [...this.pollWaiters]) wake();
  }

  private timeout(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.responseStarted && pending.controller) {
      pending.controller.error(new Error("Computer did not finish the stream in time."));
    } else {
      pending.resolve(error("computer_timeout", "Computer did not reply in time.", 504));
    }
  }

  private failOffline(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(error("computer_offline", "Computer is offline.", 503));
  }

  private cancel(id: string): void {
    const pending = this.pending.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (pending.responseStarted) {
        try { pending.controller?.close(); } catch {}
      } else {
        pending.resolve(error("computer_offline", "Relay request was canceled.", 503));
      }
    }
    const cancelFrame = JSON.stringify({ type: "cancel", id });
    const websocket = this.liveSocket();
    if (websocket) {
      try { websocket.send(cancelFrame); } catch {}
    } else {
      this.queuedFrames.push(cancelFrame);
      this.wakePollers();
    }
  }

  private countMalformedFrame(): void {
    this.malformedFrames += 1;
    console.warn(JSON.stringify({ event: "malformed_relay_frame", count: this.malformedFrames }));
  }
}
