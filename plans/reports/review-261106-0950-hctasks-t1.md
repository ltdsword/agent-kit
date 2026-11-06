# Review hctasks T1 - board like the website run card (Opus)

Verdict: PASS

- board_data: goal, integration_branch, gate (PASS/FAIL/null from verify.exit_code), per task summary,
  depends_on, fix_rounds; problems as agentctl._run_snapshot (note cut to 200). Existing fields kept.
- board/main.js: header (title, run id, status), goal, Branch/Gate rows, task graph (roots › dependents when
  >= 520 px, one column narrower), node with id/title/worker, summary, status, fix N, needs; Problems with
  "Dn open"; Pending decisions kept. Theme colors all exist (herdr.d.ts); scroll list has an id.
- Whole suite 264 passed (Opus rerun). Live look at the end of the run.
