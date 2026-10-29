import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { API_PREFIX, PROTOCOL_HEADER, validate, type RelayRequest } from "@agent-hub/protocol";
import { createApp } from "../src/app.ts";
import { verifyAssertion } from "../src/auth.ts";
import { HubDatabase } from "../src/db.ts";
import type { ComputerConfig, ServerConfig } from "../src/config.ts";
import { RelayClient } from "../src/relay.ts";
import { EventHub } from "../src/stream.ts";

const connector = "connector-test-token-with-enough-entropy";
const ws = "ws_k3m7q2abcdefghij";
const session = "ses_aaaabbbbccccdddd";
const fixtures = new URL("../../protocol/fixtures/", import.meta.url);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const computerId = "c_abcdefghijklmnop";
const testAssertion = "test-assertion";
async function fixture<T>(name: string): Promise<T> { return JSON.parse(await readFile(new URL(name, fixtures), "utf8")) as T; }
function valid(def: Parameters<typeof validate>[0], value: unknown): void { expect(validate(def, value)).toEqual({ ok: true }); }

let temp: string;
let now: number;
let db: HubDatabase;
let app: ReturnType<typeof createApp>;
let events: EventHub;
let config: ServerConfig;
let relayClients: RelayClient[];

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "hub-server-test-"));
  now = Date.parse("2026-10-28T08:00:00Z");
  await mkdir(join(temp, "data"), { recursive: true });
  const computer: ComputerConfig = { proxy_url: "http://127.0.0.1:9999", computer_id: computerId, computer_key: "computer-key-with-enough-entropy-123456", proxy_public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", username: "alice" };
  config = { port: 7420, host: "127.0.0.1", dataDir: join(temp, "data"), configDir: join(temp, "config"), dbPath: join(temp, "data/hub.db"), connectorKeyPath: join(temp, "config/connector.key"), connectorKeyHash: sha256(connector), origins: ["https://hub.example.test"], kitVersion: "b1741ff", computer, recentDays: 15, runRetentionDays: 60 };
  db = new HubDatabase(config.dbPath, config.connectorKeyHash);
  events = new EventHub();
  app = createApp({ db, config, clock: () => now, events, assertionVerifier: (token, relayFrameId, at) => token === testAssertion
    ? { v: 1, sub: "alice", cid: computerId, rid: relayFrameId ?? "direct-test", exp: Math.floor(at / 1000) + 60 }
    : null });
  relayClients = [];
});
afterEach(async () => {
  for (const relay of relayClients) await relay.stop();
  db?.close();
  await rm(temp, { recursive: true, force: true });
});

