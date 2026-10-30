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
