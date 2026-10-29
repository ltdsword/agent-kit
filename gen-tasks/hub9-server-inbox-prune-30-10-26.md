# Backend: prune the questions inbox to 100 (30/10/26)

## Goal
The backend keeps only the newest 100 decisions of the `inbox` run per workspace (never dropping open ones) with their decision documents, and docs/hub-api.md describes the new document kinds, the inbox run and HELD/FAILED prompt delivery.

## Read first
- `plans/261030-0141-hub9-questions-docs-delivery/plan.md`: sections **User decisions**, **Contract** and **T2**: **the full spec** (work items, tests). Follow it exactly.
- `hub/server/src/db.ts` (`upsertDecisions`, document storage), `hub/server/src/connector-api.ts` (decision/document sync and events), `hub/server/test/server.test.ts` (fixtures), `docs/hub-api.md`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/src/db.ts`
- `hub/server/src/connector-api.ts`
- `hub/server/test/server.test.ts`
- `docs/hub-api.md`

**You must not edit:**
- Any other file; also `hub/protocol/**` and `hub/web/src/api/types.ts` (contract, fixed), `plans/**`, `gen-tasks/**`, `.orchestrator/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/server`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `wrangler` or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T2 is done.
- [ ] `cd hub/server && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/server && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
