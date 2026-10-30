# Review: hub10 T2 server notifier

Verdict: PASS

## Checked
- `notifications` table = dedupe + outbox; PENDING decision enqueued once (INSERT OR IGNORE); opened > 1 h ago or in future → recorded as sent (no flood on resync / fresh DB).
- FAILED ack for prompt/reply → `prompt_failed`.
- Flush 20 s after first unsent item, ≤50 items, POST `/computers/:c/notify` with computer key via EnvHttpProxyAgent; 204 or 503 `zalo_not_configured` → sent; network/other → retry 60 s; >1 h → dropped with log. No key logged.
- Relay `endpoint` exported as `computerEndpoint` (rename only).
- Tests: delay, dedupe, burst of 3, prompt_failed, retry + drop, 503.

## Opus fix
- `itemFor` skips a decision no longer PENDING at flush time (answered during the 20 s wait → no stale notification).

## Notes
- 4xx from proxy (bad key/body) retries every 60 s up to the 1 h TTL; bounded, acceptable.
- 24 server tests + tsc pass (rerun by Opus).
