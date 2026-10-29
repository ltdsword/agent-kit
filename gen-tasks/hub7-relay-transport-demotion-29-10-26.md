# Backend relay stops returning to a flapping transport (29/10/26)

## Goal
A relay transport that drops within 5 minutes of connecting is tried last for 15 minutes, and the backend logs when each transport connects.

## Read first
- `plans/261029-1700-hub7-relay-failover/plan.md` section **T2**: **the full spec** (work items, tests). Follow it exactly.
- `hub/server/src/relay.ts` (`run`, `runWebSocket`, `runLongPoll`, `setStatus`), `hub/server/test/server.test.ts` (`FakeProxy`, `startRelay`, the `relay client` describe block).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/src/relay.ts`
- `hub/server/test/server.test.ts`

**You must not edit:**
- Any other file: the other hub7 tasks own `hub/proxy/src/computer-relay.ts`, `hub/proxy/test/proxy.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/HttpHubClient.test.ts`; also `hub/protocol/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.agent-system/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/server`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install` or any download; `wrangler` (login/deploy/dev/secret) or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T2 is done.
- [ ] `cd hub/server && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/server && npx vitest run && npx tsc --noEmit -p .`: expect server tests and typecheck pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (29/10/26 17:06)

- Status: **blocked** (worker worker-3, branch `agent/hub7-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/node_modules`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/server && npx vitest run && npx tsc --noEmit -p .` -> exit 1
- Risks:
  - T2 item 1 says demoted transports are last in each cycle's order, which implies they can still be attempted before expiry; its test bullet says the WebSocket is tried again only after the 15-minute window. The task header provides no interpretation.
- Not done:
  - No source or test edits made pending clarification whether active demotions should be skipped until expiry or attempted last on every retry cycle.
  - Vitest/typecheck validation incomplete: npx vitest failed on the read-only npm cache, and the chained typecheck did not run. Downloads are prohibited by the task.
- Full diff: `.orchestrator/runs/hub7/reports/T2.diff`

````text
 hub/node_modules | 1 +
 1 file changed, 1 insertion(+)
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
````

## Decision D3 needed (blocker) (29/10/26 17:06)

**T2 blocked: my spec was ambiguous**

The T2 worker (backend stops retrying a flapping connection) stopped before editing: the spec said a demoted connection is 'tried last' but the test said it is 'tried again only after 15 min'. Correct meaning: tried last, never skipped (otherwise if all connections are demoted nothing is tried). I fixed the plan. Its tests could not run either (same missing node_modules, now linked).

- `A`: Send T2 back with the clarification (recommended)
- `B`: Opus implements T2 directly
- `C`: Stop T2

Waiting for the user's answer in chat.

## Decision D3 answered by the user (29/10/26 17:18)

- Choice: **A**: Send T2 back with the clarification
- User's words (hub): "Send T2 back with the clarification"

## Worker result - attempt 2 (29/10/26 17:26)

- Status: **done** (worker worker-3, branch `agent/hub7-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/node_modules`, `hub/server/src/relay.ts`, `hub/server/test/server.test.ts`
- Scope: outside owned paths ['hub/node_modules']; secret-like []
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/server && npx vitest run && npx tsc --noEmit -p .` -> exit 2
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/server && npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/server && npx vitest run && npx tsc --noEmit -p .` -> exit 0
- Risks:
  - A pre-existing untracked hub/node_modules symlink was present at start and left intact for tests.
- Not done: none
- Full diff: `.orchestrator/runs/hub7/reports/T2.diff`

````text
 hub/node_modules               |  1 +
 hub/server/src/relay.ts        | 31 +++++++++++++-
 hub/server/test/server.test.ts | 95 +++++++++++++++++++++++++++++++++++++++++-
 3 files changed, 123 insertions(+), 4 deletions(-)
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
diff --git a/hub/server/src/relay.ts b/hub/server/src/relay.ts
index f51be59..4047b58 100644
--- a/hub/server/src/relay.ts
+++ b/hub/server/src/relay.ts
@@ -36,12 +36,14 @@ export class RelayClient {
   private readonly requests = new Map<string, AbortController>();
   private readonly timers = new Set<ReturnType<typeof setTimeout>>();
   private readonly intervals = new Set<ReturnType<typeof setInterval>>();
+  private readonly demotedUntil = new Map<Transport, number>();
   private readonly unsubscribe: () => void;
   private currentSocket?: WebSocket;
   private preferred?: Transport;
   private currentStatus: RelayStatus;
   private running?: Promise<void>;
   private sendWorkspaces?: () => void;
+  private transportConnectedAt?: number;
   private backoffMs = 1_000;
   private workspaceTimer?: ReturnType<typeof setTimeout>;
   // A dead network path can leave a socket or request open forever; these bound every wait so the loop always retries.
@@ -104,9 +106,24 @@ export class RelayClient {
 
   private async run(): Promise<void> {
     while (!this.abort.signal.aborted) {
-      const order: Transport[] = ["websocket", "long-poll-direct", "long-poll-proxy"];
-      if (this.preferred) order.unshift(order.splice(order.indexOf(this.preferred), 1)[0]);
+      const normalOrder: Transport[] = ["websocket", "long-poll-direct", "long-poll-proxy"];
+      const now = this.clock();
+      const demoted = new Set(normalOrder.filter((transport) => {
+        const until = this.demotedUntil.get(transport);
+        if (until === undefined) return false;
+        if (until <= now) { this.demotedUntil.delete(transport); return false; }
+        return true;
+      }));
+      let order = normalOrder;
+      if (demoted.size < normalOrder.length) {
+        const available = normalOrder.filter((transport) => !demoted.has(transport));
+        if (this.preferred && available.includes(this.preferred)) {
+          available.unshift(available.splice(available.indexOf(this.preferred), 1)[0]);
+        }
+        order = [...available, ...normalOrder.filter((transport) => demoted.has(transport))];
+      }
       for (const transport of order) {
+        this.transportConnectedAt = undefined;
         try {
           await this.setStatus(transport, false);
           if (transport === "websocket") await this.runWebSocket();
@@ -115,6 +132,12 @@ export class RelayClient {
           if (this.abort.signal.aborted) break;
           const reason = error instanceof Error ? (error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message) : String(error);
           process.stderr.write(`${new Date(this.clock()).toISOString()} relay ${transport} ended: ${reason}\n`);
+          const endedAt = this.clock();
+          if (this.transportConnectedAt === undefined || endedAt - this.transportConnectedAt < 5 * 60 * 1000) {
+            this.demotedUntil.set(transport, endedAt + 15 * 60 * 1000);
+          } else {
+            this.demotedUntil.delete(transport);
+          }
           await this.setStatus(transport, false);
         }
         if (this.abort.signal.aborted) break;
@@ -169,6 +192,8 @@ export class RelayClient {
           if (this.abort.signal.aborted) { socket.close(); finish(new Error("relay stopped")); return; }
           this.preferred = "websocket";
           this.backoffMs = 1_000;
+          this.transportConnectedAt = this.clock();
+          process.stderr.write(`${new Date(this.clock()).toISOString()} relay websocket connected\n`);
           void this.setStatus("websocket", true);
           send(this.hello(), "RelayHello");
           lastMessageAt = Date.now();
@@ -233,6 +258,8 @@ export class RelayClient {
       if (flushError) throw flushError;
       this.preferred = useProxy ? "long-poll-proxy" : "long-poll-direct";
       this.backoffMs = 1_000;
+      this.transportConnectedAt = this.clock();
+      process.stderr.write(`${new Date(this.clock()).toISOString()} relay ${this.preferred} connected\n`);
       await this.setStatus(this.preferred, true);
       while (!this.abort.signal.aborted) {
         if (flushError) throw flushError;
diff --git a/hub/server/test/server.test.ts b/hub/server/test/server.test.ts
index 40c3e55..0cba23f 100644
--- a/hub/server/test/server.test.ts
+++ b/hub/server/test/server.test.ts
@@ -248,22 +248,29 @@ function parseClientFrames(socket: Duplex, onFrame: (frame: unknown) => void, in
 
 class FakeProxy {
   readonly messages: any[] = [];
+  readonly attemptEvents: string[] = [];
   readonly sockets = new Set<Duplex>();
   readonly queued: unknown[] = [];
   readonly paths: string[] = [];
   readonly server = createServer((request, response) => { void this.http(request, response); });
   port = 0;
   websocket = true;
+  closeNextWebsocketImmediately = false;
   failPolls = false;
   hangUpgrade = false;
   hangPolls = false;
+  holdPolls = false;
   websocketAttempts = 0;
+  websocketHellos = 0;
+  pollAttempts = 0;
   authHeaders: string[] = [];
+  private pendingPollResponses: ServerResponse[] = [];
   private waiters: Array<{ predicate: (frame: any) => boolean; resolve: (frame: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
 
   async listen(): Promise<void> {
     this.server.on("upgrade", (request, socket, head) => {
       this.websocketAttempts++;
+      this.attemptEvents.push("websocket");
       if (this.hangUpgrade) { this.sockets.add(socket); return; }
       if (!this.websocket) { socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n"); return; }
       this.authHeaders.push(String(request.headers.authorization ?? ""));
@@ -273,7 +280,14 @@ class FakeProxy {
       socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
       this.sockets.add(socket);
       socket.on("close", () => this.sockets.delete(socket));
-      parseClientFrames(socket, (frame) => this.capture(frame), head);
+      parseClientFrames(socket, (frame) => {
+        if (frame && typeof frame === "object" && "type" in frame && frame.type === "hello") this.websocketHellos++;
+        this.capture(frame);
+      }, head);
+      if (this.closeNextWebsocketImmediately) {
+        this.closeNextWebsocketImmediately = false;
+        socket.end();
+      }
     });
     await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
     this.port = (this.server.address() as { port: number }).port;
@@ -307,14 +321,23 @@ class FakeProxy {
 
   closeSockets(): void { for (const socket of this.sockets) socket.destroy(); this.sockets.clear(); }
 
+  releasePoll(status = 200): void {
+    const response = this.pendingPollResponses.shift();
+    if (!response) throw new Error("no held poll response to release");
+    if (status !== 200) { response.writeHead(status).end(); return; }
+    setTimeout(() => response.end(JSON.stringify({ frames: [] })), 20);
+  }
+
   private async http(request: IncomingMessage, response: ServerResponse): Promise<void> {
     const path = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
     this.paths.push(path);
     this.authHeaders.push(String(request.headers.authorization ?? ""));
     if (path.endsWith("/connect")) { response.writeHead(426).end(); return; }
     if (path.endsWith("/poll")) {
+      this.pollAttempts++;
       if (this.failPolls) { response.writeHead(503).end(); return; }
       if (this.hangPolls) return;
+      if (this.holdPolls) { this.pendingPollResponses.push(response); return; }
       const frame = this.queued.shift();
       setTimeout(() => response.end(JSON.stringify({ frames: frame === undefined ? [] : [frame] })), 20);
       return;
@@ -323,7 +346,12 @@ class FakeProxy {
       if (this.failPolls) { response.writeHead(503).end(); return; }
       const chunks: Buffer[] = [];
       for await (const chunk of request) chunks.push(Buffer.from(chunk));
-      try { for (const frame of JSON.parse(Buffer.concat(chunks).toString("utf8")).frames) this.capture(frame); } catch {}
+      try {
+        for (const frame of JSON.parse(Buffer.concat(chunks).toString("utf8")).frames) {
+          if (frame.type === "hello") this.attemptEvents.push("long-poll");
+          this.capture(frame);
+        }
+      } catch {}
       response.writeHead(204).end(); return;
     }
     response.writeHead(404).end();
@@ -336,6 +364,12 @@ class FakeProxy {
   }
 }
 
+async function waitUntil(predicate: () => boolean, label: string, timeout = 5000): Promise<void> {
+  const deadline = Date.now() + timeout;
+  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
+  expect(predicate(), label).toBe(true);
+}
+
 function newRelayRequest(id: string, path: string, stream = false): RelayRequest {
   return { type: "req", id, method: "GET", path, query: "", body: null, assertion: testAssertion, stream };
 }
@@ -363,6 +397,63 @@ async function startRelay(proxy: FakeProxy, relayAppInstance: Hono, dbInstance =
 }
 
 describe("relay client", () => {
+  it("tries a briefly dropped WebSocket last for 15 minutes, then restores its place", async () => {
+    const proxy = new FakeProxy();
+    proxy.closeNextWebsocketImmediately = true;
+    proxy.holdPolls = true;
+    await proxy.listen();
+    try {
+      const client = await startRelay(proxy, relayApp({ cancelled: false, started: false }));
+      await waitUntil(() => proxy.pollAttempts >= 1, "first long-poll attempt did not start");
+
+      now += 5 * 60 * 1000;
+      proxy.releasePoll(503);
+      await waitUntil(() => proxy.pollAttempts >= 2, "second long-poll attempt did not start");
+      now += 5 * 60 * 1000;
+      proxy.releasePoll(503);
+
+      const cycleTwoStart = proxy.attemptEvents.length;
+      const websocketHelloBaseline = proxy.websocketHellos;
+      await waitUntil(() => proxy.pollAttempts >= 3, "second cycle did not start");
+      now += 5 * 60 * 1000;
+      proxy.releasePoll(503);
+      await waitUntil(() => proxy.pollAttempts >= 4, "second cycle did not try both long-poll transports");
+      now += 5 * 60 * 1000;
+      proxy.releasePoll(503);
+      await waitUntil(() => proxy.websocketAttempts >= 2, "second cycle did not try WebSocket");
+      expect(proxy.attemptEvents.slice(cycleTwoStart, cycleTwoStart + 3)).toEqual(["long-poll", "long-poll", "websocket"]);
+
+      await waitUntil(() => proxy.websocketHellos > websocketHelloBaseline, "second WebSocket did not connect");
+      const secondWebsocketIndex = proxy.attemptEvents.lastIndexOf("websocket");
+      proxy.closeSockets();
+      await waitUntil(() => !client.status().connected, "second WebSocket did not disconnect");
+      now += 16 * 60 * 1000;
+      await waitUntil(() => proxy.websocketAttempts >= 3, "WebSocket was not first in the cycle after its demotion expired");
+      expect(proxy.attemptEvents[secondWebsocketIndex + 1]).toBe("websocket");
+      await client.stop();
+    } finally { await proxy.close(); }
+  }, 20000);
+
+  it("does not demote a transport that stays connected for five minutes", async () => {
+    const proxy = new FakeProxy();
+    proxy.websocket = false;
+    proxy.holdPolls = true;
+    await proxy.listen();
+    try {
+      const client = await startRelay(proxy, relayApp({ cancelled: false, started: false }));
+      await waitUntil(() => proxy.pollAttempts >= 1, "first long-poll attempt did not start");
+      now += 5 * 60 * 1000;
+      proxy.releasePoll(503);
+      await waitUntil(() => proxy.pollAttempts >= 2, "second long-poll attempt did not start");
+      proxy.releasePoll(503);
+
+      const nextCycleStart = proxy.attemptEvents.length;
+      await waitUntil(() => proxy.attemptEvents.length > nextCycleStart, "retry cycle did not start");
+      expect(proxy.attemptEvents[nextCycleStart]).toBe("long-poll");
+      await client.stop();
+    } finally { await proxy.close(); }
+  }, 15000);
+
   it("sends hello, routes requests, streams, cancels, bounds frames, updates workspaces, and reconnects", async () => {
     const proxy = new FakeProxy(); await proxy.listen();
     const signals = { cancelled: false, started: false };
````

## Review round 2: PASS (29/10/26 17:26)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 9bc97bb08d35, commits 9bc97bb08d35

# Review hub7 T2: relay transport demotion: PASS

- Diff: `hub/server/src/relay.ts` (+31), `hub/server/test/server.test.ts` (FakeProxy hooks + 2 tests). Scope OK.
- A transport ending < 5 min after connect (or never connected) is demoted 15 min; order = non-demoted
  (preferred first) then demoted; never skipped; all demoted → normal order. Uses injected clock.
- Logs `<iso> relay <transport> connected` for websocket and long-poll.
- Tests: demoted websocket tried last, back first after 16 min; 5-min-stable transport not demoted.
- Verified by orchestrator: server vitest 16/16, tsc clean.
- Housekeeping: the worker diff listed `hub/node_modules` (orchestrator's shared-deps symlink, not
  ignored as a symlink); removed before commit. Not part of the change.
- Unresolved: none.

## Integration: merged (29/10/26 17:49)

- On `agent/integration-hub7` at 67dcaed3ed6e; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub7/logs/post-merge-T2-a2.log`)

## Final gate: PASS (29/10/26 17:50)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub7 at 77bcdb6b6632 (log `.orchestrator/runs/hub7/logs/verify-1793270990.log`)
- Task MERGED; run DONE

## Finished (29/10/26 18:00)

- merged into hub/plan (decision D6)
