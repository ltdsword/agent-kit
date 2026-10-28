# hub backend v2 (28/10/26)

## Goal
`hub/server` speaks protocol 2: owner auth by proxy assertion, relay client (WebSocket, long-poll fallback), pairing removed, runs upserted and kept 60 days, 15-day workspace list.

## Read first
- `plans/261028-1801-agent-hub-relay/phase-p2b-backend.md`: **the full spec** (work items, tests, done criteria). Follow it exactly.
- `plans/261028-1801-agent-hub-relay/plan.md`: decisions D-1..D-12 and sections 2, 10 (why).
- `docs/hub-api.md` and `hub/protocol/src/api.ts`: the protocol-2 contract (after the protocol task, which this task depends on, merged).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/**` (except package.json)

**You must not edit:**
- `hub/protocol/**`, `hub/proxy/**`, `hub/web/**`, `.agent-system/**`, `docs/**`, any package.json/lockfile, `plans/**`, `gen-tasks/**`.
- The protocol contract (schema, fixtures, `api.ts`, `docs/hub-api.md`) unless this is the protocol task: if it doesn't fit, implement the closest faithful behavior and list the gap in your report's `risks`.

**You may run:**
- Node 24 only: `source ~/.nvm/nvm.sh && nvm use 24` first (default node is 20; engine-strict).
- Dependencies are already installed in `hub/` by the lead; run `env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund` in `hub/` once if `node_modules` is missing. **No new dependencies, no edits to any package.json or lockfile.**
- `npm test`, `npm run typecheck`, `node hub/server/src/cli.ts serve` with temp `AGENT_HUB_DATA`/`AGENT_HUB_CONFIG` and a free 127.0.0.1 port (stop it after); local sockets; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; anything that talks to a Cloudflare account (`wrangler login/deploy/secret`, `--remote`);
  reading `~/.config/.wrangler/**`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub` (use temp dirs via env vars);
  real `herdr`/`codex`/`claude`; downloads.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason / command and error. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in the spec is done.
- [ ] `cd hub && npm test -w @agent-hub/server` passes.
- [ ] `cd hub && npm run typecheck -w @agent-hub/server` passes.

## Run these
- `cd hub && npm test -w @agent-hub/server`: expect all pass
- `cd hub && npm run typecheck -w @agent-hub/server`: no errors

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
