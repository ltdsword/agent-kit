import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { API_PREFIX, validate, type Decision } from "@agent-hub/protocol";
import { createApp } from "../src/app.ts";
import { HubDatabase } from "../src/db.ts";
import { EventHub } from "../src/stream.ts";
import { decisionStatus } from "../src/status.ts";
import type { ServerConfig } from "../src/config.ts";

const connector = "connector-test-token-with-enough-entropy";
const ws = "ws_k3m7q2abcdefghij";
const session = "ses_aaaabbbbccccdddd";
const prefix = API_PREFIX;
const protocolHeader = "X-Agent-Hub-Protocol";
const fixtures = new URL("../../protocol/fixtures/", import.meta.url);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture<T>(name: string): Promise<T> { return JSON.parse(await readFile(new URL(name, fixtures), "utf8")) as T; }
function valid(def: Parameters<typeof validate>[0], value: unknown): void { expect(validate(def, value)).toEqual({ ok: true }); }

let temp: string;
let now: number;
let db: HubDatabase;
let app: ReturnType<typeof createApp>;
let events: EventHub;
let config: ServerConfig;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "hub-server-test-"));
  now = Date.parse("2026-10-28T08:00:00Z");
  await mkdir(join(temp, "data"), { recursive: true });
  config = { port: 7420, host: "127.0.0.1", dataDir: join(temp, "data"), configDir: join(temp, "config"), dbPath: join(temp, "data/hub.db"), connectorKeyPath: join(temp, "config/connector.key"), connectorKeyHash: sha256(connector), origins: ["https://hub.example.test"], kitVersion: "b1741ff" };
  db = new HubDatabase(config.dbPath, config.connectorKeyHash);
  events = new EventHub();
  app = createApp({ db, config, clock: () => now, events });
});
afterEach(async () => { db?.close(); await rm(temp, { recursive: true, force: true }); });

