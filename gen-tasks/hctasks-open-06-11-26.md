# hctasks open: show the Artifacts panel when a run starts (06/11/26)

## Goal
When `run create` publishes the run board, the Herdr app shows its Artifacts side panel on the list (the new
board is at the top), so the person sees the run without hunting for it.

## Read first
- `plans/261106-0935-hctasks/plan.md` (side panel commands, why the list and not the board itself).
- `.agent-system/artifacts.py` (`enabled`, `_publish`, `publish_board`), `.agent-system/scheduler.py`
  `run_create` (the `publish_board` call site), `.agent-system/tests/test_artifacts.py`.

## Steps
1. artifacts.py: `show_panel(cfg, env=None, runner=subprocess.run) -> bool`: only when `enabled(cfg, env)`;
   runs, in order, `herdr-app do layout.select --stack panel-body --child artifacts`,
   `herdr-app do layout.select --stack artifacts --child artifacts-list`, `herdr-app do layout.show --id panel`
   (capture_output, text, shell=False, timeout=5). Stop at the first non-zero exit or exception; return whether
   all three succeeded. Never raises.
2. scheduler.py `run_create`: right after `publish_board` returned an id, call `artifacts.show_panel(...)`
   (guarded like the other artifacts calls; failure changes nothing).
3. Tests (fake runner): exact argv order; disabled -> no calls; first command failing -> stops, False; runner
   raising -> False; run create with a fake publish -> show_panel called once; publish failing -> not called.

## Boundaries
**You may edit:** `.agent-system/artifacts.py` (add show_panel only), `.agent-system/scheduler.py` (run_create
call site only), `.agent-system/tests/test_artifacts.py`.
**You must not edit:** board/decision panels, agentctl.py, hub/**, docs, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `herdr-app do`, `herdr-artifact`, `hc`, `herdr-task`; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] show_panel per step 1, called after the board publish; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
