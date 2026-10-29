# Review: hub8 T1 web stream watchdog

Verdict: PASS

## Checked
- 45 s silence watchdog per stream attempt; timer cleared in finally; reader cancelled; outer abort detaches.
- visibilitychange/online listeners added in constructor, removed in dispose(); restart aborts streams, clears polls, resyncs, refetches.
- Panel loads via Promise.allSettled; per-resource 5 s retry timers keyed workspace+resource; cleared when computer offline, on success, on dispose. Connection 'lost' while retries pending.
- D2: initial workspace list retried every 5 s until first success; `loaded` no longer set true on failure, so home shows skeleton instead of "No workspaces yet".
- Tests: 54 web tests + tsc pass (rerun by Opus).

## Out of worker scope (D4 = A)
- WorkspacePage.tsx shows "Connecting…" until `loaded`; added by Opus in integration.

## Unresolved
- Root cause of drops is the host network (Connect Timeout to Cloudflare); client now tolerates it, cannot prevent it.