async function req(path: string, options: { method?: string; token?: string; body?: unknown; protocol?: string | null; origin?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.protocol !== null) headers[protocolHeader] = options.protocol ?? "1";
  if (options.origin) headers.Origin = options.origin;
  return app.request(`http://127.0.0.1${prefix}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
async function pair(code = "A2BC3D4E"): Promise<string> {
  db.createPairCode(code, "phone", now, now + 600_000);
  const response = await req("/pair", { method: "POST", body: { code, name: "phone" } });
  expect(response.status).toBe(200);
  const value = await response.json();
  valid("PairResponse", value);
  return value.token;
}
async function doHello(body?: unknown): Promise<{ response: Response; value?: any }> {
  const response = await req("/agent/hello", { method: "POST", token: connector, body: body ?? await fixture("HelloRequest.json") });
  return { response, value: response.status === 200 ? await response.json() : undefined };
}
async function seed(): Promise<void> {
  const hello = await doHello();
  expect(hello.response.status).toBe(200);
  valid("HelloResponse", hello.value);
  for (const file of ["Snapshot.idle-new-workspace.json", "Snapshot.running.json"]) {
    const response = await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body: await fixture(file) });
    expect(response.status).toBe(204);
  }
  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: await fixture("DecisionsBatch.json") })).status).toBe(204);
}

it("handles protocol version, auth kinds, revocation, bad bodies, and pair rate limiting", async () => {
  let response = await req("/agent/ping", { token: connector, protocol: null });
  expect(response.status).toBe(200); valid("PingResponse", await response.json());
  response = await req("/agent/ping", { token: connector, origin: "http://127.0.0.1:7420" });
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:7420");
  response = await req("/agent/ping", { token: connector, protocol: "0" });
  expect(response.status).toBe(426);
  response = await req("/agent/ping"); expect(response.status).toBe(401);
  const token = await pair();
  expect((await req("/agent/ping", { token })).status).toBe(403);
  expect((await req("/devices", { token: connector })).status).toBe(403);
  response = await req("/agent/hello", { method: "POST", token: connector, body: {} });
  expect(response.status).toBe(400);

  response = await req("/devices", { token });
  const listed = await response.json();
  valid("List", listed); valid("Device", listed.items[0]);
  expect(listed.items[0].current).toBe(true);
  expect((await req(`/devices/${listed.items[0].id}`, { method: "DELETE", token })).status).toBe(204);
  expect((await req("/devices", { token })).status).toBe(401);

  db.createPairCode("EXPIRED9", "phone", now - 700_000, now - 1);
  response = await req("/pair", { method: "POST", body: { code: "EXPIRED9", name: "phone" }, origin: "https://hub.example.test" });
  expect(response.status).toBe(401);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://hub.example.test");
  for (let i = 2; i < 6; i++) expect((await req("/pair", { method: "POST", body: { code: `BADCODE${i}`, name: "phone" } })).status).toBe(401);
  expect((await req("/pair", { method: "POST", body: { code: "BADCODE7", name: "phone" } })).status).toBe(429);
});

it("requires the right credential on every protected route", async () => {
  const token = await pair("F2GH3J4K");
  const connectorRoutes: Array<[string, string]> = [
    ["GET", "/agent/ping"], ["POST", "/agent/hello"], ["POST", `/agent/workspaces/${ws}/goodbye`],
    ["PUT", `/agent/workspaces/${ws}/snapshot`], ["POST", `/agent/workspaces/${ws}/heartbeat`],
    ["PUT", `/agent/workspaces/${ws}/decisions`], ["POST", `/agent/workspaces/${ws}/events`],
    ["PUT", `/agent/workspaces/${ws}/documents`], ["DELETE", `/agent/workspaces/${ws}/documents?path=x`],
    ["GET", `/agent/workspaces/${ws}/commands`], ["POST", `/agent/workspaces/${ws}/commands/cmd_aaaaaaaaaaaaaaaa/ack`],
  ];
  const userRoutes: Array<[string, string]> = [
    ["GET", "/devices"], ["DELETE", "/devices/dev_aaaaaaaa"], ["GET", "/workspaces"], ["GET", `/workspaces/${ws}`],
    ["PATCH", `/workspaces/${ws}`], ["GET", `/workspaces/${ws}/decisions`], ["GET", `/workspaces/${ws}/decisions/r4/D3`],
    ["POST", `/workspaces/${ws}/decisions/r4/D3/answer`], ["POST", `/workspaces/${ws}/decisions/r4/D3/reply`],
    ["POST", `/workspaces/${ws}/prompts`], ["GET", `/workspaces/${ws}/commands`], ["GET", `/workspaces/${ws}/documents`],
    ["GET", `/workspaces/${ws}/documents/content?path=x`], ["GET", `/workspaces/${ws}/history`],
  ];
  for (const [method, path] of connectorRoutes) {
    expect((await req(path, { method })).status, `${method} ${path} without auth`).toBe(401);
    expect((await req(path, { method, token })).status, `${method} ${path} with device token`).toBe(403);
  }
  for (const [method, path] of userRoutes) {
    expect((await req(path, { method })).status, `${method} ${path} without auth`).toBe(401);
    expect((await req(path, { method, token: connector })).status, `${method} ${path} with connector key`).toBe(403);
  }
  expect((await req("/stream")).status).toBe(401);
  expect((await req("/stream?token=" + encodeURIComponent(connector))).status).toBe(403);
  // Revoke the paired token's device by resolving its stable test record.
  const device = db.listDevices().find((entry) => entry.name === "phone");
  expect(device).toBeTruthy();
  db.revokeDevice(device!.id, now);
  for (const [method, path] of userRoutes) expect((await req(path, { method, token })).status, `${method} ${path} revoked`).toBe(401);
  expect((await req(`/stream?token=${encodeURIComponent(token)}`)).status).toBe(401);
});

it("replays connector fixtures and exercises each connector and user route with schema checks", async () => {
  const ping = await req("/agent/ping", { token: connector }); valid("PingResponse", await ping.json());
  const hello = await doHello(); expect(hello.response.status).toBe(200); valid("HelloResponse", hello.value);
  const known = await doHello(); expect(known.response.status).toBe(200); expect(known.value.known).toBe(true); valid("HelloResponse", known.value);
  for (const file of ["Snapshot.idle-new-workspace.json", "Snapshot.running.json"]) {
    const body = await fixture(file); valid("Snapshot", body);
    expect((await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body })).status).toBe(204);
  }
  const wrongSnapshot = await fixture<any>("Snapshot.running.json"); wrongSnapshot.workspace_id = "ws_p4x2d6abcdefghij";
  expect((await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body: wrongSnapshot })).status).toBe(400);
  const oversizedSnapshot = await fixture<any>("Snapshot.running.json"); oversizedSnapshot.orchestrator.name = "x".repeat(300_000);
  expect((await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body: oversizedSnapshot })).status).toBe(413);
  expect((await req(`/agent/workspaces/${ws}/heartbeat`, { method: "POST", token: connector })).status).toBe(204);
  const decisions = await fixture("DecisionsBatch.json"); valid("DecisionsBatch", decisions);
  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: decisions })).status).toBe(204);
  const batch = await fixture("EventsBatch.json"); valid("EventsBatch", batch);
  let response = await req(`/agent/workspaces/${ws}/events`, { method: "POST", token: connector, body: batch });
  expect(response.status).toBe(200); const cursor = await response.json(); valid("EventsResponse", cursor); expect(cursor.cursor).toBe(41);
  response = await req(`/agent/workspaces/${ws}/events`, { method: "POST", token: connector, body: batch });
  expect((await response.json()).cursor).toBe(41);
  const docs = await fixture<any>("DocumentsBatch.json"); valid("DocumentsBatch", docs);
  const badDocuments = JSON.parse(JSON.stringify(docs)); badDocuments.documents[0].sha256 = "0".repeat(64);
  expect((await req(`/agent/workspaces/${ws}/documents`, { method: "PUT", token: connector, body: badDocuments })).status).toBe(400);
  expect((await req(`/agent/workspaces/${ws}/documents`, { method: "PUT", token: connector, body: docs })).status).toBe(204);
  response = await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector });
  expect(response.status).toBe(200); valid("CommandsResponse", await response.json());

  const token = await pair("B2CD3E4F");
  response = await req("/workspaces", { token }); const workspaces = await response.json();
  valid("List", workspaces); valid("WorkspaceSummary", workspaces.items[0]);
  response = await req(`/workspaces/${ws}`, { token }); const detail = await response.json();
  valid("WorkspaceDetail", detail); expect(detail.snapshot.runs.length).toBe(2); valid("HubDecision", detail.decisions_open[0]);
  response = await req(`/workspaces/${ws}/decisions`, { token }); const decisionList = await response.json();
  valid("List", decisionList); decisionList.items.forEach((item: unknown) => valid("HubDecision", item));
  response = await req(`/workspaces/${ws}/decisions/r4/D3`, { token }); valid("HubDecision", await response.json());
  response = await req(`/workspaces/${ws}/documents`, { token }); const documentList = await response.json();
  valid("List", documentList); documentList.items.forEach((item: unknown) => valid("DocumentMeta", item));
  response = await req(`/workspaces/${ws}/documents/content?path=${encodeURIComponent(docs.documents[0].path)}`, { token });
  valid("DocumentContent", await response.json());
  response = await req(`/workspaces/${ws}/history`, { token }); const history = await response.json();
  valid("List", history); history.items.forEach((item: unknown) => valid("HistoryItem", item));
  expect(history.items.some((item: { type: string }) => item.type === "routine")).toBe(true);

  response = await req(`/workspaces/${ws}/prompts`, { method: "POST", token, body: { text: "look at this" } });
  expect(response.status).toBe(201); const prompt = await response.json(); valid("UserCommand", prompt);
  response = await req(`/workspaces/${ws}/commands`, { token }); const commands = await response.json();
  valid("List", commands); commands.items.forEach((item: unknown) => valid("UserCommand", item));
  response = await req(`/workspaces/${ws}/decisions/r4/D3/answer`, { method: "POST", token, body: { choice: "A" } });
  expect(response.status).toBe(201); valid("UserCommand", await response.json());
  now += 1;
  const reply = await req(`/workspaces/${ws}/decisions/r4/D3/reply`, { method: "POST", token, body: { text: "I suggest A" } });
  expect(reply.status).toBe(201); valid("UserCommand", await reply.json());
  response = await req(`/workspaces/${ws}/decisions/r4/D3`, { token });
  const sentWithReply = await response.json();
  expect(sentWithReply.hub_status).toBe("SENT");
  expect(sentWithReply.pending_command.type).toBe("reply");
  expect((await req(`/workspaces/${ws}/decisions/r4/D3/answer`, { method: "POST", token, body: { choice: "A" } })).status).toBe(409);

  response = await req(`/workspaces/${ws}`, { method: "PATCH", token, body: { archived: true } });
  expect(response.status).toBe(200); valid("WorkspaceSummary", await response.json());
  response = await req("/workspaces?archived=true", { token }); expect((await response.json()).items).toHaveLength(1);
  expect((await req(`/workspaces/${ws}`, { method: "PATCH", token, body: { archived: false } })).status).toBe(200);
  const deleteDoc = await req(`/agent/workspaces/${ws}/documents?path=${encodeURIComponent(docs.documents[0].path)}`, { method: "DELETE", token: connector });
  expect(deleteDoc.status).toBe(204);
  const goodbye = await req(`/agent/workspaces/${ws}/goodbye`, { method: "POST", token: connector, body: await fixture("GoodbyeRequest.json") });
  expect(goodbye.status).toBe(204);
});

it("validates fixtures and exercises answer followups, rejection retries, delivery, HELD retry, and prompt expiry", async () => {
  await seed();
  const token = await pair("C2DE3F4G");
  let response = await req(`/workspaces/${ws}/decisions/r4/D3/answer`, { method: "POST", token, body: { choice: "A" } });
  expect(response.status).toBe(201); const answer = await response.json(); valid("UserCommand", answer);
  response = await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector });
  const poll = await response.json(); valid("CommandsResponse", poll); valid("Command", poll.commands[0]);
  expect((await req(`/agent/workspaces/${ws}/commands/${answer.id}/ack`, { method: "POST", token: connector, body: { status: "HELD", reason: "waiting" } })).status).toBe(204);
  expect((await (await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector })).json()).commands).toHaveLength(0);
  now += 5001;
  expect((await (await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector })).json()).commands[0].id).toBe(answer.id);
  expect((await req(`/agent/workspaces/${ws}/commands/${answer.id}/ack`, { method: "POST", token: connector, body: { status: "DELIVERED", reason: null } })).status).toBe(204);

  const batch = await fixture<any>("DecisionsBatch.json");
  const decision = batch.decisions[0] as Decision;
  decision.local_status = "ANSWERED";
  decision.answer = { choice: "A", label: decision.options[0].label, note: "", channel: "hub", by: "phone", at: new Date(now).toISOString(), quote: null, followup: null };
  await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: { decisions: [decision] } });
  response = await req(`/workspaces/${ws}/decisions/r4/D3`, { token });
  expect((await response.json()).hub_status).toBe("DELIVERED");
  decision.consumed_by = "consumed";
  await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: { decisions: [decision] } });
  expect((await (await req(`/workspaces/${ws}/decisions/r4/D3`, { token })).json()).hub_status).toBe("APPLIED");

  const finish = await fixture<Decision>("Decision.finish-answered-hub.json");
  finish.local_status = "PENDING"; finish.answer = null; finish.consumed_by = null;
  await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: { decisions: [finish] } });
  response = await req(`/workspaces/${ws}/decisions/r3/D2/answer`, { method: "POST", token, body: { choice: "A", followup: "B" } });
  expect(response.status).toBe(422);
  response = await req(`/workspaces/${ws}/decisions/r3/D2/answer`, { method: "POST", token, body: { choice: "A", followup: "A", value: "bad" } });
  expect(response.status).toBe(422);
  response = await req(`/workspaces/${ws}/decisions/r3/D2/answer`, { method: "POST", token, body: { choice: "A", followup: "B", value: "feature/r3" } });
  expect(response.status).toBe(201); const branchAnswer = await response.json();
  expect(branchAnswer.body.value).toBe("feature/r3");
  await req(`/agent/workspaces/${ws}/commands/${branchAnswer.id}/ack`, { method: "POST", token: connector, body: { status: "REJECTED", reason: "invalid branch" } });
  expect((await (await req(`/workspaces/${ws}/decisions/r3/D2`, { token })).json()).hub_status).toBe("REJECTED");
  response = await req(`/workspaces/${ws}/decisions/r3/D2/answer`, { method: "POST", token, body: { choice: "A", followup: "A" } });
  expect(response.status).toBe(201); expect((await response.json()).body.value).toBe("main");

  response = await req(`/workspaces/${ws}/prompts`, { method: "POST", token, body: { text: "expire" } });
  const prompt = await response.json(); valid("UserCommand", prompt);
  now += 30 * 60_000;
  const polled = await req(`/agent/workspaces/${ws}/commands?wait=0`, { token: connector });
  expect((await polled.json()).commands.some((command: { id: string }) => command.id === prompt.id)).toBe(false);
  expect(db.getUserCommand(ws, prompt.id)?.status).toBe("EXPIRED");
});

it("derives every hub status and handles offline, stopped, duplicate, wiped, and isolated workspaces", async () => {
  const base = await fixture<Decision>("Decision.repair-open.json");
  const cases: Array<[Partial<Decision>, any, string, string | null]> = [
    [{ local_status: "DECIDED_BY_OPUS" }, undefined, "ROUTINE", null],
    [{ local_status: "CANCELLED", cancel_reason: "withdrawn" }, undefined, "CANCELLED", "withdrawn"],
    [{ local_status: "ANSWERED", consumed_by: "x" }, undefined, "APPLIED", null],
    [{ local_status: "ANSWERED", answer: { ...base.answer, channel: "hub" } as any }, undefined, "DELIVERED", null],
    [{ local_status: "ANSWERED", answer: { ...base.answer, channel: "chat" } as any }, undefined, "ANSWERED_ELSEWHERE", null],
    [{ local_status: "PENDING" }, { type: "answer", status: "QUEUED" }, "SENT", null],
    [{ local_status: "PENDING" }, { type: "answer", status: "HELD", status_reason: "busy" }, "SENT", "busy"],
    [{ local_status: "PENDING" }, { type: "answer", status: "DELIVERED" }, "SENT", null],
    [{ local_status: "PENDING" }, { type: "answer", status: "REJECTED", status_reason: "no" }, "REJECTED", "no"],
    [{ local_status: "PENDING" }, { type: "reply", status: "DELIVERED" }, "OPEN", null],
  ];
  for (const [change, latest, expected, reason] of cases) expect(decisionStatus({ ...base, ...change } as Decision, latest as any)).toEqual({ status: expected, reason });

  const hello = await doHello(); expect(hello.value.known).toBe(false);
  const otherSession = await fixture<any>("HelloRequest.json"); otherSession.session_id = "ses_eeeeffffgggghhhh";
  expect((await doHello(otherSession)).response.status).toBe(409);
  now += 90_000; expect(db.markOffline(now)).toContain(ws);
  expect(db.getWorkspace(ws)?.status).toBe("OFFLINE");
  expect((await req(`/agent/workspaces/${ws}/heartbeat`, { method: "POST", token: connector })).status).toBe(204);
  expect(db.getWorkspace(ws)?.status).toBe("ONLINE");
  expect((await req(`/agent/workspaces/${ws}/goodbye`, { method: "POST", token: connector, body: await fixture("GoodbyeRequest.json") })).status).toBe(204);
  expect(db.getWorkspace(ws)?.status).toBe("STOPPED");

  const snapshot = await fixture<any>("Snapshot.running.json");
  await req(`/agent/workspaces/${ws}/snapshot`, { method: "PUT", token: connector, body: snapshot });
  await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: await fixture("DecisionsBatch.json") });

  const other = await fixture<any>("HelloRequest.json"); other.workspace_id = "ws_p4x2d6abcdefghij"; other.session_id = "ses_eeeeffffgggghhhh";
  expect((await doHello(other)).value.known).toBe(false);
  const token = await pair("D2EF3G4H");
  const isolated = await req(`/workspaces/${other.workspace_id}/decisions`, { token });
  expect((await isolated.json()).items).toHaveLength(0);
  const freshDir = join(temp, "wiped"); await mkdir(freshDir, { recursive: true });
  const fresh = new HubDatabase(join(freshDir, "hub.db"), config.connectorKeyHash);
  try {
    const freshApp = createApp({ db: fresh, config: { ...config, dbPath: join(freshDir, "hub.db") }, clock: () => now });
    const response = await freshApp.request(`http://127.0.0.1${prefix}/agent/hello`, { method: "POST", headers: { Authorization: `Bearer ${connector}`, "Content-Type": "application/json", [protocolHeader]: "1" }, body: JSON.stringify(await fixture("HelloRequest.json")) });
    expect((await response.json()).known).toBe(false);
  } finally { fresh.close(); }
});

