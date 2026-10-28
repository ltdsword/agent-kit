# hub proxy spike (28/10/26)

## Goal
`hub/proxy` is a Cloudflare Worker (wrangler 4) whose local dev server answers `/health`, times
PBKDF2, writes to D1, and relays a JSON request through a Durable Object to a connected WebSocket
echo client, all covered by local tests with no Cloudflare account.

## Read first
- `plans/261028-1801-agent-hub-relay/phase-p0-proxy-spike.md`: **the full spec** (work items 1-6,
  tests, done criteria). Follow it exactly.
- `plans/261028-1801-agent-hub-relay/plan.md` sections 2, 3, 9: why the spike exists.
- `hub/package.json`, `hub/server/package.json`, `hub/server/tsconfig.json`: workspace layout and TS style to copy.

## Steps
1. Implement work items 1-6 of the phase file in order.
2. Add `"proxy"` to the `workspaces` array in `hub/package.json`.
3. Write the tests listed under "Tests" in the phase file.

## Boundaries
**You may edit** (must match owned_paths in tasks.json):
- `hub/proxy/**`, `hub/package.json` (only the `workspaces` array), `hub/package-lock.json`

**You must not edit:**
- `hub/protocol/**`, `hub/server/**`, `hub/web/**`, `.agent-system/**`, `docs/**`, `plans/**`,
  `gen-tasks/**`, `hub/.gitignore`, `hub/.npmrc`, `hub/.nvmrc`.

**You may run:**
- Node 24 only: `source ~/.nvm/nvm.sh && nvm use 24` first (default node is 20; engine-strict).
- **npm install is allowed**, only from `hub/`, only as:
  `env -u HTTPS_PROXY -u https_proxy npm install --cache ./.npm-cache --no-audit --no-fund [pkgs]`.
  Dependencies limited to: `wrangler@^4`, `typescript@~5.9`, `vitest`, `@cloudflare/workers-types`,
  `@cloudflare/vitest-pool-workers` (dev only).
- `npm test`, `npm run typecheck`, `npx wrangler dev --local`, `npx wrangler types`,
  `npx wrangler d1 migrations apply agent-hub --local`, `node hub/proxy/scripts/echo-client.ts`
  against 127.0.0.1 only; read-only git. Stop any server you start.

**You must not run:**
- `wrangler login`, `wrangler deploy`, `wrangler secret`, any `--remote` command, or anything that
  talks to a Cloudflare account; reading `~/.config/.wrangler/**`; other downloads;
  `git push/merge/rebase/reset/checkout`.

**When to ask:** only for a real blocker (spec contradicts the tools, a sandbox-blocked command) →
report "blocked" with the exact command and error. Everything else: just do it.

## Do not
- Add frameworks (Hono etc.) or dependencies beyond the list. Don't commit `node_modules`,
  `.npm-cache`, `.wrangler/`, `.dev.vars`.

## Done when
- [ ] Every work item and test in the phase file is done.
- [ ] `cd hub && npm test && npm run typecheck` pass (protocol + server + proxy).
- [ ] The echo client round-trips against `wrangler dev --local`.

## Run these
- `cd hub && npm test`: expect protocol 51, server 6 and the new proxy tests to pass.
- `cd hub && npm run typecheck`: expect no errors.

## Notes
- wrangler may write telemetry/config under `~`: set `WRANGLER_SEND_METRICS=false` and
  `XDG_CONFIG_HOME=<your worktree>/.wrangler-home` for every wrangler command so nothing leaves the worktree.
- `.dev.vars` (gitignored) holds `SPIKE_KEY=test-key` for local dev; tests inject their own key.
- Report dependency versions, the test approach, and deploy risks (free-plan DO/D1, compatibility date).

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
