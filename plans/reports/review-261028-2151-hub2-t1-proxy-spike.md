# Review: hub2 T1, proxy spike (P0)

Verdict: **PASS**

## Checked
- `cd hub && npm test`: protocol 51, server 6, proxy 9 pass; `npm run typecheck` clean.
- wrangler.jsonc account-neutral (placeholder D1 id, no account_id/routes); DO uses `new_sqlite_classes` (free-plan path).
- Bearer check constant-time; every /spike route gated; 400/401/404/405/413 bodies use the ApiError shape.
- ComputerRelay: hibernation API, one socket (old closed 4000), pending map resolves on reply/close/timeout, ping/pong, malformed frames counted.
- Tests cover health, auth, hash bounds, D1, offline 503, round trip, replace, timeout 504, 413, echo-client script.

## Notes for P0-deploy / P2
- Workers freeze `performance.now()` during CPU-only work, so deployed `wall_ms` reads ~0. Measure PBKDF2 cost from `wrangler tail` CPU time / `exceededCpu` outcome instead.
- Echo client imports `undici` (resolved via wrangler's install) to send auth headers on the WebSocket handshake. P2b backend must declare undici or authenticate another way.
- 900 KB relay cap is spike-only; chunking in P2a.
