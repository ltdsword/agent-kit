# hcpanel wire: the scheduler uses the Tasks panel instead of the run board (09/11/26)

## Goal
Every state save keeps the Herdr Tasks panel in step with the run; a new run opens the Tasks panel; the
Artifacts run board is only published when `herdr.tasks` is off. Decision cards are unchanged.

## Read first
- `plans/261109-1540-hcpanel/plan.md`; `.agent-system/herdr_tasks.py` (from T1: `enabled`, `sync`, `show_panel`).
- `.agent-system/scheduler.py`: optional `import artifacts` (~line 33), store save (`write_board` call ~664),
  `run_create` artifacts block (~1408), config validation (~211); `.agent-system/README.md` herdr rows (~63-65).

## Steps
1. Import `herdr_tasks` optionally, like `artifacts`.
2. Store save: after `artifacts.write_board(...)`, call `herdr_tasks.sync(self_scheduler, state)` when
   `herdr_tasks and herdr_tasks.enabled(cfg)`; wrapped so any exception is swallowed (best effort; a
   failure prints one line to stderr). Use the same object/arguments pattern `write_board` gets.
3. `run_create`: when `herdr_tasks.enabled(cfg)`: do not publish the run board; call `herdr_tasks.show_panel`.
   Otherwise keep today's board publish + `artifacts.show_panel`.
4. Config: `herdr.tasks` must be a bool (add to the validation loop). README herdr table: one row
   `herdr.tasks` | `true` (default): show each run's tasks in Herdr's Tasks panel (state, live worker,
   status line) instead of the run board; set `false` for the board.
5. Tests (test_scheduler.py, fakes only): save calls sync when enabled, not when disabled; sync raising does
   not break save; run create with tasks on -> no publish_board, show_panel of herdr_tasks called; tasks off
   -> board path as before; config rejects non-bool `herdr.tasks`. Make sure the test environment never
   reaches real `herdr-task`/`hc` (patch `herdr_tasks.enabled` or the module in the base test setup).

