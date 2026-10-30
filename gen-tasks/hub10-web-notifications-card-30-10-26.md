# Website: Notifications floating card (30/10/26)

## Goal
The account menu has a Notifications item that opens a small floating card guiding the user to open the Zalo bot (QR code and Open in Zalo button) and send a 6-digit code, switches to Connected when the link appears, and then lists linked chats with Send test, Remove and the monthly usage.

## Read first
- `plans/261030-1110-hub10-zalo-notifications/plan.md`: sections **User decisions**, **Zalo Bot facts**, **Contract**, **Message format** and **T3**: **the full spec** (work items, tests). Follow it exactly.
- `hub/web/src/auth/AccountMenu.tsx`, `hub/web/src/auth/HttpAuthClient.ts`, `hub/web/src/auth/MockAuthClient.ts`, `hub/web/src/auth/types.ts`, `hub/web/src/auth/AuthProvider.tsx`, `hub/web/src/components/Icon.tsx`, existing auth tests, `hub/protocol/src/api.ts` (`NOTIFY_ROUTES`), notification types in `hub/protocol/src/types.gen.ts`; `qrcode-generator` is installed (`node_modules/qrcode-generator/qrcode.d.ts`).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/web/src/auth/**`
- `hub/web/src/components/**`

**You must not edit:**
- Any other file; also `hub/protocol/**` (contract, fixed), `package.json`/lock files, `plans/**`, `gen-tasks/**`, `.orchestrator/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside your package; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `wrangler` or `vercel`; anything that talks to Cloudflare, Vercel or Zalo (mock `fetch` in tests);
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (bot token, webhook secret, keys, passwords); never put the Zalo token or request URL in an error or log.

## Done when
- [ ] Every work item and test in spec section T3 is done.
- [ ] `cd hub/web && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/web && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (30/10/26 11:12)

- Status: **blocked** (worker worker-3, branch `agent/hub10-t3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported: none
- Risks:
  - The required qrcode-generator package is declared in hub/web/package.json but is absent from hub/web/node_modules, including the specified qrcode.d.ts. The task forbids package installation or downloads, so the QR implementation cannot proceed as specified.
- Not done:
  - T3 implementation and tests, and the Run these command, were not performed because the required QR dependency is missing.
- Full diff: `.orchestrator/runs/hub10/reports/T3.diff`

## Decision D1 needed (blocker) (30/10/26 11:13)

**T3 blocked: QR library looked for in the wrong folder**

Worker-3 stopped because it could not find the qrcode-generator library in hub/web/node_modules. It is installed: npm put it in the shared hub/node_modules, and the website imports resolve it from there. Re-dispatch T3 with that note?

- `A`: Re-dispatch with the note (recommended)
- `B`: Leave T3 blocked

Waiting for the user's answer in chat.

## Decision D1 answered by the user (30/10/26 11:15)

- Choice: **A**: Re-dispatch with the note
- User's words (hub): "Re-dispatch with the note"

## Worker result - attempt 2 (30/10/26 11:21)

- Status: **done** (worker worker-3, branch `agent/hub10-t3-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/web/src/auth/AccountMenu.test.tsx`, `hub/web/src/auth/AccountMenu.tsx`, `hub/web/src/auth/HttpAuthClient.test.ts`, `hub/web/src/auth/HttpAuthClient.ts`, `hub/web/src/auth/MockAuthClient.ts`, `hub/web/src/auth/NotificationsCard.tsx`, `hub/web/src/auth/types.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub10/reports/T3.diff`

````text
 hub/web/src/auth/AccountMenu.test.tsx   | 141 ++++++++++++++++++++++++
 hub/web/src/auth/AccountMenu.tsx        |  46 +++++++-
 hub/web/src/auth/HttpAuthClient.test.ts |  38 +++++++
 hub/web/src/auth/HttpAuthClient.ts      |  49 ++++++++-
 hub/web/src/auth/MockAuthClient.ts      |  48 +++++++-
 hub/web/src/auth/NotificationsCard.tsx  | 189 ++++++++++++++++++++++++++++++++
 hub/web/src/auth/types.ts               |   6 +
 7 files changed, 511 insertions(+), 6 deletions(-)
````

(diff is 641 lines; read the full diff file)

## Review round 2: PASS (30/10/26 11:21)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: fdae58c8623e, commits fdae58c8623e
- Notes: card states, polling, client OK; Opus: relink detection

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

## Integration: merged (30/10/26 11:21)

- On `agent/integration-hub10` at ff20358b2fd9; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub10/logs/post-merge-T3-a2.log`)

## Final gate: PASS (30/10/26 11:26)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub10 at cb889eb1c8b5 (log `.orchestrator/runs/hub10/logs/verify-1793334334.log`)
- Task MERGED; run DONE
