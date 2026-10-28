# hub proxy v2 (28/10/26)

## Goal
`hub/proxy` is the full protocol-2 proxy (accounts, sessions, admin API, computer registration, routing, WebSocket + long-poll relay, setup script) with no `/spike` routes left.

## Read first
- `plans/261028-1801-agent-hub-relay/phase-p2a-proxy.md`: **the full spec** (work items, tests, done criteria). Follow it exactly.
- `plans/261028-1801-agent-hub-relay/plan.md`: decisions D-1..D-12 and sections 2, 10 (why).
- `docs/hub-api.md` and `hub/protocol/src/api.ts`: the protocol-2 contract (after the protocol task, which this task depends on, merged).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/proxy/**` (except package.json)

**You must not edit:**
- `hub/protocol/**`, `hub/server/**`, `hub/web/**`, `.agent-system/**`, `docs/**`, any package.json/lockfile, `plans/**`, `gen-tasks/**`.
- The protocol contract (schema, fixtures, `api.ts`, `docs/hub-api.md`) unless this is the protocol task: if it doesn't fit, implement the closest faithful behavior and list the gap in your report's `risks`.

**You may run:**
- Node 24 only: `source ~/.nvm/nvm.sh && nvm use 24` first (default node is 20; engine-strict).
- Dependencies are already installed in `hub/` by the lead; run `env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund` in `hub/` once if `node_modules` is missing. **No new dependencies, no edits to any package.json or lockfile.**
- `npm test`, `npm run typecheck`, `npx wrangler dev --local`, `npx wrangler d1 migrations apply agent-hub --local` (set `WRANGLER_SEND_METRICS=false` and `XDG_CONFIG_HOME=<worktree>/.wrangler-home`); local sockets on 127.0.0.1; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; anything that talks to a Cloudflare account (`wrangler login/deploy/secret`, `--remote`);
  reading `~/.config/.wrangler/**`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub` (use temp dirs via env vars);
  real `herdr`/`codex`/`claude`; downloads.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason / command and error. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in the spec is done.
- [ ] `cd hub && npm test -w @agent-hub/proxy` passes.
- [ ] `cd hub && npm run typecheck -w @agent-hub/proxy` passes.

## Run these
- `cd hub && npm test -w @agent-hub/proxy`: expect all pass
- `cd hub && npm run typecheck -w @agent-hub/proxy`: no errors

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (28/10/26 22:59)

- Status: **blocked** (worker worker-1, branch `agent/hub4-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/server/src/cli.ts`
- Scope: OK
- Tests reported:
  - `cd hub && npm test -w @agent-hub/proxy (initial run under Node 24)` -> exit 127
  - `cd hub && env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund (under Node 24)` -> exit 0
  - `cd hub && npm test -w @agent-hub/proxy (under Node 24)` -> exit 0
  - `cd hub && npm run typecheck -w @agent-hub/proxy (under Node 24)` -> exit 0
- Risks:
  - Blocked at setup work item 9: it requires `npm run setup -w @agent-hub/proxy`, but hub/proxy/package.json has no setup script and Boundaries forbid changing any package.json or lockfile. The requested invocation cannot be provided without violating the boundary.
  - Final git status also shows hub/server/src/cli.ts modified. It was absent from the initial status, is outside the owned paths, and was left untouched.
- Not done:
  - Implementation and spec-specific tests were not started because the package-script/boundary conflict requires stopping per task instructions.
- Full diff: `.orchestrator/runs/hub4/reports/T1.diff`

````text
 hub/server/src/cli.ts | 0
 1 file changed, 0 insertions(+), 0 deletions(-)
````

````diff
diff --git a/hub/server/src/cli.ts b/hub/server/src/cli.ts
old mode 100644
new mode 100755
````

## Decision D1 needed (blocker) (28/10/26 23:09)

**Unblock T1: setup npm script**

T1 needs a setup npm script but package.json edits are forbidden. How to unblock?

- `A`: Allow the one line (recommended)
- `B`: Lead adds it after
- `C`: Stop T1

Waiting for the user's answer in chat.

## Decision D1 answered by the user (28/10/26 23:09)

- Choice: **A**: Allow the one line
- User's words (chat): "Allow the one line (Recommended)"

## Worker result - attempt 2 (28/10/26 23:10)

- Status: **blocked** (worker worker-3, branch `agent/hub4-t1-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported:
  - `cd hub && npm test -w @agent-hub/proxy (initial run under Node 24)` -> exit 127
  - `cd hub && env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund (under Node 24)` -> exit 0
  - `cd hub && npm test -w @agent-hub/proxy (under Node 24)` -> exit 0
  - `cd hub && npm run typecheck -w @agent-hub/proxy (under Node 24)` -> exit 0
- Risks:
  - Blocked at setup work item 9: it requires `npm run setup -w @agent-hub/proxy`, but hub/proxy/package.json has no setup script and Boundaries forbid changing any package.json or lockfile. The requested invocation cannot be provided without violating the boundary.
  - Final git status also shows hub/server/src/cli.ts modified. It was absent from the initial status, is outside the owned paths, and was left untouched.
- Not done:
  - Implementation and spec-specific tests were not started because the package-script/boundary conflict requires stopping per task instructions.
- Full diff: `.orchestrator/runs/hub4/reports/T1.diff`

## Decision D2 needed (blocker) (28/10/26 23:29)

**Unblock T1: privacy check false positive**

A privacy check blocked a patch containing this.env.DB.prepare(...). How to continue?

- `A`: Resume, avoid the token (recommended)
- `B`: Resume, I'll approve prompts
- `C`: Pause T1

Waiting for the user's answer in chat.

## Decision D2 answered by the user (28/10/26 23:29)

- Choice: **A**: Resume, avoid the token
- User's words (chat): "Resume, avoid the token (Recommended)"

## Worker result - attempt 3 (29/10/26 00:11)

- Status: **done** (worker worker-3, branch `agent/hub4-t1-r3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/proxy/README.md`, `hub/proxy/migrations/0002_v2.sql`, `hub/proxy/package.json`, `hub/proxy/scripts/setup.ts`, `hub/proxy/src/auth.ts`, `hub/proxy/src/computer-relay.ts`, `hub/proxy/src/crypto.ts`, `hub/proxy/src/env.ts`, `hub/proxy/src/index.ts`, `hub/proxy/test/proxy.test.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/proxy` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm run typecheck -w @agent-hub/proxy` -> exit 0
  - `git diff --check` -> exit 0
- Risks:
  - The phase spec requests must_change in LoginResponse, but the protocol-v2 schema excludes it. The proxy follows the protocol contract and omits that field.
- Not done:
  - Remote setup/deploy was not executed; task boundaries prohibit Cloudflare account access. Setup pure helpers are covered by local tests.
- Full diff: `.orchestrator/runs/hub4/reports/T1.diff`

````text
 hub/proxy/README.md              |  94 ++----
 hub/proxy/migrations/0002_v2.sql |  46 +++
 hub/proxy/package.json           |   1 +
 hub/proxy/scripts/setup.ts       | 169 ++++++++++
 hub/proxy/src/auth.ts            |  20 +-
 hub/proxy/src/computer-relay.ts  | 419 +++++++++++++++++++-----
 hub/proxy/src/crypto.ts          | 228 +++++++++++++
 hub/proxy/src/env.ts             |   5 +-
 hub/proxy/src/index.ts           | 600 ++++++++++++++++++++++++++++++----
 hub/proxy/test/proxy.test.ts     | 684 ++++++++++++++++++++++++++-------------
 10 files changed, 1808 insertions(+), 458 deletions(-)
````

(diff is 2635 lines; read the full diff file)

## Review round 3: PASS (29/10/26 00:12)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 4781a415dfaf, commits 4781a415dfaf

# Review: hub4 T1, proxy v2 (`hub/proxy`), attempt 3

Verdict: **PASS**

## History
- Attempt 1 was blocked: the spec asked for `npm run setup`, but the package had no such script. Fixed by decision D1 (user allowed adding that one line).
- Attempt 2 was blocked by a false positive in a file-privacy hook, which matched `this.env.DB...`. Fixed by decision D2 (avoid the token). The partial work was saved as WIP `e4ef913` and carried into attempt 3.

## Checked (re-run by lead)
- `npm test -w @agent-hub/proxy`: 12 pass. Typecheck: 0 errors. The only package.json change is the `setup` line. No `/spike` routes remain.
- **Crypto:**
  - PBKDF2-SHA256 with `LIMITS.pbkdf2Iterations`, a 16-byte salt and a 32-byte hash, compared in constant time;
  - tokens are 32 random bytes, stored as sha256;
  - generated passwords use an unambiguous alphabet.
- **Login:**
  - rate-limited per username + `CF-Connecting-IP`;
  - unknown users go through a dummy PBKDF2 hash (no timing leak) and get the same `invalid_credentials` error;
  - hashes are upgraded when `pw_iter` is below the limit.
- **Password change:** requires the current password; the new one must be 12–256 characters (otherwise 422 `weak_password`). It revokes the user's other sessions, and an admin reset revokes all of that user's sessions.
- **Keys:** the admin key is checked as sha256 against `ADMIN_KEY_HASH` in constant time. The computer key is checked as sha256 against `computers.key_hash` in constant time.
- **Ownership:** workspace routes join `workspace_index` to `computers.user_id` (otherwise 404). The stream route checks that the computer belongs to the user.
- **Relay:**
  - offline returns 503 `computer_offline` and a timeout returns 504 `computer_timeout`;
  - cancel is supported;
  - `GET .../documents/content` is relayed with `stream: true`, matching the note from the T2 review.
- **CORS:** `ALLOWED_ORIGINS` plus `localhost:5173`; the allowed headers include `X-Agent-Hub-Protocol`.
- **setup.ts:**
  - prints only the proxy URL;
  - sends secrets to `wrangler secret put` through stdin;
  - `SIGNING_KEY` is only generated if it isn't set yet;
  - `admin.key` and `admin.json` are written with mode 0600.
- No `.env.` / `this.env` tokens remain.

## Notes
- Local test runs leave a `.wrangler-home/` (logs only) at the worktree root. Removed it; worth adding to `.gitignore` later.

## Integration: merged (29/10/26 00:12)

- On `agent/integration-hub4` at 3e01198971e0; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub4/logs/post-merge-T1-a3.log`)

## Final gate: PASS (29/10/26 00:15)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub4 at 92a26ef52caa (log `.orchestrator/runs/hub4/logs/verify-1793207687.log`)
- Task MERGED; run DONE

## Finished (29/10/26 00:28)

- merged into hub/plan (decision D3)
