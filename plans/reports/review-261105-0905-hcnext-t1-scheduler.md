# Review hcnext T1 - scheduler: Codex startup, events, alerts (Opus)

Verdict: PASS (with two orchestrator fixes applied before commit)

- C1: `check_for_update_on_startup=false` always; readiness loop reads the screen every 2 s, answers
  "Hooks need review" by moving from the selected line to "Continue without trusting" (keys computed from the
  screen), update prompt -> esc; trust prompts never touched; `auto_answered` recorded; `Hc.keys`.
- C2: `Hc.wait_change` on `hc events --json` (snapshot skipped, terminal/data.address match, select bounded by
  injected clock, child always terminated, error -> sleep); `wait` uses it for hc, sleep for legacy; workers get
  `agentkit.run` / `agentkit.slot` labels.
- C3: `local_alert` gated by `herdr.alerts`, HC_TERMINAL_ID and herdr-task; called from decision_ask, wait
  (blocked) and report (report already requires DONE); validate_config checks bool alerts/artifacts.
- **Fixed (MAJOR, test isolation):** the suite sent REAL alerts to the person's app ("Decision D2 needs you",
  "Run formatter?") because tests inherit HC_TERMINAL_ID from the worker's app terminal. Added
  `.agent-system/tests/conftest.py` removing HC_TERMINAL_ID/HERDR_ENV. Proof: full suite with HC_TERMINAL_ID set
  and a logging fake `herdr-task` first on PATH -> 0 calls. (conftest.py is outside T1's owned paths: Opus fix.)
- **Fixed (MINOR, found live):** `Hc.workspace_close` left the app space behind (empty spaces piled up and the
  app started idle Assistants in them). Now also `herdr-app do space.close --id <id> --confirmed true`, best
  effort; test asserts the argv.
- Minor (accepted): `wait` alerts once per blocked agent per wait call (a re-run wait alerts again); hooks
  answer is tried once per launch.
- Tests: whole suite 233 passed (Opus rerun with the fixes).
