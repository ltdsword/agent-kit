# hub5 decisions docs (29/10/26)

## Goal
The backend tells the proxy about new workspaces right away; the web app gets a **Decisions** panel (open decisions on top, every decision below, newest first) and a searchable, filterable Documents list.

## Read first
- `plans/261029-0150-hub5-delivery-decisions/plan.md` section **T2**: **the full spec** (work items, tests). Follow it exactly; the user's own words are quoted at the top.
- `hub/web/README.md` (how the app is organised; follow its rules), `hub/web/src/api/*`, `hub/web/src/features/workspace/*`, `hub/web/src/features/decision/*`.
- `hub/server/src/connector-api.ts`, `src/relay.ts` (`sendWorkspaces`), `src/stream.ts`; `docs/hub-api.md` (v2).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/server/**`, `hub/web/**`

**You must not edit:**
- `hub/protocol/**`, `hub/proxy/**`, any `package.json` or lockfile, `.agent-system/**`, `docs/**`, `plans/**`, `gen-tasks/**`.
- No TypeScript parameter properties, enums or namespaces in `hub/server` (Node runs it with type stripping; `erasableSyntaxOnly` is on).

**You may run:**
- `cd hub && npm test|run typecheck|run build -w @agent-hub/server -w @agent-hub/web` (Node 24: `source ~/.nvm/nvm.sh && nvm use 24`); read-only git. Deps are installed; if `node_modules` is missing run `cd hub && env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund`. If `hub/server/src/cli.ts` then shows a mode change, `git restore hub/server/src/cli.ts`.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `wrangler`/`vercel` or anything that talks to Cloudflare or Vercel;
  touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; installing packages.

**When to ask:** only for a real blocker → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T2 is done.
- [ ] The commands in "Run these" pass.

## Run these
- `cd hub && npm test -w @agent-hub/server -w @agent-hub/web`: expect all pass
- `cd hub && npm run typecheck -w @agent-hub/server -w @agent-hub/web`: expect 0 errors
- `cd hub && npm run build -w @agent-hub/web`: expect built

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (29/10/26 02:23)

- Status: **done** (worker worker-3, branch `agent/hub5-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/server/test/server.test.ts`, `hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/adapter.test.ts`, `hub/web/src/api/http/adapter.ts`, `hub/web/src/api/mock/seed.ts`, `hub/web/src/components/Chips.tsx`, `hub/web/src/components/Layout.tsx`, `hub/web/src/features/decision/DecisionContext.tsx`, `hub/web/src/features/decision/DecisionPage.test.tsx`, `hub/web/src/features/overview/WorkspaceCard.tsx`, `hub/web/src/features/workspace/DocumentList.tsx`, `hub/web/src/features/workspace/NeedsYouSection.tsx`, `hub/web/src/features/workspace/OrchestratorCard.tsx`, `hub/web/src/features/workspace/SubagentsSection.tsx`, `hub/web/src/features/workspace/WorkspacePage.test.tsx`, `hub/web/src/features/workspace/WorkspacePage.tsx`, `hub/web/src/state/selectors.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/server -w @agent-hub/web` -> exit 127
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/server -w @agent-hub/web` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/server -w @agent-hub/web` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm test -w @agent-hub/server -w @agent-hub/web` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm run typecheck -w @agent-hub/server -w @agent-hub/web` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm run typecheck -w @agent-hub/server -w @agent-hub/web` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && cd hub && npm run build -w @agent-hub/web` -> exit 0
- Risks:
  - Web build succeeds with a Vite large-chunk warning (598.50 kB main JS chunk).
- Not done: none
- Full diff: `.orchestrator/runs/hub5/reports/T2.diff`

````text
 hub/server/test/server.test.ts                     |  4 +-
 hub/web/src/api/http/HttpHubClient.ts              |  4 +-
 hub/web/src/api/http/adapter.test.ts               | 19 ++++-
 hub/web/src/api/http/adapter.ts                    |  4 +
 hub/web/src/api/mock/seed.ts                       | 25 ++++++
 hub/web/src/components/Chips.tsx                   |  2 +-
 hub/web/src/components/Layout.tsx                  |  2 +-
 hub/web/src/features/decision/DecisionContext.tsx  |  9 +++
 .../src/features/decision/DecisionPage.test.tsx    |  2 +-
 hub/web/src/features/overview/WorkspaceCard.tsx    |  2 +-
 hub/web/src/features/workspace/DocumentList.tsx    | 81 +++++++++++++------
 hub/web/src/features/workspace/NeedsYouSection.tsx | 80 ++++++++++++-------
 .../src/features/workspace/OrchestratorCard.tsx    |  2 +-
 .../src/features/workspace/SubagentsSection.tsx    |  2 +-
 .../src/features/workspace/WorkspacePage.test.tsx  | 91 ++++++++++++++++++++++
 hub/web/src/features/workspace/WorkspacePage.tsx   | 14 ++--
 hub/web/src/state/selectors.ts                     | 18 ++++-
 17 files changed, 289 insertions(+), 72 deletions(-)
````

(diff is 624 lines; read the full diff file)

## Review round 1: PASS (29/10/26 02:24)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 0bf7264af3c8, commits 0bf7264af3c8

# Review: hub5 T2, Decisions panel + document filters (`hub/server`, `hub/web`)

Verdict: **PASS**

## Checked (re-run by lead)
- Server: 8 tests pass. Web: 44 tests pass. Typecheck: 0 errors. Build OK (only Vite's chunk-size warning).
- Backend: no source change was needed. The connector routes already publish `workspace` on hello and goodbye. The worker replaced the test's hand-published event with a real `hello`; the `workspaces` frame now reaches the fake proxy from that alone.
- Web:
  - The tab and section are renamed to **Decisions**: open decisions on top, then "All decisions" from every run, newest `openedAt` first.
  - Documents is one list, newest first, with search (title, id, name, run) and **Docs / Diffs / Decisions** filter chips. Decision documents open the structured decision page (`decisionForDocument`).
  - New tests are in `WorkspacePage.test.tsx`; the adapter and mock data are updated.

## Finding outside T2 (lead fix)
- The real cause of "the proxy didn't learn the new workspace" is in the proxy, not the backend. `ComputerRelay` keeps `computerId` only in memory. After the hibernating Durable Object is unloaded and woken, a `workspaces` frame, which carries no computer id, fails the id check and is dropped as malformed. Fixed in `hub/proxy` by the lead (separate commit).

## Integration: merged (29/10/26 02:26)

- On `agent/integration-hub5` at 8f6674994aaa; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub5/logs/post-merge-T2-a1.log`)

## Final gate: PASS (29/10/26 02:29)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub5 at 8f6674994aaa (log `.orchestrator/runs/hub5/logs/verify-1793215699.log`)
- Task MERGED; run DONE
