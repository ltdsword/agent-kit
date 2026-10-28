import type { Env } from "./env.ts";

type PendingReply = {
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: Response) => void;
};

type RelayResponse = {
  type: "res";
  id: string;
  body: unknown;
};

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

export class ComputerRelay {
  private readonly pending = new Map<string, PendingReply>();
  private malformedFrames = 0;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/connect")) return this.connect(request);
    if (path.endsWith("/relay")) return this.relay(request);
    return error("not_found", "Route not found.", 404);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    let frame: unknown;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      frame = JSON.parse(text);
    } catch {
      this.countMalformedFrame();
      return;
    }

    if (isRecord(frame) && frame.type === "ping") {
      try {
        socket.send(JSON.stringify({ type: "pong" }));
      } catch {}
      return;
    }

    if (
      isRecord(frame) &&
      frame.type === "res" &&
      typeof frame.id === "string" &&
      Object.hasOwn(frame, "body")
    ) {
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        pending.resolve(json((frame as RelayResponse).body));
      }
      return;
    }

    this.countMalformedFrame();
  }

  webSocketClose(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve(error("computer_offline", "Computer disconnected.", 503));
    }
  }

  private connect(request: Request): Response {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return error("websocket_required", "A WebSocket upgrade is required.", 426);
    }

    for (const socket of this.state.getWebSockets()) {
      try {
        socket.close(4000, "replaced");
      } catch {
        // A closing socket can still be present in the hibernation API list.
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async relay(request: Request): Promise<Response> {
    if (request.method !== "POST") return error("method_not_allowed", "Use POST.", 405);

    const socket = this.state.getWebSockets().find((candidate) => candidate.readyState === WebSocket.OPEN);
    if (!socket) return error("computer_offline", "Computer is offline.", 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error("invalid_json", "Request body must be valid JSON.", 400);
    }

    const id = crypto.randomUUID();
    const timeoutMs = this.timeoutMs();

    return new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(error("computer_timeout", "Computer did not reply in time.", 504));
      }, timeoutMs);

      this.pending.set(id, { timer, resolve });
      try {
        socket.send(JSON.stringify({ type: "req", id, body }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(error("computer_offline", "Computer is offline.", 503));
      }
    });
  }

  private timeoutMs(): number {
    const configured = Number(this.env["RELAY_TIMEOUT_MS"]);
    return Number.isInteger(configured) && configured > 0 ? configured : 10_000;
  }

  private countMalformedFrame(): void {
    this.malformedFrames += 1;
    console.warn(JSON.stringify({ event: "malformed_websocket_frame", count: this.malformedFrames }));
  }
}
