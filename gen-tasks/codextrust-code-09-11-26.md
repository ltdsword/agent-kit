# codextrust code: Codex trust that works, resume that sees a live stuck worker (09/11/26)

## Goal
Codex workers start without the "Trust this folder?" question, and `resume` never advises a relaunch while
the worker's agent is still alive.

## Evidence (Opus, probed with Codex 0.165.0 in tmux, scratch repo)
- `-c 'projects."<path>".trust_level="trusted"'` is ignored: the trust question shows even when Codex starts
  in the repo root itself with that flag (worktree inside or outside the repo: same).
- One inline-table value works and saves nothing to `~/.codex/config.toml`:
  `-c 'projects={"<worktree>"={trust_level="trusted"},"<repo root>"={trust_level="trusted"}}'`
  -> Codex goes straight to "Hooks need review" (already answered by the scheduler).
- Live case: BanCaZagooMW run p2, workers t2c/t2d stuck at the trust question; launch timed out
  (`agent_not_ready`), so `launch_error` was set and `resume` said "no live agent and no report -> relaunch"
  while hc showed both agents live.

## Read first
- `.agent-system/scheduler.py`: `codex_args` (trust_worktree block ~line 1264), `resume` (~line 2780-2810),
  `Hc.agent_get` / `Herdr.agent_get` (~779, ~994), launch path that sets `launch_error` (~1720).
- `.agent-system/tests/test_scheduler.py` (trust assertions ~line 424, resume tests).

## Steps
1. `codex_args`: when `trust_worktree`, append exactly ONE `-c` whose value is
   `projects={"<p1>"={trust_level="trusted"},"<p2>"={trust_level="trusted"}}` over
   `dict.fromkeys([worktree, str(self.project_root)])` (dedupe kept). Paths are JSON/TOML basic strings: quote
   with `json.dumps(path)` so a `"` or `\` in a path stays valid. Update the comment: the dotted-key form is
   ignored by Codex (0.165), the inline table works and is per-run only.
2. `resume`, RUNNING task without report: if the agent is live (`agent_get` succeeded, not "missing"), report
   `"{tid}: agent {name} is live but has not reported"` plus, when `launch_error` is set,
   `" (launch timed out: it may be stuck on a startup screen; read it with hc read / herdr agent read, then answer it or stop it before relaunch)"`.
   Advise `relaunch` only when the agent is missing, or when it was not observable AND `launch_error` is set.
   Keep the existing message text for those relaunch cases.
3. Tests: codex_args with trust -> one `-c` with the inline table containing both paths, no dotted
   `projects."` keys; same path twice -> one entry; a path with a `"` stays valid TOML (parse the value after
   `projects=` with `tomllib.loads("projects=" + value)` and check both trust levels). Resume: launch_error +
   live agent -> no relaunch advice, "live but has not reported"; launch_error + missing -> relaunch advice;
   no launch_error + live -> existing "running on" text unchanged.

## Boundaries
**You may edit:** `.agent-system/scheduler.py` (`codex_args`, `resume` only), `.agent-system/tests/test_scheduler.py`.
**You must not edit:** templates, docs, GUIDE/README, agentctl.py, artifacts*, hub/**, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `codex` itself, `hc`, `herdr*`, `herdr-app`; git push/merge/rebase/reset/checkout; edits to `~/.codex`.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Steps 1-3 done; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (09/11/26 11:39)

- Status: **blocked** (worker worker-1, branch `agent/codextrust-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit None
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - The task specification conflicts: Step 2 says any observable live agent gets the 'live but has not reported' message, while Step 3 requires a live agent without launch_error to retain the existing 'running on' message. The referenced task header does not clarify which behavior is intended.
- Not done:
  - Implementation and requested tests were not changed because the conflicting requirements cannot be followed simultaneously without guessing.
- Full diff: `.orchestrator/runs/codextrust/reports/T1.diff`

## Decision D1 needed (blocker) (09/11/26 11:39)

**Unblock T1 with a clarification?**

T1 (trust flag + resume fix) stopped because my task text contradicted itself: step 2 says every live worker gets the new 'live but has not reported' message, step 3 says a live worker without a launch error keeps today's 'running on' message. I meant: new message only when the worker is live AND its launch timed out; otherwise today's text.

- `A`: Unblock with that clarification and relaunch T1 (recommended)
- `B`: Stop T1

Waiting for the user's answer in chat.

## Decision D1 answered by the user (09/11/26 11:40)

- Choice: **A**: Unblock with that clarification and relaunch T1
- User's words (chat): "decision D1 (run codextrust): A"
- Note: answered in the Herdr app card

## Worker result - attempt 2 (09/11/26 11:47)