it("wakes a real long poll and sends a schema-valid SSE decision event", async () => {
  await seed();
  const token = await pair("E2FG3H4J");
  let port = 0;
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => { port = info.port; });
  const until = Date.now() + 3000;
  while (!port && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(port).toBeGreaterThan(0);
  const root = `http://127.0.0.1:${port}${prefix}`;
  const connectorHeaders = { Authorization: `Bearer ${connector}`, [protocolHeader]: "1" };
  const started = Date.now();
  const pollPromise = fetch(`${root}/agent/workspaces/${ws}/commands?wait=25`, { headers: connectorHeaders });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const prompt = await fetch(`${root}/workspaces/${ws}/prompts`, { method: "POST", headers: { Authorization: `Bearer ${token}`, [protocolHeader]: "1", "Content-Type": "application/json" }, body: JSON.stringify({ text: "wake" }) });
  expect(prompt.status).toBe(201);
  const poll = await pollPromise;
  expect(Date.now() - started).toBeLessThan(2000);
  const commands = await poll.json(); valid("CommandsResponse", commands); expect(commands.commands).toHaveLength(1);

  const controller = new AbortController();
  const stream = await fetch(`${root}/stream?token=${encodeURIComponent(token)}`, { headers: { [protocolHeader]: "1" }, signal: controller.signal });
  expect(stream.status).toBe(200);
  const reader = stream.body!.getReader();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const decisions = await fixture<any>("DecisionsBatch.json");
  decisions.decisions[0].question += " updated";
  const response = await fetch(`${root}/agent/workspaces/${ws}/decisions`, { method: "PUT", headers: { ...connectorHeaders, "Content-Type": "application/json" }, body: JSON.stringify(decisions) });
  expect(response.status).toBe(204);
  const result = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("SSE timeout")), 3000))]);
  const chunk = new TextDecoder().decode(result.value);
  expect(chunk).toContain("event: decision");
  const dataLine = chunk.match(/data: (\{[^\n]+\})/);
  expect(dataLine).toBeTruthy();
  const data = JSON.parse(dataLine![1]); valid("StreamEvent", data);
  controller.abort(); await reader.cancel().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
