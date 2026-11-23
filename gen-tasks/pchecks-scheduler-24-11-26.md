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

## Worker result - attempt 1 (24/11/26 03:02)

- Status: **done** (worker worker-1, branch `agent/pchecks-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/models.py`, `.agent-system/prompts/check-review.md`, `.agent-system/prompts/check-test.md`, `.agent-system/scheduler.py`, `.agent-system/tests/test_checks.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_checks.py` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done:
  - Commit skipped because .git is read-only under the sandbox permissions.
- Full diff: `.orchestrator/runs/pchecks/reports/T1.diff`

````text
 .agent-system/models.py               |  10 +
 .agent-system/prompts/check-review.md |  21 ++
 .agent-system/prompts/check-test.md   |  27 +++
 .agent-system/scheduler.py            | 266 ++++++++++++++++++++++-
 .agent-system/tests/test_checks.py    | 389 ++++++++++++++++++++++++++++++++++
 5 files changed, 707 insertions(+), 6 deletions(-)
````

(diff is 823 lines; read the full diff file)

## Checks started (24/11/26 03:02)

- Review: `pchecks-t1-review`; model `claude-opus-5-5`; effort `high`; Code Mode `False`
- Test: `pchecks-t1-test`; model `claude-opus-5-5`; effort `high`; Code Mode `True`

## Checks: FAIL (24/11/26 03:06)

- review: **FAIL** — T1 implements steps 1-11 within owned paths, and the tests pass on re-run (test_checks.py: 16 passed; full suite: 324 passed). One major problem: check_wait treats any agent_record result with no record as lost. That includes hc's transient (None, 'unknown') result on a 5 s timeout, a non-zero exit or bad JSON. A single slow hc call therefore closes the checks space and kills both checker sessions mid-run. The fix is to check agent_state == 'absent' and add a test for it. Five minor cleanups are also listed: possible name collision from truncation, a dead code_mode validation branch, a duplicated agent_start call, failed kinds not saved in t['checks'], and no next step on a worktree-changed FAIL.
  - Report: `.orchestrator/runs/pchecks/reports/T1.check-review.md`
- test: **PASS** — All three commands exited 0 in the worker-1 worktree. `python3 -m pytest -q .agent-system/tests/test_checks.py`: 16 passed in 10.25s. `python3 -m pytest -q .agent-system/tests`: 324 passed, 129 subtests passed in 110.20s. `.agent-system/scripts/verify.sh --quick`: PASS, with 1 check run (git diff --check). One minor coverage note: in quick mode, verify.sh only runs `git diff --check HEAD`. That checks tracked changes, so the three untracked new files (test_checks.py and the two prompts) are not whitespace-checked. No blocker or major findings.
  - Report: `.orchestrator/runs/pchecks/reports/T1.check-test.md`

## Review round 1: MAJOR_FIX (24/11/26 03:06)

- Verdict: **MAJOR_FIX** -> task is now FIX_REQUIRED (fix rounds used: 0/2)
- Reviewed HEAD: 3fa32a86c555

# T1 check-review (check_id a9ea2cc12d0d6722)

**Summary:** T1 adds `claude_env_prefix`, the `argv_prefix` option on hc `agent_start`, the PATH prefix for Claude workers, `checks_cfg` with its validation, two prompt templates, `check start|wait|status` and the repair hook. It follows the task closely and the tests pass. One major problem: `check_wait` counts a transient hc failure as a lost agent. It then closes the checks space, which kills both checker sessions while they are still running.

| Check | Result | Evidence |
|---|---|---|
| Done when (steps 1-11) | met, except finding 1 | models.py `claude_env_prefix`; scheduler.py `agent_start` argv_prefix, `_launch_session` claude branch, `checks_cfg`, validate_config `checks.*.kind`, `check_start`/`check_wait`/`check_status`, repair hook, `check` CLI parser and dispatch; both prompts present and fill with `str.format`, with braces escaped |
| Tests | `pytest -q .agent-system/tests/test_checks.py` exit 0 (16 passed); `pytest -q .agent-system/tests` exit 0 (324 passed, 129 subtests). Re-run by the reviewer: yes, with `PYTHONDONTWRITEBYTECODE=1 -p no:cacheprovider` so the worktree was not touched | logs under `.orchestrator/runs/pchecks/logs/checks-T1-a9ea2cc12d0d6722/` |
| Scope | OK | Only owned paths changed: models.py, scheduler.py, 2 new prompts, new test_checks.py; existing tests not edited |
| Correctness / security | 1 major, 5 minor | see findings |

**Findings:**

1. **major**: `.agent-system/scheduler.py:2033`: `check_wait` treats `rec is None` as "lost". `Hc.agent_record` also returns `(None, "unknown")` for a transient hc problem. Those cases are: `_run` returned None on a 5 s timeout or OSError (scheduler.py:895-900), a non-zero exit, or a JSON decode error (scheduler.py:1031-1044). A single slow `hc get` during a poll that can last up to 1800 s therefore closes the checks space, kills both checker sessions mid-run and records status `lost`. The fix is to test `agent_state == "absent"`. The existing `wait` never makes a destructive decision from an `unknown` state. The test fake only returns `absent`, so no test covers this path.
2. **minor**: `.agent-system/scheduler.py:1925`: `f"{run_id}-{tid}-{kind}"[:32]`. When `len(run_id)+len(tid) >= 30`, the review and test names truncate to the same string, and the second `hc run --name` would collide. The spec gives this naming, but nothing guards against it.
3. **minor**: `.agent-system/scheduler.py:231`: the `code_mode requires kind 'claude'` check can never add anything. Any input that reaches it was already rejected by the `kind must be 'claude'` check on the line above (dead code).
4. **minor**: `.agent-system/scheduler.py:1666`: `_launch_session` repeats the whole `agent_start` call in two branches. The only difference is `argv_prefix`, which could be passed as a value or None.
5. **minor**: `.agent-system/scheduler.py:1965`: `_finish_checks` stores `status` and per-session verdicts but not the `failed` kinds (or the lost kinds) in `t["checks"]`. Step 7 lists `failed: [kinds]` with the status, so `check status` cannot show which checker failed.
6. **minor**: `.agent-system/scheduler.py:2020`: the worktree-changed FAIL result has no `next`. The ordinary FAIL result points to the repair flow.

**Required fixes:** finding 1 (check `agent_state == "absent"` and add a test where `agent_record` returns `(None, "unknown")`, expecting no close and no `lost`). Findings 2-6 are optional cleanups.

## Opus decision D1 (routine repair) (24/11/26 03:06)

- Action: repair
- Reason: check review FAIL: transient hc unknown treated as lost (major) + 5 minors; see T1.check-review.md

## Fix round 1/2: errors and proposed fix, sent to worker-1 (24/11/26 03:06)

- Fix file: `gen-tasks/pchecks-scheduler-24-11-26-repair1.md` (same worker, branch and worktree)
### Errors found
These come from the review checker's report `.orchestrator/runs/pchecks/reports/T1.check-review.md`, verified by the
orchestrator.
1. `.agent-system/scheduler.py` `check_wait` (~2033), MAJOR: it marks a checker `lost` when `rec is None`. But
   `Hc.agent_record` also returns `(None, "unknown")` on an hc timeout/OSError, a non-zero exit or bad JSON. One
   slow hc call therefore closes the space and kills both live checkers. FakeHc only returns "absent", so this is
   untested.
2. Minor, `check_start` (~1925): `f"{run_id}-{tid}-{kind}"[:32]` makes the review and test names identical when the
   run id is long.
3. Minor, `validate_config` (~231): the `code_mode requires kind claude` branch is dead code (kind != claude is
   already an error).
4. Minor, `_launch_session` (~1666): the whole `agent_start` call is duplicated in two branches that differ only in
   `argv_prefix`.
5. Minor, `_finish_checks` (~1965): the failed/lost kinds are not stored, so `check status` cannot show which
   checker failed.
6. Minor, `check_wait` (~2020): the worktree-changed FAIL result has no `next`, unlike the other FAIL.

### Proposed fix
1. `check_wait`: count a session as lost only when `agent_state == "absent"`. On `"unknown"`, keep waiting; an
   unknown result never closes anything. Test: FakeHc returns `(None, "unknown")` for some polls and then the
   reports arrive: the result is pass, and workspace_close was not called before the reports.
2. `check_start`: name = `f"{base}-{suffix}"`, where suffix is `rev` or `test`,
   `base = re.sub(r"[^a-z0-9_-]", "-", f"{run_id}-{tid}".lower())[:27].rstrip("-")`. The two names always differ and
   stay <= 32 characters. Test: a 40-character run id gives two distinct names of <= 32 characters.
3. `validate_config`: drop the dead `code_mode` branch.
4. `_launch_session`: one `agent_start` call with `argv_prefix=(M.claude_env_prefix(False,
   os.environ.get("PATH")) if self.worker_kind() == "claude" else None)`. The existing tests keep passing.
5. `_finish_checks`: add a `failed: list[str]` parameter (default empty) and store it as `checks["failed"]`. Callers
   pass `failed` (fail), `["worktree"]` (worktree changed) or `lost` (lost).
6. The worktree-changed FAIL result gets the same `next` as the ordinary FAIL.

## Worker result - attempt 2 (24/11/26 03:18)

- Status: **done** (worker worker-1, branch `agent/pchecks-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/models.py`, `.agent-system/prompts/check-review.md`, `.agent-system/prompts/check-test.md`, `.agent-system/scheduler.py`, `.agent-system/tests/test_checks.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_checks.py` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 1
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done:
  - Commit skipped because .git is read-only under the sandbox permissions.
- Full diff: `.orchestrator/runs/pchecks/reports/T1.diff`

````text
 .agent-system/models.py               |  10 +
 .agent-system/prompts/check-review.md |  21 ++
 .agent-system/prompts/check-test.md   |  27 +++
 .agent-system/scheduler.py            | 265 ++++++++++++++++++++-
 .agent-system/tests/test_checks.py    | 433 ++++++++++++++++++++++++++++++++++
 5 files changed, 751 insertions(+), 5 deletions(-)
````

(diff is 867 lines; read the full diff file)

## Checks started (24/11/26 03:18)

- Review: `pchecks-t1-rev`; model `claude-opus-5-5`; effort `high`; Code Mode `False`
- Test: `pchecks-t1-test`; model `claude-opus-5-5`; effort `high`; Code Mode `True`

## Checks: PASS (24/11/26 03:22)

- review: **PASS** — Attempt 2 fixes the round-1 major problem: check_wait now marks a session lost only when agent_state == 'absent', and a new test shows that an 'unknown' hc result keeps waiting without closing the space. All five round-1 minor items are also fixed: names stay distinct and at most 32 characters, the dead code_mode validation is removed, _launch_session has a single hc agent_start call, the failed kinds are stored in t['checks'], and the worktree-changed FAIL has a next step. Steps 1-11 are met and only owned paths changed. Both Run-these commands passed when re-run by the reviewer (test_checks.py: 18 passed; full suite: 326 passed, 129 subtests). Two new minor notes remain. A transient agent_list() None in check_start skips the already-running refusal. The gate command is joined without shell quoting, as the spec asked. Neither blocks the task.
  - Report: `.orchestrator/runs/pchecks/reports/T1.check-review.md`
- test: **PASS** — All three required commands exited 0 in the worker-1 worktree (branch agent/pchecks-t1). .agent-system/tests/test_checks.py: 18 passed in 12.26s. Full .agent-system/tests suite: 326 passed, 129 subtests passed in 113.66s. verify.sh --quick: PASS (1 check run, git diff --check). No failures, errors, or findings.
  - Report: `.orchestrator/runs/pchecks/reports/T1.check-test.md`

## Review round 2: PASS (24/11/26 03:22)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 1/2)
- Reviewed HEAD: 470835e00979, commits 470835e00979

# T1 check-review (check_id be576874b5fbc818), fix round 1

**Summary:** Attempt 2 fixes the round-1 major problem: `check_wait` now marks a session lost only when `agent_state == "absent"`, and a new test shows that an `unknown` result keeps waiting without closing the space. All five round-1 minor items are also fixed. Steps 1-11 are met, only owned paths changed, and both "Run these" commands pass when re-run. Two new minor notes remain and neither blocks the task. Verdict: PASS.

| Check | Result | Evidence |
|---|---|---|
| Done when (steps 1-11) | met | models.py `claude_env_prefix`; scheduler.py `Hc.agent_start` argv_prefix (line 947), `_launch_session` claude prefix (1663-1670), `checks_cfg`, `validate_config` `checks.*.kind`, `check_start` / `check_wait` / `check_status`, repair hook (~2313), `check` CLI parser and dispatch; both prompts fill with `str.format` and escape their braces |
| Round-1 fixes | all 6 applied | (1) `scheduler.py:2034`: `elif agent_state == "absent"`, tested by `test_unknown_hc_agent_state_keeps_waiting_for_reports`. (2) `:1923`: `base[:27]` + `-rev`/`-test` gives at most 32 characters, tested by `test_long_run_id_produces_distinct_session_names_under_hc_limit`. (3) The dead `code_mode` branch is gone from `validate_config`. (4) `_launch_session` now has one hc `agent_start` call; `argv_prefix` is passed only when it is set, which keeps the existing `test_scheduler.py:95` FakeHc working without editing it. (5) `:1965`: `checks["failed"]` is stored and asserted in the fail and lost tests. (6) The worktree-changed FAIL now has `next`, as the test asserts |
| Tests | `python3 -m pytest -q .agent-system/tests/test_checks.py` exit 0 (18 passed); `python3 -m pytest -q .agent-system/tests` exit 0 (326 passed, 129 subtests). Re-run by the reviewer: yes, with `PYTHONDONTWRITEBYTECODE=1 -p no:cacheprovider`. `git status` was unchanged afterwards | logs `.orchestrator/runs/pchecks/logs/checks-T1-be576874b5fbc818/test_checks.log`, `full_suite.log` |
| Scope | OK | Only models.py, scheduler.py, the 2 new prompts and the new test_checks.py changed; existing tests were not edited |
| Correctness / security | OK, 2 minor notes | see findings |

**Findings:**

1. **minor**: `.agent-system/scheduler.py:1881`: `check_start` reads `herdr.agent_list() or []`. `Hc.agent_list` returns `None` when `hc ls` fails or times out, so a transient hc error looks like "no live checker". The refusal is then skipped, and the best-effort close of the old space also depends on `agent_list`, so it kills nothing. A second pair of checkers can then start beside the old ones. The old reports are ignored because their check_id no longer matches, so this wastes sessions but cannot corrupt a verdict. The fix is to refuse when the list is `None` and the old status is `running`.
2. **minor**: `.agent-system/scheduler.py:1915`: the gate command is built with `" ".join(post_merge_check)`, which the spec asked for, but nothing is shell-quoted. Any argument with spaces or shell metacharacters becomes a command that cannot be run as written. The test config's `python3 -c print('gate')` is an example. The real config (`.agent-system/scripts/verify.sh --quick`) is unaffected. `shlex.join` would avoid this.

**Required fixes:** none (both findings are optional minor cleanups).

### Known issues (accepted: no fix rounds left)

minor: check_start skips the live-checks refusal when hc ls fails; gate command joined without shell quoting (use shlex.join)

## Integration: merged (24/11/26 03:22)

- On `agent/integration-pchecks` at d7e2cc5e137e; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/pchecks/logs/post-merge-T1-a2.log`)

## Final gate: PASS (24/11/26 03:24)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-pchecks at 807e4c823f72 (log `.orchestrator/runs/pchecks/logs/verify-1795465355.log`)
- Task MERGED; run DONE

## Finished (24/11/26 03:28)

- merged into hub/plan (decision D2)
