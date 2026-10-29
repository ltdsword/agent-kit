# Web stream recovers fast and catches up (29/10/26)

## Goal
The web reconnects its live stream with backoff capped at 5 s and refetches the computer's workspaces once after a reconnect, so missed events show at once.

## Read first
- `plans/261029-1700-hub7-relay-failover/plan.md` section **T3**: **the full spec** (work items, tests). Follow it exactly.
- `hub/web/src/api/http/HttpHubClient.ts` (`streamLoop`, `startPoll`, `refreshWorkspaceAll`, `replaceWorkspace`), `hub/web/src/api/http/HttpHubClient.test.ts` (fake fetch pattern).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/web/src/api/http/HttpHubClient.ts`
- `hub/web/src/api/http/HttpHubClient.test.ts`

**You must not edit:**
- Any other file: the other hub7 tasks own `hub/proxy/src/computer-relay.ts`, `hub/proxy/test/proxy.test.ts`, `hub/server/src/relay.ts`, `hub/server/test/server.test.ts`; also `hub/protocol/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.agent-system/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/web`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install` or any download; `wrangler` (login/deploy/dev/secret) or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T3 is done.
- [ ] `cd hub/web && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/web && npx vitest run && npx tsc --noEmit -p .`: expect web tests and typecheck pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
