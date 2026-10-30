# Backend: notification outbox and triggers (30/10/26)

## Goal
The backend notices new open questions/decisions (opened within the last hour) and prompts that failed delivery, deduplicates them in a notifications outbox, and sends them in 20-second batches to the proxy's notify route with the computer key, retrying while the proxy is unreachable and dropping items after an hour.

## Read first
- `plans/261030-1110-hub10-zalo-notifications/plan.md`: sections **User decisions**, **Zalo Bot facts**, **Contract**, **Message format** and **T2**: **the full spec** (work items, tests). Follow it exactly.
- `hub/server/src/connector-api.ts` (decision sync, ack), `hub/server/src/db.ts`, `hub/server/src/relay.ts` (proxy endpoint + proxy-aware fetch), `hub/server/src/app.ts`, `hub/server/src/cli.ts`, `hub/server/src/config.ts` (computer.json), `hub/server/test/` (fixtures), `hub/protocol/src/api.ts` (`COMPUTER_ROUTES.notify`), `NotifyRequest` in `hub/protocol/src/types.gen.ts`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/src/notifier.ts`
- `hub/server/src/db.ts`
- `hub/server/src/connector-api.ts`
- `hub/server/src/app.ts`
- `hub/server/src/cli.ts`
- `hub/server/src/relay.ts`
- `hub/server/test/**`

**You must not edit:**
- Any other file; also `hub/protocol/**` (contract, fixed), `package.json`/lock files, `plans/**`, `gen-tasks/**`, `.orchestrator/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside your package; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `wrangler` or `vercel`; anything that talks to Cloudflare, Vercel or Zalo (mock `fetch` in tests);
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (bot token, webhook secret, keys, passwords); never put the Zalo token or request URL in an error or log.

## Done when
- [ ] Every work item and test in spec section T2 is done.
- [ ] `cd hub/server && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/server && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (30/10/26 11:16)

- Status: **done** (worker worker-2, branch `agent/hub10-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/server/src/app.ts`, `hub/server/src/cli.ts`, `hub/server/src/connector-api.ts`, `hub/server/src/db.ts`, `hub/server/src/notifier.ts`, `hub/server/src/relay.ts`, `hub/server/test/server.test.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub/server && npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `git diff --check` -> exit 0
- Risks:
  - prompt_failed items use an empty title because the proxy renders the fixed prompt_failed message.
- Not done: none
- Full diff: `.orchestrator/runs/hub10/reports/T2.diff`

````text
 hub/server/src/app.ts           |   4 +-
 hub/server/src/cli.ts           |   7 +-
 hub/server/src/connector-api.ts |   6 +-
 hub/server/src/db.ts            |  39 ++++++++-
 hub/server/src/notifier.ts      | 176 ++++++++++++++++++++++++++++++++++++++++
 hub/server/src/relay.ts         |   8 +-
 hub/server/test/server.test.ts  | 137 ++++++++++++++++++++++++++++++-
 7 files changed, 366 insertions(+), 11 deletions(-)
````

(diff is 588 lines; read the full diff file)

## Review round 1: PASS (30/10/26 11:17)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 6664c94ed4f2, commits 6664c94ed4f2
- Notes: outbox, triggers, batching OK; Opus: skip answered at flush

# Review: hub10 T2 server notifier

Verdict: PASS

## Checked
- `notifications` table = dedupe + outbox; PENDING decision enqueued once (INSERT OR IGNORE); opened > 1 h ago or in future → recorded as sent (no flood on resync / fresh DB).
- FAILED ack for prompt/reply → `prompt_failed`.
- Flush 20 s after first unsent item, ≤50 items, POST `/computers/:c/notify` with computer key via EnvHttpProxyAgent; 204 or 503 `zalo_not_configured` → sent; network/other → retry 60 s; >1 h → dropped with log. No key logged.
- Relay `endpoint` exported as `computerEndpoint` (rename only).
- Tests: delay, dedupe, burst of 3, prompt_failed, retry + drop, 503.

## Opus fix
- `itemFor` skips a decision no longer PENDING at flush time (answered during the 20 s wait → no stale notification).

## Notes
- 4xx from proxy (bad key/body) retries every 60 s up to the 1 h TTL; bounded, acceptable.
- 24 server tests + tsc pass (rerun by Opus).

## Integration: merged (30/10/26 11:17)

- On `agent/integration-hub10` at 97af36e67245; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub10/logs/post-merge-T2-a1.log`)

## Final gate: PASS (30/10/26 11:26)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub10 at cb889eb1c8b5 (log `.orchestrator/runs/hub10/logs/verify-1793334334.log`)
- Task MERGED; run DONE
