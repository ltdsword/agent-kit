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
