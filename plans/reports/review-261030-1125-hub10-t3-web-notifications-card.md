# Review: hub10 T3 web Notifications card

Verdict: PASS

## Checked
- Account menu: Notifications item (bell + green/grey dot) only when `zalo_configured`; opens floating card anchored like the menu; Escape / outside tap / ✕ close.
- Card not linked: QR SVG (qrcode-generator) + Open in Zalo, auto-created 6-digit code with Copy + mm:ss countdown, New code when expired, group hint; polls status every 3 s while unlinked.
- Linked: targets (Private/Group, Needs reconnect), Remove, Send test, "This month: N / limit", Connect another chat.
- HttpAuthClient uses NOTIFY_ROUTES with session token; 401 → signs out; mock client in-memory.
- 71 web tests + tsc + vite build pass (rerun by Opus).

## Opus fix
- "Connected" notice detected by a newer `linked_at` instead of a larger target count, so relinking a broken chat (same chat, upsert) also shows Connected.