## Boundaries
**You may edit:** `.agent-system/scheduler.py` (the spots above only), `.agent-system/tests/test_scheduler.py`,
`.agent-system/README.md` (one row).
**You must not edit:** herdr_tasks.py, artifacts*, agentctl.py, hub/**, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `herdr-task`, `hc`, `herdr-app`, `herdr-artifact`; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Steps 1-5; whole suite green, with no real herdr-task/hc calls from tests.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (09/11/26 16:00)

- Status: **blocked** (worker worker-1, branch `agent/hcpanel-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported: none
- Risks:
  - Step 2 cannot be wired as specified: Store.save() has a Store instance as self, with neither cfg nor the Scheduler.store interface required by herdr_tasks.sync(sched, state).
- Not done:
  - Stopped before edits because the specified Store.save() call site and T1 herdr_tasks API do not match. No tests run; blocked per task instructions.
- Full diff: `.orchestrator/runs/hcpanel/reports/T2.diff`

## Decision D1 needed (blocker) (09/11/26 16:00)

**Unblock T2 with a corrected call site?**

T2 (scheduler wiring for the Tasks panel) stopped before editing: my task said to call the sync from the run Store's save, but that object has no config and no scheduler, so it can't. Fix: the Store gets an optional on_save hook; the Scheduler sets it in __init__ to a method that calls herdr_tasks.sync(self, state) when enabled (errors swallowed). Same behaviour, correct place.

- `A`: Unblock with that call site and relaunch T2 (recommended)
- `B`: Stop T2

Waiting for the user's answer in chat.

## Decision D1 answered by the user (09/11/26 16:04)

- Choice: **A**: Unblock with that call site and relaunch T2
- User's words (hub): "Unblock with that call site and relaunch T2"

## Worker result - attempt 2 (09/11/26 16:13)

- Status: **done** (worker worker-1, branch `agent/hcpanel-t2-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/README.md`, `.agent-system/scheduler.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_scheduler.py -k 'HerdrTasks or herdr_alerts_artifacts_and_tasks'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_scheduler.py -k 'HerdrTasks or herdr_alerts_artifacts_and_tasks'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_scheduler.py -k 'HerdrTasks or herdr_alerts_artifacts_and_tasks'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_scheduler.py -k 'HerdrTasks or herdr_alerts_artifacts_and_tasks'` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hcpanel/reports/T2.diff`

````text
 .agent-system/README.md               |  1 +
 .agent-system/scheduler.py            | 23 ++++++++++--
 .agent-system/tests/test_scheduler.py | 69 ++++++++++++++++++++++++++++++++++-
 3 files changed, 88 insertions(+), 5 deletions(-)
````

````diff
diff --git a/.agent-system/README.md b/.agent-system/README.md
index 45b91ad..b4485f0 100644
--- a/.agent-system/README.md
+++ b/.agent-system/README.md
@@ -63,6 +63,7 @@ roots the same). Worktrees live in `pool.worktree_root`, outside the repo: `work
 | `herdr.backend` | `auto` (default): `hc` inside the Herdr app, `legacy` inside old Herdr, otherwise `hc` when its core runs; set `hc` or `legacy` to force one |
 | `herdr.alerts` | `true` (default): show in-app alerts for decisions, blocked workers and finished runs; set `false` to disable |
 | `herdr.artifacts` | `true` (default): publish a board for each run and decision cards in the Herdr app; set `false` to disable |
+| `herdr.tasks` | `true` (default): show each run's tasks in Herdr's Tasks panel (state, live worker, status line) instead of the run board; set `false` for the board. |
 
 ## Commands (all implemented; `python3 .agent-system/scheduler.py <cmd> --help`)
 
diff --git a/.agent-system/scheduler.py b/.agent-system/scheduler.py
index 70a86da..a32ad5c 100644
--- a/.agent-system/scheduler.py
+++ b/.agent-system/scheduler.py
@@ -33,6 +33,10 @@ try:  # Herdr app panels are optional: a workspace without the module still runs
     import artifacts  # noqa: E402
 except ImportError:  # pragma: no cover
     artifacts = None
+try:  # Herdr Tasks panel integration is optional
+    import herdr_tasks  # noqa: E402
+except ImportError:  # pragma: no cover
+    herdr_tasks = None
 import models as M  # noqa: E402  (model registry, same folder)
 
 SCHEMA_VERSION = 1
@@ -208,7 +212,7 @@ def validate_config(cfg: dict) -> list[str]:
         if backend not in ("auto", "hc", "legacy"):
             errors.append("herdr.backend must be one of auto, hc, legacy")
         if isinstance(herdr, dict):
-            for key in ("alerts", "artifacts"):
+            for key in ("alerts", "artifacts", "tasks"):
                 if key in herdr and not isinstance(herdr[key], bool):
                     errors.append(f"herdr.{key} must be a bool")
         if worker["sandbox"] == "danger-full-access":
@@ -610,9 +614,10 @@ def scope_check(files: list[str], owned: list[str]) -> tuple[list[str], list[str
 # --------------------------------------------------------------------------- persistence
 
 class Store:
-    def __init__(self, workspace_root: Path):
+    def __init__(self, workspace_root: Path, on_save=None):
         self.workspace_root = workspace_root
         self.root = workspace_root / ".orchestrator"
+        self.on_save = on_save
 
     def run_dir(self, run_id: str) -> Path:
         return self.root / "runs" / run_id
@@ -662,6 +667,11 @@ class Store:
             os.replace(tmp, p)
             if artifacts:
                 artifacts.write_board(self, state)
+            if self.on_save:
+                try:
+                    self.on_save(state)
+                except Exception:
+                    print(f"Herdr task sync failed for {state['run_id']}", file=sys.stderr)
         finally:
             if tmp.exists():
                 tmp.unlink()
@@ -1162,9 +1172,14 @@ class Scheduler:
                 raise SchedulerError(f"workspace {self.workspace_root} must not be inside the project repo "
                                      f"{self.project_root}")
         self.store = Store(self.workspace_root)
+        self.store.on_save = self._sync_herdr_tasks
         self.herdr_injected = herdr is not None
         self.herdr = herdr if herdr is not None else make_herdr(self.cfg)
 
+    def _sync_herdr_tasks(self, state: dict) -> None:
+        if herdr_tasks and herdr_tasks.enabled(self.cfg):
+            herdr_tasks.sync(self, state)
+
     def herdr_for(self, state: dict) -> Herdr | Hc:
         backend = state.get("herdr_backend", "legacy")
         if self.herdr_injected or backend == self.herdr.backend:
@@ -1405,7 +1420,9 @@ class Scheduler:
             log_event(state, "run_created", base_sha=base_sha)
             (run_dir / "tasks.json").write_text(json.dumps({"tasks": tasks}, indent=2) + "\n")
             self.store.save(state)
-            if artifacts and artifacts.enabled(self.cfg):
+            if herdr_tasks and herdr_tasks.enabled(self.cfg):
+                herdr_tasks.show_panel(self.cfg)
+            elif artifacts and artifacts.enabled(self.cfg):
                 artifact_id = artifacts.publish_board(self.project_root, run_dir, state, self.cfg)
                 if artifact_id:
                     artifacts.show_panel(self.cfg)
diff --git a/.agent-system/tests/test_scheduler.py b/.agent-system/tests/test_scheduler.py
index cf60b45..40e7ba0 100644
--- a/.agent-system/tests/test_scheduler.py
+++ b/.agent-system/tests/test_scheduler.py
@@ -172,6 +172,12 @@ class Base(unittest.TestCase):
         self.cfg["gate"]["post_merge_check"] = PY_OK
         self.cfg["gate"]["verify_cmd"] = PY_OK
         self.herdr = FakeHerdr()
+        herdr_tasks = getattr(S, "herdr_tasks", None)
+        if herdr_tasks:
+            for name, value in (("enabled", False), ("sync", None), ("show_panel", False)):
+                patcher = mock.patch.object(herdr_tasks, name, return_value=value)
+                patcher.start()
+                self.addCleanup(patcher.stop)
         self.s = self.new_scheduler()
 
     def new_scheduler(self):
@@ -401,8 +407,8 @@ class TestConfig(Base):
         bad["pool"].update(size=11, slots=[f"worker-{i}" for i in range(1, 12)])
         self.assertTrue(any("1..10" in e for e in S.validate_config(bad)))
 
-    def test_herdr_alerts_and_artifacts_must_be_bool(self):
-        for key in ("alerts", "artifacts"):
+    def test_herdr_alerts_artifacts_and_tasks_must_be_bool(self):
+        for key in ("alerts", "artifacts", "tasks"):
             bad = copy.deepcopy(KIT_CONFIG)
             bad["herdr"][key] = "yes"
             self.assertTrue(any(f"herdr.{key} must be a bool" in error for error in S.validate_config(bad)))
@@ -452,6 +458,65 @@ class TestConfig(Base):
         self.assertNotIn("sandbox_workspace_write.network_access=true", self.new_scheduler().codex_args("/wt", "r1"))
 
 
+class TestHerdrTasks(Base):
+    def _saved_state(self):
+        self.dag()
+        return self.s.store.load("r1")
+
+    def test_save_syncs_herdr_tasks_when_enabled(self):
+        state = self._saved_state()
+        with mock.patch.object(S.herdr_tasks, "enabled", return_value=True), \
+                mock.patch.object(S.herdr_tasks, "sync") as sync, \
+                mock.patch.object(S.artifacts, "write_board"):
+            self.s.store.save(state)
+
+        sync.assert_called_once_with(self.s, state)
+
+    def test_save_skips_herdr_sync_when_disabled(self):
+        state = self._saved_state()
+        with mock.patch.object(S.herdr_tasks, "enabled", return_value=False), \
+                mock.patch.object(S.herdr_tasks, "sync") as sync, \
+                mock.patch.object(S.artifacts, "write_board"):
+            self.s.store.save(state)
+
+        sync.assert_not_called()
+
+    def test_save_swallows_herdr_sync_errors(self):
+        state = self._saved_state()
+        stderr = StringIO()
+        with mock.patch.object(S.herdr_tasks, "enabled", return_value=True), \
+                mock.patch.object(S.herdr_tasks, "sync", side_effect=RuntimeError("sync failed")), \
+                mock.patch.object(S.artifacts, "write_board"), redirect_stderr(stderr):
+            self.s.store.save(state)
+
+        self.assertEqual(len(stderr.getvalue().splitlines()), 1)
+
+    def test_run_create_shows_tasks_panel_without_publishing_board(self):
+        with mock.patch.object(S.herdr_tasks, "enabled", return_value=True), \
+                mock.patch.object(S.herdr_tasks, "sync"), \
+                mock.patch.object(S.herdr_tasks, "show_panel") as show_panel, \
+                mock.patch.object(S.artifacts, "enabled", return_value=True), \
+                mock.patch.object(S.artifacts, "publish_board") as publish_board, \
+                mock.patch.object(S.artifacts, "write_board"):
+            self.s.create_run("r2", [self.task("T1", trivial=True)])
+
+        show_panel.assert_called_once_with(self.cfg)
+        publish_board.assert_not_called()
+
+    def test_run_create_keeps_board_when_tasks_disabled(self):
+        with mock.patch.object(S.herdr_tasks, "enabled", return_value=False), \
+                mock.patch.object(S.herdr_tasks, "show_panel") as show_panel, \
+                mock.patch.object(S.artifacts, "enabled", return_value=True), \
+                mock.patch.object(S.artifacts, "publish_board", return_value="artifact-id") as publish_board, \
+                mock.patch.object(S.artifacts, "show_panel") as artifacts_panel, \
+                mock.patch.object(S.artifacts, "write_board"):
+            self.s.create_run("r2", [self.task("T1", trivial=True)])
+
+        show_panel.assert_not_called()
+        publish_board.assert_called_once()
+        artifacts_panel.assert_called_once_with(self.cfg)
+
+
 class TestDispatch(Base):
     def test_hc_launch_passes_run_and_slot_labels(self):
         self.herdr.backend = "hc"
````

## Review round 2: PASS (09/11/26 16:14)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 5853922d15ee, commits 5853922d15ee
- Notes: suite 292 passed with live env; no real task store writes

# Review hcpanel T2 (wiring) - PASS
- Store(on_save=None); save calls on_save after write_board, exception -> one stderr line. Scheduler sets store.on_save = _sync_herdr_tasks (enabled check, then herdr_tasks.sync(self, state)) per D1.
- run_create: tasks enabled -> herdr_tasks.show_panel, no run board; else board path unchanged. Config herdr.tasks bool. README row.
- Tests: base setup patches herdr_tasks; save/sync, raising sync, run create both paths, config. Suite 292 passed with HC_TERMINAL_ID set; ~/.herdr/tasks gained no task list (only Herdr's own periodic files changed).

## Integration: merged (09/11/26 16:14)

- On `agent/integration-hcpanel` at 29f37c5c4627; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcpanel/logs/post-merge-T2-a2.log`)

## Final gate: PASS (09/11/26 16:15)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcpanel at 29f37c5c4627 (log `.orchestrator/runs/hcpanel/logs/verify-1794215680.log`)
- Task MERGED; run DONE
