import { readFile, writeFile } from "node:fs/promises";
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, WebSocket } from "undici";
import { LIMITS, PROTOCOL, PROTOCOL_HEADER, validate, type RelayHello, type RelayRequest, type RelayWorkspaces } from "@agent-hub/protocol";
import type { Hono } from "hono";
import { bindRelayFrameId } from "./auth.ts";
import type { ComputerConfig, ServerConfig } from "./config.ts";
import type { HubDatabase } from "./db.ts";
import { EventHub } from "./stream.ts";

type Transport = "websocket" | "long-poll-direct" | "long-poll-proxy";
type RelayStatus = { transport: Transport | null; connected: boolean; owner: string; pid: number; updated_at: string };
type RelayFrame = Record<string, unknown> & { type: string; id?: string };
type OutgoingDef = "RelayHello" | "RelayWorkspaces" | "RelayResponse" | "RelayStreamChunk" | "RelayStreamEnd" | "RelayPong";

const frameBytes = (frame: unknown) => Buffer.byteLength(JSON.stringify(frame), "utf8");

function endpoint(computer: ComputerConfig, action: string, websocket = false): URL {
  const url = new URL(computer.proxy_url);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v1/computers/${encodeURIComponent(computer.computer_id)}/${action}`;
  if (websocket) url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

function requireValidFrame(def: OutgoingDef, frame: unknown): void {
  if (!validate(def, frame).ok) throw new Error(`invalid ${def} frame`);
}

function splitText(text: string, maxChars = 60_000): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxChars) chunks.push(text.slice(offset, offset + maxChars));
  return chunks;
}

export class RelayClient {
  private readonly abort = new AbortController();
  private readonly requests = new Map<string, AbortController>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();
  private readonly unsubscribe: () => void;
  private currentSocket?: WebSocket;
  private preferred?: Transport;
  private currentStatus: RelayStatus;
  private running?: Promise<void>;
  private sendWorkspaces?: () => void;
  private backoffMs = 1_000;
  // A dead network path can leave a socket or request open forever; these bound every wait so the loop always retries.
  readonly timeouts = { connectMs: 15_000, heartbeatMs: LIMITS.heartbeatSeconds * 1000, silenceMs: LIMITS.heartbeatSeconds * 3000, requestMs: 15_000, pollMs: (LIMITS.relayPollSeconds + 15) * 1000 };

  private readonly app: Hono;
  private readonly db: HubDatabase;
  private readonly config: ServerConfig;
  private readonly computer: ComputerConfig;
  private readonly clock: () => number;

  constructor(app: Hono, db: HubDatabase, config: ServerConfig, computer: ComputerConfig, events: EventHub, clock: () => number) {
    this.app = app;
    this.db = db;
    this.config = config;
    this.computer = computer;
    this.clock = clock;
    this.currentStatus = { transport: null, connected: false, owner: computer.username, pid: process.pid, updated_at: new Date(clock()).toISOString() };
    this.unsubscribe = events.subscribe((event) => {
      if (event.type !== "workspace") return;
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.sendWorkspaces?.();
      }, 2_000);
      this.timers.add(timer);
    });
  }

  status(): RelayStatus { return { ...this.currentStatus }; }

  start(): void {
    if (this.running) return;
    this.running = this.run().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.abort.abort();
    this.currentSocket?.close();
    for (const controller of this.requests.values()) controller.abort();
    for (const timer of this.timers) clearTimeout(timer);
    for (const interval of this.intervals) clearInterval(interval);
    this.timers.clear();
    this.intervals.clear();
    this.unsubscribe();
    this.currentStatus = { ...this.currentStatus, connected: false, updated_at: new Date(this.clock()).toISOString() };
    await this.writeStatus();
    await this.running;
  }

  private async setStatus(transport: Transport | null, connected: boolean): Promise<void> {
    this.currentStatus = { ...this.currentStatus, transport, connected, updated_at: new Date(this.clock()).toISOString() };
    await this.writeStatus();
  }

  private async writeStatus(): Promise<void> {
    await writeFile(`${this.config.dataDir}/relay-status.json`, JSON.stringify(this.currentStatus), { mode: 0o600 });
  }

  private async run(): Promise<void> {
    while (!this.abort.signal.aborted) {
      const order: Transport[] = ["websocket", "long-poll-direct", "long-poll-proxy"];
      if (this.preferred) order.unshift(order.splice(order.indexOf(this.preferred), 1)[0]);
      for (const transport of order) {
        try {
          await this.setStatus(transport, false);
          if (transport === "websocket") await this.runWebSocket();
          else await this.runLongPoll(transport === "long-poll-proxy");
        } catch {
          if (this.abort.signal.aborted) break;
          await this.setStatus(transport, false);
        }
        if (this.abort.signal.aborted) break;
      }
      if (!this.abort.signal.aborted) {
        await this.setStatus(this.currentStatus.transport, false);
        process.stderr.write("Agent Hub relay disconnected; retrying.\n");
        await this.delay(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, ms);
      this.timers.add(timer);
      this.abort.signal.addEventListener("abort", () => { clearTimeout(timer); this.timers.delete(timer); resolve(); }, { once: true });
    });
  }

  private hello(): RelayHello {
    return { type: "hello", protocol: PROTOCOL, computer_id: this.computer.computer_id, backend_version: "0.1.0", workspaces: this.db.workspaceIndex() };
  }

  private workspaceFrame(): RelayWorkspaces {
    return { type: "workspaces", workspaces: this.db.workspaceIndex() };
  }

  private async runWebSocket(): Promise<void> {
    const socket = new WebSocket(endpoint(this.computer, "connect", true), {
      headers: { Authorization: `Bearer ${this.computer.computer_key}` },
    });
    this.currentSocket = socket;
    const send = (frame: unknown, def: OutgoingDef) => {
      requireValidFrame(def, frame);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    };
    this.sendWorkspaces = () => send(this.workspaceFrame(), "RelayWorkspaces");
    let lastMessageAt = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => error ? reject(error) : resolve();
        this.abort.signal.addEventListener("abort", () => { socket.close(); finish(new Error("relay stopped")); }, { once: true });
        const connectTimer = setTimeout(() => {
          this.timers.delete(connectTimer);
          if (socket.readyState !== WebSocket.OPEN) { socket.close(); finish(new Error("relay websocket connect timed out")); }
        }, this.timeouts.connectMs);
        this.timers.add(connectTimer);
        socket.addEventListener("open", () => {
          clearTimeout(connectTimer); this.timers.delete(connectTimer);
          if (this.abort.signal.aborted) { socket.close(); finish(new Error("relay stopped")); return; }
          this.preferred = "websocket";
          this.backoffMs = 1_000;
          void this.setStatus("websocket", true);
          send(this.hello(), "RelayHello");
          lastMessageAt = Date.now();
          const heartbeat = setInterval(() => {
            // The proxy answers every ping, so silence means the connection is gone even if no close event arrived.
            if (Date.now() - lastMessageAt > this.timeouts.silenceMs) { socket.close(); finish(new Error("relay websocket silent")); return; }
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
          }, this.timeouts.heartbeatMs);
          this.intervals.add(heartbeat);
          this.sendWorkspaces = () => send(this.workspaceFrame(), "RelayWorkspaces");
        });
        socket.addEventListener("message", (event) => {
          lastMessageAt = Date.now();
          void this.receive(event.data, (frame) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
          }).catch(() => undefined);
        });
        socket.addEventListener("error", () => finish(new Error("relay websocket failed")));
        socket.addEventListener("close", () => finish(new Error("relay websocket closed")));
      });
    } finally {
      this.sendWorkspaces = undefined;
      this.currentSocket = undefined;
      for (const interval of this.intervals) clearInterval(interval);
      this.intervals.clear();
      for (const controller of this.requests.values()) controller.abort();
      this.requests.clear();
    }
  }

  private async runLongPoll(useProxy: boolean): Promise<void> {
    const base = endpoint(this.computer, "poll");
    const framesUrl = endpoint(this.computer, "frames");
    const dispatcher = useProxy ? new EnvHttpProxyAgent() : new Agent();
    const outgoing: RelayFrame[] = [this.hello() as unknown as RelayFrame];
    let flushing = false;
    let flushError: Error | undefined;
    const flush = async () => {
      if (flushing || !outgoing.length) return;
      flushing = true;
      try {
        while (outgoing.length) {
          const frames = outgoing.splice(0, 50);
          const response = await undiciFetch(framesUrl, {
            method: "POST", dispatcher, signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.timeouts.requestMs)]),
            headers: { Authorization: `Bearer ${this.computer.computer_key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ frames }),
          });
          if (!response.ok) throw new Error("relay frame post failed");
        }
      } catch (error) {
        flushError = error instanceof Error ? error : new Error("relay frame post failed");
      } finally {
        flushing = false;
      }
    };
    this.sendWorkspaces = () => { outgoing.push(this.workspaceFrame() as unknown as RelayFrame); void flush(); };
    const flushTimer = setInterval(() => { void flush(); }, 100);
    this.intervals.add(flushTimer);
    try {
      await flush();
      if (flushError) throw flushError;
      this.preferred = useProxy ? "long-poll-proxy" : "long-poll-direct";
      this.backoffMs = 1_000;
      await this.setStatus(this.preferred, true);
      while (!this.abort.signal.aborted) {
        if (flushError) throw flushError;
        const url = new URL(base);
        url.searchParams.set("wait", String(LIMITS.relayPollSeconds));
        const pollTimeout = AbortSignal.timeout(this.timeouts.pollMs);
        const response = await undiciFetch(url, { dispatcher, signal: AbortSignal.any([this.abort.signal, pollTimeout]),
          headers: { Authorization: `Bearer ${this.computer.computer_key}` } });
        if (!response.ok) throw new Error("relay poll failed");
        const payload: unknown = await response.json();
        if (!validate("RelayPollResponse", payload).ok) throw new Error("invalid relay poll response");
        const frames = (payload as { frames: RelayFrame[] }).frames;
        for (const frame of frames) await this.receive(frame, (outgoingFrame) => { outgoing.push(outgoingFrame); void flush(); });
        await flush();
      }
    } finally {
      this.sendWorkspaces = undefined;
      clearInterval(flushTimer);
      this.intervals.delete(flushTimer);
      dispatcher.close();
      for (const controller of this.requests.values()) controller.abort();
      this.requests.clear();
    }
  }

  private async receive(data: unknown, send: (frame: RelayFrame) => void): Promise<void> {
    let frame: unknown;
    try {
      if (data && typeof data === "object" && !(data instanceof ArrayBuffer) && !(data instanceof Blob)) frame = data;
      else {
        const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : await (data as Blob).text();
        frame = JSON.parse(text);
      }
    } catch { return; }
    if (frame && typeof frame === "object" && (frame as RelayFrame).type === "ping") {
      const pong = { type: "pong" };
      requireValidFrame("RelayPong", pong);
      send(pong);
      return;
    }
    if (frame && typeof frame === "object" && (frame as RelayFrame).type === "cancel") {
      const cancel = frame as RelayFrame;
      if (typeof cancel.id === "string") this.requests.get(cancel.id)?.abort();
      return;
    }
    if (!validate("RelayRequest", frame).ok) return;
    const requestFrame = frame as RelayRequest;
    if (frameBytes(requestFrame) > LIMITS.relayFrameBytes) {
      send({ type: "res", id: requestFrame.id, status: 413, body: { error: { code: "payload_too_large", message: "relay frame exceeds the allowed size" } } });
      return;
    }
    const controller = new AbortController();
    this.requests.set(requestFrame.id, controller);
    void this.dispatch(requestFrame, controller, send).finally(() => this.requests.delete(requestFrame.id));
  }

  private async dispatch(frame: RelayRequest, controller: AbortController, send: (frame: RelayFrame) => void): Promise<void> {
    try {
      const bodyText = frame.body === null ? undefined : JSON.stringify(frame.body);
      if (bodyText && Buffer.byteLength(bodyText, "utf8") > LIMITS.relayFrameBytes) {
        send({ type: "res", id: frame.id, status: 413, body: { error: { code: "payload_too_large", message: "request body exceeds the relay frame size" } } });
        return;
      }
      const target = `http://127.0.0.1:${this.config.port}${frame.path}${frame.query ? `?${frame.query}` : ""}`;
      const request = new Request(target, {
        method: frame.method,
        headers: {
          ...(bodyText ? { "Content-Type": "application/json" } : {}),
          [PROTOCOL_HEADER]: String(PROTOCOL),
          "X-Hub-Assertion": frame.assertion,
        },
        ...(bodyText && !["GET", "HEAD"].includes(frame.method) ? { body: bodyText } : {}),
        signal: controller.signal,
      });
      bindRelayFrameId(request, frame.id);
      const response = await this.app.fetch(request);
      if (controller.signal.aborted) return;
      const shouldStream = frame.stream || (frame.path.endsWith("/documents/content") && response.headers.get("Content-Length") !== null
        && Number(response.headers.get("Content-Length")) > LIMITS.relayFrameBytes);
      if (shouldStream) {
        const start = { type: "res", id: frame.id, status: response.status, body: null };
        requireValidFrame("RelayResponse", start);
        send(start);
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const text of splitText(decoder.decode(value, { stream: true }))) {
              const chunk = { type: "chunk", id: frame.id, data: text };
              requireValidFrame("RelayStreamChunk", chunk);
              send(chunk);
            }
          }
          for (const text of splitText(decoder.decode())) {
            const chunk = { type: "chunk", id: frame.id, data: text };
            requireValidFrame("RelayStreamChunk", chunk);
            send(chunk);
          }
        }
        const end = { type: "end", id: frame.id, status: response.status };
        requireValidFrame("RelayStreamEnd", end);
        send(end);
        return;
      }
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      const result = { type: "res", id: frame.id, status: response.status, body };
      if (frameBytes(result) > LIMITS.relayFrameBytes) {
        send({ type: "res", id: frame.id, status: 413, body: { error: { code: "payload_too_large", message: "response exceeds the relay frame size" } } });
        return;
      }
      requireValidFrame("RelayResponse", result);
      send(result);
    } catch {
      if (controller.signal.aborted) return;
      send({ type: "res", id: frame.id, status: 500, body: { error: { code: "internal_error", message: "relay request failed" } } });
    }
  }
}

export function createRelayClient(app: Hono, db: HubDatabase, config: ServerConfig, events: EventHub, clock: () => number): RelayClient | undefined {
  if (!config.computer) return undefined;
  return new RelayClient(app, db, config, config.computer, events, clock);
}

export async function readRelayStatus(config: Pick<ServerConfig, "dataDir">): Promise<RelayStatus | undefined> {
  try {
    const value = JSON.parse(await readFile(`${config.dataDir}/relay-status.json`, "utf8")) as RelayStatus;
    if (!Number.isInteger(value.pid) || value.pid < 1) return undefined;
    try { process.kill(value.pid, 0); }
    catch { return { ...value, connected: false }; }
    return value;
  } catch { return undefined; }
}
