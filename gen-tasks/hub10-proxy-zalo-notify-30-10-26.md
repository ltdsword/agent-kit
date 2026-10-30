# Proxy: Zalo link codes, webhook, notify, offline alarm (30/10/26)

## Goal
The proxy links a user's Zalo chats through a 6-digit code sent to the bot (webhook), sends batched notifications from the computer to every linked chat with token-safe Zalo calls and quota protection, alerts the owner when a computer stays offline 10 minutes, and registers its own webhook through an admin route.

## Read first
- `plans/261030-1110-hub10-zalo-notifications/plan.md`: sections **User decisions**, **Zalo Bot facts**, **Contract**, **Message format** and **T1**: **the full spec** (work items, tests). Follow it exactly.
- `hub/proxy/src/index.ts` (routing, session/admin/computer auth, CORS), `hub/proxy/src/computer-relay.ts` (connection lifecycle, Durable Object), `hub/proxy/src/env.ts`, `hub/proxy/migrations/0002_v2.sql`, `hub/proxy/test/proxy.test.ts` (harness), `hub/protocol/src/api.ts` (`NOTIFY_ROUTES`, `COMPUTER_ROUTES.notify`, `ADMIN_ROUTES.zaloSetup`), notification types in `hub/protocol/src/types.gen.ts`, `docs/hub-api.md`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/proxy/src/**`
- `hub/proxy/migrations/0003_notify.sql`
- `hub/proxy/test/**`
- `hub/proxy/wrangler.jsonc`
- `docs/hub-api.md`

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
- [ ] Every work item and test in spec section T1 is done.
- [ ] `cd hub/proxy && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/proxy && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
