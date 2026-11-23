# pchecks-scheduler (24/11/26)

## Goal
`scheduler.py check start --run R --task T` starts a review session and a Code Mode test session in parallel on a
REVIEW task. `check wait` returns at the first FAIL and ends both sessions, or returns pass when both pass.
Every Claude-kind session the scheduler starts inherits the scheduler's PATH, so plugin hooks find `node`.

## Read first
- `plans/261124-0230-pchecks/plan.md`: design and reasons.
- `.agent-system/scheduler.py`: `Hc.workspace_create`, `Hc.workspace_close`, `Hc.agent_start` (~905-980),
  `Scheduler._launch_session` (~1609), `wait` (~1767: blocked detection, `local_alert`), `collect`, `mark_reviewed`,
  `repair`, `_run_logged`, config validation (~225-240), the CLI parser (~3180-3360) and dispatch (~3400-3470).
- `.agent-system/models.py`: `launch_args`, `ADAPTERS`.
- `.agent-system/prompts/review-checklist.md` (the review prompt points the reviewer at it).
- `.agent-system/tests/test_hc_adapter.py`, `.agent-system/tests/test_scheduler.py`: existing fakes for hc and runs.

## Steps
1. `models.py`: add `def claude_env_prefix(code_mode: bool, path: str | None) -> list[str]`. It returns
   `["env", f"PATH={path}"]` when `path` is set, plus `"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1"` when `code_mode`;
   it returns `[]` when neither applies. Unit-test it.
2. `scheduler.py`, `Hc.agent_start`: add the keyword `argv_prefix: list[str] | None = None`. The command after
   `--` becomes `[*(argv_prefix or []), M.binary(kind), *agent_args]`. Nothing else changes.
3. `Scheduler._launch_session`, hc branch: when `self.worker_kind() == "claude"`, pass
   `argv_prefix=M.claude_env_prefix(False, os.environ.get("PATH"))`. Codex workers are unchanged. The legacy
   backend is unchanged.
4. Config defaults, read with `cfg.get` and not required in config.json: add the helper
   `Scheduler.checks_cfg() -> dict`. It merges `{"enabled": True, "timeout_seconds": 1800, "review": {"kind":
   "claude", "model": None, "effort": None, "code_mode": False}, "test": {"kind": "claude", "model": None, "effort":
   None, "code_mode": True}}` with `self.cfg.get("checks", {})`, one level deep per role. A null model or effort
   takes `cfg["orchestrator"]["model"]` / `["effort"]`. Validation: if `checks` is present, `kind` must be
   `"claude"`. Code Mode is Claude-only; a kind other than claude gives a config error naming the key.
5. Prompts, both new: `.agent-system/prompts/check-review.md` and `.agent-system/prompts/check-test.md`. These are
   templates filled with `str.format` keys `{run} {task} {worktree} {task_file} {diff} {checklist} {report_json}
   {report_md} {log_dir} {check_id} {commands}`; escape literal braces.
   - Both say: you are a read-only checker, not the orchestrator or a worker (ignore AGENTS.md/CLAUDE.md
     orchestrator text). Never edit, create or delete files in the worktree. Write only the two report files and
     logs under `{log_dir}`. No git commit, push, checkout, stash or reset. No other agents. Report JSON keys:
     `check_id` (echo `{check_id}`), `task_id`, `check` (review|test), `verdict` (PASS|FAIL), `summary` (one
     paragraph), `findings` [{severity: blocker|major|minor, file, line, evidence}], `logs` [paths]. Write the `.md`
     first (human report), then the JSON last (the JSON is the completion signal). FAIL only for blocker/major
     findings.
   - Review: read the task file `{task_file}` and the diff `{diff}`, apply `{checklist}`, and open the changed
     files in `{worktree}` as needed.
   - Test: run each command in `{commands}` (one per line) in `{worktree}`. Send each command's full output to a log
     file in `{log_dir}` from the FIRST run (`cmd > log 2>&1; echo exit=$?`), and never rerun a command just to see
     its output again. Every number, test name and file:line in the report must be confirmed by opening the log or
     the file; never guess. A command exiting non-zero means FAIL, with its log in `logs`.
