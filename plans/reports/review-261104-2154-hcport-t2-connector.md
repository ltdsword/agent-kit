# Review hcport T2 - connector (Opus)

Verdict: PASS (with one orchestrator fix applied before commit)

- C3 met: `_backends` order orchestrator.json backend -> config -> [Hc, Herdr]; `_herdr_record` returns
  (rec, state, backend), first non-absent/unknown wins, states forced into HUB_STATES; workspace fallback via
  `agent_list` by kind + resolved cwd; target = REC name or pane_id.
- No raw `["herdr", ...]` subprocess call left in agentctl.py; all 3 prompt-delivery paths use the finding
  backend's `agent_prompt`, HELD/retry + log lines unchanged; READY_STATES imported from scheduler.
- Snapshot workers use the run's `herdr_backend`, else probe both; watch/_orchestrator_alive use the same rule.
- **Fixed (MAJOR, security):** `_screen` scrubbed line by line, so a multi-line PEM block was no longer
  matched by PEM_RE and its body would reach the hub. Now scrubs the joined text then splits (old behaviour).
  Added `test_hc_screen_redacts_multiline_pem_block`.
- Minor (accepted): an hc agent with null status (unknown) plus legacy absent reports `absent`; liveness rule
  treats both the same.
- Tests: 9 worker tests + 1 review test; whole suite 219 passed (Opus rerun).
