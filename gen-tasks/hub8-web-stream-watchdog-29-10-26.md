# Website detects a dead live stream (29/10/26)

## Goal
The website treats a live stream that has been silent for 45 s as dead and reconnects, and restarts streams when the page becomes visible again or the device comes back online; panels that failed to load are retried every 5 s.

## Read first
- `plans/261029-1720-hub8-stream-watchdog/plan.md` section **T1**: **the full spec** (work items, tests). Follow it exactly.
- `hub/web/src/api/http/HttpHubClient.ts` (`streamLoop`, `startPoll`, `refreshWorkspaceAll`, `setConnection`, `dispose`), `hub/web/src/api/http/HttpHubClient.test.ts` (fake fetch pattern).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/web/src/api/http/HttpHubClient.ts`
- `hub/web/src/api/http/HttpHubClient.test.ts`

**You must not edit:**
- Any other file; also `hub/protocol/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.agent-system/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/web`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install` or any download; `wrangler` (login/deploy/dev/secret) or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `cd hub/web && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/web && npx vitest run && npx tsc --noEmit -p .`: expect web tests and typecheck pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (29/10/26 17:06)

- Status: **done** (worker worker-1, branch `agent/hub7-t3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/web/src/api/http/HttpHubClient.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`
- Scope: OK
- Tests reported:
  - `cd hub/web && source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `cd hub/web && source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `cd hub/web && source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `cd hub/web && source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub7/reports/T3.diff`

````text
 hub/web/src/api/http/HttpHubClient.test.ts | 41 +++++++++++++++++++++++++++++-
 hub/web/src/api/http/HttpHubClient.ts      |  7 ++++-
 2 files changed, 46 insertions(+), 2 deletions(-)
````

````diff
diff --git a/hub/web/src/api/http/HttpHubClient.test.ts b/hub/web/src/api/http/HttpHubClient.test.ts
index f942183..13f2b22 100644
--- a/hub/web/src/api/http/HttpHubClient.test.ts
+++ b/hub/web/src/api/http/HttpHubClient.test.ts
@@ -10,7 +10,7 @@ const summary = (computerId: string | null) => ({
 const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
 
 describe('HttpHubClient', () => {
-  afterEach(() => { vi.unstubAllGlobals(); });
+  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
 
   it('keeps the computer from the listing when a workspace detail refresh arrives, so the live stream stays open', async () => {
     let streamSignal: AbortSignal | undefined;
@@ -46,4 +46,43 @@ describe('HttpHubClient', () => {
       client.dispose();
     }
   });
+
+  it('retries a failed stream within 3 seconds and refreshes decisions after reconnecting', async () => {
+    vi.useFakeTimers();
+    let streamAttempts = 0;
+    let decisionRequests = 0;
+    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
+      const path = new URL(input).pathname;
+      if (path.endsWith('/computers/c_1/stream')) {
+        streamAttempts += 1;
+        if (streamAttempts < 3) throw new Error('stream unavailable');
+        return new Response(new ReadableStream<Uint8Array>(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
+      }
+      if (path.endsWith('/workspaces')) return json({ items: [summary('c_1')], next: null });
+      if (path.endsWith('/workspaces/ws_aaaaaaaaaaaaaaaa')) {
+        return json({ workspace: summary(null), snapshot: null, decisions_open: [], commands_recent: [] });
+      }
+      if (path.endsWith('/decisions')) {
+        decisionRequests += 1;
+        return json({ items: [], next: null });
+      }
+      return json({ items: [], next: null });
+    }));
+
+    const client = new HttpHubClient('https://hub.example', () => 'token', () => {});
+    try {
+      await vi.advanceTimersByTimeAsync(0);
+      expect(streamAttempts).toBe(1);
+      expect(decisionRequests).toBe(1);
+      await vi.advanceTimersByTimeAsync(1000);
+      expect(streamAttempts).toBe(2);
+      await vi.advanceTimersByTimeAsync(1999);
+      expect(streamAttempts).toBe(2);
+      await vi.advanceTimersByTimeAsync(1);
+      expect(streamAttempts).toBe(3);
+      await vi.waitFor(() => expect(decisionRequests).toBe(2));
+    } finally {
+      client.dispose();
+    }
+  });
 });
diff --git a/hub/web/src/api/http/HttpHubClient.ts b/hub/web/src/api/http/HttpHubClient.ts
index f6a4ea2..e8e2277 100644
--- a/hub/web/src/api/http/HttpHubClient.ts
+++ b/hub/web/src/api/http/HttpHubClient.ts
@@ -270,9 +270,14 @@ export class HttpHubClient implements HubClient {
           throw error;
         }
         if (!response.body) throw new HubApiError('empty_stream', 'The event stream had no body.');
+        const reconnected = this.streamDown.has(computerId);
         this.streamDown.delete(computerId);
         this.clearPoll(computerId);
         this.setConnection();
+        if (reconnected) {
+          const workspaces = this.snap.workspaces.filter((item) => item.computerId === computerId);
+          void Promise.all(workspaces.map((item) => this.refreshWorkspaceAll(item.id, item.computerOnline))).catch(() => {});
+        }
         delay = 1000;
         const parser = new SSEParser();
         const reader = response.body.getReader();
@@ -303,7 +308,7 @@ export class HttpHubClient implements HubClient {
         this.setConnection();
         this.startPoll(computerId);
         await this.wait(delay, signal);
-        delay = Math.min(delay * 2, 30_000);
+        delay = Math.min(delay * 2, 5_000);
       }
     }
   }
````

## Review round 1: PASS (29/10/26 17:07)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 5cf459111f44, commits 5cf459111f44

# Review hub7 T3: web stream recovery: PASS

- Diff: `hub/web/src/api/http/HttpHubClient.ts` (+7/-1), test (+41). Scope OK (owned paths only).
- Backoff cap 30 s → 5 s; on reconnect after `streamDown`, refetches every workspace of that computer once.
- Test: fake timers, stream fails twice, attempts at 0 / 1 s / 3 s, decisions refetched after reconnect.
- Verified by orchestrator: web vitest 47/47, tsc clean (worker-1 worktree, shared node_modules linked).
- Note: refetch reuses `refreshWorkspaceAll` (same as the 10 s poll), errors swallowed like the poll.
- Unresolved: none.
