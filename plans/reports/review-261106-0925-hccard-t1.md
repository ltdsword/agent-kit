# Review hccard T1 - cleanup keeps cards shown in layouts (Opus)

Verdict: PASS

- `shown_in_layouts(env)`: walks `<HERDR_APP_HOME or ~/.config/herdr-app>/layouts/*.json`, collects `content.mod`
  values `art-*`; bad files skipped; never raises.
- `remove` skips shown ids with one stderr line; others removed as before. Only caller (scheduler cleanup) unchanged.
- Tests: shown kept, others removed, broken layout ignored, no layouts dir. Whole suite 263 passed (Opus rerun).
