# hctasks open: show the Artifacts panel when a run starts (06/11/26)

## Goal
When `run create` publishes the run board, the Herdr app shows its Artifacts side panel on the list (the new
board is at the top), so the person sees the run without hunting for it.

## Read first
- `plans/261106-0935-hctasks/plan.md` (side panel commands, why the list and not the board itself).
- `.agent-system/artifacts.py` (`enabled`, `_publish`, `publish_board`), `.agent-system/scheduler.py`
  `run_create` (the `publish_board` call site), `.agent-system/tests/test_artifacts.py`.

## Steps
1. artifacts.py: `show_panel(cfg, env=None, runner=subprocess.run) -> bool`: only when `enabled(cfg, env)`;
   runs, in order, `herdr-app do layout.select --stack panel-body --child artifacts`,
   `herdr-app do layout.select --stack artifacts --child artifacts-list`, `herdr-app do layout.show --id panel`
   (capture_output, text, shell=False, timeout=5). Stop at the first non-zero exit or exception; return whether
   all three succeeded. Never raises.
2. scheduler.py `run_create`: right after `publish_board` returned an id, call `artifacts.show_panel(...)`
   (guarded like the other artifacts calls; failure changes nothing).
3. Tests (fake runner): exact argv order; disabled -> no calls; first command failing -> stops, False; runner
   raising -> False; run create with a fake publish -> show_panel called once; publish failing -> not called.

