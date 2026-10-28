# Review: hub3 T2, local backend v2 (`hub/server`)

Verdict: **PASS**

## Checked
- `npm test -w @agent-hub/server`: 8 pass. Typecheck: 0 errors.
- Assertion check (`src/auth.ts`):
  - Ed25519 signature using the pinned `proxy_public_key`, which must be 32 bytes;
  - payload validated against the schema;
  - `exp` within [now, now+120 s];
  - `cid`, `sub` and `rid` must match;
  - no relay frame means 401.
  - Tests cover a bad signature, an expired assertion, and a wrong cid/sub/rid.
- Commands take `by` from `assertion.sub`.
- Pairing and devices removed: `002-v2.sql` drops both tables, and no `pair`/`device` references remain in `src/`.
- Runs are upserted and survive a later snapshot. The sweep runs on start and hourly, and deletes decisions, events, documents and the run in one transaction.
- The workspace list keeps the 15-day rule, and `?all=true` returns everything.
- Relay (`src/relay.ts`):
  - transports tried in order: WS, then long-poll direct, then long-poll via `EnvHttpProxyAgent`;
  - backoff from 1 s to 60 s;
  - in-process `app.fetch` with the frame id bound;
  - stream chunks + end, cancel, and 413 for oversized bodies;
  - frames validated before sending.
- REPLY_SENT is derived as the spec says.

## Notes (minor, not blocking)
- The fallback that auto-streams large documents depends on a `Content-Length` header, and Hono's `c.json` doesn't set one. So a `documents/content` response over 900 KB streams only when the proxy sends `stream: true`. That matches the contract ("a `DocumentContent` response is sent with `stream: true`"). Added to the P2a spec: the proxy sets `stream: true` on `documents/content` requests.
