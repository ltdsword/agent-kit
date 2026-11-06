# hctasks board: run board like the website's run card (06/11/26)

## Goal
The Herdr app run board shows what the website's run card shows: run title, id, status, goal, branch, gate,
the task graph (roots, then dependents) with each task's state, worker, summary, fix round and "needs", and
problems with their open decision.

## Read first
- `plans/261106-0935-hctasks/plan.md`.
- Website: `hub/web/src/features/workspace/RunCard.tsx`, `hub/web/src/lib/status.ts` (TASK_STATUS looks).
- Data rules to copy: `.agent-system/agentctl.py` `_run_snapshot` (~582: gate from verify.exit_code, problems
  for BLOCKED/FIX_REQUIRED tasks with their PENDING decision, run close_reason).
- `.agent-system/artifacts.py` `board_data`; `.agent-system/artifacts/board/main.js`; tests
  `.agent-system/tests/test_artifacts.py`. App UI rules: `~/.config/herdr-app/AGENTS.md` (UI section) and
  `~/.config/herdr-app/gpui-kit.d.ts` (read only).

## Steps
1. `board_data(state)` adds: `goal`, `integration_branch`, `gate` ("PASS" | "FAIL" | null from
   `state["verify"]["exit_code"]`), per task `summary`, `depends_on` (list), `fix_rounds` (int,
   `major_repairs`, default 0); `problems` exactly as `_run_snapshot` builds them but only
   `{task_id, type, decision_id, note}` with note cut to 200 chars. Keep every existing field. No packet text,
   env values or file contents.
2. `artifacts/board/main.js` redraw (same file, same data.js/board.json reading, 5 s refresh):
   - Header: title (14 px semibold), `Run <id>` (12 px dim), status as a small colored label (existing
     statusColor). Goal (13 px muted) when set. Two rows "Branch <integration_branch>", "Gate <PASS|FAIL|not run>".
   - "Tasks": roots = no depends_on; dependents = the rest. Width >= 520 px (track with on_size_change): two
     columns with a "›" column between; narrower: one column, roots then dependents.
   - Node (rounded card, border colored by state like the website: RUNNING working, FIX_REQUIRED/BLOCKED/FAILED
     blocked, PASSED/MERGED done, PENDING muted): line 1 `id` (dim, mono-like) + title (truncate) + worker
     (when not MERGED); line 2 summary (12 px muted, when set); line 3 status label, `fix N` when N > 0 and not
     MERGED, `needs T1, T2` when PENDING and depends_on.
   - "Problems" (when any): `<task_id or Run>: <type>` + note, and `<decision_id> open` when set.
   - Keep "Pending decisions" as today. Theme colors only, text 12-15 px, size_full, scroll, works at 320 px,
     `.id()` on scroll lists, no emojis, no setTimeout, never keep cx.
3. Tests: board_data new fields (gate PASS/FAIL/null, depends_on, fix_rounds, problems with decision id, note
   cut, no extra keys like packet/prompt); existing tests still pass; `herdr-app check` test on the board with a
   sample board.json that has dependents and a problem (skipped without herdr-app).

