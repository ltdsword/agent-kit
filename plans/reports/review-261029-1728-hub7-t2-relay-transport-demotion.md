# Review hub7 T2: relay transport demotion: PASS

- Diff: `hub/server/src/relay.ts` (+31), `hub/server/test/server.test.ts` (FakeProxy hooks + 2 tests). Scope OK.
- A transport ending < 5 min after connect (or never connected) is demoted 15 min; order = non-demoted
  (preferred first) then demoted; never skipped; all demoted → normal order. Uses injected clock.
- Logs `<iso> relay <transport> connected` for websocket and long-poll.
- Tests: demoted websocket tried last, back first after 16 min; 5-min-stable transport not demoted.
- Verified by orchestrator: server vitest 16/16, tsc clean.
- Housekeeping: the worker diff listed `hub/node_modules` (orchestrator's shared-deps symlink, not
  ignored as a symlink); removed before commit. Not part of the change.
- Unresolved: none.
