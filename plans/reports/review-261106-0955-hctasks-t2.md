# Review hctasks T2 - open the Artifacts panel at run start (Opus)

Verdict: PASS

- `artifacts.show_panel`: gated by `enabled`, three `herdr-app do` commands in order, stops at first failure,
  never raises. Called in `run_create` only after `publish_board` returned an id.
- Tests: argv order, disabled, failure stop, runner raising, call/no-call from run create.
- Whole suite passed (Opus rerun). Live look before the merge decision.
