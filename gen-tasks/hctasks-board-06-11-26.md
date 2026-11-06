# hctasks board: run board like the website's run card (06/11/26)

## Goal
The Herdr app run board shows what the website's run card shows: run title, id, status, goal, branch, gate,
the task graph (roots, then dependents) with each task's state, worker, summary, fix round and "needs", and
problems with their open decision.

## Read first
- `plans/261106-0935-hctasks/plan.md`.
- Website: `hub/web/src/features/workspace/RunCard.tsx`, `hub/web/src/lib/status.ts` (TASK_STATUS looks).
- Data rules to copy: `.agent-system/agentctl.py` `_run_snapshot` (~582: gate from verify.exit_code, problems
  for BLOCKED/FIX_REQUIRED tasks with their PENDING decision, run close_reason).
- `.agent-system/artifacts.py` `board_data`; `.agent-system/artifacts/board/main.js`; tests
  `.agent-system/tests/test_artifacts.py`. App UI rules: `~/.config/herdr-app/AGENTS.md` (UI section) and
  `~/.config/herdr-app/gpui-kit.d.ts` (read only).

## Steps
1. `board_data(state)` adds: `goal`, `integration_branch`, `gate` ("PASS" | "FAIL" | null from
   `state["verify"]["exit_code"]`), per task `summary`, `depends_on` (list), `fix_rounds` (int,
   `major_repairs`, default 0); `problems` exactly as `_run_snapshot` builds them but only
   `{task_id, type, decision_id, note}` with note cut to 200 chars. Keep every existing field. No packet text,
   env values or file contents.
2. `artifacts/board/main.js` redraw (same file, same data.js/board.json reading, 5 s refresh):
   - Header: title (14 px semibold), `Run <id>` (12 px dim), status as a small colored label (existing
     statusColor). Goal (13 px muted) when set. Two rows "Branch <integration_branch>", "Gate <PASS|FAIL|not run>".
   - "Tasks": roots = no depends_on; dependents = the rest. Width >= 520 px (track with on_size_change): two
     columns with a "›" column between; narrower: one column, roots then dependents.
   - Node (rounded card, border colored by state like the website: RUNNING working, FIX_REQUIRED/BLOCKED/FAILED
     blocked, PASSED/MERGED done, PENDING muted): line 1 `id` (dim, mono-like) + title (truncate) + worker
     (when not MERGED); line 2 summary (12 px muted, when set); line 3 status label, `fix N` when N > 0 and not
     MERGED, `needs T1, T2` when PENDING and depends_on.
   - "Problems" (when any): `<task_id or Run>: <type>` + note, and `<decision_id> open` when set.
   - Keep "Pending decisions" as today. Theme colors only, text 12-15 px, size_full, scroll, works at 320 px,
     `.id()` on scroll lists, no emojis, no setTimeout, never keep cx.
3. Tests: board_data new fields (gate PASS/FAIL/null, depends_on, fix_rounds, problems with decision id, note
   cut, no extra keys like packet/prompt); existing tests still pass; `herdr-app check` test on the board with a
   sample board.json that has dependents and a problem (skipped without herdr-app).

## Boundaries
**You may edit:** `.agent-system/artifacts.py` (board_data only), `.agent-system/artifacts/board/main.js`,
`.agent-system/tests/test_artifacts.py`.
**You must not edit:** scheduler.py, agentctl.py, decision panel, hub/**, docs, plans/**, gen-tasks/**,
.orchestrator/**, anything in `~/.config/herdr-app`.
**You may run:** `python3 -m pytest`, `herdr-app check <dir>` on copies in a temp dir, read-only git,
`git add`/`git commit` on your branch.
**You must not run:** `herdr-artifact publish|update|rm`, `herdr-app do`, `hc`, `herdr-task`; git
push/merge/rebase/reset/checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] board_data per step 1; board panel per step 2 passes `herdr-app check`; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
