# hcnext artifacts repair 1: confirm the resolved blocker (05/11/26)

## Goal
Your blocker (install.sh does not ship artifacts.py/artifacts/) is resolved. The person approved the change
(D3/D4) and Opus already applied it plus review fixes in your worktree. Only confirm the suite is green.

## Already done by Opus in your worktree (do not change or revert)
- `.agent-system/scripts/install.sh`: `artifacts.py artifacts` added to the copied file list.
- `.agent-system/scheduler.py`: `import artifacts` optional (`artifacts = None` on ImportError); call sites guarded.
- `.agent-system/artifacts/decision/main.js`: `.id(...)` on every clickable element and the options list;
  one reply per card. `.agent-system/artifacts/board/main.js`: `.id("rows")` on the scroll list.

## Steps
1. Read the diff (`git diff`) to see the state; edit nothing.
2. Run the command below and write the report with status "done", the real exit code, and
   files_changed listing every changed file (including install.sh).

## Boundaries
**You may edit:** nothing.
**You may run:** `python3 -m pytest -q .agent-system/tests`, read-only git.
**You must not run:** hc, herdr*, herdr-artifact publish/update/rm; git commit/push/merge/reset/checkout.

## Done when
- [ ] Report written with status done and the suite's real exit code.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