async function req(path: string, options: { method?: string; token?: string; assertion?: string | null; body?: unknown; protocol?: string | null; origin?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.assertion !== null) headers["X-Hub-Assertion"] = options.assertion ?? testAssertion;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.protocol !== null) headers[PROTOCOL_HEADER] = options.protocol ?? "2";
  if (options.origin) headers.Origin = options.origin;
  return app.request(`http://127.0.0.1${API_PREFIX}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}

async function doHello(body?: unknown): Promise<{ response: Response; value?: any }> {
  const response = await req("/agent/hello", { method: "POST", token: connector, body: body ?? await fixture("HelloRequest.json") });
  return { response, value: response.status === 200 ? await response.json() : undefined };
}

async function seed(): Promise<void> {
  const hello = await doHello();
  expect(hello.response.status).toBe(200);
  valid("HelloResponse", hello.value);
  const snapshot = await fixture("Snapshot.running.json");
  expect((await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body: snapshot })).status).toBe(204);
  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: await fixture("DecisionsBatch.json") })).status).toBe(204);
}

it("requires protocol 2 and assertion auth, and has no pairing, device, or URL-token routes", async () => {
  expect((await req("/agent/ping", { token: connector, protocol: null })).status).toBe(426);
  const ping = await req("/agent/ping", { token: connector });
  expect(ping.status).toBe(200); valid("PingResponse", await ping.json());
  expect((await req("/agent/ping", { token: connector, protocol: "1" })).status).toBe(426);
  expect((await req("/agent/ping")).status).toBe(401);
  expect((await req("/workspaces", { assertion: null })).status).toBe(401);
  expect((await req("/workspaces", { token: connector, assertion: null })).status).toBe(401);
  for (const path of ["/pair", "/devices"]) {
    expect((await req(path, { assertion: null })).status).toBe(404);
  }
  // The live stream needs the assertion; a URL token is not accepted.
  expect((await req(`/stream?token=${encodeURIComponent(testAssertion)}`, { assertion: null })).status).toBe(401);
  expect((await req("/agent/ping", { token: connector, origin: "http://127.0.0.1:7420" })).headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:7420");
});

it("validates protocol-2 connector and user responses and attributes commands to the assertion owner", async () => {
  const ping = await req("/agent/ping", { token: connector }); valid("PingResponse", await ping.json());
  const hello = await doHello(); expect(hello.response.status).toBe(200); valid("HelloResponse", hello.value);
  for (const name of ["Snapshot.idle-new-workspace.json", "Snapshot.running.json"]) {
    const body = await fixture(name); valid("Snapshot", body);
    expect((await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body })).status).toBe(204);
  }
  const decisions = await fixture("DecisionsBatch.json"); valid("DecisionsBatch", decisions);
  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: decisions })).status).toBe(204);
  const batch = await fixture("EventsBatch.json"); valid("EventsBatch", batch);
  const eventsResponse = await req(`/agent/workspaces/${ws}/events`, { method: "POST", token: connector, body: batch });
  valid("EventsResponse", await eventsResponse.json());
  const documents = await fixture<any>("DocumentsBatch.json"); valid("DocumentsBatch", documents);
  expect((await req(`/agent/workspaces/${ws}/documents`, { method: "PUT", token: connector, body: documents })).status).toBe(204);
  const commands = await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector }); valid("CommandsResponse", await commands.json());

  const workspaces = await req("/workspaces"); const workspaceList = await workspaces.json();
  valid("List", workspaceList); valid("WorkspaceSummary", workspaceList.items[0]);
  expect(workspaceList.items[0]).toMatchObject({ computer_id: null, computer_online: true, upload: { documents: true, diffs: true, orchestrator_screen: true } });
  const detailResponse = await req(`/workspaces/${ws}`); const detail = await detailResponse.json();
  valid("WorkspaceDetail", detail); expect(detail.snapshot.runs).toHaveLength(2); valid("Run", detail.snapshot.runs[0]);
  valid("HubDecision", detail.decisions_open[0]);
  const decisionResponse = await req(`/workspaces/${ws}/decisions/r4/D3`); valid("HubDecision", await decisionResponse.json());
  const documentList = await (await req(`/workspaces/${ws}/documents`)).json(); valid("List", documentList); valid("DocumentMeta", documentList.items[0]);
  const document = await req(`/workspaces/${ws}/documents/content?path=${encodeURIComponent(documents.documents[0].path)}`);
  valid("DocumentContent", await document.json());
  const history = await (await req(`/workspaces/${ws}/history`)).json(); valid("List", history);
  history.items.forEach((item: unknown) => valid("HistoryItem", item));

  const prompt = await req(`/workspaces/${ws}/prompts`, { method: "POST", body: { text: "look at this" } });
  expect(prompt.status).toBe(201); const created = await prompt.json(); valid("UserCommand", created); expect(created.by).toBe("alice");
  const poll = await (await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector })).json();
  valid("CommandsResponse", poll); valid("Command", poll.commands[0]); expect(poll.commands[0].by).toBe("alice");
  const answer = await req(`/workspaces/${ws}/decisions/r4/D3/answer`, { method: "POST", body: { choice: "A" } });
  expect(answer.status).toBe(201); const answerCommand = await answer.json(); valid("UserCommand", answerCommand); expect(answerCommand.by).toBe("alice");
  const repeat = await req(`/workspaces/${ws}/decisions/r4/D3/answer`, { method: "POST", body: { choice: "A" } });
  expect(repeat.status).toBe(200); expect((await repeat.json()).id).toBe(answerCommand.id);
  const changed = await req(`/workspaces/${ws}/decisions/r4/D3/answer`, { method: "POST", body: { choice: "B" } });
  expect(changed.status).toBe(409);
  const archive = await req(`/workspaces/${ws}`, { method: "PATCH", body: { archived: true } });
  valid("WorkspaceSummary", await archive.json());
  expect((await req("/workspaces?archived=true")).status).toBe(200);
});

it("verifies Ed25519 assertions, expiry, owner, computer, and relay-frame binding", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  const computer: ComputerConfig = { ...config.computer!, proxy_public_key: rawKey };
  const timestamp = Math.floor(now / 1000);
  const tokenFor = (payload: object) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${sign(null, Buffer.from(encoded, "ascii"), privateKey).toString("base64url")}`;
  };
  const base = { v: 1, sub: "alice", cid: computerId, rid: "req-1", exp: timestamp + 60 };
  const good = tokenFor(base);
  expect(verifyAssertion(good, computer, now, "req-1")?.sub).toBe("alice");
  expect(verifyAssertion(good, computer, now, null)).toBeNull();
  const secured = createApp({ db, config: { ...config, computer }, clock: () => now, events });
  const directReplay = await secured.request(`http://127.0.0.1${API_PREFIX}/workspaces`, {
    headers: { "X-Agent-Hub-Protocol": "2", "X-Hub-Assertion": good, "X-Hub-Relay-Id": "req-1" },
  });
  expect(directReplay.status).toBe(401);
  const invalid = [
    `${Buffer.from(JSON.stringify(base)).toString("base64url")}.${Buffer.alloc(64).toString("base64url")}`,
    tokenFor({ ...base, exp: timestamp - 1 }),
    tokenFor({ ...base, cid: "c_bcdefghijklmnopq" }),
    tokenFor({ ...base, sub: "bob" }),
    tokenFor({ ...base, rid: "req-2" }),
  ];
  for (const token of invalid) expect(verifyAssertion(token, computer, now, "req-1")).toBeNull();
});

