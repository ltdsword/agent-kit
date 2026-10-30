# Backend: notification outbox and triggers (30/10/26)

## Goal
The backend notices new open questions/decisions (opened within the last hour) and prompts that failed delivery, deduplicates them in a notifications outbox, and sends them in 20-second batches to the proxy's notify route with the computer key, retrying while the proxy is unreachable and dropping items after an hour.

## Read first
- `plans/261030-1110-hub10-zalo-notifications/plan.md`: sections **User decisions**, **Zalo Bot facts**, **Contract**, **Message format** and **T2**: **the full spec** (work items, tests). Follow it exactly.
- `hub/server/src/connector-api.ts` (decision sync, ack), `hub/server/src/db.ts`, `hub/server/src/relay.ts` (proxy endpoint + proxy-aware fetch), `hub/server/src/app.ts`, `hub/server/src/cli.ts`, `hub/server/src/config.ts` (computer.json), `hub/server/test/` (fixtures), `hub/protocol/src/api.ts` (`COMPUTER_ROUTES.notify`), `NotifyRequest` in `hub/protocol/src/types.gen.ts`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/src/notifier.ts`
- `hub/server/src/db.ts`
- `hub/server/src/connector-api.ts`
- `hub/server/src/app.ts`
- `hub/server/src/cli.ts`
- `hub/server/src/relay.ts`
- `hub/server/test/**`

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
- [ ] Every work item and test in spec section T2 is done.
- [ ] `cd hub/server && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/server && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