## Boundaries
**You may edit:** `.agent-system/artifacts.py` (board_data only), `.agent-system/artifacts/board/main.js`,
`.agent-system/tests/test_artifacts.py`.
**You must not edit:** scheduler.py, agentctl.py, decision panel, hub/**, docs, plans/**, gen-tasks/**,
.orchestrator/**, anything in `~/.config/herdr-app`.
**You may run:** `python3 -m pytest`, `herdr-app check <dir>` on copies in a temp dir, read-only git,
`git add`/`git commit` on your branch.
**You must not run:** `herdr-artifact publish|update|rm`, `herdr-app do`, `hc`, `herdr-task`; git
push/merge/rebase/reset/checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] board_data per step 1; board panel per step 2 passes `herdr-app check`; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (06/11/26 09:46)

- Status: **done** (worker worker-1, branch `agent/hctasks-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/artifacts.py`, `.agent-system/artifacts/board/main.js`, `.agent-system/tests/test_artifacts.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_artifacts.py -k board_data` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_artifacts.py -k board_data` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_artifacts.py -k herdr_app_check` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
  - `git diff --check` -> exit 0
- Risks:
  - Changes left uncommitted; the worker sandbox exposes .git as read-only.
- Not done: none
- Full diff: `.orchestrator/runs/hctasks/reports/T1.diff`

````text
 .agent-system/artifacts.py            |  34 +++++++++++
 .agent-system/artifacts/board/main.js | 111 ++++++++++++++++++++++++++--------
 .agent-system/tests/test_artifacts.py |  65 ++++++++++++++++++--
 3 files changed, 181 insertions(+), 29 deletions(-)
````

````diff
diff --git a/.agent-system/artifacts.py b/.agent-system/artifacts.py
index 6a2889c..46a28bc 100644
--- a/.agent-system/artifacts.py
+++ b/.agent-system/artifacts.py
@@ -29,9 +29,39 @@ def board_data(state: dict) -> dict:
         tasks.append({
             "id": task.get("id", task_id),
             "title": task.get("title"),
+            "summary": task.get("summary"),
             "status": task.get("status"),
             "worker": task.get("worker"),
             "verdict": verdict,
+            "depends_on": task.get("depends_on", []),
+            "fix_rounds": int(task.get("major_repairs") or 0),
+        })
+
+    verification = state.get("verify") or {}
+    code = verification.get("exit_code")
+    gate = "PASS" if code == 0 else "FAIL" if code is not None else None
+    problems = []
+    decisions_by_id = state.get("decisions") or {}
+    for task in (state.get("tasks") or {}).values():
+        if task.get("status") not in ("BLOCKED", "FIX_REQUIRED"):
+            continue
+        last = next((event for event in reversed(events)
+                     if event.get("kind") == "task" and event.get("task") == task.get("id")), {})
+        decision_id = next((decision_id for decision_id, decision in decisions_by_id.items()
+                            if decision.get("task") == task.get("id")
+                            and decision.get("status") == "PENDING"), None)
+        problems.append({
+            "task_id": task.get("id"),
+            "type": task.get("status"),
+            "decision_id": decision_id,
+            "note": str(task.get("status_reason") or last.get("reason") or "")[:200],
+        })
+    if state.get("status") in ("BLOCKED", "FAILED") and state.get("close_reason"):
+        problems.append({
+            "task_id": None,
+            "type": state["status"],
+            "decision_id": None,
+            "note": str(state["close_reason"])[:200],
         })
 
     decisions = []
@@ -72,9 +102,13 @@ def board_data(state: dict) -> dict:
     return {
         "run_id": state.get("run_id"),
         "title": state.get("title"),
+        "goal": state.get("goal"),
         "status": state.get("status"),
+        "integration_branch": state.get("integration_branch", ""),
+        "gate": gate,
         "updated_at": updated_at,
         "tasks": tasks,
+        "problems": problems[:50],
         "decisions": decisions,
     }
 
diff --git a/.agent-system/artifacts/board/main.js b/.agent-system/artifacts/board/main.js
index 2563178..3b197ae 100644
--- a/.agent-system/artifacts/board/main.js
+++ b/.agent-system/artifacts/board/main.js
@@ -11,9 +11,36 @@ const statusColor = (status, t) => {
   return t.muted;
 };
 
+function statusLabel(status, t) {
+  return div().flex_none().px(6).py(2).rounded(4).text_size(12)
+    .text_color(statusColor(status, t)).child(status || "Unknown");
+}
+
+function taskNode(task, t) {
+  const dependencies = task.depends_on ?? [];
+  return v_flex().min_w(0).gap(4).p(8).rounded(6).border_1()
+    .border_color(statusColor(task.status, t)).bg(t.surface)
+    .child(h_flex().min_w(0).gap(5).items_center()
+      .child(div().flex_none().text_size(12).font_family("monospace").text_color(t.dim)
+        .child(task.id || ""))
+      .child(div().flex_1().min_w(0).text_size(13).truncate()
+        .child(task.title || "Untitled task"))
+      .when(Boolean(task.worker && task.status !== "MERGED"), (row) => row.child(
+        div().flex_none().max_w(76).text_size(12).truncate().text_color(t.muted).child(task.worker))))
+    .when(Boolean(task.summary), (card) => card.child(
+      div().min_w(0).text_size(12).text_color(t.muted).child(task.summary)))
+    .child(h_flex().min_w(0).flex_wrap().items_center().gap(5)
+      .child(statusLabel(task.status, t))
+      .when(task.fix_rounds > 0 && task.status !== "MERGED", (row) => row.child(
+        div().flex_none().text_size(12).text_color(t.muted).child(`fix ${task.fix_rounds}`)))
+      .when(task.status === "PENDING" && dependencies.length > 0, (row) => row.child(
+        div().min_w(0).text_size(12).text_color(t.muted).child(`needs ${dependencies.join(", ")}`))));
+}
+
 export default class RunBoard extends View {
   init(_props, cx) {
     this.data = null;
+    this.wide = false;
     cx.spawn(async (cx) => this.refresh(cx));
     cx.timer.every(5000, (cx) => cx.spawn(async (cx) => this.refresh(cx)));
   }
@@ -31,35 +58,69 @@ export default class RunBoard extends View {
   render() {
     const t = theme();
     const data = this.data;
+    const frame = v_flex().id("run-board").size_full().min_w(0).min_h(0)
+      .on_size_change((size, cx) => {
+        const wide = size.width >= 520;
+        if (this.wide !== wide) {
+          this.wide = wide;
+          cx.notify();
+        }
+      });
     if (!data) {
-      return v_flex().size_full().min_h(0).p(12).bg(t.background).text_color(t.muted)
-        .text_size(13).child("Waiting for data");
+      return frame.p(12).bg(t.background).text_color(t.muted).text_size(13)
+        .child("Waiting for data");
     }
-    const counts = {};
-    for (const task of data.tasks ?? []) counts[task.status] = (counts[task.status] ?? 0) + 1;
-    const summary = Object.entries(counts).map(([status, count]) => `${status.toLowerCase()} ${count}`).join(" · ")
-      || "no tasks";
+
+    const tasks = data.tasks ?? [];
+    const roots = tasks.filter((task) => (task.depends_on ?? []).length === 0);
+    const dependents = tasks.filter((task) => (task.depends_on ?? []).length > 0);
     const pending = (data.decisions ?? []).filter((decision) => !decision.answer);
-    return v_flex().size_full().min_h(0).p(10).gap(8).bg(t.background).text_color(t.foreground).text_size(13)
-      .child(v_flex().flex_none().gap(4)
-        .child(div().text_size(14).font_semibold().child(data.title || data.run_id || "Run"))
-        .child(h_flex().gap(5).text_size(12).text_color(t.muted)
-          .child(div().text_color(statusColor(data.status, t)).child(data.status || "Unknown"))
-          .child(div().child("·"))
-          .child(div().min_w(0).child(summary))))
-      .child(v_flex().id("rows").flex_1().min_h(0).overflow_y_scrollbar().gap(10)
-        .child(v_flex().gap(5)
+    const problems = data.problems ?? [];
+    const branchRow = (label, value) => h_flex().min_w(0).gap(8)
+      .child(div().flex_none().w(48).text_size(12).text_color(t.muted).child(label))
+      .child(div().min_w(0).text_size(12).truncate().child(value));
+    const taskGraph = this.wide && dependents.length > 0
+      ? h_flex().min_w(0).gap(5)
+        .child(v_flex().flex_1().min_w(0).gap(6).children(roots.map((task) => taskNode(task, t))))
+        .child(v_flex().flex_none().w(18).items_center().justify_center().text_size(15)
+          .text_color(t.dim).child("›"))
+        .child(v_flex().flex_1().min_w(0).gap(6).children(dependents.map((task) => taskNode(task, t))))
+      : v_flex().min_w(0).gap(6).children([...roots, ...dependents].map((task) => taskNode(task, t)));
+
+    return frame.p(10).gap(8).bg(t.background).text_color(t.foreground).text_size(13)
+      .child(v_flex().flex_none().min_w(0).gap(5)
+        .child(h_flex().min_w(0).items_start().gap(8)
+          .child(v_flex().flex_1().min_w(0).gap(2)
+            .child(div().min_w(0).text_size(14).font_semibold().truncate()
+              .child(data.title || data.run_id || "Run"))
+            .child(div().text_size(12).font_family("monospace").text_color(t.dim)
+              .child(`Run ${data.run_id || ""}`)))
+          .child(statusLabel(data.status, t)))
+        .when(Boolean(data.goal), (header) => header.child(
+          div().min_w(0).text_size(13).text_color(t.muted).child(data.goal)))
+        .child(v_flex().gap(3)
+          .child(branchRow("Branch", data.integration_branch || ""))
+          .child(branchRow("Gate", data.gate || "not run"))))
+      .child(v_flex().id("rows").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().gap(10)
+        .child(v_flex().min_w(0).gap(6)
           .child(div().text_size(12).font_semibold().text_color(t.muted).child("Tasks"))
-          .children((data.tasks ?? []).map((task) => h_flex().min_w(0).gap(7).items_start()
-            .child(div().flex_none().text_size(12).text_color(statusColor(task.status, t)).child(task.status || "Unknown"))
-            .child(v_flex().min_w(0).gap(2)
-              .child(div().text_size(13).child(`${task.id}: ${task.title || "Untitled task"}`))
-              .when(Boolean(task.worker || task.verdict), (row) => row.child(div().text_size(12).text_color(t.dim)
-                .child([task.worker, task.verdict].filter(Boolean).join(" · ")))))))))
-        .when(pending.length > 0, (list) => list.child(v_flex().gap(5)
+          .when(tasks.length > 0, (section) => section.child(taskGraph))
+          .when(tasks.length === 0, (section) => section.child(
+            div().text_size(12).text_color(t.muted).child("No tasks"))))
+        .when(problems.length > 0, (list) => list.child(v_flex().min_w(0).gap(5)
+          .child(div().text_size(12).font_semibold().text_color(t.muted).child("Problems"))
+          .children(problems.map((problem) => v_flex().min_w(0).gap(3).p(8).rounded(6).border_1()
+            .border_color(t.blocked).bg(t.surface)
+            .child(div().text_size(12).font_semibold().text_color(t.blocked)
+              .child(`${problem.task_id || "Run"}: ${problem.type || "Unknown"}`))
+            .when(Boolean(problem.note), (item) => item.child(
+              div().min_w(0).text_size(12).text_color(t.muted).child(problem.note)))
+            .when(Boolean(problem.decision_id), (item) => item.child(
+              div().text_size(12).text_color(t.accent).child(`${problem.decision_id} open`)))))))
+        .when(pending.length > 0, (list) => list.child(v_flex().min_w(0).gap(5)
           .child(div().text_size(12).font_semibold().text_color(t.muted).child("Pending decisions"))
-          .children(pending.map((decision) => v_flex().gap(2)
-            .child(div().text_size(13).child(`${decision.id}: ${decision.title || "Decision"}`))
-            .child(div().text_size(12).text_color(t.dim).child(decision.question || ""))))));
+          .children(pending.map((decision) => v_flex().min_w(0).gap(2)
+            .child(div().min_w(0).text_size(13).child(`${decision.id}: ${decision.title || "Decision"}`))
+            .child(div().min_w(0).text_size(12).text_color(t.dim).child(decision.question || "")))))));
   }
 }
diff --git a/.agent-system/tests/test_artifacts.py b/.agent-system/tests/test_artifacts.py
index 5bfa829..ec04ca7 100644
--- a/.agent-system/tests/test_artifacts.py
+++ b/.agent-system/tests/test_artifacts.py
@@ -55,9 +55,14 @@ def minimal_run_state():
 class ArtifactBoardTests(unittest.TestCase):
     def test_board_data_has_only_the_safe_contract_fields(self):
         board = A.board_data(sample_state())
-        self.assertEqual(set(board), {"run_id", "title", "status", "updated_at", "tasks", "decisions"})
-        self.assertEqual(set(board["tasks"][0]), {"id", "title", "status", "worker", "verdict"})
+        self.assertEqual(set(board), {"run_id", "title", "goal", "status", "integration_branch",
+                                      "gate", "updated_at", "tasks", "problems", "decisions"})
+        self.assertEqual(set(board["tasks"][0]), {"id", "title", "summary", "status", "worker", "verdict",
+                                                   "depends_on", "fix_rounds"})
         self.assertEqual(board["tasks"][0]["verdict"], "PASS")
+        self.assertEqual(board["tasks"][0]["depends_on"], [])
+        self.assertEqual(board["tasks"][0]["fix_rounds"], 0)
+        self.assertEqual(board["problems"], [])
         self.assertEqual(set(board["decisions"][0]),
                          {"id", "kind", "title", "question", "options", "recommend", "followup", "answer"})
         self.assertEqual(board["decisions"][0]["options"], [{"key": "A", "label": "Small"},
@@ -67,6 +72,44 @@ class ArtifactBoardTests(unittest.TestCase):
         for private in ("packet body", "private answer quote", "private note", "/private/path", "event body"):
             self.assertNotIn(private, serialized)
 
+    def test_board_data_includes_graph_gate_and_safe_problems(self):
+        state = sample_state()
+        state["goal"] = "Ship the run board"
+        state["integration_branch"] = "agent/integration"
+        state["verify"] = {"exit_code": 0}
+        state["status"] = "BLOCKED"
+        state["close_reason"] = "Integration stopped"
+        state["tasks"]["T1"].update(summary="Root summary", depends_on=[], major_repairs=2)
+        long_note = "problem note " * 30
+        state["tasks"]["T2"] = {
+            "id": "T2", "title": "Dependent task", "summary": "Needs T1", "status": "FIX_REQUIRED",
+            "worker": "worker-2", "depends_on": ["T1"], "major_repairs": 3,
+            "status_reason": long_note, "packet": "private packet", "prompt": "private prompt",
+        }
+        state["decisions"]["D2"] = {"id": "D2", "task": "T2", "status": "PENDING"}
+
+        board = A.board_data(state)
+
+        self.assertEqual(board["goal"], "Ship the run board")
+        self.assertEqual(board["integration_branch"], "agent/integration")
+        self.assertEqual(board["gate"], "PASS")
+        self.assertEqual(board["tasks"][0]["summary"], "Root summary")
+        self.assertEqual(board["tasks"][0]["fix_rounds"], 2)
+        self.assertEqual(board["tasks"][1]["depends_on"], ["T1"])
+        self.assertEqual(board["tasks"][1]["fix_rounds"], 3)
+        self.assertEqual(board["problems"], [
+            {"task_id": "T2", "type": "FIX_REQUIRED", "decision_id": "D2", "note": long_note[:200]},
+            {"task_id": None, "type": "BLOCKED", "decision_id": None, "note": "Integration stopped"},
+        ])
+        serialized = json.dumps(board)
+        self.assertNotIn("private packet", serialized)
+        self.assertNotIn("private prompt", serialized)
+
+        state["verify"]["exit_code"] = 1
+        self.assertEqual(A.board_data(state)["gate"], "FAIL")
+        state["verify"]["exit_code"] = None
+        self.assertIsNone(A.board_data(state)["gate"])
+
     def test_write_board_is_atomic_and_ignores_write_errors(self):
         with tempfile.TemporaryDirectory() as tmp:
             run_dir = Path(tmp) / "runs" / "run-one"
@@ -220,8 +263,22 @@ class ArtifactBoardTests(unittest.TestCase):
 
     @unittest.skipUnless(shutil.which("herdr-app"), "herdr-app is not on PATH")
     def test_herdr_app_check_accepts_both_shipped_panels(self):
-        sample = {"run_id": "run-one", "title": "Sample", "status": "RUNNING", "updated_at": None,
-                  "tasks": [], "decisions": []}
+        sample = {
+            "run_id": "run-one", "title": "Sample", "goal": "Check the task graph",
+            "status": "RUNNING", "integration_branch": "agent/integration", "gate": "PASS",
+            "updated_at": None,
+            "tasks": [
+                {"id": "T1", "title": "Root task", "summary": "Starts the graph", "status": "PASSED",
+                 "worker": "worker-1", "verdict": "PASS", "depends_on": [], "fix_rounds": 0},
+                {"id": "T2", "title": "Dependent task", "summary": "Needs T1", "status": "FIX_REQUIRED",
+                 "worker": "worker-2", "verdict": None, "depends_on": ["T1"], "fix_rounds": 1},
+            ],
+            "problems": [{"task_id": "T2", "type": "FIX_REQUIRED", "decision_id": "D1",
+                          "note": "Needs a repair decision"}],
+            "decisions": [{"id": "D1", "kind": "repair", "title": "Repair task",
+                           "question": "Choose a repair", "options": [{"key": "A", "label": "Retry"}],
+                           "recommend": "A", "followup": None, "answer": None}],
+        }
         with tempfile.TemporaryDirectory() as tmp:
             root = Path(tmp)
             board_path = root / "board.json"
````

## Review round 1: PASS (06/11/26 09:47)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 34840a1f5a5f, commits 34840a1f5a5f
- Notes: board like website run card; 264 tests pass

# Review hctasks T1 - board like the website run card (Opus)

Verdict: PASS

- board_data: goal, integration_branch, gate (PASS/FAIL/null from verify.exit_code), per task summary,
  depends_on, fix_rounds; problems as agentctl._run_snapshot (note cut to 200). Existing fields kept.
- board/main.js: header (title, run id, status), goal, Branch/Gate rows, task graph (roots › dependents when
  >= 520 px, one column narrower), node with id/title/worker, summary, status, fix N, needs; Problems with
  "Dn open"; Pending decisions kept. Theme colors all exist (herdr.d.ts); scroll list has an id.
- Whole suite 264 passed (Opus rerun). Live look at the end of the run.

## Integration: merged (06/11/26 09:47)

- On `agent/integration-hctasks` at aafd620a2c13; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hctasks/logs/post-merge-T1-a1.log`)

## Final gate: PASS (06/11/26 09:57)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hctasks at 7fffd702d3f4 (log `.orchestrator/runs/hctasks/logs/verify-1793933790.log`)
- Task MERGED; run DONE

## Finished (06/11/26 10:01)

- merged into hub/plan (decision D1)
