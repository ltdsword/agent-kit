# Hub backend server (28/10/26)

## Goal
`node hub/server/src/cli.ts serve` runs the Agent Hub backend: the whole v1 API in
`docs/hub-api.md` (connector routes, user routes, commands queue, pairing, SSE) on Node 24 with
the built-in `node:sqlite`, fully tested.

## Read first
- `plans/261028-1511-agent-hub-build/phase-b1-backend.md`: **the full spec for this task**
  (stack, layout, requirements 1-8, tests, done criteria). Every design decision is made there;
  follow it exactly.
- `docs/hub-api.md`: all of it (the behavior contract).
- `hub/protocol/src/index.ts`, `hub/protocol/src/api.ts`: `validate()`, generated types, routes,
  `LIMITS`, `ERRORS`. Import them; never redefine them.
- `hub/protocol/fixtures/*.json`: example bodies; replay them in tests.

## Steps
1. Create `hub/server/` exactly as in the phase file's "Layout" (package `@agent-hub/server`, bin
   `agent-hub` → `src/cli.ts`, scripts `start`, `test`, `typecheck`), and add `"server"` to the
   `workspaces` array in `hub/package.json`.
2. Implement requirements 1-8 of the phase file.
3. Write the tests listed under "Tests (minimum)" in the phase file.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/**`, `hub/package.json` (only the `workspaces` array), `hub/package-lock.json`

**You must not edit:**
- `hub/protocol/**`, `hub/web/**`, `.agent-system/**`, `docs/**`, `plans/**`, `gen-tasks/**`,
  `hub/.gitignore`, `hub/.npmrc`, `hub/.nvmrc`.
- The contract: if it looks wrong or incomplete, implement the closest faithful behavior and list
  the gap in your report's `risks`.

**You may run:**
- Node 24 only: `source ~/.nvm/nvm.sh && nvm use 24` first (the default node is 20; engine-strict).
- **npm install is allowed**, only from `hub/`, only as:
  `env -u HTTPS_PROXY -u https_proxy npm install --cache ./.npm-cache --no-audit --no-fund [pkgs]`
  (the corporate proxy hangs npm; the cache must stay inside your worktree for the sandbox).
  Dependencies are limited to: `hono`, `@hono/node-server` (runtime); `typescript@~5.9`, `vitest`,
  `@types/node` (dev).
- `npm test`, `npm run typecheck`, `npx tsc`, `npx vitest`, and `node hub/server/src/cli.ts ...`
  with temp `AGENT_HUB_DATA`/`AGENT_HUB_CONFIG` dirs and a free port on 127.0.0.1 (stop it after),
  `curl` to 127.0.0.1 only; read-only git.

**You must not run:**
- Anything touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`, `systemctl`,
  other downloads, `git push/merge/rebase/reset/checkout`.

**When to ask:** only for a real blocker (a spec contradiction, or a sandbox-blocked command) →
report "blocked" with the exact command and error. Everything else: just do it.

## Do not
- Add an ORM, a build step, or dependencies beyond the list. Don't commit `node_modules`, `*.db`
  or `.npm-cache`.

## Done when
- [ ] Every requirement and test in the phase file is done.
- [ ] Every response body of a route with a `$def` validates against it in tests.
- [ ] `cd hub && npm test && npm run typecheck` pass (protocol + server).

## Run these
- `cd hub && npm test`: expect all protocol (51) and server tests to pass.
- `cd hub && npm run typecheck`: expect no errors.
- A serve smoke test: start with temp dirs and a free port, then `curl -H "Authorization: Bearer $(cat <tmp>/connector.key)" http://127.0.0.1:<port>/api/v1/agent/ping`
  → a valid `PingResponse`.

## Notes
- Node type stripping: `.ts` import extensions, no enums, no parameter properties, `import type`
  for type-only imports.
- All SQL lives in `src/db.ts`. Inject a clock so the 90 s offline rule and the prompt expiry are
  testable without sleeping.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (28/10/26 15:32)

- Status: **blocked** (worker worker-2, branch `agent/hub1-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported:
  - `cd hub && npm test` -> exit 1
  - `cd hub && npm run typecheck` -> exit 127
  - `node hub/server/src/cli.ts serve (AGENT_HUB_DATA=/tmp/hub-t2-smoke-data, AGENT_HUB_CONFIG=/tmp/hub-t2-smoke-config, AGENT_HUB_PORT=17420)` -> exit 1
- Risks:
  - Implementation blocked: the phase spec requires Hono and @hono/node-server, but this relaunch forbids new dependencies and package installs. Neither dependency is in hub/package-lock.json, and hub/node_modules is absent. Implementing the specified stack without those dependencies would violate the decided plan.
- Not done:
  - All hub/server implementation requirements and minimum tests.
  - npm test, typecheck, and the serve/curl smoke test could not pass without dependencies and the server implementation.
  - No curl request was sent because the CLI failed to load.
- Full diff: `.orchestrator/runs/hub1/reports/T2.diff`

## Decision D2 needed (blocker) (28/10/26 15:33)

**T2 blocked: kit prompt forbade the npm install its task file allows**

Worker stopped before coding: the scheduler's generated prompt said 'no package installs, no new dependencies' unconditionally, overriding the task file's Boundaries (npm install of hono etc. allowed). Fix (already applied in main checkout, one line in _prompt_text): installs only when the Boundaries allow them. Then relaunch T2 unchanged.

- `A`: Keep the prompt fix and relaunch T2 (recommended)
- `B`: Stop T2

Waiting for the user's answer in chat.

## Decision D2 answered by the user (28/10/26 15:34)

- Choice: **A**: Keep the prompt fix and relaunch T2
- User's words (chat): "A: Keep fix, relaunch T2 (Recommended)"

## Worker result - attempt 2 (28/10/26 15:56)

- Status: **done** (worker worker-2, branch `agent/hub1-t2-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/package-lock.json`, `hub/package.json`, `hub/server/migrations/001-init.sql`, `hub/server/package.json`, `hub/server/src/app.ts`, `hub/server/src/auth.ts`, `hub/server/src/cli.ts`, `hub/server/src/config.ts`, `hub/server/src/connector-api.ts`, `hub/server/src/db.ts`, `hub/server/src/http.ts`, `hub/server/src/status.ts`, `hub/server/src/stream.ts`, `hub/server/src/user-api.ts`, `hub/server/test/server.test.ts`, `hub/server/tsconfig.json`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm test` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && AGENT_HUB_DATA=/tmp/hub1-t2-smoke-data-final3 AGENT_HUB_CONFIG=/tmp/hub1-t2-smoke-config-final3 AGENT_HUB_PORT=17424 node hub/server/src/cli.ts serve` -> exit 130
  - `curl -sS -H 'Authorization: Bearer [temp connector key]' -H 'X-Agent-Hub-Protocol: 1' http://127.0.0.1:17424/api/v1/agent/ping` -> exit 0
  - `git diff --check` -> exit 0
  - `node hub/server/src/cli.ts serve (initial attempt from default Node 20 shell)` -> exit 1
- Risks:
  - Design choices: used one initial SQLite migration with TEXT ISO timestamps; generated 16-character lowercase base32 command IDs; paired devices keep the name bound to the one-time code.
  - Contract gap: ERRORS has no internal_error code. Unexpected exceptions return HTTP 500 with an ApiError body using bad_request.
  - Open question: PairRequest.name is schema-validated but the server uses the name stored when agent-hub pair --name created the code.
- Not done: none
- Full diff: `.orchestrator/runs/hub1/reports/T2.diff`

````text
 hub/package-lock.json              |  45 ++++-
 hub/package.json                   |   2 +-
 hub/server/migrations/001-init.sql | 138 ++++++++++++++
 hub/server/package.json            |  24 +++
 hub/server/src/app.ts              |  98 ++++++++++
 hub/server/src/auth.ts             |  41 +++++
 hub/server/src/cli.ts              | 102 +++++++++++
 hub/server/src/config.ts           |  52 ++++++
 hub/server/src/connector-api.ts    | 209 +++++++++++++++++++++
 hub/server/src/db.ts               | 362 +++++++++++++++++++++++++++++++++++++
 hub/server/src/http.ts             |  29 +++
 hub/server/src/status.ts           |  86 +++++++++
 hub/server/src/stream.ts           |  14 ++
 hub/server/src/user-api.ts         | 281 ++++++++++++++++++++++++++++
 hub/server/test/server.test.ts     | 331 +++++++++++++++++++++++++++++++++
 hub/server/tsconfig.json           |  14 ++
 16 files changed, 1826 insertions(+), 2 deletions(-)
````

(diff is 1962 lines; read the full diff file)

## Review round 2: PASS (28/10/26 15:57)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: d6c45c28bdc1, commits d6c45c28bdc1

# Review: hub1 T2, hub backend server (phase B1)

Verdict: **PASS**

## Checked
- `npm test` (protocol 51 + server 6 tests, 88 assertions) and `npm run typecheck` pass on Node 24.
- Tests cover the phase minimum list: per-route auth (none/wrong kind/revoked), fixture replay into user
  views with schema checks, hub_status table, command lifecycle (DELIVERED, REJECTED retry, HELD 5 s,
  prompt expiry, long-poll wake), workspace lifecycle (90 s offline via fake clock, goodbye, duplicate 409,
  wiped DB known:false), isolation, SSE decision event.
- Security: bind refuses non-127.0.0.1 without `--i-know`; tokens stored/looked up as sha256; device vs
  connector kinds return 403; CORS from `AGENT_HUB_ORIGINS` only.
- Hashes: canonical JSON (sorted keys) in db.ts; document sha256 verified on upload.

## Minor (follow-up)
- Tests are 6 large scenario tests; failures will be harder to localize. Split when touching them next.
- Contract gap: no `internal_error` code; 500s reuse `bad_request`. Add to ERRORS in a protocol bump.
- PairRequest.name ignored (name fixed at `agent-hub pair --name`). Fine; document in hub-api.md.
- Cross-language canonical JSON parity (Python vs JS) unproven until M1; floats would differ (1.0 vs 1).

## Integration: merged (28/10/26 15:57)

- On `agent/integration-hub1` at bbb60fb72f7b; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub1/logs/post-merge-T2-a2.log`)

## Final gate: PASS (28/10/26 15:59)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub1 at bbb60fb72f7b (log `.orchestrator/runs/hub1/logs/verify-1793177959.log`)
- Task MERGED; run DONE
