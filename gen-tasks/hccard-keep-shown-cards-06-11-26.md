# hccard: never delete a decision card a Herdr layout is showing (06/11/26)

## Goal
Run cleanup removes a run's decision cards, but a card open in the person's Artifacts view is referenced by
their layout file; deleting it made the whole layout fail to load ("shepherdr" fell back to "main").
Cleanup must leave such a card in place.

## Facts (Opus, verified 06/11/26, herdr-app 0.1.13)
- App home: `$HERDR_APP_HOME`, default `~/.config/herdr-app`. Layouts: `<home>/layouts/*.json`.
- An artifact with id `X` is installed as mod `art-X`; the Artifacts view shows it by writing
  `{"content": {"mod": "art-X"}}` into the layout's block `"id": "artifacts-view-body"` (mods/artifacts/sidebar.js).
- After `herdr-artifact rm X`, a layout still holding `art-X` fails: status error
  `mod art-X: no mod folder ~/.config/herdr-app/mods/art-X`.
- Only caller: `scheduler.py` cleanup (`artifacts.remove(artifact_ids)`, ~2894).

## Read first
- `.agent-system/artifacts.py` (`remove`, `enabled`), `.agent-system/tests/test_artifacts.py`.

## Steps
1. artifacts.py: `shown_in_layouts(env=None) -> set[str]`: read every `<home>/layouts/*.json` (home from
   env/os.environ `HERDR_APP_HOME`, else `~/.config/herdr-app`), walk the JSON tree, collect every
   `content.mod` string starting with `art-`, return them without the `art-` prefix. Unreadable/invalid
   files are skipped; never raises.
2. `remove(ids, runner=subprocess.run, env=None)`: skip ids in `shown_in_layouts(env)` (one line to stderr per
   skipped id: `kept artifact <id>: shown in a Herdr layout`); others removed as today.
3. Tests (temp HERDR_APP_HOME, fake runner): shown card kept and not passed to the runner; other ids removed;
   a broken layout file is ignored; no layouts dir -> all removed.

