import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { connect, createServer, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configuredDatabaseId, parseSetupArgs, rewriteConfig } from "../scripts/setup.ts";
import { ComputerRelay } from "../src/computer-relay.ts";

const proxyRoot = fileURLToPath(new URL("../", import.meta.url));
const worktreeRoot = fileURLToPath(new URL("../../../", import.meta.url));
const schema = JSON.parse(readFileSync(new URL("../../protocol/schemas/protocol.schema.json", import.meta.url), "utf8")) as {
  $defs: Record<string, Record<string, unknown>>;
};
const adminKey = "proxy-test-admin-key-for-local-only";
const adminHash = createHash("sha256").update(adminKey).digest("hex");
const keyPair = generateKeyPairSync("ed25519");
const signingKey = keyPair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url");
const publicDer = keyPair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
const expectedPublicKey = publicDer.subarray(publicDer.length - 32).toString("base64url");
const invalidCredential = { error: { code: "invalid_credentials", message: "Invalid username or password." } };

let baseUrl = "";
let wrangler: ReturnType<typeof spawn> | undefined;
let wranglerOutput = "";
let account: { username: string; password: string; token: string };
let computer: { id: string; key: string; publicKey: string };

type ProtocolSchema = Record<string, unknown>;

function conforms(definition: ProtocolSchema, value: unknown): boolean {
  if (typeof definition.$ref === "string") {
    const name = definition.$ref.split("/").at(-1) ?? "";
    return conforms(schema.$defs[name] as ProtocolSchema, value);
  }
  if (Array.isArray(definition.anyOf)) return definition.anyOf.some((item) => conforms(item as ProtocolSchema, value));
  const type = definition.type;
  if (Array.isArray(type)) {
    if (!type.some((item) => conforms({ ...definition, type: item }, value))) return false;
  } else if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const required = definition.required as string[] | undefined;
    if (required?.some((key) => !Object.hasOwn(record, key))) return false;
    const properties = definition.properties as Record<string, ProtocolSchema> | undefined;
    if (definition.additionalProperties === false && Object.keys(record).some((key) => !properties?.[key])) return false;
    if (properties && Object.entries(record).some(([key, item]) => properties[key] && !conforms(properties[key], item))) return false;
  } else if (type === "array") {
    if (!Array.isArray(value)) return false;
    if (definition.items && value.some((item) => !conforms(definition.items as ProtocolSchema, item))) return false;
    if (typeof definition.maxItems === "number" && value.length > definition.maxItems) return false;
    if (typeof definition.minItems === "number" && value.length < definition.minItems) return false;
  } else if (type === "string") {
    if (typeof value !== "string") return false;
    if (typeof definition.pattern === "string" && !new RegExp(definition.pattern).test(value)) return false;
    if (typeof definition.minLength === "number" && value.length < definition.minLength) return false;
    if (typeof definition.maxLength === "number" && value.length > definition.maxLength) return false;
  } else if (type === "integer") {
    if (!Number.isInteger(value)) return false;
  } else if (type === "number") {
    if (typeof value !== "number") return false;
  } else if (type === "boolean") {
    if (typeof value !== "boolean") return false;
  } else if (type === "null" && value !== null) return false;
  if (Object.hasOwn(definition, "const") && definition.const !== value) return false;
  if (Array.isArray(definition.enum) && !definition.enum.includes(value)) return false;
  if (typeof definition.minimum === "number" && typeof value === "number" && value < definition.minimum) return false;
  if (typeof definition.maximum === "number" && typeof value === "number" && value > definition.maximum) return false;
  return true;
}

function expectDefinition(name: string, value: unknown): void {
  expect(conforms(schema.$defs[name] as ProtocolSchema, value), `${name} protocol definition`).toBe(true);
}

