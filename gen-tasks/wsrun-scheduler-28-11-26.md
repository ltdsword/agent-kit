# wsrun scheduler (28/11/26)

## Goal
`run create` works in workspace mode with task files that exist only in the workspace (not committed in the
project repo); `check start` refuses when `hc ls` fails while checks may be running; the gate command in check
prompts is shell-quoted.

## Read first
- `.agent-system/scheduler.py`: `project_root_for` (~152), `read_first_paths` (~333), `Scheduler.__init__`
  (`workspace_mode`, ~1176), `_task_source_issues` (~1335), `create_run` (~1379-1403), `check_start` (~1864-1915).
- `.agent-system/tests/test_scheduler.py`: `TestDag.test_run_create_requires_task_sources_committed_at_base`
  (~244), `WorkspaceBase` / `TestWorkspaceMode` (~1550-1600).
- `.agent-system/tests/test_checks.py`: `FakeHc.agent_list` (~74) and the "already running" test.

## Steps
1. `scheduler.py`, `_task_source_issues(self, tasks, base_sha)`: keep the start of the loop as is (reject absolute
   / `..` packets, require `self.workspace_root / packet` to be a file). Then branch on `self.workspace_mode`:
   - Workspace mode (new): task files and their Read-first `plans/`/`gen-tasks/` files live in the workspace,
     which is never a git repo. Resolve every Read-first path against `self.workspace_root` (not
     `project_root`); add it to issues if that file does not exist. Skip all git checks. Return sorted issues.
   - In-repo mode: unchanged (git `ls-tree` / `diff --quiet` / `show` comparison, Read-first paths resolved
     against `project_root`, which equals `workspace_root` there).
2. `scheduler.py`, `create_run`: make the error message depend on the mode. In-repo mode keeps
   `"task files must be tracked and unmodified at integration base: "`; workspace mode uses
   `"task files not found in the workspace: "`. Both join the issues with `", "` as today.
3. `scheduler.py`, `check_start`, the block `if old.get("status") == "running" and old_space:`: call
   `records = herdr.agent_list()`; if it is `None` raise
   `SchedulerError(f"cannot list hc agents; checks for {tid} may still be running (check status first)")`;
   otherwise keep the existing `any(...)` refusal on the list.
4. `scheduler.py`, `check_start`: replace `" ".join(self.cfg["gate"]["post_merge_check"])` with
   `shlex.join(...)` (add `import shlex` at the top if missing, sorted with the other stdlib imports).
5. `tests/test_scheduler.py`, class `TestWorkspaceMode`, add:
   - `test_run_create_accepts_task_files_only_in_workspace`: write `self.ws / "gen-tasks/ws-only.md"` with a
     `## Read first` listing `` `plans/ws-plan.md` ``, create `self.ws / "plans/ws-plan.md"`; neither exists in
     the repo; task packet = `gen-tasks/ws-only.md`; `create_run` succeeds and `self.repo_status()` is `""`.
   - `test_run_create_reports_missing_workspace_read_first`: same packet but no `plans/ws-plan.md`;
     `assertRaisesRegex(S.SchedulerError, "not found in the workspace: plans/ws-plan.md")`; no state file.
6. `tests/test_checks.py`, add two tests next to the existing "already running" test:
   - `hc ls` failure: give the task `checks = {"status": "running", "space": <id>}`, make the fake's
     `agent_list` return `None`; `check_start` raises "cannot list hc agents" and `workspace_close` is not called.
   - quoting: set `cfg["gate"]["post_merge_check"] = ["bash", "-c", "echo a b"]`; the review prompt sent via
     `agent_prompt` contains `bash -c 'echo a b'`.

## Boundaries
**You may edit** (must match owned_paths in tasks.json):
- `.agent-system/scheduler.py`
- `.agent-system/tests/test_scheduler.py`
- `.agent-system/tests/test_checks.py`

**You must not edit:**
- In-repo-mode behaviour of the task-source check (its existing tests must pass unchanged).
- Any other file, the task file, `.orchestrator/`, other worktrees.

**You may run:**
- The commands in "Run these"; read-only git; `git add` / `git commit` on your task branch; reading any file.

**You must not run:**
- Installs or downloads; `git push`, `merge`, `rebase`, `reset --hard`, `checkout`/`switch`, `clean`;
  `install.sh`; `herdr`/`hc`/`agentctl` against real sessions; anything touching `~/.herdr`,
  `~/.config/agent-hub` or `~/.config/herdr-app`.

**When to ask** (approval prompt or "blocked" report), and only then:
- a step doesn't match the code, or a test fails for a reason the plan doesn't cover -> report "blocked";
- a command needs to go outside your worktree or sandbox -> ask, or report "blocked" with the error.
Everything else allowed above: just do it. Never work around a block.

## Do not
- Refactor, rename, reformat or touch anything not listed in Steps.

## Done when
- [ ] Workspace-mode `run create` accepts workspace-only task files and reports missing Read-first files.
- [ ] In-repo-mode guard tests unchanged and passing.
- [ ] `check_start` refuses when `agent_list()` is `None` for running checks; gate command uses `shlex.join`.

## Run these
- `python3 -m pytest -q .agent-system/tests/test_scheduler.py .agent-system/tests/test_checks.py`: expect all pass
- `.agent-system/scripts/verify.sh --quick`: expect exit 0

## Notes
- `self.workspace_mode` already exists on `Scheduler`; `WorkspaceBase` builds `self.ws` with `project.path`.
- `WorkspaceBase`'s packets `packets/T1.md` also exist in the repo with the same text, which is why today's
  workspace tests pass; the new tests must use a path that is not in the repo (`gen-tasks/ws-only.md`).

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