it("derives REPLY_SENT only after a delivered reply while the local decision is still pending", async () => {
  await seed();
  const response = await req(`/workspaces/${ws}/decisions/r4/D3/reply`, { method: "POST", body: { text: "I suggest A" } });
  expect(response.status).toBe(201); const command = await response.json(); valid("UserCommand", command); expect(command.by).toBe("alice");
  expect((await (await req(`/workspaces/${ws}/decisions/r4/D3`)).json()).hub_status).toBe("OPEN");
  expect((await req(`/agent/workspaces/${ws}/commands/${command.id}/ack`, { method: "POST", token: connector, body: { status: "DELIVERED", reason: null } })).status).toBe(204);
  const decision = await (await req(`/workspaces/${ws}/decisions/r4/D3`)).json();
  expect(decision.hub_status).toBe("REPLY_SENT"); valid("HubDecision", decision);
});

it("upserts runs across snapshots and sweeps old finished-run data with the injected clock", async () => {
  const hello = await doHello(); expect(hello.response.status).toBe(200);
  const snapshot = await fixture<any>("Snapshot.running.json");
  db.saveSnapshot(ws, snapshot, now);
  const nextSnapshot = { ...snapshot, runs: [snapshot.runs[0]] };
  db.saveSnapshot(ws, nextSnapshot, now + 1);
  expect(db.getSnapshot(ws)?.runs.map((run) => run.run_id)).toEqual(["r4", "r3"]);

  const staleDone = { ...snapshot.runs[1], run_id: "old-finished", created_at: "2020-01-01T00:00:00Z", finish: { ...snapshot.runs[1].finish, at: "2020-01-02T00:00:00Z" } };
  const staleNoFinish = { ...snapshot.runs[1], run_id: "old-no-finish", status: "FAILED", created_at: "2020-01-01T00:00:00Z", finish: null };
  db.saveSnapshot(ws, { ...snapshot, runs: [snapshot.runs[0], staleDone, staleNoFinish] }, now + 2);
  const decision = await fixture<any>("Decision.repair-open.json"); decision.run_id = "old-finished";
  db.upsertDecisions(ws, [decision], now);
  const batch = await fixture<any>("EventsBatch.json"); batch.run_id = "old-finished";
  db.insertEvents(ws, batch, now);
  const document = await fixture<any>("DocumentsBatch.json"); document.documents[0].run_id = "old-finished";
  db.upsertDocuments(ws, document.documents, now);
  expect(db.sweepFinishedRuns(now, 60)).toBe(2);
  expect(db.listRuns(ws).map((run) => run.run_id)).toContain("r4");
  expect(db.listRuns(ws).map((run) => run.run_id)).not.toContain("old-finished");
  expect(Number(db.sql.prepare("SELECT COUNT(*) AS n FROM decisions WHERE run_id='old-finished'").get()?.n)).toBe(0);
  expect(Number(db.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id='old-finished'").get()?.n)).toBe(0);
  expect(Number(db.sql.prepare("SELECT COUNT(*) AS n FROM documents WHERE run_id='old-finished'").get()?.n)).toBe(0);
});

it("lists online and recent workspaces, with all=true bypassing the recent cutoff", async () => {
  await doHello();
  const second = await fixture<any>("HelloRequest.json"); second.workspace_id = "ws_p4x2d6abcdefghij"; second.session_id = "ses_eeeeffffgggghhhh";
  await doHello(second);
  const third = { ...second, workspace_id: "ws_abcd2345efgh6727", session_id: "ses_2222333344445555" };
  await doHello(third);
  db.sql.prepare("UPDATE workspaces SET last_seen_at=?,status='ONLINE' WHERE id=?").run("2026-01-01T00:00:00.000Z", ws);
  db.sql.prepare("UPDATE workspaces SET last_seen_at=?,status='OFFLINE' WHERE id=?").run(new Date(now - 86_400_000).toISOString(), second.workspace_id);
  db.sql.prepare("UPDATE workspaces SET last_seen_at=?,status='STOPPED' WHERE id=?").run(new Date(now - 16 * 86_400_000).toISOString(), third.workspace_id);
  const recent = await (await req("/workspaces")).json();
  expect(recent.items.map((item: { id: string }) => item.id).sort()).toEqual([ws, second.workspace_id].sort());
  const all = await (await req("/workspaces?all=true")).json();
  expect(all.items.map((item: { id: string }) => item.id)).toContain(third.workspace_id);
});

function serverFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65_536) { const head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(payload.length, 2); return Buffer.concat([head, payload]); }
  const head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2); return Buffer.concat([head, payload]);
}

