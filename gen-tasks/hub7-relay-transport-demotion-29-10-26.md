# Backend relay stops returning to a flapping transport (29/10/26)

## Goal
A relay transport that drops within 5 minutes of connecting is tried last for 15 minutes, and the backend logs when each transport connects.

## Read first
- `plans/261029-1700-hub7-relay-failover/plan.md` section **T2**: **the full spec** (work items, tests). Follow it exactly.
- `hub/server/src/relay.ts` (`run`, `runWebSocket`, `runLongPoll`, `setStatus`), `hub/server/test/server.test.ts` (`FakeProxy`, `startRelay`, the `relay client` describe block).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/src/relay.ts`
- `hub/server/test/server.test.ts`

**You must not edit:**
- Any other file: the other hub7 tasks own `hub/proxy/src/computer-relay.ts`, `hub/proxy/test/proxy.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/HttpHubClient.test.ts`; also `hub/protocol/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.agent-system/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/server`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install` or any download; `wrangler` (login/deploy/dev/secret) or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T2 is done.
- [ ] `cd hub/server && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/server && npx vitest run && npx tsc --noEmit -p .`: expect server tests and typecheck pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