6. `Scheduler.check_start(run_id, tid) -> dict`:
   - Requirements: task status `REVIEW`, `herdr.backend == "hc"` (else a SchedulerError saying checks need hc),
     `checks_cfg()["enabled"]`, `shutil.which("claude")`.
   - Refuse with a SchedulerError if `t.get("checks", {}).get("status") == "running"` and that space still has a
     live agent. Otherwise close any old checks space first (best effort).
   - Paths: `reports/<T>.diff` (made by collect; if missing, error "collect first"), the task file
     `self._task_file(t)`, `log_dir = run_dir/"logs"/f"checks-{tid}-{check_id}"` (mkdir),
     `report_json = run_dir/"reports"/f"{tid}.check-{kind}.json"` and `.md`. Delete old report files before starting.
   - `commands`: the lines in the task file's `## Run these` section that are backticked commands (one per
     bullet), followed by `" ".join(cfg["gate"]["post_merge_check"])`. Write them as a numbered list. If the
     section is missing, use only the gate command.
   - Snapshot: `sha256` of `git status --porcelain=v1 -uall` plus `git diff HEAD`, run in the worktree, stored as
     `t["checks"]["snapshot"]`.
   - One space: `ws, pane = herdr.workspace_create(t["worktree"], f"{run}-{tid}-checks")`. For each kind in
     (review, test): name `f"{run}-{tid}-{kind}"[:32]` lowercased (hc name rules: a-z 0-9 - _). Args:
     `M.launch_args(role)` + `["--permission-mode", "auto", "--add-dir", str(run_dir)]`, where role = {kind,
     model, effort} from `checks_cfg`. Call `herdr.agent_start(name, pane, args, timeout, kind="claude",
     labels={"agentkit.run": run, "agentkit.check": kind}, argv_prefix=M.claude_env_prefix(role["code_mode"],
     os.environ.get("PATH")))`, then `herdr.agent_prompt(name, <filled prompt>, ...)`. Start both before waiting
     on either; a failure starting either closes the space and raises.
   - State: `t["checks"] = {"status": "running", "check_id", "space": ws, "started_at": now(), "snapshot", "sessions":
     {kind: {"agent": name, "verdict": None, "report_json", "report_md"}}}`. Then save, `log_event(state,
     "checks_started", task=tid)`, and `_append_task_file(t, "Checks started", [...names, models, code mode...])`.
     Return `{task, check_id, sessions: {kind: name}}`.
7. `Scheduler.check_wait(run_id, tid, timeout_s=None, interval_s=5, sleep=time.sleep, clock=time.monotonic) ->
   dict`: the default timeout is `checks_cfg()["timeout_seconds"]`. Loop:
   - A report counts only when it is valid JSON with a matching `check_id`, `task_id` and `check`, and a verdict of
     PASS or FAIL.
   - Any FAIL: `herdr.workspace_close(space)` at once (ends both), status `failed`, `failed: [kinds]`. Return
     `{result: "fail", failed, reports: {kind: md path}, next: ["task new --repair-of <task file> ... then repair
     (same worker)"]}`.
   - Both PASS: re-take the snapshot. If it differs, treat the result as FAIL with failed `["worktree"]` and the
     reason "a checker changed the worktree". Otherwise close the space, set status `passed`, and return `{result:
     "pass", reports, next: [f"mark-reviewed --run {run} --task {tid} --verdict PASS --report <review md>"]}`.
   - An agent in hc state `blocked`: return `{result: "blocked", agent, next: "hc read ..., decision ask --kind
     worker_approval"}`; it does not close anything.
   - An agent gone (`agent_record` gives no record) with no report: close the space, status `lost`, return
     `{result: "lost", kinds}`.
   - Timeout: return `{result: "timeout"}`; sessions are left running.
   - Each terminal result updates `t["checks"]`, logs an event and appends a task-file section "Checks:
     PASS|FAIL" with each verdict, summary and report path.
8. `Scheduler.check_status(run_id, tid) -> dict`: returns `t.get("checks")`.
9. Hooks into the existing flow:
   - `repair` (FIX_REQUIRED -> RUNNING): if a checks space is recorded and running, close it and set status
     `cancelled`.
   - `mark_reviewed` does not require checks. Checks are optional for the orchestrator; T3 documents when to use
     them.
10. CLI: `check` with sub-actions `start --run --task`, `wait --run --task [--timeout]` and `status --run --task`,
    dispatched like `finish` (`a.action`). Print JSON like other commands.
11. Tests: a NEW file `.agent-system/tests/test_checks.py`, with fakes modelled on test_hc_adapter/test_scheduler.
    No real hc, herdr-app or claude.
    - The prefix appears after `--` in the hc run argv, with PATH and the Code Mode env only for the test session.
    - Both reports PASS gives pass, and the space is closed.
    - The test session reports FAIL while review is still running: fail returns at once, workspace_close is
      called, and the review report is not awaited.
    - A stale `check_id` report is ignored.
    - A worktree changed between snapshots gives fail `["worktree"]`.
    - A blocked agent gives blocked, with no close.
    - The non-REVIEW, legacy-backend and missing-diff refusals.
    - `repair` closes running checks.
    - A claude worker launch gets the PATH prefix; a codex worker launch gets none.
    - Config validation: a checks kind other than claude is an error.

## Boundaries
**You may edit** (owned_paths):
- `.agent-system/scheduler.py`, `.agent-system/models.py`
- `.agent-system/prompts/check-review.md`, `.agent-system/prompts/check-test.md` (new)
- `.agent-system/tests/test_checks.py` (new)

**You must not edit:**
- install.sh, kitstart.py, agentctl.py, templates/, GUIDE.md, README.md (T2/T3); existing tests except to keep them
  passing after an intended signature change (say so in the report).
- The state schema of existing fields: add `t["checks"]` only.
- Anything else, `.orchestrator/`, other worktrees.

**You may run:** the commands in "Run these"; read-only git; `git add` / `git commit` on your branch.

**You must not run:** the real `hc`, `herdr`, `herdr-app`, `claude`, `agent-kit`; downloads or installs; git push,
merge, rebase, reset, checkout or clean. Never write under the real `~/.config/herdr-app`, `~/.herdr` or
`~/.config/agent-hub`.

**When to ask:** only a real blocker: report "blocked" with the exact reason.

## Done when
- [ ] Steps 1-11; the new tests and the whole suite pass.

## Run these
- `python3 -m pytest -q .agent-system/tests/test_checks.py`
- `python3 -m pytest -q .agent-system/tests`
