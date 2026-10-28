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

## Worker result - attempt 1 (28/10/26 22:40)

- Status: **done** (worker worker-1, branch `agent/hub3-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/server/migrations/002-v2.sql`, `hub/server/src/app.ts`, `hub/server/src/auth.ts`, `hub/server/src/cli.ts`, `hub/server/src/config.ts`, `hub/server/src/connector-api.ts`, `hub/server/src/db.ts`, `hub/server/src/relay.ts`, `hub/server/src/status.ts`, `hub/server/src/user-api.ts`, `hub/server/test/server.test.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/server` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/server` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm run typecheck -w @agent-hub/server` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub3/reports/T2.diff`

````text
 hub/server/migrations/002-v2.sql |  32 ++
 hub/server/src/app.ts            |   6 +-
 hub/server/src/auth.ts           |  76 +++--
 hub/server/src/cli.ts            |  68 ++---
 hub/server/src/config.ts         |  57 +++-
 hub/server/src/connector-api.ts  |  40 +--
 hub/server/src/db.ts             | 136 ++++-----
 hub/server/src/relay.ts          | 353 ++++++++++++++++++++++
 hub/server/src/status.ts         |  29 +-
 hub/server/src/user-api.ts       |  78 ++---
 hub/server/test/server.test.ts   | 628 ++++++++++++++++++++++-----------------
 11 files changed, 984 insertions(+), 519 deletions(-)
````

(diff is 1927 lines; read the full diff file)

## Review round 1: PASS (28/10/26 22:42)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: b49f9b395c11, commits b49f9b395c11

# Review: hub3 T2, local backend v2 (`hub/server`)

Verdict: **PASS**

## Checked
- `npm test -w @agent-hub/server`: 8 pass. Typecheck: 0 errors.
- Assertion check (`src/auth.ts`):
  - Ed25519 signature using the pinned `proxy_public_key`, which must be 32 bytes;
  - payload validated against the schema;
  - `exp` within [now, now+120 s];
  - `cid`, `sub` and `rid` must match;
  - no relay frame means 401.
  - Tests cover a bad signature, an expired assertion, and a wrong cid/sub/rid.
- Commands take `by` from `assertion.sub`.
- Pairing and devices removed: `002-v2.sql` drops both tables, and no `pair`/`device` references remain in `src/`.
- Runs are upserted and survive a later snapshot. The sweep runs on start and hourly, and deletes decisions, events, documents and the run in one transaction.
- The workspace list keeps the 15-day rule, and `?all=true` returns everything.
- Relay (`src/relay.ts`):
  - transports tried in order: WS, then long-poll direct, then long-poll via `EnvHttpProxyAgent`;
  - backoff from 1 s to 60 s;
  - in-process `app.fetch` with the frame id bound;
  - stream chunks + end, cancel, and 413 for oversized bodies;
  - frames validated before sending.
- REPLY_SENT is derived as the spec says.

## Notes (minor, not blocking)
- The fallback that auto-streams large documents depends on a `Content-Length` header, and Hono's `c.json` doesn't set one. So a `documents/content` response over 900 KB streams only when the proxy sends `stream: true`. That matches the contract ("a `DocumentContent` response is sent with `stream: true`"). Added to the P2a spec: the proxy sets `stream: true` on `documents/content` requests.

## Integration: merged (28/10/26 22:51)

- On `agent/integration-hub3` at 69fd3061f553; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub3/logs/post-merge-T2-a1.log`)

## Final gate: PASS (28/10/26 22:54)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub3 at b82502faff42 (log `.orchestrator/runs/hub3/logs/verify-1793202836.log`)
- Task MERGED; run DONE

## Finished (28/10/26 22:56)

- merged into hub/plan (decision D1)
