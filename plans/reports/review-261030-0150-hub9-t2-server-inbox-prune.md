# Review: hub9 T2 server inbox prune

Verdict: PASS

## Checked
- `upsertDecisions` prunes run `inbox` to newest 100 by opened_at; skips `PENDING` (open); deletes decision rows + their `.orchestrator/runs/inbox/decisions/Dn.md` documents; other runs untouched.
- connector-api publishes decision/history events for pruned refs and document events for deleted docs.
- docs/hub-api.md: kinds plan/review/other, inbox run, HELD→FAILED (10 min) prompt semantics.
- 18 server tests + tsc pass (rerun by Opus).

## Notes
- If a connector still holds >100 (kit not updated), pruned rows get re-sent and re-pruned each sync; bounded, harmless; resolved once kit T1 prunes locally.
