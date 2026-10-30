# hub10: Zalo notifications for questions, decisions and problems

Requested 30/10/26 10:26-11:05 from the terminal. Applies to every hub install: whoever runs a
proxy configures their own Zalo Bot; without a bot token the feature is hidden.

## User decisions (verbatim)
- "ok next step is getting me to know when a question/decision comes or when a run completes.
  Actually in the final decision we have the final report + diff so i think the "run complete"
  notification is trivial."
- "How about Zalo Bot? it can send 3000 msg a month for free user. Moreover it only need a ChatId
  and Bot Token to do that."
- "We do so that everyone can use that"
- "i approve your plan already" (link-code flow on the proxy webhook, group support, separate hub
  bot, token-safe logging, sender interface, quota protection; events: new question, new decision,
  prompt not delivered, computer offline > 10 min).
- "when clicking in "Notification" in the profile, a small floating card will appear. It will
  guide user to scan QR and type in the code to the bot."

## Zalo Bot facts (official docs + the user's working bridge, demo-testing-monitoring)
- Send: `POST https://bot-api.zaloplatforms.com/bot<TOKEN>/sendMessage`, JSON `{"chat_id","text"}`,
  plain text (no parse_mode), 1-2000 characters. Success = HTTP 2xx **and** body `ok:true`; HTTP 200
  with `ok:false` is a rejection (`error_code`, `description`). No redirects, 5 s timeout.
- The token is in the URL: never log the URL, the request, raw fetch errors or response bodies.
- A `chat_id` exists only after the user (or a group member) messages the bot; it is read from the
  incoming update (`message.chat.id`, `message.chat.chat_type` PRIVATE|GROUP,
  `message.from.display_name`, `message.text`). No lookup by phone.
- Webhook: `setWebhook {url, secret_token}`; Zalo sends header `X-Bot-Api-Secret-Token` on every
  update. Webhook and getUpdates are mutually exclusive.
- Basic plan: 3 bots, 50 users per bot, 3,000 messages/month, 3 group chats (Beta).
- The exact webhook body is not documented; parse both `{message:{...}}` and
  `{result:{message:{...}}}` / `{event_name, message}` shapes, and log (without token) the top-level
  keys of an unknown shape so it can be pinned after the first real event.

## Contract (fixed by Opus before dispatch)
- Schema `$defs`: `NotifyKind`, `NotifyItem`, `NotifyRequest`, `NotificationTarget`,
  `NotificationStatus`, `ZaloLinkCode` (protocol.schema.json, types.gen.ts, kit schema copy).
- Routes (`hub/protocol/src/api.ts`, all under `/api/v1`):
  - `COMPUTER_ROUTES.notify`: `POST /computers/:c/notify` body `NotifyRequest`, computer-key auth
    (same check as connect), 204. 
  - `NOTIFY_ROUTES` (session auth): `GET /notifications` → `NotificationStatus`;
    `POST /notifications/zalo/code` → `ZaloLinkCode`; `POST /notifications/test` → 204 (sends
    "🔔 Agent Hub test: notifications work." to every target of the user; 409 `no_targets` when none);
    `DELETE /notifications/targets/:target` → 204.
  - `ADMIN_ROUTES.zaloSetup`: `POST /admin/zalo/setup` (admin key) → the proxy calls Zalo
    `setWebhook` with url `<proxy origin>/api/v1/zalo/webhook` and `ZALO_WEBHOOK_SECRET`, and
    returns `{ok, outcome, hint}` from Zalo's `verification` (no token in the response or logs).
    So the bot token never leaves Cloudflare.
  - `NOTIFY_ROUTES.webhook`: `POST /zalo/webhook`, no session; header must equal
    `ZALO_WEBHOOK_SECRET` (constant-time) else 401; always 200 for valid-secret requests.
