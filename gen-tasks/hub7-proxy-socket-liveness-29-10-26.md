# Proxy never routes into a dead or replaced socket (29/10/26)

## Goal
The proxy Durable Object routes relay requests only to a live WebSocket (heard from within 75 s), a long-poll hello replaces open sockets, and a closing socket fails only its own requests.

## Read first
- `plans/261029-1700-hub7-relay-failover/plan.md` section **T1**: **the full spec** (work items, tests). Follow it exactly.
- `hub/proxy/src/computer-relay.ts` (`relay`, `isOnline`, `connect`, `receiveFrames`, `processFrame`, `webSocketClose`, `cancel`), `hub/proxy/test/proxy.test.ts` (the DO unit test that builds `ComputerRelay` with a fake state, `connectClient`).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/proxy/src/computer-relay.ts`
- `hub/proxy/test/proxy.test.ts`

**You must not edit:**
- Any other file: the other hub7 tasks own `hub/server/src/relay.ts`, `hub/server/test/server.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/HttpHubClient.test.ts`; also `hub/protocol/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.agent-system/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/proxy`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install` or any download; `wrangler` (login/deploy/dev/secret) or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `cd hub/proxy && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/proxy && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .`: expect proxy tests and typecheck pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (29/10/26 17:04)

- Status: **blocked** (worker worker-2, branch `agent/hub7-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/proxy/src/computer-relay.ts`, `hub/proxy/test/proxy.test.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .` -> exit 1
- Risks:
  - Vitest and TypeScript validation remain unverified because Vitest was not available locally and npx could not resolve it without a download.
- Not done:
  - TypeScript check did not run because the preceding Vitest command failed.
  - No commit was created; task boundaries allow read-only git only.
- Full diff: `.orchestrator/runs/hub7/reports/T1.diff`

````text
 hub/proxy/src/computer-relay.ts |  51 +++++++++++++---
 hub/proxy/test/proxy.test.ts    | 126 +++++++++++++++++++++++++++++++++++++++-
 2 files changed, 167 insertions(+), 10 deletions(-)
````

````diff
diff --git a/hub/proxy/src/computer-relay.ts b/hub/proxy/src/computer-relay.ts
index 48cb289..454cb55 100644
--- a/hub/proxy/src/computer-relay.ts
+++ b/hub/proxy/src/computer-relay.ts
@@ -5,11 +5,17 @@ type Frame = Record<string, unknown> & { type: string };
 type Pending = {
   timer: ReturnType<typeof setTimeout>;
   stream: boolean;
+  socket?: WebSocket;
   resolve: (response: Response) => void;
   controller?: ReadableStreamDefaultController<Uint8Array>;
   responseStarted: boolean;
 };
 
+type RelaySocket = WebSocket & {
+  serializeAttachment(attachment: unknown): void;
+  deserializeAttachment(): unknown;
+};
+
 const encoder = new TextEncoder();
 
 function json(body: unknown, status = 200): Response {
@@ -75,12 +81,14 @@ export class ComputerRelay {
   private readonly pending = new Map<string, Pending>();
   private readonly queuedFrames: string[] = [];
   private readonly pollWaiters = new Set<() => void>();
+  private readonly now: () => number;
   private malformedFrames = 0;
   private computerId = "";
 
-  constructor(ctx: DurableObjectState, bindings: Env) {
+  constructor(ctx: DurableObjectState, bindings: Env, now: () => number = Date.now) {
     this.state = ctx;
     this.db = bindings.DB;
+    this.now = now;
   }
 
   private async knownComputerId(): Promise<string> {
@@ -123,6 +131,7 @@ export class ComputerRelay {
   }
 
   async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
+    (socket as RelaySocket).serializeAttachment({ lastSeenAt: this.now() });
     const bytes = typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength;
     if (bytes > LIMITS.relayFrameBytes) {
       this.countMalformedFrame();
@@ -138,8 +147,9 @@ export class ComputerRelay {
     await this.processFrame(frame, socket);
   }
 
-  webSocketClose(): void {
+  webSocketClose(socket: WebSocket): void {
     for (const [id, pending] of this.pending) {
+      if (pending.socket !== socket) continue;
       clearTimeout(pending.timer);
       this.pending.delete(id);
       if (pending.responseStarted && pending.controller) {
@@ -150,14 +160,30 @@ export class ComputerRelay {
     }
   }
 
-  webSocketError(): void {
-    this.webSocketClose();
+  webSocketError(socket: WebSocket): void {
+    this.webSocketClose(socket);
   }
 
   private async isOnline(): Promise<boolean> {
-    if (this.state.getWebSockets().some((socket) => socket.readyState === WebSocket.OPEN)) return true;
+    if (this.liveSocket()) return true;
     const lastPoll = await this.state.storage.get<number>("last_poll_at");
-    return typeof lastPoll === "number" && Date.now() - lastPoll <= 40_000;
+    return typeof lastPoll === "number" && this.now() - lastPoll <= 40_000;
+  }
+
+  private liveSocket(): WebSocket | undefined {
+    let live: WebSocket | undefined;
+    const now = this.now();
+    for (const socket of this.state.getWebSockets()) {
+      if (socket.readyState !== WebSocket.OPEN) continue;
+      let attachment: unknown;
+      try { attachment = (socket as RelaySocket).deserializeAttachment(); } catch {}
+      if (isRecord(attachment) && typeof attachment.lastSeenAt === "number" && now - attachment.lastSeenAt <= 75_000) {
+        live ??= socket;
+      } else {
+        try { socket.close(4001, "stale"); } catch {}
+      }
+    }
+    return live;
   }
 
   private connect(request: Request): Response {
@@ -170,6 +196,7 @@ export class ComputerRelay {
     const pair = new WebSocketPair();
     const client = pair[0];
     this.state.acceptWebSocket(pair[1]);
+    (pair[1] as RelaySocket).serializeAttachment({ lastSeenAt: this.now() });
     return new Response(null, { status: 101, webSocket: client });
   }
 
@@ -194,13 +221,14 @@ export class ComputerRelay {
     }
     const requestFrame = frame as Frame;
     const id = requestFrame.id as string;
-    const websocket = this.state.getWebSockets().find((candidate) => candidate.readyState === WebSocket.OPEN);
+    const websocket = this.liveSocket();
     if (!websocket && !await this.isOnline()) return error("computer_offline", "Computer is offline.", 503);
 
     return new Promise<Response>((resolve) => {
       const pending: Pending = {
         timer: setTimeout(() => this.timeout(id), LIMITS.relayTimeoutSeconds * 1000),
         stream: requestFrame.stream === true,
+        socket: websocket,
         resolve,
         responseStarted: false,
       };
@@ -234,7 +262,7 @@ export class ComputerRelay {
     if (!Number.isFinite(requested) || requested < 0) return error("bad_request", "wait must be a non-negative number.", 400);
     const waitSeconds = Math.min(Math.floor(requested), LIMITS.relayPollSeconds);
     await this.touchComputer(computerId);
-    await this.state.storage.put("last_poll_at", Date.now());
+    await this.state.storage.put("last_poll_at", this.now());
     if (this.queuedFrames.length === 0 && waitSeconds > 0) await this.waitForPoll(Math.min(waitSeconds * 1000, LIMITS.relayPollSeconds * 1000));
     const frames = this.queuedFrames.splice(0, 50).map((encoded) => JSON.parse(encoded));
     return json({ frames });
@@ -256,6 +284,11 @@ export class ComputerRelay {
         this.countMalformedFrame();
         continue;
       }
+      if (frame.type === "hello") {
+        for (const socket of this.state.getWebSockets()) {
+          try { socket.close(4000, "replaced"); } catch {}
+        }
+      }
       await this.processFrame(frame);
     }
     return new Response(null, { status: 204 });
@@ -405,7 +438,7 @@ export class ComputerRelay {
       }
     }
     const cancelFrame = JSON.stringify({ type: "cancel", id });
-    const websocket = this.state.getWebSockets().find((candidate) => candidate.readyState === WebSocket.OPEN);
+    const websocket = this.liveSocket();
     if (websocket) {
       try { websocket.send(cancelFrame); } catch {}
     } else {
diff --git a/hub/proxy/test/proxy.test.ts b/hub/proxy/test/proxy.test.ts
index 3cbdc32..7a74613 100644
--- a/hub/proxy/test/proxy.test.ts
+++ b/hub/proxy/test/proxy.test.ts
@@ -556,10 +556,134 @@ describe("protocol-v2 proxy", () => {
     const relay = new ComputerRelay(state as never, { DB: db } as never);
     const frame = { type: "workspaces", workspaces: [{ workspace_id: "ws_aaaaaaaaaaaaaaaa", name: "kit", status: "ONLINE", last_seen_at: "2026-10-29T00:00:00.000Z" }] };
     expectDefinition("RelayWorkspaces", frame);
-    await relay.webSocketMessage({ readyState: 1, send() {}, close() {} } as never, JSON.stringify(frame));
+    await relay.webSocketMessage({ readyState: 1, send() {}, close() {}, serializeAttachment() {}, deserializeAttachment: () => ({ lastSeenAt: Date.now() }) } as never, JSON.stringify(frame));
     expect(writes.some((values) => values[0] === "ws_aaaaaaaaaaaaaaaa" && values[1] === "c_aaaaaaaaaaaaaaaa")).toBe(true);
   });
 
+  it("queues relay requests when the only WebSocket has been silent for over 75 seconds", async () => {
+    const now = 100_000;
+    const sent: Record<string, unknown>[] = [];
+    const closed: Array<[number, string]> = [];
+    let attachment: unknown = { lastSeenAt: now - 75_001 };
+    const socket = {
+      readyState: 1,
+      serializeAttachment(value: unknown) { attachment = value; },
+      deserializeAttachment() { return attachment; },
+      send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
+      close(code: number, reason: string) { closed.push([code, reason]); this.readyState = 2; },
+    };
+    const stored = new Map<string, unknown>([["last_poll_at", now]]);
+    const state = {
+      getWebSockets: () => [socket],
+      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
+    };
+    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
+    const relay = new ComputerRelay(state as never, { DB: db } as never, () => now);
+    const frame = {
+      type: "req", id: "stale-socket-request", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const pending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frame),
+    }));
+
+    await new Promise((resolve) => setTimeout(resolve, 10));
+    expect(sent).toEqual([]);
+    expect(closed).toEqual([[4001, "stale"]]);
+    const poll = await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/poll?wait=0"));
+    expect((await poll.json()).frames).toEqual([frame]);
+    await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [{ type: "res", id: frame.id, status: 200, body: { ok: true } }] }),
+    }));
+    expect((await pending).status).toBe(200);
+  });
+
+  it("lets a long-poll hello replace an open WebSocket", async () => {
+    const now = Date.now();
+    const closed: Array<[number, string]> = [];
+    const socket = {
+      readyState: 1,
+      serializeAttachment() {},
+      deserializeAttachment: () => ({ lastSeenAt: now }),
+      send() {},
+      close(code: number, reason: string) { closed.push([code, reason]); this.readyState = 2; },
+    };
+    const stored = new Map<string, unknown>([["last_poll_at", now]]);
+    const state = {
+      getWebSockets: () => [socket],
+      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
+    };
+    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
+    const relay = new ComputerRelay(state as never, { DB: db } as never, () => now);
+    const hello = { type: "hello", protocol: 2, computer_id: "c_aaaaaaaaaaaaaaaa", backend_version: "test", workspaces: [] };
+    const started = await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [hello] }),
+    }));
+    expect(started.status).toBe(204);
+    expect(closed).toEqual([[4000, "replaced"]]);
+
+    const frame = {
+      type: "req", id: "long-poll-after-hello", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const pending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frame),
+    }));
+    await new Promise((resolve) => setTimeout(resolve, 10));
+    const poll = await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/poll?wait=0"));
+    expect((await poll.json()).frames).toEqual([frame]);
+    await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [{ type: "res", id: frame.id, status: 200, body: { ok: true } }] }),
+    }));
+    expect((await pending).status).toBe(200);
+  });
+
+  it("fails only requests sent on a closed WebSocket", async () => {
+    const now = Date.now();
+    const sent: Record<string, unknown>[] = [];
+    const socket = {
+      readyState: 1,
+      serializeAttachment() {},
+      deserializeAttachment: () => ({ lastSeenAt: now }),
+      send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
+      close() { this.readyState = 2; },
+    };
+    const sockets: typeof socket[] = [];
+    const stored = new Map<string, unknown>([["last_poll_at", now]]);
+    const state = {
+      getWebSockets: () => sockets,
+      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
+    };
+    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
+    const relay = new ComputerRelay(state as never, { DB: db } as never, () => now);
+    const longPollFrame = {
+      type: "req", id: "long-poll-pending", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const longPollPending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(longPollFrame),
+    }));
+    await new Promise((resolve) => setTimeout(resolve, 10));
+
+    sockets.push(socket);
+    const socketFrame = {
+      type: "req", id: "socket-pending", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const socketPending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(socketFrame),
+    }));
+    await new Promise((resolve) => setTimeout(resolve, 10));
+    expect(sent).toEqual([socketFrame]);
+
+    relay.webSocketClose(socket as never);
+    expect((await socketPending).status).toBe(503);
+    await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [{ type: "res", id: longPollFrame.id, status: 200, body: { ok: true } }] }),
+    }));
+    expect((await longPollPending).status).toBe(200);
+  });
+
   it("sends cancel when the relay request is aborted", async () => {
     const sent: Record<string, unknown>[] = [];
     const socket = {
````

## Decision D2 needed (blocker) (29/10/26 17:05)

**T1 blocked: tests couldn't run in the worker**

The T1 worker (proxy socket liveness) wrote the code but could not run the tests: its worktree had no node_modules and npx tried to download. I linked the shared hub/node_modules into the worker worktrees (git-ignored). Running T1's tests now: 13 pass, 4 fail; the main cause is the unit-test fake socket lacking serializeAttachment, which then breaks the other relay tests.

- `A`: Send T1 back to its worker (recommended)
- `B`: Opus fixes it directly
- `C`: Stop T1

Waiting for the user's answer in chat.

## Decision D2 answered by the user (29/10/26 17:17)

- Choice: **A**: Send T1 back to its worker
- User's words (hub): "Send T1 back to its worker"

## Worker result - attempt 2 (29/10/26 17:44)

- Status: **done** (worker worker-2, branch `agent/hub7-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/node_modules`, `hub/proxy/src/computer-relay.ts`, `hub/proxy/test/proxy.test.ts`
- Scope: outside owned paths ['hub/node_modules']; secret-like []
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/proxy && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/proxy && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/proxy && npx tsc --noEmit -p .` -> exit 2
- Risks:
  - The prelinked hub/node_modules symlink appears as untracked in git status; it was present before implementation and is not included in files_changed.
- Not done: none
- Full diff: `.orchestrator/runs/hub7/reports/T1.diff`

````text
 hub/node_modules                |   1 +
 hub/proxy/src/computer-relay.ts |  50 ++++++++++---
 hub/proxy/test/proxy.test.ts    | 156 +++++++++++++++++++++++++++++++++++++---
 3 files changed, 187 insertions(+), 20 deletions(-)
````

````diff
diff --git a/hub/node_modules b/hub/node_modules
new file mode 120000
index 0000000..6aad915
--- /dev/null
+++ b/hub/node_modules
@@ -0,0 +1 @@
+/home/lap17124/Code/agent-kit/hub/node_modules
\ No newline at end of file
diff --git a/hub/proxy/src/computer-relay.ts b/hub/proxy/src/computer-relay.ts
index 48cb289..875fe7c 100644
--- a/hub/proxy/src/computer-relay.ts
+++ b/hub/proxy/src/computer-relay.ts
@@ -5,11 +5,17 @@ type Frame = Record<string, unknown> & { type: string };
 type Pending = {
   timer: ReturnType<typeof setTimeout>;
   stream: boolean;
+  socket?: WebSocket;
   resolve: (response: Response) => void;
   controller?: ReadableStreamDefaultController<Uint8Array>;
   responseStarted: boolean;
 };
 
+type RelaySocket = WebSocket & {
+  serializeAttachment(attachment: unknown): void;
+  deserializeAttachment(): unknown;
+};
+
 const encoder = new TextEncoder();
 
 function json(body: unknown, status = 200): Response {
@@ -75,12 +81,14 @@ export class ComputerRelay {
   private readonly pending = new Map<string, Pending>();
   private readonly queuedFrames: string[] = [];
   private readonly pollWaiters = new Set<() => void>();
+  private readonly now: () => number;
   private malformedFrames = 0;
   private computerId = "";
 
-  constructor(ctx: DurableObjectState, bindings: Env) {
+  constructor(ctx: DurableObjectState, bindings: Env, now: () => number = Date.now) {
     this.state = ctx;
     this.db = bindings.DB;
+    this.now = now;
   }
 
   private async knownComputerId(): Promise<string> {
@@ -123,6 +131,7 @@ export class ComputerRelay {
   }
 
   async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
+    (socket as RelaySocket).serializeAttachment({ lastSeenAt: this.now() });
     const bytes = typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength;
     if (bytes > LIMITS.relayFrameBytes) {
       this.countMalformedFrame();
@@ -138,8 +147,9 @@ export class ComputerRelay {
     await this.processFrame(frame, socket);
   }
 
-  webSocketClose(): void {
+  webSocketClose(socket: WebSocket): void {
     for (const [id, pending] of this.pending) {
+      if (pending.socket !== socket) continue;
       clearTimeout(pending.timer);
       this.pending.delete(id);
       if (pending.responseStarted && pending.controller) {
@@ -150,14 +160,29 @@ export class ComputerRelay {
     }
   }
 
-  webSocketError(): void {
-    this.webSocketClose();
+  webSocketError(socket: WebSocket): void {
+    this.webSocketClose(socket);
   }
 
   private async isOnline(): Promise<boolean> {
-    if (this.state.getWebSockets().some((socket) => socket.readyState === WebSocket.OPEN)) return true;
+    if (this.liveSocket()) return true;
     const lastPoll = await this.state.storage.get<number>("last_poll_at");
-    return typeof lastPoll === "number" && Date.now() - lastPoll <= 40_000;
+    return typeof lastPoll === "number" && this.now() - lastPoll <= 40_000;
+  }
+
+  private liveSocket(): WebSocket | undefined {
+    const now = this.now();
+    for (const socket of this.state.getWebSockets()) {
+      if (socket.readyState !== WebSocket.OPEN) continue;
+      let attachment: unknown;
+      try { attachment = (socket as RelaySocket).deserializeAttachment(); } catch {}
+      if (isRecord(attachment) && typeof attachment.lastSeenAt === "number" && now - attachment.lastSeenAt <= 75_000) {
+        return socket;
+      } else {
+        try { socket.close(4001, "stale"); } catch {}
+      }
+    }
+    return undefined;
   }
 
   private connect(request: Request): Response {
@@ -170,6 +195,7 @@ export class ComputerRelay {
     const pair = new WebSocketPair();
     const client = pair[0];
     this.state.acceptWebSocket(pair[1]);
+    (pair[1] as RelaySocket).serializeAttachment({ lastSeenAt: this.now() });
     return new Response(null, { status: 101, webSocket: client });
   }
 
@@ -194,13 +220,14 @@ export class ComputerRelay {
     }
     const requestFrame = frame as Frame;
     const id = requestFrame.id as string;
-    const websocket = this.state.getWebSockets().find((candidate) => candidate.readyState === WebSocket.OPEN);
+    const websocket = this.liveSocket();
     if (!websocket && !await this.isOnline()) return error("computer_offline", "Computer is offline.", 503);
 
     return new Promise<Response>((resolve) => {
       const pending: Pending = {
         timer: setTimeout(() => this.timeout(id), LIMITS.relayTimeoutSeconds * 1000),
         stream: requestFrame.stream === true,
+        socket: websocket,
         resolve,
         responseStarted: false,
       };
@@ -234,7 +261,7 @@ export class ComputerRelay {
     if (!Number.isFinite(requested) || requested < 0) return error("bad_request", "wait must be a non-negative number.", 400);
     const waitSeconds = Math.min(Math.floor(requested), LIMITS.relayPollSeconds);
     await this.touchComputer(computerId);
-    await this.state.storage.put("last_poll_at", Date.now());
+    await this.state.storage.put("last_poll_at", this.now());
     if (this.queuedFrames.length === 0 && waitSeconds > 0) await this.waitForPoll(Math.min(waitSeconds * 1000, LIMITS.relayPollSeconds * 1000));
     const frames = this.queuedFrames.splice(0, 50).map((encoded) => JSON.parse(encoded));
     return json({ frames });
@@ -256,6 +283,11 @@ export class ComputerRelay {
         this.countMalformedFrame();
         continue;
       }
+      if (frame.type === "hello") {
+        for (const socket of this.state.getWebSockets()) {
+          try { socket.close(4000, "replaced"); } catch {}
+        }
+      }
       await this.processFrame(frame);
     }
     return new Response(null, { status: 204 });
@@ -405,7 +437,7 @@ export class ComputerRelay {
       }
     }
     const cancelFrame = JSON.stringify({ type: "cancel", id });
-    const websocket = this.state.getWebSockets().find((candidate) => candidate.readyState === WebSocket.OPEN);
+    const websocket = this.liveSocket();
     if (websocket) {
       try { websocket.send(cancelFrame); } catch {}
     } else {
diff --git a/hub/proxy/test/proxy.test.ts b/hub/proxy/test/proxy.test.ts
index 3cbdc32..852d8b1 100644
--- a/hub/proxy/test/proxy.test.ts
+++ b/hub/proxy/test/proxy.test.ts
@@ -498,21 +498,16 @@ describe("protocol-v2 proxy", () => {
     expect(offline.status).toBe(503);
     expect((await readJson(offline, "ApiError")).error.code).toBe("computer_offline");
 
+    const contentWorkspace = `ws_${"e".repeat(16)}`;
+    await seedIndex(computer, contentWorkspace, "content workspace");
     const timeoutWorkspace = `ws_${"d".repeat(16)}`;
     await seedIndex(computer, timeoutWorkspace, "timeout workspace");
     const socket = await connectClient(computer.id, computer.key);
     try {
-      const pending = fetch(`${baseUrl}/api/v1/workspaces/${timeoutWorkspace}/documents`, { headers: headers(account.token) });
-      const timeoutRequest = await socket.nextMessage() as Record<string, unknown>;
-      expectDefinition("RelayRequest", timeoutRequest);
-      const timeout = await pending;
-      expect(timeout.status).toBe(504);
-      expect((await readJson(timeout, "ApiError")).error.code).toBe("computer_timeout");
-
-      const contentWorkspace = `ws_${"e".repeat(16)}`;
-      await seedIndex(computer, contentWorkspace, "content workspace");
       const content = fetch(`${baseUrl}/api/v1/workspaces/${contentWorkspace}/documents/content?path=report`, { headers: headers(account.token) });
-      const start = await socket.nextMessage() as Record<string, unknown>;
+      const start = await socket.nextMessage().catch((cause: unknown) => {
+        throw new Error("Timed out waiting for the streamed relay request.", { cause });
+      }) as Record<string, unknown>;
       expect(start.stream).toBe(true);
       const initial = { type: "res", id: start.id, status: 200, body: null };
       const document = {
@@ -539,6 +534,15 @@ describe("protocol-v2 proxy", () => {
       const response = await content;
       expect(response.status).toBe(200);
       expect(await readJson(response, "DocumentContent")).toEqual(document);
+
+      const pending = fetch(`${baseUrl}/api/v1/workspaces/${timeoutWorkspace}/documents`, { headers: headers(account.token) });
+      const timeoutRequest = await socket.nextMessage().catch((cause: unknown) => {
+        throw new Error("Timed out waiting for the timeout relay request.", { cause });
+      }) as Record<string, unknown>;
+      expectDefinition("RelayRequest", timeoutRequest);
+      const timeout = await pending;
+      expect(timeout.status).toBe(504);
+      expect((await readJson(timeout, "ApiError")).error.code).toBe("computer_timeout");
     } finally {
       socket.close();
     }
@@ -556,14 +560,141 @@ describe("protocol-v2 proxy", () => {
     const relay = new ComputerRelay(state as never, { DB: db } as never);
     const frame = { type: "workspaces", workspaces: [{ workspace_id: "ws_aaaaaaaaaaaaaaaa", name: "kit", status: "ONLINE", last_seen_at: "2026-10-29T00:00:00.000Z" }] };
     expectDefinition("RelayWorkspaces", frame);
-    await relay.webSocketMessage({ readyState: 1, send() {}, close() {} } as never, JSON.stringify(frame));
+    await relay.webSocketMessage({ readyState: 1, send() {}, close() {}, serializeAttachment() {}, deserializeAttachment: () => ({ lastSeenAt: Date.now() }) } as never, JSON.stringify(frame));
     expect(writes.some((values) => values[0] === "ws_aaaaaaaaaaaaaaaa" && values[1] === "c_aaaaaaaaaaaaaaaa")).toBe(true);
   });
 
+  it("queues relay requests when the only WebSocket has been silent for over 75 seconds", async () => {
+    const now = 100_000;
+    const sent: Record<string, unknown>[] = [];
+    const closed: Array<[number, string]> = [];
+    let attachment: unknown = { lastSeenAt: now - 75_001 };
+    const socket = {
+      readyState: 1,
+      serializeAttachment(value: unknown) { attachment = value; },
+      deserializeAttachment() { return attachment; },
+      send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
+      close(code: number, reason: string) { closed.push([code, reason]); this.readyState = 2; },
+    };
+    const stored = new Map<string, unknown>([["last_poll_at", now]]);
+    const state = {
+      getWebSockets: () => [socket],
+      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
+    };
+    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
+    const relay = new ComputerRelay(state as never, { DB: db } as never, () => now);
+    const frame = {
+      type: "req", id: "stale-socket-request", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const pending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frame),
+    }));
+
+    await new Promise((resolve) => setTimeout(resolve, 10));
+    expect(sent).toEqual([]);
+    expect(closed).toEqual([[4001, "stale"]]);
+    const poll = await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/poll?wait=0"));
+    expect((await poll.json()).frames).toEqual([frame]);
+    await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [{ type: "res", id: frame.id, status: 200, body: { ok: true } }] }),
+    }));
+    expect((await pending).status).toBe(200);
+  });
+
+  it("lets a long-poll hello replace an open WebSocket", async () => {
+    const now = Date.now();
+    const closed: Array<[number, string]> = [];
+    const socket = {
+      readyState: 1,
+      serializeAttachment() {},
+      deserializeAttachment: () => ({ lastSeenAt: now }),
+      send() {},
+      close(code: number, reason: string) { closed.push([code, reason]); this.readyState = 2; },
+    };
+    const stored = new Map<string, unknown>([["last_poll_at", now]]);
+    const state = {
+      getWebSockets: () => [socket],
+      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
+    };
+    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
+    const relay = new ComputerRelay(state as never, { DB: db } as never, () => now);
+    const hello = { type: "hello", protocol: 2, computer_id: "c_aaaaaaaaaaaaaaaa", backend_version: "test", workspaces: [] };
+    const started = await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [hello] }),
+    }));
+    expect(started.status).toBe(204);
+    expect(closed).toEqual([[4000, "replaced"]]);
+
+    const frame = {
+      type: "req", id: "long-poll-after-hello", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const pending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frame),
+    }));
+    await new Promise((resolve) => setTimeout(resolve, 10));
+    const poll = await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/poll?wait=0"));
+    expect((await poll.json()).frames).toEqual([frame]);
+    await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [{ type: "res", id: frame.id, status: 200, body: { ok: true } }] }),
+    }));
+    expect((await pending).status).toBe(200);
+  });
+
+  it("fails only requests sent on a closed WebSocket", async () => {
+    const now = Date.now();
+    const sent: Record<string, unknown>[] = [];
+    const socket = {
+      readyState: 1,
+      serializeAttachment() {},
+      deserializeAttachment: () => ({ lastSeenAt: now }),
+      send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
+      close() { this.readyState = 2; },
+    };
+    const sockets: typeof socket[] = [];
+    const stored = new Map<string, unknown>([["last_poll_at", now]]);
+    const state = {
+      getWebSockets: () => sockets,
+      storage: { get: async (key: string) => stored.get(key), put: async (key: string, value: unknown) => { stored.set(key, value); }, delete: async () => false },
+    };
+    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
+    const relay = new ComputerRelay(state as never, { DB: db } as never, () => now);
+    const longPollFrame = {
+      type: "req", id: "long-poll-pending", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const longPollPending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(longPollFrame),
+    }));
+    await new Promise((resolve) => setTimeout(resolve, 10));
+
+    sockets.push(socket);
+    const socketFrame = {
+      type: "req", id: "socket-pending", method: "GET", path: "/api/v1/stream", query: "",
+      body: null, assertion: "test-assertion", stream: false,
+    };
+    const socketPending = relay.fetch(new Request("https://relay/internal/computers/c_aaaaaaaaaaaaaaaa/relay", {
+      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(socketFrame),
+    }));
+    await new Promise((resolve) => setTimeout(resolve, 10));
+    expect(sent).toEqual([socketFrame]);
+
+    relay.webSocketClose(socket as never);
+    expect((await socketPending).status).toBe(503);
+    await relay.fetch(new Request("https://relay/api/v1/computers/c_aaaaaaaaaaaaaaaa/frames", {
+      method: "POST", body: JSON.stringify({ frames: [{ type: "res", id: longPollFrame.id, status: 200, body: { ok: true } }] }),
+    }));
+    expect((await longPollPending).status).toBe(200);
+  });
+
   it("sends cancel when the relay request is aborted", async () => {
     const sent: Record<string, unknown>[] = [];
+    let attachment: unknown = { lastSeenAt: Date.now() };
     const socket = {
       readyState: 1,
+      serializeAttachment(value: unknown) { attachment = value; },
+      deserializeAttachment() { return attachment; },
       send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
       close() {},
     };
@@ -591,8 +722,11 @@ describe("protocol-v2 proxy", () => {
 
   it("forwards a canceled stream to the backend as a cancel frame", async () => {
     const sent: Record<string, unknown>[] = [];
+    let attachment: unknown = { lastSeenAt: Date.now() };
     const socket = {
       readyState: 1,
+      serializeAttachment(value: unknown) { attachment = value; },
+      deserializeAttachment() { return attachment; },
       send(value: string) { sent.push(JSON.parse(value) as Record<string, unknown>); },
       close() {},
     };
````

## Review round 2: PASS (29/10/26 17:49)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: a00f5a34e990, commits a00f5a34e990
- Notes: orchestrator added immediate fail of pending on self-closed sockets

# Review hub7 T1: proxy socket liveness: PASS (with orchestrator fix)

- Diff: `hub/proxy/src/computer-relay.ts` (+50/-?), `hub/proxy/test/proxy.test.ts` (+156). Scope OK.
- `liveSocket()` = OPEN and heard from within 75 s (lastSeenAt in socket attachment, set on accept and
  every message); used for routing, `isOnline()`, cancel. Stale sockets closed 4001.
- Long-poll `hello` closes all WebSockets (4000 "replaced"). Pending requests remember their socket;
  `webSocketClose(socket)` fails only that socket's requests. Optional clock in the constructor.
- Orchestrator fix: when the proxy closes a socket itself (stale or replaced), it now calls
  `webSocketClose(socket)` right away, since a self-initiated close may not fire the handler and those
  requests would wait for the relay timeout.
- Worker's temporary `relay_socket_debug` log was removed before the report (checked).
- Verified: proxy vitest 17/17, tsc clean. `hub/node_modules` symlink (orchestrator's) removed before commit.
- Unresolved: Cloudflare hibernation behaviour of attachments verified only by unit test, not live.

## Integration: merged (29/10/26 17:49)

- On `agent/integration-hub7` at 313eb1d833ea; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub7/logs/post-merge-T1-a2.log`)

## Final gate: PASS (29/10/26 17:50)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub7 at 77bcdb6b6632 (log `.orchestrator/runs/hub7/logs/verify-1793270990.log`)
- Task MERGED; run DONE
