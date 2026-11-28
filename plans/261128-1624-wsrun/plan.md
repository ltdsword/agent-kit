# wsrun: scheduler runs in multi-repo workspaces + pchecks minors (28/11/26)

## Why
- 27/11, BanCaZagooMW.workspace: `run create` failed with "task files must be tracked and unmodified at
  integration base". In workspace mode task files live in the workspace `gen-tasks/` (the workspace is never a
  git repo, `project_root_for`), but `_task_source_issues` checks them with git in the project repo.
- Earlier BanCaZagooMW runs (grand, refactor, p3m, p3pay) got past it only by committing temporary task files
  into the company repo ("add temporary ... task packets (remove before merge)"). On 27/11 the run was skipped and
  Opus coded LuckyBall directly.
- Today's workspace tests pass by accident: `WorkspaceBase` packets also exist, same text, in the test repo.
- pchecks known issues (gen-tasks/pchecks-scheduler-24-11-26.md): `check_start` skips the live-checks refusal
  when `hc ls` fails (`agent_list() or []`); the gate command is joined with `" ".join` (no shell quoting).

## Decisions
- Workspace mode: the guard checks that task files and their Read-first `plans/`/`gen-tasks/` files exist in the
  workspace (resolved against `workspace_root`); no git checks. Workers already read the task file by its absolute
  workspace path (`_prompt_text`), so there is no stale-copy risk the git check was protecting against.
- In-repo mode: unchanged (task files must be committed and unmodified at the base).
- Separate error message per mode, so the fix is obvious.
- `check_start`: `agent_list()` returning `None` while checks are recorded as running -> refuse (safe side).
- `shlex.join` for the gate command in check prompts.

## Tasks
- T1 scheduler + tests (`scheduler.py`, `tests/test_scheduler.py`, `tests/test_checks.py`):
  gen-tasks/wsrun-scheduler-28-11-26.md. One task: all changes are in one file.

## After
- `install.sh update --folder` on the workspaces (BanCaZagooMW, cms-migrate, ...) to ship this and pchecks.
- Drop the "temporary task packets" workaround in BanCaZagooMW (those commits stay in its history).
