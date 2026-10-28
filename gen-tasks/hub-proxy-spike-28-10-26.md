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

## Worker result - attempt 1 (28/10/26 21:51)

- Status: **done** (worker worker-1, branch `agent/hub2-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/package-lock.json`, `hub/package.json`, `hub/proxy/.gitignore`, `hub/proxy/README.md`, `hub/proxy/migrations/0001_spike.sql`, `hub/proxy/package.json`, `hub/proxy/scripts/echo-client.ts`, `hub/proxy/src/auth.ts`, `hub/proxy/src/computer-relay.ts`, `hub/proxy/src/env.ts`, `hub/proxy/src/hash.ts`, `hub/proxy/src/index.ts`, `hub/proxy/test/proxy.test.ts`, `hub/proxy/tsconfig.json`, `hub/proxy/wrangler.jsonc`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` -> exit 2
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm test` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm test` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` -> exit 0
- Risks:
  - Remote deployment and target-plan CPU timing were not run; confirm free-plan Durable Object and D1 availability before P1.
  - Recheck the committed compatibility date (2026-10-28) when deploying.
  - Echo-client proxy support requires undici to be importable without adding a dependency; it was available in the local Wrangler install used by the loopback test.
- Not done: none
- Full diff: `.orchestrator/runs/hub2/reports/T1.diff`

````text
 hub/package-lock.json               | 1643 ++++++++++++++++++++++++++++++++++-
 hub/package.json                    |    2 +-
 hub/proxy/.gitignore                |    3 +
 hub/proxy/README.md                 |   83 ++
 hub/proxy/migrations/0001_spike.sql |    5 +
 hub/proxy/package.json              |   17 +
 hub/proxy/scripts/echo-client.ts    |  150 ++++
 hub/proxy/src/auth.ts               |   18 +
 hub/proxy/src/computer-relay.ts     |  150 ++++
 hub/proxy/src/env.ts                |    6 +
 hub/proxy/src/hash.ts               |   21 +
 hub/proxy/src/index.ts              |  118 +++
 hub/proxy/test/proxy.test.ts        |  425 +++++++++
 hub/proxy/tsconfig.json             |   13 +
 hub/proxy/wrangler.jsonc            |   22 +
 15 files changed, 2631 insertions(+), 45 deletions(-)
````

(diff is 2926 lines; read the full diff file)

## Review round 1: PASS (28/10/26 21:52)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 4904ab4949d6, commits 4904ab4949d6

# Review: hub2 T1, proxy spike (P0)

Verdict: **PASS**

## Checked
- `cd hub && npm test`: protocol 51, server 6, proxy 9 pass; `npm run typecheck` clean.
- wrangler.jsonc account-neutral (placeholder D1 id, no account_id/routes); DO uses `new_sqlite_classes` (free-plan path).
- Bearer check constant-time; every /spike route gated; 400/401/404/405/413 bodies use the ApiError shape.
- ComputerRelay: hibernation API, one socket (old closed 4000), pending map resolves on reply/close/timeout, ping/pong, malformed frames counted.
- Tests cover health, auth, hash bounds, D1, offline 503, round trip, replace, timeout 504, 413, echo-client script.

## Notes for P0-deploy / P2
- Workers freeze `performance.now()` during CPU-only work, so deployed `wall_ms` reads ~0. Measure PBKDF2 cost from `wrangler tail` CPU time / `exceededCpu` outcome instead.
- Echo client imports `undici` (resolved via wrangler's install) to send auth headers on the WebSocket handshake. P2b backend must declare undici or authenticate another way.
- 900 KB relay cap is spike-only; chunking in P2a.

## Integration: merged (28/10/26 21:52)

- On `agent/integration-hub2` at 9b7e8d378fb6; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub2/logs/post-merge-T1-a1.log`)

## Final gate: PASS (28/10/26 21:52)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub2 at 9b7e8d378fb6 (log `.orchestrator/runs/hub2/logs/verify-1793199138.log`)
- Task MERGED; run DONE

## Final gate: PASS (28/10/26 21:53)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub2 at 9b7e8d378fb6 (log `.orchestrator/runs/hub2/logs/verify-1793199176.log`)
- Task MERGED; run DONE

## Finished (28/10/26 21:55)

- merged into hub/plan (decision D1)
