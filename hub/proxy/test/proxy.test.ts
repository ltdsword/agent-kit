import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { connect, createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const proxyRoot = fileURLToPath(new URL("../", import.meta.url));
const testKey = "local-test-key";
const relayBody = { message: "hello from test" };

let baseUrl = "";
let wrangler: ReturnType<typeof spawn> | undefined;
let echoClient: ReturnType<typeof spawn> | undefined;
let wranglerOutput = "";
let echoOutput = "";

function localWranglerEnv(): NodeJS.ProcessEnv {
  return {
    ...process["env"],
    WRANGLER_SEND_METRICS: "false",
    XDG_CONFIG_HOME: `${proxyRoot}/.wrangler/home`,
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
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function runCommand(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: proxyRoot,
      env: localWranglerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "server did not answer";
  while (Date.now() < deadline) {
    if (wrangler?.exitCode !== null && wrangler?.exitCode !== undefined) {
      throw new Error(`Wrangler exited early (${wrangler.exitCode}):\n${wranglerOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler did not become ready: ${lastError}\n${wranglerOutput}`);
}

class TestWebSocket {
  private buffer = Buffer.alloc(0);
  private readonly messages: unknown[] = [];
  private readonly messageWaiters: Array<(value: unknown) => void> = [];
  private closeCode: number | undefined;
  private closeWaiters: Array<(code: number) => void> = [];

  constructor(private readonly socket: Socket, initialBytes: Buffer) {
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.on("close", () => this.markClosed(1006));
    socket.on("error", () => this.markClosed(1006));
    if (initialBytes.length) this.consume(initialBytes);
  }

  sendText(value: string): void {
    this.sendFrame(0x1, Buffer.from(value));
  }

  async nextMessage(timeoutMs = 5_000): Promise<unknown> {
    if (this.messages.length) return this.messages.shift();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.messageWaiters.indexOf(onMessage);
        if (index >= 0) this.messageWaiters.splice(index, 1);
        reject(new Error("Timed out waiting for a WebSocket message."));
      }, timeoutMs);
      const onMessage = (value: unknown): void => {
        clearTimeout(timer);
        resolve(value);
      };
      this.messageWaiters.push(onMessage);
    });
  }

  async closed(timeoutMs = 5_000): Promise<number> {
    if (this.closeCode !== undefined) return this.closeCode;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.closeWaiters.indexOf(onClose);
        if (index >= 0) this.closeWaiters.splice(index, 1);
        reject(new Error("Timed out waiting for the WebSocket to close."));
      }, timeoutMs);
      const onClose = (code: number): void => {
        clearTimeout(timer);
        resolve(code);
      };
      this.closeWaiters.push(onClose);
    });
  }

  close(): void {
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]));
    this.socket.end();
  }

  private markClosed(code: number): void {
    if (this.closeCode !== undefined) return;
    this.closeCode = code;
    for (const waiter of this.closeWaiters.splice(0)) waiter(code);
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const longLength = this.buffer.readBigUInt64BE(offset);
        if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame is too large.");
        length = Number(longLength);
        offset += 8;
      }

      let mask: Buffer | undefined;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;

      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }

      if (opcode === 0x1) {
        const text = payload.toString("utf8");
        let value: unknown;
        try { value = JSON.parse(text); } catch { value = text; }
        const waiter = this.messageWaiters.shift();
        if (waiter) waiter(value);
        else this.messages.push(value);
      } else if (opcode === 0x8) {
        this.markClosed(payload.length >= 2 ? payload.readUInt16BE(0) : 1005);
      } else if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
      }
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const mask = randomBytes(4);
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length <= 0xffff) {
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

async function connectClient(id: string): Promise<TestWebSocket> {
  return new Promise((resolve, reject) => {
    const target = new URL(`/spike/computers/${encodeURIComponent(id)}/connect`, baseUrl);
    const socket = connect(Number(target.port), "127.0.0.1");
    const websocketKey = randomBytes(16).toString("base64");
    let buffer = Buffer.alloc(0);
    let upgraded = false;

    socket.once("connect", () => {
      socket.write([
        `GET ${target.pathname} HTTP/1.1`,
        `Host: ${target.host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Sec-WebSocket-Key: ${websocketKey}`,
        "Sec-WebSocket-Version: 13",
        `Authorization: Bearer ${testKey}`,
        "",
        "",
      ].join("\r\n"));
    });

    socket.on("data", (chunk: Buffer) => {
      if (upgraded) return;
      buffer = Buffer.concat([buffer, chunk]);
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) return;
      upgraded = true;
      const headers = buffer.subarray(0, separator).toString("utf8");
      if (!/^HTTP\/1\.1 101\b/.test(headers)) {
        socket.destroy();
        reject(new Error(`WebSocket upgrade failed: ${headers.split("\r\n", 1)[0]}`));
        return;
      }
      resolve(new TestWebSocket(socket, buffer.subarray(separator + 4)));
    });
    socket.once("error", reject);
  });
}

function authHeaders(value = testKey): HeadersInit {
  return { Authorization: `Bearer ${value}`, "content-type": "application/json" };
}