- Proxy config: secrets `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`; vars `ZALO_BOT_LINK` (the bot's
  share link, from the bot's QR), `HUB_WEB_URL` (e.g. https://agent-hub-psi-five.vercel.app),
  optional `ZALO_MONTHLY_LIMIT` (default 3000). Zalo is "configured" when token, secret and link are
  all set.
- Deep link of a decision: `${HUB_WEB_URL}/#/w/<ws>/d/<run>/<decision>`; prompt_failed links to
  `${HUB_WEB_URL}/#/w/<ws>`.
- Web dependency `qrcode-generator@1.4.4` already installed (renders the bot link as a QR SVG).

## Message format (plain text, ≤2000 chars, one message per flush)
```
🔔 Agent Hub
agent-kit · Q7 question
Push hub/plan now?
https://…/#/w/ws_…/d/inbox/D7

agent-kit · hub10 D2 decision
Finish run hub10?
https://…/#/w/ws_…/d/hub10/D2
```
- Inbox decisions show as `Q<n>`; run decisions as `<run> D<n>`; prompt_failed as
  "Your message was not delivered (Opus stayed busy 10 min). Open the hub to resend." Offline:
  "⚠️ <computer name> has been offline for 10 minutes. Questions can't reach you until it is back."
- Titles cut to 120 chars; when over 2000 chars, drop trailing items and end with "+N more in the
  hub".

## T1 proxy (Cloudflare Worker)
Owned: `hub/proxy/src/**`, `hub/proxy/migrations/0003_notify.sql` (new), `hub/proxy/test/**`,
`hub/proxy/wrangler.jsonc`, `docs/hub-api.md`.
1. Migration `0003_notify.sql`:
   - `notify_link_codes(code TEXT PK, user_id, expires_at INTEGER)`;
   - `notify_targets(id TEXT PK, user_id, channel 'zalo', chat_id, chat_type, display_name,
     linked_at, broken INTEGER DEFAULT 0, UNIQUE(user_id, chat_id))`;
   - `notify_usage(month TEXT PK 'YYYY-MM', sent INTEGER)`.
2. `src/zalo-sender.ts`: `sendZaloText(env, chatId, text)` → `{ok:true} | {ok:false, kind:
   'rejected'|'rate_limited'|'server'|'network'|'timeout'}`; port of the bridge client rules above
   (5 s AbortSignal timeout, `redirect:'manual'`, bounded 64 KB body read, 2000-char check, errors
   never contain token/URL/chat id/body). A `Notifier` type (`send(target, text)`) wraps it so other
   channels can be added later.
3. `src/notify.ts`:
   - Link code: 6 digits, crypto-random, 10 min, one live code per user (new one replaces old);
     expired codes deleted on each create.
   - Webhook: verify secret; parse update; if text (trimmed) is a live code → upsert target for that
     user (private or group, display name; chat_type GROUP → group), delete the code, reply
     "✅ Connected to Agent Hub (<username>). Questions and decisions will arrive here." Otherwise
     reply once "Send the 6-digit code shown in Agent Hub → Notifications." (no reply for group
     messages without a code). Never echo the token or the code back in logs.
   - `/computers/:c/notify`: computer-key auth; validate `NotifyRequest`; owner = `computers.user_id`;
     format (above); send to each non-broken target; on `rejected` mark target broken; on
     `rate_limited|server|network|timeout` retry twice (1 s, 3 s) then give up; count each successful
     send in `notify_usage`; refuse sends past `ZALO_MONTHLY_LIMIT - 50` (reserve) with a log line.
     Returns 204 even when Zalo fails (the backend must not retry forever); 503 `zalo_not_configured`
     when not configured; 400 on invalid body.
   - Status/test/unlink routes per contract; a test send clears `broken` on success.
   - `POST /admin/zalo/setup` per contract (admin auth like the other admin routes).
4. Computer offline: in `computer-relay.ts`, when the computer's last connection drops, set a Durable
   Object alarm for +10 min; on reconnect clear it; when the alarm fires and the computer is still
   offline, notify the owner once (offline message) until it reconnects.
5. `index.ts`: route the new paths (CORS like other user routes; webhook without CORS); `env.ts` adds
   the new vars/secrets; `wrangler.jsonc` adds `HUB_WEB_URL` var (`ZALO_BOT_LINK` left to deploy).
6. `docs/hub-api.md`: notification routes, setup steps (secrets, setWebhook), message format.
7. Tests (`proxy.test.ts`, fetch to Zalo mocked): link code create/replace/expire; webhook bad secret
   401; code → private target + reply; group target; unknown text reply; notify auth, batching
   format, 2000-char cut, broken on `ok:false`, retry on 5xx, quota stop; status/test/unlink;
   offline alarm fires once and is cleared by reconnect; a test asserting no log line contains the
   token.

## T2 backend (server)
Owned: `hub/server/src/notifier.ts` (new), `hub/server/src/db.ts`, `hub/server/src/connector-api.ts`,
`hub/server/src/app.ts`, `hub/server/src/cli.ts`, `hub/server/src/relay.ts` (only to share the HTTP
agent/endpoint helper if needed), `hub/server/test/**`.
1. `db.ts`: table `notifications(workspace_id, ref TEXT, created_at, sent_at NULL, PRIMARY KEY
   (workspace_id, ref))` used for dedupe and as the outbox; `ref` = `decision:<run>/<id>` or
   `command:<id>`.
2. Triggers:
   - `PUT .../decisions`: a decision with `local_status == 'PENDING'` that has no notifications row
     and was opened within the last hour → enqueue kind `question` (run `inbox`) or `decision`.
     (Older ones are recorded as already sent, so a fresh database or resync never floods.)
   - `POST .../commands/:id/ack` with `FAILED` for a `prompt` or `reply` command → enqueue
     `prompt_failed`.
3. `notifier.ts`: flush the outbox 20 s after the first unsent item (so a burst becomes one
   request; at most 50 items per request); POST `NotifyRequest` to
   `<proxy_url>/api/v1/computers/<id>/notify` with the computer key (same proxy-aware fetch as the
   relay); on 204 set `sent_at`; on 503 `zalo_not_configured` mark sent (silently, feature off); on
   network/5xx retry every 60 s; items older than 1 h unsent are dropped with a log line. Skip
   cleanly when `computer.json` is missing (relay off). Never log the computer key.
4. Wiring in `app.ts`/`cli.ts`; injected clock for tests.
5. Tests: new PENDING decision → one request after 20 s with the right item; same decision again →
   nothing; ANSWERED/old decisions → nothing; burst of 3 → one request; FAILED prompt ack →
   prompt_failed; proxy down → retried, dropped after 1 h; 503 → marked sent.

## T3 website
Owned: `hub/web/src/auth/**`, `hub/web/src/components/**`.
1. Account menu: a **Notifications** item (bell icon) above Change password, with a status dot
   (green when a target is linked, grey otherwise). Hidden when `zalo_configured` is false.
2. Clicking opens a **small floating card** (anchored like the account menu, dismiss on Escape /
   outside tap / ✕):
   - Not linked: step 1 "Open the bot": QR code (SVG from `bot_link` via `qrcode-generator`) plus an
     **Open in Zalo** button (`bot_link`; on a phone the button is the way, the QR is for a second
     screen). Step 2 "Send this code": the 6-digit code large, with **Copy**, and "expires in mm:ss";
     **New code** when expired. Hint: "Works in a group too: add the bot to the group and send the
     code there."
   - While open and not yet linked, poll `GET /notifications` every 3 s; when a new target appears,
     show "✅ Connected (display name)".
   - Linked: list targets (name, Private/Group, "needs reconnect" when broken, **Remove**), **Send
     test**, "This month: N / limit", and **Connect another chat** (shows the steps again).
   - Errors as short inline text.
3. `HttpAuthClient`/`MockAuthClient`/types: `notificationStatus()`, `zaloLinkCode()`,
   `sendTestNotification()`, `removeNotificationTarget(id)` using `NOTIFY_ROUTES`; mock keeps state in
   memory (link "connects" after 5 s in the mock).
4. Tests: card states (not configured hidden, not linked shows QR + code, linked list, broken label),
   polling switches to connected, test/remove call the client, code countdown/expiry.

## Rollout (each step a hub decision)
1. Merge locally. 2. User creates a separate hub bot (Basic) and gives its share link; user types
`! npx wrangler secret put ZALO_BOT_TOKEN` themselves; Opus generates and stores
`ZALO_WEBHOOK_SECRET` without printing it (random bytes piped into `wrangler secret put`); apply D1
migration; deploy the proxy; call `POST /admin/zalo/setup` with the admin key (the proxy registers
its own webhook; the token never leaves Cloudflare). 3. Restart backend. 4. Deploy website.
5. User links Zalo from the phone and sends a test.