## Boundaries
**You may edit:** `.agent-system/artifacts.py` (add show_panel only), `.agent-system/scheduler.py` (run_create
call site only), `.agent-system/tests/test_artifacts.py`.
**You must not edit:** board/decision panels, agentctl.py, hub/**, docs, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `herdr-app do`, `herdr-artifact`, `hc`, `herdr-task`; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] show_panel per step 1, called after the board publish; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (06/11/26 09:55)

- Status: **done** (worker worker-1, branch `agent/hctasks-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/artifacts.py`, `.agent-system/scheduler.py`, `.agent-system/tests/test_artifacts.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hctasks/reports/T2.diff`

````text
 .agent-system/artifacts.py            | 18 +++++++
 .agent-system/scheduler.py            |  1 +
 .agent-system/tests/test_artifacts.py | 93 +++++++++++++++++++++++++++++++++++
 3 files changed, 112 insertions(+)
````

````diff
diff --git a/.agent-system/artifacts.py b/.agent-system/artifacts.py
index 46a28bc..e4af878 100644
--- a/.agent-system/artifacts.py
+++ b/.agent-system/artifacts.py
@@ -150,6 +150,24 @@ def enabled(cfg: dict, env=None) -> bool:
         return False
 
 
+def show_panel(cfg: dict, env=None, runner=subprocess.run) -> bool:
+    try:
+        if not enabled(cfg, env):
+            return False
+        commands = (
+            ["herdr-app", "do", "layout.select", "--stack", "panel-body", "--child", "artifacts"],
+            ["herdr-app", "do", "layout.select", "--stack", "artifacts", "--child", "artifacts-list"],
+            ["herdr-app", "do", "layout.show", "--id", "panel"],
+        )
+        for argv in commands:
+            result = runner(argv, capture_output=True, text=True, shell=False, timeout=5)
+            if result.returncode != 0:
+                return False
+        return True
+    except Exception:
+        return False
+
+
 def _data_module(run_dir: Path, run_id: str, decision_id: str = "") -> str:
     board_path = (run_dir / "board.json").resolve()
     return (f"export const DATA = {json.dumps(str(board_path))};\n"
diff --git a/.agent-system/scheduler.py b/.agent-system/scheduler.py
index d7efd5f..b735b20 100644
--- a/.agent-system/scheduler.py
+++ b/.agent-system/scheduler.py
@@ -1408,6 +1408,7 @@ class Scheduler:
             if artifacts and artifacts.enabled(self.cfg):
                 artifact_id = artifacts.publish_board(self.project_root, run_dir, state, self.cfg)
                 if artifact_id:
+                    artifacts.show_panel(self.cfg)
                     try:
                         self.store.save(state)
                     except Exception:
diff --git a/.agent-system/tests/test_artifacts.py b/.agent-system/tests/test_artifacts.py
index ec04ca7..6f47336 100644
--- a/.agent-system/tests/test_artifacts.py
+++ b/.agent-system/tests/test_artifacts.py
@@ -133,6 +133,53 @@ class ArtifactBoardTests(unittest.TestCase):
             which.return_value = None
             self.assertFalse(A.enabled({"herdr": {}}, {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}))
 
+    def test_show_panel_runs_layout_commands_in_order(self):
+        calls = []
+
+        def runner(argv, **kwargs):
+            calls.append((argv, kwargs))
+            return subprocess.CompletedProcess(argv, 0, "", "")
+
+        commands = [
+            ["herdr-app", "do", "layout.select", "--stack", "panel-body", "--child", "artifacts"],
+            ["herdr-app", "do", "layout.select", "--stack", "artifacts", "--child", "artifacts-list"],
+            ["herdr-app", "do", "layout.show", "--id", "panel"],
+        ]
+        with mock.patch.object(A, "enabled", return_value=True):
+            self.assertTrue(A.show_panel({"herdr": {}}, {"HC_TERMINAL_ID": "t1"}, runner))
+
+        self.assertEqual([argv for argv, _ in calls], commands)
+        self.assertEqual([kwargs for _, kwargs in calls], [
+            {"capture_output": True, "text": True, "shell": False, "timeout": 5},
+        ] * 3)
+
+    def test_show_panel_disabled_does_not_run_commands(self):
+        calls = []
+        with mock.patch.object(A, "enabled", return_value=False):
+            self.assertFalse(A.show_panel({"herdr": {"artifacts": False}}, {},
+                                          lambda argv, **kwargs: calls.append(argv)))
+        self.assertEqual(calls, [])
+
+    def test_show_panel_stops_after_first_failed_command(self):
+        calls = []
+
+        def runner(argv, **kwargs):
+            calls.append(argv)
+            return subprocess.CompletedProcess(argv, 1, "", "failed")
+
+        with mock.patch.object(A, "enabled", return_value=True):
+            self.assertFalse(A.show_panel({"herdr": {}}, {}, runner))
+        self.assertEqual(calls, [
+            ["herdr-app", "do", "layout.select", "--stack", "panel-body", "--child", "artifacts"],
+        ])
+
+    def test_show_panel_runner_exception_returns_false(self):
+        def runner(argv, **kwargs):
+            raise OSError("unavailable")
+
+        with mock.patch.object(A, "enabled", return_value=True):
+            self.assertFalse(A.show_panel({"herdr": {}}, {}, runner))
+
     def test_publish_board_uses_cli_contract_and_writes_data_module(self):
         calls = []
 
@@ -229,6 +276,52 @@ class ArtifactBoardTests(unittest.TestCase):
         state.update(artifacts={"board": "board-id"}, decisions={"D1": {"artifact_id": "decision-id"}})
         S.validate_state(state)
 
+    def test_create_run_shows_panel_only_after_board_publish(self):
+        task = [{"id": "T1", "title": "Create board", "summary": "Build the run board for this task.",
+                 "depends_on": [], "owned_paths": [], "acceptance": ["done"], "packet": "task.md"}]
+        cfg = {"limits": {"max_tasks_per_request": 4, "max_scout_rounds": 0},
+               "pool": {"slots": [], "worktree_root": "{repo_name}-worktrees"},
+               "herdr": {"artifacts": True}}
+
+        def run_case(published_id):
+            with tempfile.TemporaryDirectory() as tmp:
+                workspace = Path(tmp)
+                scheduler = S.Scheduler.__new__(S.Scheduler)
+                scheduler.workspace_root = workspace
+                scheduler.project_root = workspace
+                scheduler.cfg = cfg
+                scheduler.store = mock.Mock()
+                scheduler.store.lock.return_value = contextlib.nullcontext()
+                scheduler.store.state_path.side_effect = lambda run_id: workspace / f"{run_id}.json"
+                scheduler.store.list_runs.return_value = []
+                scheduler.store.run_dir.side_effect = lambda run_id: workspace / "runs" / run_id
+                scheduler._task_source_issues = mock.Mock(return_value=[])
+                scheduler._write_research_index = mock.Mock()
+                events = []
+                publish = mock.Mock(side_effect=lambda *args: events.append("publish") or published_id)
+                show = mock.Mock(side_effect=lambda *args: events.append("show") or False)
+                git_result = mock.Mock(stdout="main\n", returncode=0)
+                stderr = io.StringIO()
+                with mock.patch.object(S, "git_out", return_value="base-sha"), \
+                        mock.patch.object(S, "git", return_value=git_result), \
+                        mock.patch.object(S, "git_branch_exists", return_value=False), \
+                        mock.patch.object(A, "enabled", return_value=True), \
+                        mock.patch.object(A, "publish_board", publish), \
+                        mock.patch.object(A, "show_panel", show), \
+                        contextlib.redirect_stderr(stderr):
+                    result = scheduler.create_run("panel-run", task)
+                self.assertEqual(result["status"], "RUNNING")
+                publish.assert_called_once()
+                if published_id:
+                    show.assert_called_once_with(cfg)
+                    self.assertEqual(events, ["publish", "show"])
+                else:
+                    show.assert_not_called()
+                    self.assertEqual(events, ["publish"])
+
+        run_case("board-id")
+        run_case(None)
+
     def test_scheduler_decision_command_succeeds_when_card_publish_fails(self):
         with tempfile.TemporaryDirectory() as tmp:
             workspace = Path(tmp)
````

## Review round 1: PASS (06/11/26 09:56)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 61982e6ccd0e, commits 61982e6ccd0e
- Notes: show_panel after board publish; suite green

# Review hctasks T2 - open the Artifacts panel at run start (Opus)

Verdict: PASS

- `artifacts.show_panel`: gated by `enabled`, three `herdr-app do` commands in order, stops at first failure,
  never raises. Called in `run_create` only after `publish_board` returned an id.
- Tests: argv order, disabled, failure stop, runner raising, call/no-call from run create.
- Whole suite passed (Opus rerun). Live look before the merge decision.

## Integration: merged (06/11/26 09:56)

- On `agent/integration-hctasks` at 7fffd702d3f4; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hctasks/logs/post-merge-T2-a1.log`)

## Final gate: PASS (06/11/26 09:57)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hctasks at 7fffd702d3f4 (log `.orchestrator/runs/hctasks/logs/verify-1793933790.log`)
- Task MERGED; run DONE