## Boundaries
**You may edit:** `.agent-system/artifacts.py`, `.agent-system/tests/test_artifacts.py`.
**You must not edit:** scheduler.py, panels, docs, plans/**, gen-tasks/**, .orchestrator/**, anything in
`~/.config/herdr-app`.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `herdr*`, `hc`; git push/merge/rebase/reset/checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Shown cards survive cleanup; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (06/11/26 09:19)

- Status: **done** (worker worker-1, branch `agent/hccard-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/artifacts.py`, `.agent-system/tests/test_artifacts.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_artifacts.py` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_artifacts.py` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done:
  - Commit not created; .git is read only in this sandbox.
- Full diff: `.orchestrator/runs/hccard/reports/T1.diff`

````text
 .agent-system/artifacts.py            | 36 ++++++++++++++++++++++++-
 .agent-system/tests/test_artifacts.py | 49 +++++++++++++++++++++++++++++------
 2 files changed, 76 insertions(+), 9 deletions(-)
````

````diff
diff --git a/.agent-system/artifacts.py b/.agent-system/artifacts.py
index 86a15f0..6a2889c 100644
--- a/.agent-system/artifacts.py
+++ b/.agent-system/artifacts.py
@@ -5,6 +5,7 @@ import json
 import os
 import shutil
 import subprocess
+import sys
 import tempfile
 from pathlib import Path
 
@@ -173,10 +174,43 @@ def publish_decision(project_root, run_dir, state: dict, cfg: dict, decision_id:
     return artifact_id
 
 
-def remove(ids, runner=subprocess.run) -> None:
+def shown_in_layouts(env=None) -> set[str]:
+    shown = set()
+    try:
+        env = os.environ if env is None else env
+        app_home = Path(env.get("HERDR_APP_HOME") or "~/.config/herdr-app").expanduser()
+
+        def collect(value):
+            if isinstance(value, dict):
+                content = value.get("content")
+                if isinstance(content, dict):
+                    mod = content.get("mod")
+                    if isinstance(mod, str) and mod.startswith("art-"):
+                        shown.add(mod[4:])
+                for child in value.values():
+                    collect(child)
+            elif isinstance(value, list):
+                for child in value:
+                    collect(child)
+
+        for layout in (app_home / "layouts").glob("*.json"):
+            try:
+                collect(json.loads(layout.read_text(encoding="utf-8")))
+            except Exception:
+                continue
+    except Exception:
+        pass
+    return shown
+
+
+def remove(ids, runner=subprocess.run, env=None) -> None:
+    shown = shown_in_layouts(env)
     for artifact_id in ids:
         if not isinstance(artifact_id, str) or not artifact_id:
             continue
+        if artifact_id in shown:
+            sys.stderr.write(f"kept artifact {artifact_id}: shown in a Herdr layout\n")
+            continue
         try:
             runner(["herdr-artifact", "rm", artifact_id], capture_output=True, text=True,
                    shell=False, timeout=5)
diff --git a/.agent-system/tests/test_artifacts.py b/.agent-system/tests/test_artifacts.py
index b245de5..5bfa829 100644
--- a/.agent-system/tests/test_artifacts.py
+++ b/.agent-system/tests/test_artifacts.py
@@ -1,4 +1,6 @@
 """Artifact board and decision card tests."""
+import contextlib
+import io
 import json
 import os
 import shutil
@@ -133,20 +135,51 @@ class ArtifactBoardTests(unittest.TestCase):
             self.assertIsNone(A.publish_board(Path(tmp), run_dir, sample_state(), {"herdr": {}},
                                                {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}, failed))
 
-    def test_remove_calls_cli_for_each_id(self):
-        calls = []
+    def test_remove_keeps_cards_shown_in_layouts_and_ignores_broken_layouts(self):
+        with tempfile.TemporaryDirectory() as tmp:
+            home = Path(tmp)
+            layouts = home / "layouts"
+            layouts.mkdir()
+            (layouts / "main.json").write_text(json.dumps({
+                "blocks": [{"id": "artifacts-view-body", "content": {"mod": "art-kept"}}],
+            }))
+            (layouts / "other.json").write_text(json.dumps({
+                "nested": [{"content": {"mod": "art-second"}}],
+            }))
+            (layouts / "broken.json").write_text("{")
+            env = {"HERDR_APP_HOME": str(home)}
+            calls = []
+
+            def runner(argv, **kwargs):
+                calls.append(argv)
+                return subprocess.CompletedProcess(argv, 0, "", "")
+
+            stderr = io.StringIO()
+            with contextlib.redirect_stderr(stderr):
+                A.remove(["kept", "other", "second"], runner, env=env)
+
+            self.assertEqual(calls, [["herdr-artifact", "rm", "other"]])
+            self.assertEqual(stderr.getvalue(),
+                             "kept artifact kept: shown in a Herdr layout\n"
+                             "kept artifact second: shown in a Herdr layout\n")
+
+    def test_remove_calls_cli_for_each_id_when_layouts_dir_is_absent(self):
+        with tempfile.TemporaryDirectory() as tmp:
+            env = {"HERDR_APP_HOME": tmp}
+            calls = []
 
-        def runner(argv, **kwargs):
-            calls.append(argv)
-            return subprocess.CompletedProcess(argv, 0, "", "")
+            def runner(argv, **kwargs):
+                calls.append(argv)
+                return subprocess.CompletedProcess(argv, 0, "", "")
 
-        A.remove(["d1", "d2"], runner)
-        self.assertEqual(calls, [["herdr-artifact", "rm", "d1"], ["herdr-artifact", "rm", "d2"]])
+            A.remove(["d1", "d2"], runner, env=env)
+            self.assertEqual(calls, [["herdr-artifact", "rm", "d1"],
+                                     ["herdr-artifact", "rm", "d2"]])
 
         def failed_runner(argv, **kwargs):
             raise OSError("unavailable")
 
-        A.remove(["d1", "d2"], failed_runner)
+        A.remove(["d1", "d2"], failed_runner, env=env)
 
     def test_state_validation_accepts_artifact_ids(self):
         state = minimal_run_state()
````

## Review round 1: PASS (06/11/26 09:21)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 98cf2a37a13c, commits 98cf2a37a13c
- Notes: layout-shown cards kept; 263 tests pass

# Review hccard T1 - cleanup keeps cards shown in layouts (Opus)

Verdict: PASS

- `shown_in_layouts(env)`: walks `<HERDR_APP_HOME or ~/.config/herdr-app>/layouts/*.json`, collects `content.mod`
  values `art-*`; bad files skipped; never raises.
- `remove` skips shown ids with one stderr line; others removed as before. Only caller (scheduler cleanup) unchanged.
- Tests: shown kept, others removed, broken layout ignored, no layouts dir. Whole suite 263 passed (Opus rerun).

## Integration: merged (06/11/26 09:21)

- On `agent/integration-hccard` at 2d9f852e2f83; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hccard/logs/post-merge-T1-a1.log`)

## Final gate: PASS (06/11/26 09:22)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hccard at 2d9f852e2f83 (log `.orchestrator/runs/hccard/logs/verify-1793931662.log`)
- Task MERGED; run DONE
