# Proxy: Zalo link codes, webhook, notify, offline alarm (30/10/26)

## Goal
The proxy links a user's Zalo chats through a 6-digit code sent to the bot (webhook), sends batched notifications from the computer to every linked chat with token-safe Zalo calls and quota protection, alerts the owner when a computer stays offline 10 minutes, and registers its own webhook through an admin route.

## Read first
- `plans/261030-1110-hub10-zalo-notifications/plan.md`: sections **User decisions**, **Zalo Bot facts**, **Contract**, **Message format** and **T1**: **the full spec** (work items, tests). Follow it exactly.
- `hub/proxy/src/index.ts` (routing, session/admin/computer auth, CORS), `hub/proxy/src/computer-relay.ts` (connection lifecycle, Durable Object), `hub/proxy/src/env.ts`, `hub/proxy/migrations/0002_v2.sql`, `hub/proxy/test/proxy.test.ts` (harness), `hub/protocol/src/api.ts` (`NOTIFY_ROUTES`, `COMPUTER_ROUTES.notify`, `ADMIN_ROUTES.zaloSetup`), notification types in `hub/protocol/src/types.gen.ts`, `docs/hub-api.md`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/proxy/src/**`
- `hub/proxy/migrations/0003_notify.sql`
- `hub/proxy/test/**`
- `hub/proxy/wrangler.jsonc`
- `docs/hub-api.md`

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
- [ ] Every work item and test in spec section T1 is done.
- [ ] `cd hub/proxy && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/proxy && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (30/10/26 11:24)

- Status: **done** (worker worker-1, branch `agent/hub10-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `docs/hub-api.md`, `hub/proxy/migrations/0003_notify.sql`, `hub/proxy/src/computer-relay.ts`, `hub/proxy/src/env.ts`, `hub/proxy/src/index.ts`, `hub/proxy/src/notify.ts`, `hub/proxy/src/zalo-sender.ts`, `hub/proxy/test/notify.test.ts`, `hub/proxy/test/proxy.test.ts`, `hub/proxy/wrangler.jsonc`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p . (workdir: hub/proxy)` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p . (workdir: hub/proxy)` -> exit 2
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p . (workdir: hub/proxy)` -> exit 0
  - `git diff --check` -> exit 0
- Risks:
  - HUB_WEB_URL defaults to the plan's example site origin and should be overridden for deployments using another website URL.
- Not done:
  - Production Zalo webhook registration/deployment was not run; T1 boundaries prohibit Cloudflare and Zalo calls.
- Full diff: `.orchestrator/runs/hub10/reports/T1.diff`

````text
 docs/hub-api.md                      |  29 ++
 hub/proxy/migrations/0003_notify.sql |  24 ++
 hub/proxy/src/computer-relay.ts      |  47 ++-
 hub/proxy/src/env.ts                 |   5 +
 hub/proxy/src/index.ts               |  47 ++-
 hub/proxy/src/notify.ts              | 533 +++++++++++++++++++++++++++++++++++
 hub/proxy/src/zalo-sender.ts         | 104 +++++++
 hub/proxy/test/notify.test.ts        | 483 +++++++++++++++++++++++++++++++
 hub/proxy/test/proxy.test.ts         |  22 ++
 hub/proxy/wrangler.jsonc             |   3 +
 10 files changed, 1287 insertions(+), 10 deletions(-)
````

(diff is 1514 lines; read the full diff file)

## Review round 1: PASS (30/10/26 11:25)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 02e9c5362d5c, commits 02e9c5362d5c
- Notes: sender, webhook, notify, quota, alarm OK; Opus: lenient chat_type

# Review: hub10 T1 proxy Zalo notify

Verdict: PASS

## Checked
- `zalo-sender.ts`: port of the user's bridge client: `{chat_id,text}` plain text, ≤2000 chars, 5 s abort, `redirect:manual`, 64 KB bounded read, success = 2xx + `ok:true`; results are bounded kinds, never token/URL/body. `Notifier` interface for future channels.
- Migration 0003: link codes, targets (UNIQUE user+chat, private/group, broken), monthly usage.
- Link code: 6 crypto-random digits (rejection sampling), 10 min, one per user.
- Webhook: constant-time secret check (401), parses `{message}` and `{result:{message}}`; code → upsert target, delete code, "✅ Connected" reply; private non-code → hint reply; group non-code → silent; unknown shape → logs top-level keys only (redacted).
- Notify: computer-key auth, owner via computers.user_id, format with Q/D ids + hash-route links, 2000-char cut with "+N more", per-target 3 attempts (1 s, 3 s) for 429/5xx/network, `rejected` → broken, quota reserved atomically (cap = limit − 50), released on failure; 503 when not configured.
- Status/test/unlink; admin `/admin/zalo/setup` calls setWebhook with proxy origin, returns only verification outcome/hint (secrets stripped).
- Offline alarm: set on socket close / after each poll, cleared on connect/poll/frames; fires once per offline period.
- All logs are fixed `{event}` JSON; 31 proxy tests + tsc pass (rerun by Opus).

## Opus fix
- Webhook parser accepts any-case `chat_type` and treats missing as private (body shape undocumented).

## Notes
- Each non-code private message to the bot costs one quota message (hint reply); acceptable at 50-user cap.
- `wrangler.jsonc` gets `HUB_WEB_URL`; the deploy config (`wrangler.local.jsonc`) must also carry `HUB_WEB_URL` and `ZALO_BOT_LINK` at rollout.

## Integration: merged (30/10/26 11:25)

- On `agent/integration-hub10` at cb889eb1c8b5; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub10/logs/post-merge-T1-a1.log`)

## Final gate: PASS (30/10/26 11:26)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub10 at cb889eb1c8b5 (log `.orchestrator/runs/hub10/logs/verify-1793334334.log`)
- Task MERGED; run DONE

## Finished (30/10/26 11:32)

- merged into hub/plan (decision D2)
