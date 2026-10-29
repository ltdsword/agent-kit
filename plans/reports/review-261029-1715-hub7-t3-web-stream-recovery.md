# Review hub7 T3: web stream recovery: PASS

- Diff: `hub/web/src/api/http/HttpHubClient.ts` (+7/-1), test (+41). Scope OK (owned paths only).
- Backoff cap 30 s → 5 s; on reconnect after `streamDown`, refetches every workspace of that computer once.
- Test: fake timers, stream fails twice, attempts at 0 / 1 s / 3 s, decisions refetched after reconnect.
- Verified by orchestrator: web vitest 47/47, tsc clean (worker-1 worktree, shared node_modules linked).
- Note: refetch reuses `refreshWorkspaceAll` (same as the 10 s poll), errors swallowed like the poll.
- Unresolved: none.