function localWranglerEnv(): NodeJS.ProcessEnv {
  return {
    ...process["env"],
    WRANGLER_SEND_METRICS: "false",
    XDG_CONFIG_HOME: `${worktreeRoot}/.wrangler-home`,
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function runCommand(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: proxyRoot, env: localWranglerEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (wrangler?.exitCode !== null && wrangler?.exitCode !== undefined) {
      const safeOutput = wranglerOutput.replaceAll(signingKey, "[redacted]").replaceAll(adminHash, "[redacted]");
      throw new Error(`Wrangler exited early (${wrangler.exitCode}):\n${safeOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Wrangler did not become ready.");
}

class TestWebSocket {
  private buffer = Buffer.alloc(0);
  private readonly messages: unknown[] = [];
  private readonly waiters: Array<(value: unknown) => void> = [];
  private closeCode: number | undefined;

  constructor(private readonly socket: Socket, initialBytes: Buffer) {
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.on("close", () => { this.closeCode ??= 1006; });
    socket.on("error", () => { this.closeCode ??= 1006; });
    if (initialBytes.length) this.consume(initialBytes);
  }

  sendText(value: string): void {
    this.sendFrame(0x1, Buffer.from(value));
  }

  async nextMessage(timeoutMs = 5_000): Promise<unknown> {
    if (this.messages.length) return this.messages.shift();
    return new Promise((resolve, reject) => {
      const waiter = (value: unknown): void => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Timed out waiting for a WebSocket message."));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async closed(timeoutMs = 5_000): Promise<number> {
    if (this.closeCode !== undefined) return this.closeCode;
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = (): void => {
        if (this.closeCode !== undefined) resolve(this.closeCode);
        else if (Date.now() >= deadline) reject(new Error("Timed out waiting for WebSocket close."));
        else setTimeout(poll, 20);
      };
      poll();
    });
  }

  close(): void {
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]));
    this.socket.end();
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x8) this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
      else if (opcode === 0x9) this.sendFrame(0xA, payload);
      else if (opcode === 0x1) {
        const value = JSON.parse(payload.toString("utf8")) as unknown;
        const waiter = this.waiters.shift();
        if (waiter) waiter(value);
        else this.messages.push(value);
      }
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const mask = randomBytes(4);
    let header: Buffer;
    if (payload.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.from(payload);
    for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }
}

async function connectClient(id: string, key: string): Promise<TestWebSocket> {
  return new Promise((resolve, reject) => {
    const target = new URL(`/api/v1/computers/${encodeURIComponent(id)}/connect`, baseUrl);
    const socket = connect(Number(target.port), "127.0.0.1");
    const websocketKey = randomBytes(16).toString("base64");
    let buffer = Buffer.alloc(0);
    socket.once("connect", () => socket.write([
      `GET ${target.pathname} HTTP/1.1`, `Host: ${target.host}`, "Connection: Upgrade", "Upgrade: websocket",
      `Sec-WebSocket-Key: ${websocketKey}`, "Sec-WebSocket-Version: 13", `Authorization: Bearer ${key}`, "", "",
    ].join("\r\n")));
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) return;
      const headers = buffer.subarray(0, separator).toString("utf8");
      if (!/^HTTP\/1\.1 101\b/.test(headers)) {
        socket.destroy();
        reject(new Error(`WebSocket upgrade failed: ${headers.split("\r\n", 1)[0]}`));
        return;
      }
      socket.removeListener("data", onData);
      resolve(new TestWebSocket(socket, buffer.subarray(separator + 4)));
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function headers(token?: string, ip = "127.0.0.1"): HeadersInit {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json",
    "X-Agent-Hub-Protocol": "2",
    "CF-Connecting-IP": ip,
  };
}

async function readJson(response: Response, definition?: string): Promise<any> {
  const value = await response.json();
  if (definition) expectDefinition(definition, value);
  return value;
}

async function createUser(username: string): Promise<{ username: string; password: string }> {
  const body = { username };
  expectDefinition("AdminUserRequest", body);
  const response = await fetch(`${baseUrl}/api/v1/admin/users`, { method: "POST", headers: headers(adminKey), body: JSON.stringify(body) });
  expect(response.status).toBe(201);
  const value = await readJson(response, "AdminUserResponse");
  return { username: value.username, password: value.password };
}

async function login(username: string, password: string, ip = "127.0.0.1"): Promise<Response> {
  const body = { username, password, remember: false };
  expectDefinition("LoginRequest", body);
  return fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST", headers: headers(undefined, ip), body: JSON.stringify(body) });
}

async function register(username: string, password: string, name = "local test computer"): Promise<{ id: string; key: string; publicKey: string }> {
  const body = { username, password, name };
  expectDefinition("ComputerRegisterRequest", body);
  const response = await fetch(`${baseUrl}/api/v1/computers/register`, {
    method: "POST", headers: headers(undefined, `register-${Date.now()}-${randomBytes(3).toString("hex")}`), body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  const value = await readJson(response, "ComputerRegisterResponse");
  return { id: value.computer_id, key: value.computer_key, publicKey: value.proxy_public_key };
}

async function seedIndex(target: { id: string; key: string }, workspaceId: string, name: string): Promise<void> {
  const entry = { workspace_id: workspaceId, name, status: "ONLINE", last_seen_at: new Date().toISOString() };
  const hello = { type: "hello", protocol: 2, computer_id: target.id, backend_version: "test", workspaces: [entry] };
  expectDefinition("RelayHello", hello);
  const body = { frames: [hello] };
  expectDefinition("RelayFramesRequest", body);
  const response = await fetch(`${baseUrl}/api/v1/computers/${target.id}/frames`, { method: "POST", headers: headers(target.key), body: JSON.stringify(body) });
  expect(response.status).toBe(204);
}

async function sendBackendFrames(target: { id: string; key: string }, frames: unknown[]): Promise<Response> {
  for (const frame of frames) {
    if (typeof frame === "object" && frame !== null && "type" in frame) {
      const type = (frame as { type: string }).type;
      const definition = ({
        res: "RelayResponse", chunk: "RelayStreamChunk", end: "RelayStreamEnd", hello: "RelayHello",
        workspaces: "RelayWorkspaces", pong: "RelayPong",
      } as Record<string, string>)[type];
      if (definition) expectDefinition(definition, frame);
    }
  }
  const body = { frames };
  expectDefinition("RelayFramesRequest", body);
  return fetch(`${baseUrl}/api/v1/computers/${target.id}/frames`, { method: "POST", headers: headers(target.key), body: JSON.stringify(body) });
}

function assertAssertion(value: string, expected: { username: string; computerId: string; requestId: string }, publicKey: string): void {
  const [payloadPart, signaturePart] = value.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  expectDefinition("Assertion", payload);
  expect(payload).toMatchObject({ sub: expected.username, cid: expected.computerId, rid: expected.requestId, v: 1 });
  expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKeyObject = createPublicKey({ key: Buffer.concat([prefix, Buffer.from(publicKey, "base64url")]), type: "spki", format: "der" });
  expect(verify(null, Buffer.from(payloadPart), publicKeyObject, Buffer.from(signaturePart, "base64url"))).toBe(true);
}

describe("protocol-v2 proxy", () => {
  beforeAll(async () => {
    const migration = await runCommand("npx", ["wrangler", "d1", "migrations", "apply", "agent-hub", "--local", "--config", "wrangler.jsonc"]);
    if (migration.code !== 0) throw new Error(`D1 migration failed (${migration.code}).`);
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    wrangler = spawn("npx", [
      "wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
      "--var", `ADMIN_KEY_HASH:${adminHash}`, "--var", `SIGNING_KEY:${signingKey}`,
    ], { cwd: proxyRoot, env: localWranglerEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    wrangler.stdout?.on("data", (chunk: Buffer) => { wranglerOutput += chunk.toString(); });
    wrangler.stderr?.on("data", (chunk: Buffer) => { wranglerOutput += chunk.toString(); });
    await waitForHealth();
    const user = await createUser(`tst_${Date.now()}`);
    const loginResponse = await login(user.username, user.password, "seed-login");
    expect(loginResponse.status).toBe(200);
    const loggedIn = await readJson(loginResponse, "LoginResponse");
    account = { ...user, token: loggedIn.token };
    computer = await register(account.username, account.password);
    expectDefinition("ComputerRegisterResponse", {
      computer_id: computer.id, computer_key: computer.key, proxy_public_key: computer.publicKey, username: account.username,
    });
    expect(computer.publicKey).toBe(expectedPublicKey);
  }, 90_000);

  afterAll(async () => {
    if (wrangler?.pid && wrangler.exitCode === null) {
      try { process.kill(-wrangler.pid, "SIGTERM"); } catch { wrangler.kill("SIGTERM"); }
      await Promise.race([
        new Promise<void>((resolve) => wrangler?.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
    }
  });

  it("validates setup arguments and rewrites the local config fields", () => {
    expect(parseSetupArgs(["--rotate-admin-key", "--origins", "https://one.example, https://two.example"])).toEqual({
      rotateAdminKey: true,
      origins: ["https://one.example", "https://two.example"],
    });
    expect(() => parseSetupArgs(["--origins"])).toThrow();
    const source = JSON.stringify({ name: "agent-hub", d1_databases: [{ database_name: "agent-hub", database_id: "old" }] });
    expect(configuredDatabaseId(source)).toBe("old");
    expect(JSON.parse(rewriteConfig(source, "new-id", ["https://app.example"]))).toEqual({
      name: "agent-hub", d1_databases: [{ database_name: "agent-hub", database_id: "new-id" }],
      vars: { ALLOWED_ORIGINS: "https://app.example" },
    });
  });

  it("returns the same invalid-credentials response and rate limits username plus IP", async () => {
    const wrong = await login(account.username, "wrong password", "same-credential-ip");
    const unknown = await login("unknown_user", "wrong password", "same-credential-ip");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await readJson(wrong, "ApiError")).toEqual(invalidCredential);
    expect(await readJson(unknown, "ApiError")).toEqual(invalidCredential);
    let last: Response | undefined;
    for (let index = 0; index < 6; index += 1) last = await login(account.username, "wrong password", "rate-limit-ip");
    expect(last?.status).toBe(429);
    expect((await readJson(last!, "ApiError")).error.code).toBe("rate_limited");
  });

  it("changes passwords, enforces the minimum and revokes other sessions", async () => {
    const second = await login(account.username, account.password, "second-session-ip");
    const secondSession = await readJson(second, "LoginResponse");
    const requestBody = { current: account.password, new: "long-enough-new-password" };
    expectDefinition("PasswordChangeRequest", requestBody);
    const weak = await fetch(`${baseUrl}/api/v1/auth/password`, {
      method: "POST", headers: headers(account.token), body: JSON.stringify({ current: account.password, new: "short" }),
    });
    expect(weak.status).toBe(422);
    expect((await readJson(weak, "ApiError")).error.code).toBe("weak_password");
    const wrongCurrent = await fetch(`${baseUrl}/api/v1/auth/password`, {
      method: "POST", headers: headers(account.token), body: JSON.stringify({ current: "wrong", new: requestBody.new }),
    });
    expect(wrongCurrent.status).toBe(401);
    expect((await readJson(wrongCurrent, "ApiError")).error.code).toBe("invalid_credentials");
    const changed = await fetch(`${baseUrl}/api/v1/auth/password`, {
      method: "POST", headers: headers(account.token), body: JSON.stringify(requestBody),
    });
    expect(changed.status).toBe(204);
    const revoked = await fetch(`${baseUrl}/api/v1/me`, { headers: headers(secondSession.token) });
    expect(revoked.status).toBe(401);
    expect((await readJson(revoked, "ApiError")).error.code).toBe("unauthorized");
    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: headers(account.token) });
    expect(me.status).toBe(200);
    expect(await readJson(me, "Me")).toMatchObject({ username: account.username, computers: [expect.objectContaining({ id: computer.id, online: false })] });
    const next = await login(account.username, requestBody.new, "new-password-ip");
    expect(next.status).toBe(200);
    account.password = requestBody.new;
  });

  it("logs out and rejects the revoked token", async () => {
    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: headers(account.token) });
    expect(logout.status).toBe(204);
    const revoked = await fetch(`${baseUrl}/api/v1/me`, { headers: headers(account.token) });
    expect(revoked.status).toBe(401);
    expect((await readJson(revoked, "ApiError")).error.code).toBe("unauthorized");
    const next = await login(account.username, account.password, "after-logout-ip");
    account.token = (await readJson(next, "LoginResponse")).token;
  });

  it("creates admin users, rejects duplicates and bad keys, and resets passwords", async () => {
    const created = await createUser(`reset_${Date.now()}`);
    const unauthorized = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST", headers: headers("wrong-admin-key"), body: JSON.stringify({ username: `nope_${Date.now()}` }),
    });
    expect(unauthorized.status).toBe(401);
    expect((await readJson(unauthorized, "ApiError")).error.code).toBe("unauthorized");
    const duplicate = await fetch(`${baseUrl}/api/v1/admin/users`, {
      method: "POST", headers: headers(adminKey), body: JSON.stringify({ username: created.username }),
    });
    expect(duplicate.status).toBe(409);
    expect((await readJson(duplicate, "ApiError")).error.code).toBe("username_taken");
    const firstLogin = await login(created.username, created.password, "reset-first-login");
    const session = await readJson(firstLogin, "LoginResponse");
    const reset = await fetch(`${baseUrl}/api/v1/admin/users/${created.username}/reset-password`, { method: "POST", headers: headers(adminKey) });
    expect(reset.status).toBe(200);
    const password = await readJson(reset, "AdminUserResponse");
    const revoked = await fetch(`${baseUrl}/api/v1/me`, { headers: headers(session.token) });
    expect(revoked.status).toBe(401);
    expect((await login(created.username, password.password, "reset-second-login")).status).toBe(200);
  });

  it("authenticates computer routes and verifies relay assertions", async () => {
    const badKey = await fetch(`${baseUrl}/api/v1/computers/${computer.id}/poll?wait=0`, { headers: headers("bad-computer-key") });
    expect(badKey.status).toBe(401);
    expect((await readJson(badKey, "ApiError")).error.code).toBe("unauthorized");
    const workspaceId = `ws_${"a".repeat(16)}`;
    await seedIndex(computer, workspaceId, "relay workspace");
    const socket = await connectClient(computer.id, computer.key);
    try {
      const relayed = fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}/documents`, { headers: headers(account.token) });
      const request = await socket.nextMessage() as Record<string, unknown>;
      expectDefinition("RelayRequest", request);
      expect(request).toMatchObject({ type: "req", method: "GET", path: `/api/v1/workspaces/${workspaceId}/documents`, stream: false });
      assertAssertion(String(request.assertion), { username: account.username, computerId: computer.id, requestId: String(request.id) }, computer.publicKey);
      const responseFrame = { type: "res", id: request.id, status: 200, body: { items: [], next: null } };
      expectDefinition("RelayResponse", responseFrame);
      socket.sendText(JSON.stringify(responseFrame));
      const response = await relayed;
      expect(response.status).toBe(200);
      expect(await readJson(response, "List")).toEqual({ items: [], next: null });
    } finally {
      socket.close();
    }
  });

  it("relays over long-poll and accepts backend frame batches", async () => {
    const workspaceId = `ws_${"b".repeat(16)}`;
    await seedIndex(computer, workspaceId, "poll workspace");
    const poll = fetch(`${baseUrl}/api/v1/computers/${computer.id}/poll?wait=25`, { headers: headers(computer.key) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const relayed = fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}/documents`, { headers: headers(account.token) });
    const pollResponse = await poll;
    expect(pollResponse.status).toBe(200);
    const pollResult = await readJson(pollResponse, "RelayPollResponse");
    expect(pollResult.frames).toHaveLength(1);
    const frame = pollResult.frames[0];
    expectDefinition("RelayRequest", frame);
    const posted = await sendBackendFrames(computer, [{ type: "res", id: frame.id, status: 200, body: { items: [], next: null } }]);
    expect(posted.status).toBe(204);
    expect((await relayed).status).toBe(200);
  });

  it("returns offline and timeout errors and joins streamed document chunks", async () => {
    const offlineComputer = await register(account.username, account.password, "offline computer");
    const offlineWorkspace = `ws_${"c".repeat(16)}`;
    await seedIndex(offlineComputer, offlineWorkspace, "offline workspace");
    const offline = await fetch(`${baseUrl}/api/v1/workspaces/${offlineWorkspace}/documents`, { headers: headers(account.token) });
    expect(offline.status).toBe(503);
    expect((await readJson(offline, "ApiError")).error.code).toBe("computer_offline");

    const timeoutWorkspace = `ws_${"d".repeat(16)}`;
    await seedIndex(computer, timeoutWorkspace, "timeout workspace");
    const socket = await connectClient(computer.id, computer.key);
    try {
      const pending = fetch(`${baseUrl}/api/v1/workspaces/${timeoutWorkspace}/documents`, { headers: headers(account.token) });
      const timeoutRequest = await socket.nextMessage() as Record<string, unknown>;
      expectDefinition("RelayRequest", timeoutRequest);
      const timeout = await pending;
      expect(timeout.status).toBe(504);
      expect((await readJson(timeout, "ApiError")).error.code).toBe("computer_timeout");

      const contentWorkspace = `ws_${"e".repeat(16)}`;
      await seedIndex(computer, contentWorkspace, "content workspace");
      const content = fetch(`${baseUrl}/api/v1/workspaces/${contentWorkspace}/documents/content?path=report`, { headers: headers(account.token) });
      const start = await socket.nextMessage() as Record<string, unknown>;
      expect(start.stream).toBe(true);
      const initial = { type: "res", id: start.id, status: 200, body: null };
      const document = {
        meta: {
          path: "report", run_id: null, kind: "final_report", title: "Report", format: "text",
          bytes: 6, truncated: false, updated_at: new Date().toISOString(), deleted: false,
        },
        content: "joined",
      };
      expectDefinition("DocumentContent", document);
      const serialized = JSON.stringify(document);
      const midpoint = Math.floor(serialized.length / 2);
      const first = { type: "chunk", id: start.id, data: serialized.slice(0, midpoint) };
      const second = { type: "chunk", id: start.id, data: serialized.slice(midpoint) };
      const end = { type: "end", id: start.id, status: 200 };
      expectDefinition("RelayResponse", initial);
      expectDefinition("RelayStreamChunk", first);
      expectDefinition("RelayStreamChunk", second);
      expectDefinition("RelayStreamEnd", end);
      socket.sendText(JSON.stringify(initial));
      socket.sendText(JSON.stringify(first));
      socket.sendText(JSON.stringify(second));
      socket.sendText(JSON.stringify(end));
      const response = await content;
      expect(response.status).toBe(200);
      expect(await readJson(response, "DocumentContent")).toEqual(document);
    } finally {
      socket.close();
    }
  }, 40_000);

  it("accepts a workspaces frame after the hibernated relay wakes with empty fields", async () => {
    const stored = new Map<string, unknown>([["computerId", "c_aaaaaaaaaaaaaaaa"]]);
    const writes: unknown[][] = [];
    const db = { prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { writes.push(values); return {}; } }) }) };
    const state = {
      getWebSockets: () => [],
      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
    };
    // A new instance stands in for the object rebuilt after hibernation: only storage survives.
    const relay = new ComputerRelay(state as never, { DB: db } as never);
    const frame = { type: "workspaces", workspaces: [{ workspace_id: "ws_aaaaaaaaaaaaaaaa", name: "kit", status: "ONLINE", last_seen_at: "2026-10-29T00:00:00.000Z" }] };
    expectDefinition("RelayWorkspaces", frame);
    await relay.webSocketMessage({ readyState: 1, send() {}, close() {} } as never, JSON.stringify(frame));
    expect(writes.some((values) => values[0] === "ws_aaaaaaaaaaaaaaaa" && values[1] === "c_aaaaaaaaaaaaaaaa")).toBe(true);
  });

  it("sends cancel when the relay request is aborted", async () => {
    const sent: Record<string, unknown>[] = [];
    const socket = {
      readyState: 1,
      send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
      close() {},
    };
    const state = {
      getWebSockets: () => [socket],
      storage: { get: async () => undefined, put: async () => {}, delete: async () => false },
    };
    const relay = new ComputerRelay(state as never, {} as never);
    const controller = new AbortController();
    const frame = {
      type: "req", id: "request-cancel-test", method: "GET", path: "/api/v1/stream", query: "",
      body: null, assertion: "test-assertion", stream: true,
    };
    expectDefinition("RelayRequest", frame);
    const pending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frame), signal: controller.signal,
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(sent).toEqual([frame, { type: "cancel", id: frame.id }]);
    const canceled = await pending;
    expect(canceled.status).toBe(503);
    expect((await readJson(canceled, "ApiError")).error.code).toBe("computer_offline");
  }, 10_000);

  it("forwards a canceled stream to the backend as a cancel frame", async () => {
    const sent: Record<string, unknown>[] = [];
    const socket = {
      readyState: 1,
      send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
      close() {},
    };
    const state = {
      getWebSockets: () => [socket],
      storage: { get: async () => undefined, put: async () => {}, delete: async () => false },
    };
    const relay = new ComputerRelay(state as never, {} as never);
    const requestFrame = {
      type: "req", id: "stream-cancel-test", method: "GET", path: "/api/v1/stream", query: "",
      body: null, assertion: "test-assertion", stream: true,
    };
    const pending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestFrame),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await relay.webSocketMessage(socket as never, JSON.stringify({ type: "res", id: requestFrame.id, status: 200, body: null }));
    const response = await pending;
    expect(response.status).toBe(200);
    await response.body?.cancel();
    const cancel = { type: "cancel", id: requestFrame.id };
    expectDefinition("RelayCancel", cancel);
    expect(sent).toEqual([requestFrame, cancel]);
  });

  it("merges online and offline workspaces and hides another user's workspace", async () => {
    const liveId = `ws_${"f".repeat(16)}`;
    const offlineComputer = await register(account.username, account.password, "indexed offline computer");
    const offlineId = `ws_${"g".repeat(16)}`;
    await seedIndex(computer, liveId, "live workspace");
    await seedIndex(offlineComputer, offlineId, "recent offline workspace");
    const socket = await connectClient(computer.id, computer.key);
    try {
      const listing = fetch(`${baseUrl}/api/v1/workspaces`, { headers: headers(account.token) });
      const request = await socket.nextMessage() as Record<string, unknown>;
      expect(request.path).toBe("/api/v1/workspaces");
      const liveItem = {
        id: liveId, name: "live workspace", path: null, status: "ONLINE", last_seen_at: new Date().toISOString(),
        kit_version: null, kit_outdated: false, open_decisions: 0, problems: 0, orchestrator_state: null,
        active_run: null, archived: false, upload: null, orchestrator_last_activity_at: null,
        computer_id: null, computer_online: true,
      };
      expectDefinition("WorkspaceSummary", liveItem);
      socket.sendText(JSON.stringify({ type: "res", id: request.id, status: 200, body: { items: [liveItem], next: null } }));
      const list = await readJson(await listing, "List");
      for (const workspace of list.items) expectDefinition("WorkspaceSummary", workspace);
      expect(list.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: liveId, computer_id: computer.id, computer_online: true }),
        expect.objectContaining({ id: offlineId, status: "OFFLINE", computer_online: false, computer_id: offlineComputer.id }),
      ]));
    } finally {
      socket.close();
    }

    const other = await createUser(`own_${Date.now()}`);
    const foreignComputer = await register(other.username, other.password, "foreign computer");
    const foreignId = `ws_${"h".repeat(16)}`;
    await seedIndex(foreignComputer, foreignId, "foreign workspace");
    const foreign = await fetch(`${baseUrl}/api/v1/workspaces/${foreignId}`, { headers: headers(account.token) });
    expect(foreign.status).toBe(404);
    expect((await readJson(foreign, "ApiError")).error.code).toBe("not_found");
  });

  it("handles CORS preflight and leaves no spike route", async () => {
    const preflight = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,x-agent-hub-protocol" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("X-Agent-Hub-Protocol");
    const denied = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "OPTIONS", headers: { Origin: "https://unlisted.example" } });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const spike = await fetch(`${baseUrl}/spike/hash`, { method: "POST", headers: headers(adminKey), body: "{}" });
    expect(spike.status).toBe(404);
    expect((await readJson(spike, "ApiError")).error.code).toBe("not_found");
  });
});
