# Proxy never routes into a dead or replaced socket (29/10/26)

## Goal
The proxy Durable Object routes relay requests only to a live WebSocket (heard from within 75 s), a long-poll hello replaces open sockets, and a closing socket fails only its own requests.

## Read first
- `plans/261029-1700-hub7-relay-failover/plan.md` section **T1**: **the full spec** (work items, tests). Follow it exactly.
- `hub/proxy/src/computer-relay.ts` (`relay`, `isOnline`, `connect`, `receiveFrames`, `processFrame`, `webSocketClose`, `cancel`), `hub/proxy/test/proxy.test.ts` (the DO unit test that builds `ComputerRelay` with a fake state, `connectClient`).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/proxy/src/computer-relay.ts`
- `hub/proxy/test/proxy.test.ts`

**You must not edit:**
- Any other file: the other hub7 tasks own `hub/server/src/relay.ts`, `hub/server/test/server.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/HttpHubClient.test.ts`; also `hub/protocol/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.agent-system/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/proxy`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install` or any download; `wrangler` (login/deploy/dev/secret) or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `cd hub/proxy && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/proxy && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx vitest run && npx tsc --noEmit -p .`: expect proxy tests and typecheck pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
