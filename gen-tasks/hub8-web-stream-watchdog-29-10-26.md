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

## Decision D1 needed (worker_approval) (29/10/26 20:53)

**Let worker-1 run the web tests outside its sandbox?**

worker-1 (hub8 T1) finished coding and wants to run the web tests. Vite writes a temporary config file inside the shared hub/node_modules that I linked into its folder, which is outside the worker's sandbox, so the sandbox blocked it. The command only runs the tests and the typecheck.

- `A`: Yes, this once
- `B`: Yes, and don't ask again for this command (recommended)
- `C`: No

Waiting for the user's answer in chat.

## Decision D1 answered by the user (29/10/26 21:19)

- Choice: **A**: Yes, this once
- User's words (chat): "choose A."

## Decision D2 needed (scope_exception) (29/10/26 21:20)

**Also retry the workspace list in hub8?**

Why refresh showed 'Workspace not found': your computer's internet keeps dropping (5 drops 20:48-21:16, connect timeouts to Cloudflare). If the page loads during a drop, the workspace list request fails, the page says 'Workspace not found' and never retries; the home page loads it again, so you saw 3 workspaces there. hub8 T1 currently retries only the panels inside a workspace. Proposed: tell worker-1 (still on the same file) to also retry the first load every 5 s until it succeeds, and keep the page in 'connecting' (not 'not found') until the list has loaded once.

- `A`: Add it to hub8 T1 now (recommended)
- `B`: Leave it for later

Waiting for the user's answer in chat.

## Decision D2 answered by the user (29/10/26 21:23)

- Choice: **A**: Add it to hub8 T1 now
- User's words (chat): "choose A btw"

## Decision D3 needed (worker_approval) (29/10/26 22:51)

**Let worker-1 rerun the web tests (2nd time)?**

worker-1 fixed one type error and wants to rerun the same test + typecheck command to confirm. Last run: all 52 tests passed.

- `A`: Yes, this once
- `B`: Yes, and don't ask again for this command (recommended)
- `C`: No

Waiting for the user's answer in chat.

## Decision D3 answered by the user (29/10/26 22:55)

- Choice: **B**: Yes, and don't ask again for this command
- User's words (hub): "Yes, and don't ask again for this command"

## Worker result - attempt 1 (29/10/26 23:00)

- Status: **blocked** (worker worker-1, branch `agent/hub8-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/node_modules`, `hub/web/src/api/http/HttpHubClient.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 2
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
- Risks:
  - WorkspacePage renders Workspace not found whenever the workspace is absent and does not check HubSnapshot.loaded. The initial list remains loading (loaded=false), but that route cannot show a loading state within the two-file ownership boundary.
- Not done:
  - Workspace route loading UI during the first workspace-list request requires a change to hub/web/src/features/workspace/WorkspacePage.tsx, which is outside the authorized files.
- Full diff: `.orchestrator/runs/hub8/reports/T1.diff`

````text
 hub/node_modules                           |   1 +
 hub/web/src/api/http/HttpHubClient.test.ts | 274 +++++++++++++++++++++++++++++
 hub/web/src/api/http/HttpHubClient.ts      | 182 +++++++++++++++++--
 3 files changed, 439 insertions(+), 18 deletions(-)
````

(diff is 591 lines; read the full diff file)

## Decision D4 needed (blocker) (29/10/26 23:01)

**hub8 T1: how to finish the 'Workspace not found' fix?**

worker-1 finished everything (54 tests + typecheck pass): 45 s dead-stream detection, reconnect when you reopen the page or get back online, 5 s retry for failed panels and for the workspace list; home page now shows loading cards instead of 'No workspaces yet'. Last piece: the workspace page itself still says 'Workspace not found' while the list is loading. The fix is 1 line in WorkspacePage.tsx (show 'Connecting…' until loaded), which is outside the worker's allowed files, so it stopped.

- `A`: Worker reports done for its files; Opus adds the WorkspacePage line during integration (recommended)
- `B`: Leave the workspace page as-is for now

Waiting for the user's answer in chat.

## Decision D4 answered by the user (29/10/26 23:23)

- Choice: **A**: Worker reports done for its files; Opus adds the WorkspacePage line during integration
- User's words (hub): "Worker reports done for its files; Opus adds the WorkspacePage line during integration"

## Worker result - attempt 2 (29/10/26 23:25)

- Status: **done** (worker worker-1, branch `agent/hub8-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/web/src/api/http/HttpHubClient.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 2
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
- Risks:
  - The current-session verification rerun could not resolve local Vite dependencies; the earlier successful run is retained above.
- Not done:
  - WorkspacePage.tsx loading line is handled by Opus during integration, per D4=A.
- Full diff: `.orchestrator/runs/hub8/reports/T1.diff`

````text
 hub/web/src/api/http/HttpHubClient.test.ts | 274 +++++++++++++++++++++++++++++
 hub/web/src/api/http/HttpHubClient.ts      | 182 +++++++++++++++++--
 2 files changed, 438 insertions(+), 18 deletions(-)
````

(diff is 583 lines; read the full diff file)

## Review round 2: PASS (29/10/26 23:26)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 7b5bbc3286b8, commits 7b5bbc3286b8

# Review: hub8 T1 web stream watchdog

Verdict: PASS

## Checked
- 45 s silence watchdog per stream attempt; timer cleared in finally; reader cancelled; outer abort detaches.
- visibilitychange/online listeners added in constructor, removed in dispose(); restart aborts streams, clears polls, resyncs, refetches.
- Panel loads via Promise.allSettled; per-resource 5 s retry timers keyed workspace+resource; cleared when computer offline, on success, on dispose. Connection 'lost' while retries pending.
- D2: initial workspace list retried every 5 s until first success; `loaded` no longer set true on failure, so home shows skeleton instead of "No workspaces yet".
- Tests: 54 web tests + tsc pass (rerun by Opus).

## Out of worker scope (D4 = A)
- WorkspacePage.tsx shows "Connecting…" until `loaded`; added by Opus in integration.

## Unresolved
- Root cause of drops is the host network (Connect Timeout to Cloudflare); client now tolerates it, cannot prevent it.

## Integration: merged (29/10/26 23:26)

- On `agent/integration-hub8` at ea080a737014; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub8/logs/post-merge-T1-a2.log`)

## Final gate: PASS (29/10/26 23:28)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub8 at ea080a737014 (log `.orchestrator/runs/hub8/logs/verify-1793291233.log`)
- Task MERGED; run DONE

## Decision D5 needed (scope_exception) (29/10/26 23:28)

**Make the website confirm a 'timed-out' answer by checking?**

Your D3 and D4 answers were saved on my computer in under 0.5 s, but the reply back to your phone was lost on the flaky link, so the page showed computer_timeout and stayed put. Fix: when sending an answer ends in computer_timeout or a network error, the page does not show an error; it shows 'Checking…' and re-reads the decision every 3 s for up to 60 s. As soon as the decision shows answered, it moves to the Sent screen as normal. Only if it is still unanswered after 60 s does it say 'Not confirmed, try again'. Resending is already safe (a second answer is refused and the page refreshes).

- `A`: Add it to hub8 now (before merge) (recommended)
- `B`: Do it in a separate hub9 later

Waiting for the user's answer in chat.

## Decision D5 answered by the user (29/10/26 23:32)

- Choice: **A**: Add it to hub8 now (before merge)
- User's words (hub): "Add it to hub8 now (before merge)"