function parseClientFrames(socket: Duplex, onFrame: (frame: unknown) => void, initial = Buffer.alloc(0)): void {
  let buffer = initial;
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      const maskBytes = masked ? 4 : 0;
      if (buffer.length < offset + maskBytes + length) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
      offset += maskBytes;
      const body = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let index = 0; index < body.length; index++) body[index] ^= mask[index % 4];
      if (opcode === 1) { try { onFrame(JSON.parse(body.toString("utf8"))); } catch {} }
      if (opcode === 8) socket.end();
    }
  });
  socket.on("error", () => undefined);
}

class FakeProxy {
  readonly messages: any[] = [];
  readonly sockets = new Set<Duplex>();
  readonly queued: unknown[] = [];
  readonly paths: string[] = [];
  readonly server = createServer((request, response) => { void this.http(request, response); });
  port = 0;
  websocket = true;
  failPolls = false;
  websocketAttempts = 0;
  authHeaders: string[] = [];
  private waiters: Array<{ predicate: (frame: any) => boolean; resolve: (frame: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  async listen(): Promise<void> {
    this.server.on("upgrade", (request, socket, head) => {
      this.websocketAttempts++;
      if (!this.websocket) { socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n"); return; }
      this.authHeaders.push(String(request.headers.authorization ?? ""));
      const key = request.headers["sec-websocket-key"];
      if (!key) { socket.destroy(); return; }
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      parseClientFrames(socket, (frame) => this.capture(frame), head);
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as { port: number }).port;
  }

  private capture(frame: any): void {
    this.messages.push(frame);
    this.waiters = this.waiters.filter((waiter) => {
      if (!waiter.predicate(frame)) return true;
      clearTimeout(waiter.timer); waiter.resolve(frame); return false;
    });
  }

  waitFor(predicate: (frame: any) => boolean, timeout = 5000): Promise<any> {
    const match = this.messages.find(predicate);
    if (match) return Promise.resolve(match);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        reject(new Error(`fake proxy frame timed out; frames=${this.messages.map((frame) => frame.type).join(",")}; paths=${[...new Set(this.paths)].join(",")}`));
      }, timeout) };
      this.waiters.push(waiter);
    });
  }

  send(frame: unknown): void {
    const socket = [...this.sockets].find((candidate) => !candidate.destroyed);
    if (socket) socket.write(serverFrame(frame));
    else this.queued.push(frame);
  }

  closeSockets(): void { for (const socket of this.sockets) socket.destroy(); this.sockets.clear(); }

  private async http(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
    this.paths.push(path);
    this.authHeaders.push(String(request.headers.authorization ?? ""));
    if (path.endsWith("/connect")) { response.writeHead(426).end(); return; }
    if (path.endsWith("/poll")) {
      if (this.failPolls) { response.writeHead(503).end(); return; }
      const frame = this.queued.shift();
      setTimeout(() => response.end(JSON.stringify({ frames: frame === undefined ? [] : [frame] })), 20);
      return;
    }
    if (path.endsWith("/frames")) {
      if (this.failPolls) { response.writeHead(503).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      try { for (const frame of JSON.parse(Buffer.concat(chunks).toString("utf8")).frames) this.capture(frame); } catch {}
      response.writeHead(204).end(); return;
    }
    response.writeHead(404).end();
  }

  async close(): Promise<void> {
    this.closeSockets();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

function newRelayRequest(id: string, path: string, stream = false): RelayRequest {
  return { type: "req", id, method: "GET", path, query: "", body: null, assertion: testAssertion, stream };
}

function relayApp(signals: { cancelled: boolean; started: boolean }): Hono {
  const relayApp = new Hono();
  relayApp.get("/api/v1/test/ok", (c) => c.json({ ok: true }));
  relayApp.get("/api/v1/test/sse", () => new Response("data: first\n\ndata: second\n\n", { headers: { "Content-Type": "text/event-stream" } }));
  relayApp.get("/api/v1/test/cancellable", (c) => new Promise<Response>((resolve) => {
    signals.started = true;
    c.req.raw.signal.addEventListener("abort", () => { signals.cancelled = true; resolve(new Response("cancelled")); }, { once: true });
  }));
  relayApp.get("/api/v1/test/large", (c) => c.json({ value: "x".repeat(950_000) }));
  relayApp.get("/api/v1/workspaces/:ws/documents/content", (c) => c.json({ meta: { path: "big", bytes: 950_000 }, content: "z".repeat(950_000) }));
  return relayApp;
}

async function startRelay(proxy: FakeProxy, relayAppInstance: Hono, dbInstance = db): Promise<RelayClient> {
  const relayConfig = { ...config, port: proxy.port, computer: { ...config.computer!, proxy_url: `http://127.0.0.1:${proxy.port}` } };
  const relay = new RelayClient(relayAppInstance, dbInstance, relayConfig, relayConfig.computer!, events, () => now);
  relayClients.push(relay);
  relay.start();
  return relay;
}

describe("relay client", () => {
  it("sends hello, routes requests, streams, cancels, bounds frames, updates workspaces, and reconnects", async () => {
    const proxy = new FakeProxy(); await proxy.listen();
    const signals = { cancelled: false, started: false };
    try {
      await doHello();
      const client = await startRelay(proxy, relayApp(signals));
      const hello = await proxy.waitFor((frame) => frame.type === "hello");
      valid("RelayHello", hello); expect(hello.workspaces).toHaveLength(1);
      expect(proxy.authHeaders).toContain(`Bearer ${config.computer!.computer_key}`);

      proxy.send(newRelayRequest("ok-1", "/api/v1/test/ok"));
      const roundTrip = await proxy.waitFor((frame) => frame.type === "res" && frame.id === "ok-1");
      expect(roundTrip).toMatchObject({ status: 200, body: { ok: true } }); valid("RelayResponse", roundTrip);

      proxy.send(newRelayRequest("sse-1", "/api/v1/test/sse", true));
      const streamStart = await proxy.waitFor((frame) => frame.type === "res" && frame.id === "sse-1");
      expect(streamStart.body).toBeNull();
      const chunks = await proxy.waitFor((frame) => frame.type === "end" && frame.id === "sse-1");
      const streamData = proxy.messages.filter((frame) => frame.type === "chunk" && frame.id === "sse-1").map((frame) => frame.data).join("");
      expect(streamData).toContain("data: first"); expect(chunks.status).toBe(200); valid("RelayStreamEnd", chunks);

      proxy.send(newRelayRequest("cancel-1", "/api/v1/test/cancellable", true));
      await new Promise<void>((resolve) => {
        const until = Date.now() + 3000;
        const poll = () => signals.started ? resolve() : Date.now() >= until ? resolve() : setTimeout(poll, 10);
        poll();
      });
      proxy.send({ type: "cancel", id: "cancel-1" });
      await new Promise<void>((resolve) => {
        const until = Date.now() + 3000;
        const poll = () => signals.cancelled ? resolve() : Date.now() >= until ? resolve() : setTimeout(poll, 10);
        poll();
      });
      expect(signals.cancelled).toBe(true);
      expect(proxy.messages.some((frame) => frame.type === "res" && frame.id === "cancel-1")).toBe(false);

      proxy.send(newRelayRequest("large-1", "/api/v1/test/large"));
      const oversized = await proxy.waitFor((frame) => frame.type === "res" && frame.id === "large-1");
      expect(oversized.status).toBe(413); expect(oversized.body.error.code).toBe("payload_too_large");

      proxy.send(newRelayRequest("doc-1", `/api/v1/workspaces/${ws}/documents/content?path=big`, true));
      await proxy.waitFor((frame) => frame.type === "end" && frame.id === "doc-1");
      const documentChunks = proxy.messages.filter((frame) => frame.type === "chunk" && frame.id === "doc-1");
      expect(documentChunks.length).toBeGreaterThan(1);
      expect(documentChunks.map((frame) => frame.data).join("")).toContain("\"content\":\"z");
      documentChunks.forEach((frame) => valid("RelayStreamChunk", frame));

      const other = await fixture<any>("HelloRequest.json"); other.workspace_id = "ws_p4x2d6abcdefghij"; other.session_id = "ses_eeeeffffgggghhhh";
      const newWorkspace = await doHello(other);
      expect(newWorkspace.response.status).toBe(200);
      const workspaces = await proxy.waitFor((frame) => frame.type === "workspaces" && frame.workspaces.length === 2, 5000);
      valid("RelayWorkspaces", workspaces);
      expect(workspaces.workspaces).toContainEqual(expect.objectContaining({ workspace_id: other.workspace_id, name: other.name, status: "ONLINE" }));

      const firstConnectedAt = Date.now();
      const initialWebsocketAttempts = proxy.websocketAttempts;
      proxy.closeSockets(); proxy.failPolls = true;
      const reconnect = await proxy.waitFor((frame) => frame.type === "hello" && proxy.websocketAttempts > initialWebsocketAttempts, 5000);
      expect(Date.now() - firstConnectedAt).toBeGreaterThanOrEqual(900);
      valid("RelayHello", reconnect);
      await client.stop();
    } finally { await proxy.close(); }
  });

  it("uses HTTPS long-poll fallback after the WebSocket upgrade fails", async () => {
    const proxy = new FakeProxy(); proxy.websocket = false; await proxy.listen();
    try {
      const client = await startRelay(proxy, relayApp({ cancelled: false, started: false }));
      const hello = await proxy.waitFor((frame) => frame.type === "hello", 3000);
      valid("RelayHello", hello);
      proxy.send(newRelayRequest("poll-1", "/api/v1/test/ok"));
      const response = await proxy.waitFor((frame) => frame.type === "res" && frame.id === "poll-1");
      valid("RelayResponse", response); expect(response.body).toEqual({ ok: true });
      expect(client.status().transport).toBe("long-poll-direct");
      await client.stop();
    } finally { await proxy.close(); }
  }, 15000);
});

it("streams published changes as named server-sent events", async () => {
  const controller = new AbortController();
  const response = await app.request(`http://127.0.0.1${API_PREFIX}/stream`, {
    headers: { "X-Hub-Assertion": testAssertion, [PROTOCOL_HEADER]: "2" }, signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = decoder.decode((await reader.read()).value);
  events.publish({ type: "decision", workspace_id: ws, at: "2026-10-28T08:00:00Z", ref: "r4/D3" });
  while (!text.includes("event: decision")) text += decoder.decode((await reader.read()).value);
  expect(text).toContain(`"ref":"r4/D3"`);
  controller.abort();
  await reader.cancel().catch(() => undefined);
});
