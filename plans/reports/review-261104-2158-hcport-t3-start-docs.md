# Review hcport T3 - start/continue + docs (Opus)

Verdict: PASS

- C4 met: `main` uses `make_herdr(cfg, env)`; `save_session` records `backend` on every launch path;
  `live_agent` on `agent_record`; `launch` focuses via `herdr.focus`; hc path has no server wait / execvp,
  `inside` = HC_TERMINAL_ID; legacy path unchanged (when-ready helper + attach only for legacy).
- One orchestrator per workspace: `find_orchestrator` checks both backends by name + kind/cwd fallback;
  other backend -> exit 1 naming it and `agent-kit continue`; same backend -> focus.
- `stop_for_continue` closes via `workspace_close(workspace_id)` for both; `remember_session` returns the
  saved chat for hc.
- Docs: README / GUIDE / .agent-system README describe the app as default, `herdr.backend` auto/hc/legacy,
  `hc read --lines 80`, spaces `<run>-worker-N`; troubleshooting rows no longer cite HERDR_ENV.
- Minor (accepted): `find_orchestrator` rebuilds `make_herdr` instead of using the caller's backend; the
  "already running" block is duplicated in the when-ready and main paths; GUIDE keeps `ctrl+b w` (old key).
- Tests: 4 new TestStart cases; whole suite 213 passed in the worktree (Opus rerun).
