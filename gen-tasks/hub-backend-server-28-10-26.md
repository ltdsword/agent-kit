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
