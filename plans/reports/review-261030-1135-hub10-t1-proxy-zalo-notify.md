# Review: hub10 T1 proxy Zalo notify

Verdict: PASS

## Checked
- `zalo-sender.ts`: port of the user's bridge client: `{chat_id,text}` plain text, ≤2000 chars, 5 s abort, `redirect:manual`, 64 KB bounded read, success = 2xx + `ok:true`; results are bounded kinds, never token/URL/body. `Notifier` interface for future channels.
- Migration 0003: link codes, targets (UNIQUE user+chat, private/group, broken), monthly usage.
- Link code: 6 crypto-random digits (rejection sampling), 10 min, one per user.
- Webhook: constant-time secret check (401), parses `{message}` and `{result:{message}}`; code → upsert target, delete code, "✅ Connected" reply; private non-code → hint reply; group non-code → silent; unknown shape → logs top-level keys only (redacted).
- Notify: computer-key auth, owner via computers.user_id, format with Q/D ids + hash-route links, 2000-char cut with "+N more", per-target 3 attempts (1 s, 3 s) for 429/5xx/network, `rejected` → broken, quota reserved atomically (cap = limit − 50), released on failure; 503 when not configured.
- Status/test/unlink; admin `/admin/zalo/setup` calls setWebhook with proxy origin, returns only verification outcome/hint (secrets stripped).
- Offline alarm: set on socket close / after each poll, cleared on connect/poll/frames; fires once per offline period.
- All logs are fixed `{event}` JSON; 31 proxy tests + tsc pass (rerun by Opus).

## Opus fix
- Webhook parser accepts any-case `chat_type` and treats missing as private (body shape undocumented).

## Notes
- Each non-code private message to the bot costs one quota message (hint reply); acceptable at 50-user cap.
- `wrangler.jsonc` gets `HUB_WEB_URL`; the deploy config (`wrangler.local.jsonc`) must also carry `HUB_WEB_URL` and `ZALO_BOT_LINK` at rollout.
