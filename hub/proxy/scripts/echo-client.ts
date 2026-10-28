#!/usr/bin/env node

type UndiciModule = {
  WebSocket?: new (url: string, options: Record<string, unknown>) => WebSocketLike;
  EnvHttpProxyAgent?: new () => unknown;
  ProxyAgent?: new (url: string) => unknown;
};

type WebSocketLike = {
  addEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(): void;
};

function log(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

function parseArgs(args: string[]): { url: string; id: string } {
  let url: string | undefined;
  let id: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--url") url = args[++index];
    else if (args[index] === "--id") id = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!url || !id) throw new Error("Usage: node scripts/echo-client.ts --url <base> --id <name>");
  return { url, id };
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

async function run(): Promise<void> {
  const { url: base, id } = parseArgs(process.argv.slice(2));
  const key = process["env"]["SPIKE_KEY"];
  if (!key) throw new Error("SPIKE_KEY must be set in the environment.");

  let undici: UndiciModule;
  try {
    const loadModule = new Function("name", "return import(name)") as (name: string) => Promise<UndiciModule>;
    undici = await loadModule("undici");
  } catch {
    throw new Error("The undici module is not importable; the echo client cannot set WebSocket handshake headers.");
  }
  if (!undici.WebSocket) throw new Error("The importable undici module does not export WebSocket.");

  const endpoint = new URL(`/spike/computers/${encodeURIComponent(id)}/connect`, base);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";

  const proxy = process["env"]["HTTPS_PROXY"] || process["env"]["https_proxy"];
  let dispatcher: unknown;
  if (proxy && !isLoopback(endpoint.hostname)) {
    if (undici.EnvHttpProxyAgent) dispatcher = new undici.EnvHttpProxyAgent();
    else if (undici.ProxyAgent) dispatcher = new undici.ProxyAgent(proxy);
    else throw new Error("HTTPS_PROXY is set, but undici has no supported proxy dispatcher.");
  }

  let stopping = false;
  let current: WebSocketLike | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1_000;
  const stop = (): void => {
    stopping = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    current?.close();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const options: Record<string, unknown> = {
        headers: { Authorization: `Bearer ${key}` },
      };
      if (dispatcher) options.dispatcher = dispatcher;

      try {
        const socket = new undici.WebSocket!(endpoint.toString(), options);
        current = socket;
        socket.addEventListener("open", () => {
          reconnectDelay = 1_000;
          log("connected", { id });
        });
        socket.addEventListener("message", (event) => {
          let frame: unknown;
          try {
            frame = JSON.parse(String(event.data));
          } catch {
            log("malformed_message", { id });
            return;
          }
          if (typeof frame !== "object" || frame === null || !("type" in frame) || frame.type !== "req") {
            log("ignored_message", { id });
            return;
          }
          const request = frame as { id?: unknown; body?: unknown };
          if (typeof request.id !== "string") {
            log("malformed_request", { id });
            return;
          }
          socket.send(JSON.stringify({
            type: "res",
            id: request.id,
            body: { echo: request.body, at: new Date().toISOString() },
          }));
          log("replied", { id, request_id: request.id });
        });
        socket.addEventListener("error", () => {
          log("connection_error", { id });
          finish();
        });
        socket.addEventListener("close", (event) => {
          log("disconnected", { id, code: event.code });
          current = undefined;
          finish();
        });
      } catch {
        log("connection_error", { id });
        current = undefined;
        finish();
      }
    });

    if (stopping) break;
    const waitMs = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    log("reconnecting", { id, wait_ms: waitMs });
    await new Promise<void>((resolve) => {
      reconnectTimer = setTimeout(resolve, waitMs);
    });
  }
  log("stopped", { id });
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  log("fatal", { message });
  process.exitCode = 1;
});
