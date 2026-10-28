# Review: hub1 T2, hub backend server (phase B1)

Verdict: **PASS**

## Checked
- `npm test` (protocol 51 + server 6 tests, 88 assertions) and `npm run typecheck` pass on Node 24.
- Tests cover the phase minimum list: per-route auth (none/wrong kind/revoked), fixture replay into user
  views with schema checks, hub_status table, command lifecycle (DELIVERED, REJECTED retry, HELD 5 s,
  prompt expiry, long-poll wake), workspace lifecycle (90 s offline via fake clock, goodbye, duplicate 409,
  wiped DB known:false), isolation, SSE decision event.
- Security: bind refuses non-127.0.0.1 without `--i-know`; tokens stored/looked up as sha256; device vs
  connector kinds return 403; CORS from `AGENT_HUB_ORIGINS` only.
- Hashes: canonical JSON (sorted keys) in db.ts; document sha256 verified on upload.

## Minor (follow-up)
- Tests are 6 large scenario tests; failures will be harder to localize. Split when touching them next.
- Contract gap: no `internal_error` code; 500s reuse `bad_request`. Add to ERRORS in a protocol bump.
- PairRequest.name ignored (name fixed at `agent-hub pair --name`). Fine; document in hub-api.md.
- Cross-language canonical JSON parity (Python vs JS) unproven until M1; floats would differ (1.0 vs 1).
