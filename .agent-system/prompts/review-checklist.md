# Review checklist (Opus)

Never accept on worker claims or Herdr `idle`. Evidence = report JSON + the captured diff + test logs
+ checks you re-ran. Record the verdict with `scheduler.py mark-reviewed --report <file>`; the verdict
and your report are appended to the end of the task file in `gen-tasks/`.

## How you learn a worker finished
`scheduler.py wait --run <id>` returns when a report file appears (or a worker shows an approval
prompt). Then `scheduler.py collect --run <id> --task <T>`: it checks the report against git, saves the
full diff (commits + uncommitted + new files) to `.orchestrator/runs/<id>/reports/<T>.diff`, and appends
a "Worker result" section (status, files, tests, diffstat, inline diff when short) to the task file.

## Per-task review
1. `collect` returned `REVIEW` (not `pending` / `ambiguous`).
2. Read the whole diff file (or the inline diff in the task file). Open surrounding code when needed.
3. Each "Done when" item met, with evidence.
4. Correctness and failure paths (null/empty input, errors, partial failure, retries).
5. Tests: new behavior is tested; the tests would fail without the change; re-run the "Run these"
   commands yourself in the worktree when practical.
6. Concurrency / transactions / resource cleanup where relevant.
7. Security: input validation, injection, secrets, authz; no secret-like files (`scope_secrets`).
8. Scope: only owned paths (`scope_outside` empty or justified with `--accept-scope`); nothing from
   the Boundaries and "Do not" lists; no undocumented dependency or network change; no generated binaries.
9. Maintainability: matches surrounding style; no dead code or duplicated abstractions.

### Verdicts
| Verdict | Use when | Next command |
|---|---|---|
| PASS | everything above holds, tests actually pass | `commit-task` (if uncommitted) -> `mark-reviewed PASS` -> `integrate` |
| MINOR_FIX | obvious, local, low-risk; Opus fixes in the task worktree | edit -> `commit-task` -> re-review -> PASS |
| MAJOR_FIX | logic / API / security / test failure | `task new --repair-of <task file>` -> fill -> `repair` (same worker): 1st repair `--reason "<evidence>"` (routine), later repairs need the user's `--decision` |
| BLOCKED | missing credential / dependency / ambiguous requirement | critical: ask the user (`decision ask --kind blocker`), then `task-unblock --decision` |
| FAIL | unrecoverable | critical: ask the user (`decision ask --kind abandon`), then `--decision` |

For PASS on an uncommitted diff, run `commit-task` first (PASS requires commits), then `mark-reviewed`.

### Review report (write to a file, pass with `--report`)
```markdown
**Summary:** <one or two sentences: what the change does and whether it is right>

| Check | Result | Evidence |
|---|---|---|
| Done when | met / not met | <item -> where> |
| Tests | <cmd> exit <n> (re-run by Opus: yes/no) | <log or output line> |
| Scope | OK / <files> | |
| Correctness / security | OK / <issue> | `<path:line>` |

**Findings:** <numbered, each with path:line and severity; "none" if clean>
**Required fixes:** <for MINOR/MAJOR_FIX: exact list; otherwise "none">
```

## Integration review (after all tasks MERGED)
1. Combined diff: `git -C <integration worktree> diff <integration_base_sha>..HEAD`.
2. Interfaces between tasks line up; no duplicated helpers across tasks.
3. Hidden behavior changes, missing tests/docs, migration impact.
4. `scheduler.py verify --run <id>`; the result is appended to every task file. The run is DONE only when it passes.