async function relay(id: string, body: unknown = relayBody): Promise<Response> {
  return fetch(`${baseUrl}/spike/computers/${encodeURIComponent(id)}/relay`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

describe("local proxy spike", () => {
  beforeAll(async () => {
    const migration = await runCommand("npx", ["wrangler", "d1", "migrations", "apply", "agent-hub", "--local", "--config", "wrangler.jsonc"]);
    if (migration.code !== 0) throw new Error(`D1 migration failed (${migration.code}):\n${migration.output}`);

    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    wrangler = spawn("npx", [
      "wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
      "--var", `SPIKE_KEY:${testKey}`, "--var", "RELAY_TIMEOUT_MS:200",
    ], {
      cwd: proxyRoot,
      env: localWranglerEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    wrangler.stdout?.on("data", (chunk: Buffer) => { wranglerOutput += chunk.toString(); });
    wrangler.stderr?.on("data", (chunk: Buffer) => { wranglerOutput += chunk.toString(); });
    await waitForHealth();
  }, 90_000);

  afterAll(async () => {
    if (echoClient?.pid && echoClient.exitCode === null) echoClient.kill("SIGTERM");
    if (wrangler?.pid && wrangler.exitCode === null) {
      try { process.kill(-wrangler.pid, "SIGTERM"); } catch { wrangler.kill("SIGTERM"); }
      await Promise.race([
        new Promise<void>((resolve) => wrangler?.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
    }
  });

  it("serves public health and denies every spike route without or with a wrong key", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, version: "0.1.0" });

    const cases = [
      ["/spike/hash", "POST", "{}"],
      ["/spike/d1", "POST", "{}"],
      ["/spike/computers/auth/connect", "GET", undefined],
      ["/spike/computers/auth/relay", "POST", "{}"],
    ] as const;
    for (const [path, method, body] of cases) {
      for (const headers of [{ "content-type": "application/json" }, authHeaders("wrong-key")]) {
        const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
        expect(response.status, `${method} ${path}`).toBe(401);
        expect((await response.json()).error.code).toBe("unauthorized");
      }
    }
  });

  it("rejects out-of-range PBKDF2 work and measures both supported boundaries", async () => {
    for (const iterations of [999, 100_001]) {
      const response = await fetch(`${baseUrl}/spike/hash`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ iterations }),
      });
      expect(response.status).toBe(400);
    }

    for (const iterations of [1_000, 100_000]) {
      const response = await fetch(`${baseUrl}/spike/hash`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ iterations }),
      });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.iterations).toBe(iterations);
      expect(Number.isFinite(result.wall_ms)).toBe(true);
    }
  });

  it("inserts into local D1 and returns the row count", async () => {
    const note = `test-${Date.now()}`;
    const response = await fetch(`${baseUrl}/spike/d1`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ note }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.row).toMatchObject({ note });
    expect(result.row.id).toEqual(expect.any(Number));
    expect(result.row.at).toEqual(expect.any(String));
    expect(result.count).toBeGreaterThan(0);
  });

  it("returns offline without a connected client", async () => {
    const response = await relay(`offline-${Date.now()}`);
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("computer_offline");
  });

  it("relays a request to the connected client and routes its reply back", async () => {
    const id = `roundtrip-${Date.now()}`;
    const client = await connectClient(id);
    try {
      const pending = relay(id, relayBody);
      const request = await client.nextMessage() as { type: string; id: string; body: unknown };
      expect(request.type).toBe("req");
      expect(request.body).toEqual(relayBody);
      client.sendText(JSON.stringify({
        type: "res", id: request.id,
        body: { echo: request.body, at: "2026-10-28T00:00:00.000Z" },
      }));
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ echo: relayBody, at: "2026-10-28T00:00:00.000Z" });

      client.sendText(JSON.stringify({ type: "ping" }));
      expect(await client.nextMessage()).toEqual({ type: "pong" });
    } finally {
      client.close();
    }
  });

  it("replaces the prior socket when a second client connects", async () => {
    const id = `replace-${Date.now()}`;
    const first = await connectClient(id);
    const second = await connectClient(id);
    try {
      expect(await first.closed()).toBe(4000);
    } finally {
      second.close();
    }
  });

  it("times out when the connected client does not answer", async () => {
    const id = `timeout-${Date.now()}`;
    const client = await connectClient(id);
    try {
      const pending = relay(id);
      const request = await client.nextMessage() as { type: string };
      expect(request.type).toBe("req");
      const response = await pending;
      expect(response.status).toBe(504);
      expect((await response.json()).error.code).toBe("computer_timeout");
    } finally {
      client.close();
    }
  });

  it("rejects request bodies larger than 900 KB", async () => {
    const response = await relay(`oversized-${Date.now()}`, { value: "x".repeat(900 * 1024) });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("body_too_large");
  });

  it("round-trips through the echo client script", async () => {
    echoClient = spawn("node", ["scripts/echo-client.ts", "--url", baseUrl, "--id", "echo-test"], {
      cwd: proxyRoot,
      env: { ...process["env"], SPIKE_KEY: testKey },
      stdio: ["ignore", "pipe", "pipe"],
    });
    echoClient.stdout?.on("data", (chunk: Buffer) => { echoOutput += chunk.toString(); });
    echoClient.stderr?.on("data", (chunk: Buffer) => { echoOutput += chunk.toString(); });

    const deadline = Date.now() + 15_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      response = await relay("echo-test", { message: "echo client" });
      if (response.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(response?.status, echoOutput).toBe(200);
    const result = await response!.json();
    expect(result.echo).toEqual({ message: "echo client" });
    expect(result.at).toEqual(expect.any(String));
  });
});
