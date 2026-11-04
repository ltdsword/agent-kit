# Review hcport T1 - adapter (Opus)

Verdict: PASS

- Contract C1/C2 met: `Hc` mirrors `Herdr` (+ agent_record/agent_list/agent_read/focus/server_running on both);
  REC normalized; states only from HUB_STATES (`error`/no status -> unknown, finished/not_found -> absent).
- `hc run` argv uses `--no-parent --no-notify --keep`, labels `herdr.space` + `agentkit.kind`, binary from
  `M.binary(kind)` after `--`; space.rename best effort; readiness waits for `reported` + idle/done with
  injectable sleep/clock; `agent_not_ready` marker kept for kitstart.
- `make_herdr` matrix per C2; `herdr_for(state)` + `herdr_backend` recorded on first live launch; all live
  call sites (launch, same-session prompt, wait blocked check + backend-specific hint, collect, status,
  cleanup) go through it; old runs default to legacy.
- Doctor: hc/herdr-app warn, herdr fail only for legacy, `herdr-session` replaces `herdr-env`; integration
  status only for legacy / HERDR_ENV. Order kept.
- Tests: 17 new fake-runner tests replaying the hc 0.1.17 samples; whole suite 209 passed (Opus rerun).
- Minor (accepted): `hc` missing with backend legacy is reported via level "ok"; fine.
