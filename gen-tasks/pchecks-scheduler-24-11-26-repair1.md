# pchecks-scheduler-24-11-26 - repair 1

## Errors found
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

## Proposed fix
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

## Boundaries
- Same as the original task file's Boundaries, except: none.

## Do not
- Rewrite earlier work or touch files not listed in Proposed fix (scheduler.py and tests/test_checks.py only).

## Run these
- `python3 -m pytest -q .agent-system/tests/test_checks.py`: expect all pass
- `python3 -m pytest -q .agent-system/tests`: expect all pass

## Deliver
- Same branch, keep earlier changes. Overwrite the report JSON at the same path;
  `commits` lists ALL task commits since base_sha (or [] if commits are blocked).
