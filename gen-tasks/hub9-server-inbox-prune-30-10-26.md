# Backend: prune the questions inbox to 100 (30/10/26)

## Goal
The backend keeps only the newest 100 decisions of the `inbox` run per workspace (never dropping open ones) with their decision documents, and docs/hub-api.md describes the new document kinds, the inbox run and HELD/FAILED prompt delivery.

## Read first
- `plans/261030-0141-hub9-questions-docs-delivery/plan.md`: sections **User decisions**, **Contract** and **T2**: **the full spec** (work items, tests). Follow it exactly.
- `hub/server/src/db.ts` (`upsertDecisions`, document storage), `hub/server/src/connector-api.ts` (decision/document sync and events), `hub/server/test/server.test.ts` (fixtures), `docs/hub-api.md`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/src/db.ts`
- `hub/server/src/connector-api.ts`
- `hub/server/test/server.test.ts`
- `docs/hub-api.md`

**You must not edit:**
- Any other file; also `hub/protocol/**` and `hub/web/src/api/types.ts` (contract, fixed), `plans/**`, `gen-tasks/**`, `.orchestrator/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/server`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `wrangler` or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T2 is done.
- [ ] `cd hub/server && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/server && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (30/10/26 01:49)

- Status: **done** (worker worker-2, branch `agent/hub9-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `docs/hub-api.md`, `hub/server/src/connector-api.ts`, `hub/server/src/db.ts`, `hub/server/test/server.test.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p . (cwd: hub/server)` -> exit 0
  - `git diff --check` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub9/reports/T2.diff`

````text
 docs/hub-api.md                 | 24 ++++++++++++----
 hub/server/src/connector-api.ts |  8 ++++--
 hub/server/src/db.ts            | 18 ++++++++++--
 hub/server/test/server.test.ts  | 61 +++++++++++++++++++++++++++++++++++++++++
 4 files changed, 101 insertions(+), 10 deletions(-)
````

````diff
diff --git a/docs/hub-api.md b/docs/hub-api.md
index 974ae95..3e442cd 100644
--- a/docs/hub-api.md
+++ b/docs/hub-api.md
@@ -78,12 +78,19 @@ Connector routes are local to the backend and are never exposed through the prox
   screens and task file details are not uploaded; an orchestrator screen is `null` when its upload
   setting is off. Older runs can have null title/goal and older tasks can have a null summary.
 - `PUT .../decisions` upserts by `(workspace, run_id, decision_id)` and emits decision events when
-  content changes. Each option may include its consequence; decisions include evidence, Opus's
-  rationale in `note`, and optional worker approval.
+  content changes. The reserved `inbox` run contains ordinary `question` decisions; it is not an
+  active or listed run, and its questions appear in the Questions panel. History labels its items
+  as questions. For each workspace, the backend retains the newest 100 inbox decisions by their
+  `opened_at` timestamp and keeps older pending decisions until they are closed; pruning also
+  removes their decision documents. Each option may include its consequence; decisions include
+  evidence, Opus's rationale in `note`, and optional worker approval.
 - `POST .../events` inserts events by `(run_id, n)`, ignoring duplicates; event number gaps are
   allowed when old state logs have trimmed events.
 - `PUT .../documents` upserts by path. The backend recomputes SHA-256 and rejects mismatches.
-  Document kinds are `final_report`, `final_diff`, `decision` and `research`.
+  Document kinds are `final_report`, `final_diff`, `decision`, `research`, `plan`, `review` and
+  `other`. A plan is a `plans/*/plan.md` file, a review is a `plans/reports/review-*.md` file, and
+  `other` covers any other published file. Documents carry the run ID that recorded the path, or
+  `null` for workspace-level documents.
 - `DELETE .../documents?path=` marks a document deleted while retaining its content.
 
 ### 3.3 Commands (hub → system)
@@ -98,7 +105,7 @@ Connector routes are local to the backend and are never exposed through the prox
   `reason` is shown to the user. `REJECTED` is final when the scheduler refuses an answer, with its
   exact reason. `FAILED` is final for other delivery errors.
 - If the scheduler records an answer but typing its notice fails, the connector still acknowledges
-  the answer as delivered and retries the notice locally.
+  the answer as delivered and retries the notice locally for up to 10 minutes.
 
 ## 4. Connector behavior per command
 
@@ -108,8 +115,13 @@ Connector routes are local to the backend and are never exposed through the prox
 | `reply` | Records no scheduler answer | `[hub] reply to D3 from alice: "<text>"` |
 | `prompt` | Records no scheduler answer | `[hub] <text>` |
 
-Delivery uses `herdr agent prompt <orchestrator> <text>` and waits until the orchestrator is working
-or blocked. A blocked agent is acknowledged as `HELD`. Delivered commands are appended to local
+Delivery uses `herdr agent prompt <orchestrator> <text>` only when the orchestrator is idle. A busy
+or blocked agent is acknowledged as `HELD` while the connector retries after delays of 1, 2, 4, 8,
+16, 16, 16 and 16 seconds; after those eight retries it retries every 32 seconds until 10 minutes
+from the first attempt. An undelivered `prompt` or `reply` is then acknowledged as `FAILED` with
+reason `Opus stayed busy for 10 minutes; not delivered`; `HELD` is non-final and `FAILED` is final.
+Answer notices use the same retry schedule, but the answer itself remains delivered; an untyped
+notice is logged and dropped after 10 minutes. Delivered commands are appended to local
 `.orchestrator/hub-log.jsonl` with their username and body for recovery.
 
 ## 5. Decision status in the hub (`HubDecision.hub_status`)
diff --git a/hub/server/src/connector-api.ts b/hub/server/src/connector-api.ts
index 6189a5b..9333874 100644
--- a/hub/server/src/connector-api.ts
+++ b/hub/server/src/connector-api.ts
@@ -83,11 +83,15 @@ export function mountConnectorApi(app: Hono, deps: ApiDependencies): void {
     const body = await readBody<DecisionsBatch>(c, "DecisionsBatch", 1024 * 1024);
     if ("response" in body) return body.response;
     touch(ws);
-    const changed = db.upsertDecisions(ws, body.value.decisions, clock());
-    for (const ref of changed) {
+    const sync = db.upsertDecisions(ws, body.value.decisions, clock());
+    for (const ref of new Set([...sync.changed, ...sync.pruned])) {
       publish("decision", ws, ref);
       publish("history", ws, ref);
     }
+    for (const path of sync.deletedDocuments) {
+      publish("document", ws, path);
+      publish("history", ws, path);
+    }
     return c.body(null, 204);
   });
 
diff --git a/hub/server/src/db.ts b/hub/server/src/db.ts
index 74848e0..65b58f8 100644
--- a/hub/server/src/db.ts
+++ b/hub/server/src/db.ts
@@ -202,8 +202,10 @@ export class HubDatabase {
     return (row?.hash as string | undefined) ?? null;
   }
 
-  upsertDecisions(workspaceId: string, decisions: Decision[], now: number): string[] {
+  upsertDecisions(workspaceId: string, decisions: Decision[], now: number): { changed: string[]; pruned: string[]; deletedDocuments: string[] } {
     const changed: string[] = [];
+    const pruned: string[] = [];
+    const deletedDocuments: string[] = [];
     const statement = this.sql.prepare(`INSERT INTO decisions (workspace_id,run_id,decision_id,kind,task_id,agent,title,question,options,followup,recommend,local_status,answer,consumed_by,opened_at,updated_at,content_hash,body)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(workspace_id,run_id,decision_id) DO UPDATE SET kind=excluded.kind,task_id=excluded.task_id,agent=excluded.agent,title=excluded.title,question=excluded.question,options=excluded.options,followup=excluded.followup,recommend=excluded.recommend,local_status=excluded.local_status,answer=excluded.answer,consumed_by=excluded.consumed_by,opened_at=excluded.opened_at,updated_at=excluded.updated_at,content_hash=excluded.content_hash,body=excluded.body`);
@@ -217,8 +219,20 @@ export class HubDatabase {
         decision.question, JSON.stringify(decision.options), decision.followup ? JSON.stringify(decision.followup) : null, decision.recommend,
         decision.local_status, decision.answer ? JSON.stringify(decision.answer) : null, decision.consumed_by, decision.opened_at, iso(now), digest, JSON.stringify(decision));
     }
+    if (decisions.some((decision) => decision.run_id === "inbox")) {
+      const inbox = this.sql.prepare("SELECT decision_id,local_status FROM decisions WHERE workspace_id=? AND run_id='inbox' ORDER BY opened_at DESC,decision_id DESC")
+        .all(workspaceId) as Row[];
+      for (const row of inbox.slice(100)) {
+        if (row.local_status === "PENDING") continue;
+        const decisionId = String(row.decision_id);
+        this.sql.prepare("DELETE FROM decisions WHERE workspace_id=? AND run_id='inbox' AND decision_id=?").run(workspaceId, decisionId);
+        pruned.push(`inbox/${decisionId}`);
+        const path = `.orchestrator/runs/inbox/decisions/${decisionId}.md`;
+        if (this.deleteDocument(workspaceId, path, now)) deletedDocuments.push(path);
+      }
+    }
     if (decisions.length) this.audit(workspaceId, "connector", "decisions.synced", null, { count: decisions.length }, now);
-    return changed;
+    return { changed, pruned, deletedDocuments };
   }
 
   listDecisionBodies(workspaceId: string): Decision[] {
diff --git a/hub/server/test/server.test.ts b/hub/server/test/server.test.ts
index 0cba23f..2f2dda3 100644
--- a/hub/server/test/server.test.ts
+++ b/hub/server/test/server.test.ts
@@ -76,6 +76,20 @@ async function seed(): Promise<void> {
   expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector, body: await fixture("DecisionsBatch.json") })).status).toBe(204);
 }
 
+function inboxDecision(base: any, id: number, localStatus: "PENDING" | "CANCELLED"): any {
+  return { ...base, run_id: "inbox", decision_id: `D${id}`, kind: "question", task_id: null,
+    agent: "orchestrator", local_status: localStatus, answer: null, consumed_by: null,
+    opened_at: new Date(Date.parse("2026-10-28T08:00:00Z") - (106 - id) * 1000).toISOString(),
+    cancel_reason: localStatus === "CANCELLED" ? "closed" : null };
+}
+
+function inboxDecisionDocument(decision: any): any {
+  const path = `.orchestrator/runs/inbox/decisions/${decision.decision_id}.md`;
+  const content = `# ${decision.decision_id}\n`;
+  return { path, run_id: "inbox", kind: "decision", title: decision.title, format: "markdown",
+    sha256: sha256(content), bytes: Buffer.byteLength(content), truncated: false, content };
+}
+
 it("requires protocol 2 and assertion auth, and has no pairing, device, or URL-token routes", async () => {
   expect((await req("/agent/ping", { token: connector, protocol: null })).status).toBe(426);
   const ping = await req("/agent/ping", { token: connector });
@@ -174,6 +188,53 @@ it("derives REPLY_SENT only after a delivered reply while the local decision is
   expect(decision.hub_status).toBe("REPLY_SENT"); valid("HubDecision", decision);
 });
 
+it("prunes inbox decisions and their documents, leaves other runs intact, and publishes removal events", async () => {
+  await doHello();
+  const base = await fixture<any>("Decision.repair-open.json");
+  const firstHundred = Array.from({ length: 100 }, (_, index) => inboxDecision(base, index + 1, "CANCELLED"));
+  const otherRun = { ...base, run_id: "r4", decision_id: "D3" };
+  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector,
+    body: { decisions: [...firstHundred, otherRun] } })).status).toBe(204);
+
+  const documents = firstHundred.map(inboxDecisionDocument);
+  for (let index = 0; index < documents.length; index += 50) {
+    expect((await req(`/agent/workspaces/${ws}/documents`, { method: "PUT", token: connector,
+      body: { documents: documents.slice(index, index + 50) } })).status).toBe(204);
+  }
+
+  const published: Array<{ type: string; ref: string | null }> = [];
+  const unsubscribe = events.subscribe(({ type, ref }) => published.push({ type, ref }));
+  const newest = Array.from({ length: 5 }, (_, index) => inboxDecision(base, index + 101, "CANCELLED"));
+  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector,
+    body: { decisions: newest } })).status).toBe(204);
+  unsubscribe();
+
+  expect(Number(db.sql.prepare("SELECT COUNT(*) AS n FROM decisions WHERE workspace_id=? AND run_id='inbox'").get(ws)?.n)).toBe(100);
+  expect(db.getDecisionBody(ws, "r4", "D3")).toBeDefined();
+  const removedPaths = Array.from({ length: 5 }, (_, index) => `.orchestrator/runs/inbox/decisions/D${index + 1}.md`);
+  for (const path of removedPaths) expect(db.getDocument(ws, path)).toBeUndefined();
+  expect(db.listDocuments(ws).map((document) => document.path)).not.toEqual(expect.arrayContaining(removedPaths));
+  for (let id = 1; id <= 5; id++) expect(published).toContainEqual({ type: "decision", ref: `inbox/D${id}` });
+  expect(published.filter((event) => event.type === "document").map((event) => event.ref).sort()).toEqual([...removedPaths].sort());
+});
+
+it("keeps an older pending inbox decision outside the newest 100", async () => {
+  await doHello();
+  const base = await fixture<any>("Decision.repair-open.json");
+  const first = Array.from({ length: 104 }, (_, index) => inboxDecision(base, index + 2, "CANCELLED"));
+  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector,
+    body: { decisions: first } })).status).toBe(204);
+  const oldOpen = inboxDecision(base, 1, "PENDING");
+  expect((await req(`/agent/workspaces/${ws}/decisions`, { method: "PUT", token: connector,
+    body: { decisions: [oldOpen] } })).status).toBe(204);
+
+  expect(Number(db.sql.prepare("SELECT COUNT(*) AS n FROM decisions WHERE workspace_id=? AND run_id='inbox'").get(ws)?.n)).toBe(101);
+  expect(db.getDecisionBody(ws, "inbox", "D1")?.local_status).toBe("PENDING");
+  for (let id = 2; id <= 5; id++) expect(db.getDecisionBody(ws, "inbox", `D${id}`)).toBeUndefined();
+  expect(db.getDecisionBody(ws, "inbox", "D6")).toBeDefined();
+  expect(db.getDecisionBody(ws, "inbox", "D105")).toBeDefined();
+});
+
 it("upserts runs across snapshots and sweeps old finished-run data with the injected clock", async () => {
   const hello = await doHello(); expect(hello.response.status).toBe(200);
   const snapshot = await fixture<any>("Snapshot.running.json");
````

## Review round 1: PASS (30/10/26 01:49)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 04994c7f398b, commits 04994c7f398b

# Review: hub9 T2 server inbox prune

Verdict: PASS

## Checked
- `upsertDecisions` prunes run `inbox` to newest 100 by opened_at; skips `PENDING` (open); deletes decision rows + their `.orchestrator/runs/inbox/decisions/Dn.md` documents; other runs untouched.
- connector-api publishes decision/history events for pruned refs and document events for deleted docs.
- docs/hub-api.md: kinds plan/review/other, inbox run, HELD→FAILED (10 min) prompt semantics.
- 18 server tests + tsc pass (rerun by Opus).

## Notes
- If a connector still holds >100 (kit not updated), pruned rows get re-sent and re-pruned each sync; bounded, harmless; resolved once kit T1 prunes locally.

## Integration: merged (30/10/26 02:04)

- On `agent/integration-hub9` at 1b78334e24fe; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub9/logs/post-merge-T2-a1.log`)

## Final gate: PASS (30/10/26 02:07)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub9 at c7aed2b45378 (log `.orchestrator/runs/hub9/logs/verify-1793300785.log`)
- Task MERGED; run DONE

## Finished (30/10/26 02:16)

- merged into hub/plan (decision D1)