- Status: **done** (worker worker-1, branch `agent/codextrust-t1-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/scheduler.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 1
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - Changes remain uncommitted because git add was blocked by the read-only .git worktree index.
- Not done:
  - Commit not created; git add exited 128 with 'Read-only file system'. No workaround attempted.
- Full diff: `.orchestrator/runs/codextrust/reports/T1.diff`

````text
 .agent-system/scheduler.py            | 16 ++++++---
 .agent-system/tests/test_scheduler.py | 65 +++++++++++++++++++++++++++++++++--
 2 files changed, 74 insertions(+), 7 deletions(-)
````

````diff
diff --git a/.agent-system/scheduler.py b/.agent-system/scheduler.py
index b735b20..4a852b4 100644
--- a/.agent-system/scheduler.py
+++ b/.agent-system/scheduler.py
@@ -1262,10 +1262,10 @@ class Scheduler:
         for d in w.get("writable_dirs", []):  # build-tool caches, e.g. ~/.gradle
             args += ["--add-dir", str(Path(d).expanduser())]
         if w.get("trust_worktree"):
-            # For this run only (not saved). Codex applies trust to the git repository root for a worktree,
-            # so trust the repo root too, or the worker stops at a "Trust this folder?" prompt.
-            for path in dict.fromkeys([worktree, str(self.project_root)]):
-                args += ["-c", f'projects."{path}".trust_level="trusted"']
+            # Codex 0.165 ignores the dotted-key form; this inline table works and applies per run only.
+            projects = ",".join(f'{json.dumps(path)}={{trust_level="trusted"}}'
+                                for path in dict.fromkeys([worktree, str(self.project_root)]))
+            args += ["-c", f"projects={{{projects}}}"]
         if w.get("network_access"):  # e.g. tests that open sockets; Codex cannot limit this to localhost
             args += ["-c", "sandbox_workspace_write.network_access=true"]
         if w.get("web_search"):  # Codex's built-in web search, to look up docs and references
@@ -2793,17 +2793,23 @@ class Scheduler:
                     has_report = (self.store.run_dir(run_id) / "reports" / f"{tid}.json").exists()
                     w = state["workers"][t["worker"]]
                     live = None
+                    observable = False
                     herdr = self.herdr_for(state)
                     if w.get("agent_name") and herdr.available():
                         try:
                             live = herdr.agent_get(w["agent_name"]).get("result")
+                            observable = True
                         except SchedulerError:
                             live = "missing"
                     t["lease"]["last_observed_at"] = now()
                     if has_report:
                         actions.append(f"{tid}: report present -> scheduler.py collect --run {run_id} --task {tid}")
-                    elif live == "missing" or t.get("launch_error"):
+                    elif live == "missing" or (t.get("launch_error") and not observable):
                         actions.append(f"{tid}: no live agent and no report -> relaunch --run {run_id} --task {tid}")
+                    elif t.get("launch_error"):
+                        actions.append(f"{tid}: agent {w['agent_name']} is live but has not reported "
+                                       "(launch timed out: it may be stuck on a startup screen; read it with "
+                                       "hc read / herdr agent read, then answer it or stop it before relaunch)")
                     else:
                         actions.append(f"{tid}: running on {t['worker']} (herdr: {live or 'not observable'})")
                 elif t["status"] == "REVIEW":
diff --git a/.agent-system/tests/test_scheduler.py b/.agent-system/tests/test_scheduler.py
index d287cd3..4d76b87 100644
--- a/.agent-system/tests/test_scheduler.py
+++ b/.agent-system/tests/test_scheduler.py
@@ -9,6 +9,7 @@ import os
 import subprocess
 import sys
 import tempfile
+import tomllib
 import unittest
 from contextlib import redirect_stderr
 from io import StringIO
@@ -421,10 +422,30 @@ class TestConfig(Base):
         self.cfg["worker"].update(trust_worktree=True, network_access=True, web_search=False)
         args = self.new_scheduler().codex_args("/wt", "r1")
         self.assertIn("check_for_update_on_startup=false", args)
-        self.assertIn('projects."/wt".trust_level="trusted"', args)
-        self.assertIn(f'projects."{self.repo.resolve()}".trust_level="trusted"', args)
+        project_configs = [args[i + 1] for i, arg in enumerate(args[:-1])
+                           if arg == "-c" and args[i + 1].startswith("projects=")]
+        self.assertEqual(len(project_configs), 1)
+        projects = tomllib.loads("projects=" + project_configs[0].split("=", 1)[1])["projects"]
+        self.assertEqual(projects, {"/wt": {"trust_level": "trusted"},
+                                    str(self.repo.resolve()): {"trust_level": "trusted"}})
+        self.assertFalse(any('projects."' in arg for arg in args))
         self.assertIn("sandbox_workspace_write.network_access=true", args)
         self.assertNotIn("--search", args)
+
+        same_path_args = self.new_scheduler().codex_args(str(self.repo.resolve()), "r1")
+        same_path_config = next(same_path_args[i + 1] for i, arg in enumerate(same_path_args[:-1])
+                                if arg == "-c" and same_path_args[i + 1].startswith("projects="))
+        same_path_projects = tomllib.loads("projects=" + same_path_config.split("=", 1)[1])["projects"]
+        self.assertEqual(same_path_projects, {str(self.repo.resolve()): {"trust_level": "trusted"}})
+
+        quoted_path = '/wt/with"quote'
+        quoted_args = self.new_scheduler().codex_args(quoted_path, "r1")
+        quoted_config = next(quoted_args[i + 1] for i, arg in enumerate(quoted_args[:-1])
+                             if arg == "-c" and quoted_args[i + 1].startswith("projects="))
+        quoted_projects = tomllib.loads("projects=" + quoted_config.split("=", 1)[1])["projects"]
+        self.assertEqual(quoted_projects, {quoted_path: {"trust_level": "trusted"},
+                                           str(self.repo.resolve()): {"trust_level": "trusted"}})
+
         self.cfg["worker"]["web_search"] = True
         self.assertIn("--search", self.new_scheduler().codex_args("/wt", "r1"))
         self.cfg["worker"].update(network_access=False)
@@ -746,6 +767,46 @@ class TestPersistence(Base):
         res = self.new_scheduler().resume("r1")
         self.assertTrue(any("relaunch" in a for a in res["actions"]))
 
+    def test_resume_live_agent_after_launch_timeout_does_not_suggest_relaunch(self):
+        self.dag()
+        self.s.dispatch_ready("r1", launch="herdr")
+        state = self.s.store.load("r1")
+        task = state["tasks"]["T1"]
+        agent_name = state["workers"][task["worker"]]["agent_name"]
+        task["launch_error"] = "agent_not_ready"
+        self.s.store.save(state)
+
+        actions = self.new_scheduler().resume("r1")["actions"]
+        action = next(a for a in actions if a.startswith("T1:"))
+        self.assertEqual(action, f"T1: agent {agent_name} is live but has not reported "
+                         "(launch timed out: it may be stuck on a startup screen; read it with "
+                         "hc read / herdr agent read, then answer it or stop it before relaunch)")
+        self.assertNotIn("relaunch --run", action)
+
+    def test_resume_missing_agent_after_launch_timeout_suggests_relaunch(self):
+        self.dag()
+        self.s.dispatch_ready("r1", launch="herdr")
+        state = self.s.store.load("r1")
+        task = state["tasks"]["T1"]
+        agent_name = state["workers"][task["worker"]]["agent_name"]
+        task["launch_error"] = "agent_not_ready"
+        self.s.store.save(state)
+        self.herdr.live.pop(agent_name)
+
+        actions = self.new_scheduler().resume("r1")["actions"]
+        self.assertIn("T1: no live agent and no report -> relaunch --run r1 --task T1", actions)
+
+    def test_resume_live_agent_without_launch_error_keeps_running_message(self):
+        self.dag()
+        self.s.dispatch_ready("r1", launch="herdr")
+        state = self.s.store.load("r1")
+        task = state["tasks"]["T1"]
+        agent_name = state["workers"][task["worker"]]["agent_name"]
+
+        actions = self.new_scheduler().resume("r1")["actions"]
+        self.assertIn(f"T1: running on {task['worker']} (herdr: {{'name': '{agent_name}', 'state': 'working'}})",
+                      actions)
+
     def test_lock_excludes_second_instance(self):
         self.dag()
         s2 = self.new_scheduler()
````

## Review round 2: PASS (09/11/26 11:49)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 8b949bc93401, commits 8b949bc93401
- Notes: suite 272 passed; live trust check with worker profile OK

# Review codextrust T1 (code) - PASS
- codex_args: one `-c projects={...}` inline table, paths via json.dumps (valid TOML basic strings), deduped; dotted form gone.
- resume: live+launch_error -> "live but has not reported (launch timed out ...)", no relaunch; missing, or unobservable+launch_error -> relaunch; live w/o launch_error -> unchanged "running on". Matches D1 clarification.
- Tests: tomllib parse of the value, dedupe, quote in path; three resume cases. Suite in worktree: 272 passed.
- Live (Opus): Codex 0.165 `--profile worker`, never-trusted repo + outside worktree, dotted dir names -> no trust question, goes to Hooks review; ~/.codex config.toml and worker.config.toml unchanged.
- Note (pre-existing, not in scope): hc "unreachable" also maps to "missing" -> relaunch advice.

## Integration: merged (09/11/26 11:49)

- On `agent/integration-codextrust` at ab5ff95ffd0f; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/codextrust/logs/post-merge-T1-a2.log`)

## Final gate: PASS (09/11/26 11:50)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-codextrust at c7afff53e72e (log `.orchestrator/runs/codextrust/logs/verify-1794199776.log`)
- Task MERGED; run DONE
