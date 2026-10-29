# Website: Questions panel, document filters, paging (30/10/26)

## Goal
The website shows inbox decisions in a new Questions panel/tab and labels them Question in History, filters documents by Run (with per-kind toggles) / Plan / Other, pages Documents, Decisions, Questions and History at 30 rows, and shows the first 15 plus a More button on the Everything tab.

## Read first
- `plans/261030-0141-hub9-questions-docs-delivery/plan.md`: sections **User decisions**, **Contract** and **T3**: **the full spec** (work items, tests). Follow it exactly.
- `hub/web/src/features/workspace/WorkspacePage.tsx`, `DocumentList.tsx`, `NeedsYouSection.tsx`, `HistoryPreview.tsx`, `RunCard.tsx`, `hub/web/src/features/history/*`, `hub/web/src/state/selectors.ts`, `hub/web/src/lib/status.ts`, `hub/web/src/api/types.ts` (read only), existing `*.test.tsx`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/web/src/features/**`
- `hub/web/src/components/**`
- `hub/web/src/lib/**`
- `hub/web/src/state/**`
- `hub/web/src/api/mock/**`
- `hub/web/src/api/http/adapter.ts`

**You must not edit:**
- Any other file; also `hub/protocol/**` and `hub/web/src/api/types.ts` (contract, fixed), `plans/**`, `gen-tasks/**`, `.orchestrator/**`, root files.

**You may run:**
- Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`), `npx vitest run`, `npx tsc --noEmit -p .` inside `hub/web`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `wrangler` or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T3 is done.
- [ ] `cd hub/web && npx vitest run && npx tsc --noEmit -p .` passes.

## Run these
- `cd hub/web && npx vitest run && npx tsc --noEmit -p .`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

## Worker result - attempt 1 (30/10/26 01:54)

- Status: **done** (worker worker-3, branch `agent/hub9-t3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `hub/web/src/components/Pager.test.tsx`, `hub/web/src/components/Pager.tsx`, `hub/web/src/features/history/HistoryPage.test.tsx`, `hub/web/src/features/history/HistoryPage.tsx`, `hub/web/src/features/history/HistoryRow.tsx`, `hub/web/src/features/workspace/DocumentList.tsx`, `hub/web/src/features/workspace/HistoryPreview.tsx`, `hub/web/src/features/workspace/NeedsYouSection.tsx`, `hub/web/src/features/workspace/QuestionsSection.tsx`, `hub/web/src/features/workspace/RunCard.tsx`, `hub/web/src/features/workspace/WorkspacePage.test.tsx`, `hub/web/src/features/workspace/WorkspacePage.tsx`, `hub/web/src/lib/status.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run && npx tsc --noEmit -p .` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub9/reports/T3.diff`

````text
 hub/web/src/components/Pager.test.tsx              |  18 +++
 hub/web/src/components/Pager.tsx                   |  35 +++++
 hub/web/src/features/history/HistoryPage.test.tsx  |  27 ++++
 hub/web/src/features/history/HistoryPage.tsx       |  18 ++-
 hub/web/src/features/history/HistoryRow.tsx        |   8 +-
 hub/web/src/features/workspace/DocumentList.tsx    |  57 ++++++--
 hub/web/src/features/workspace/HistoryPreview.tsx  |  11 +-
 hub/web/src/features/workspace/NeedsYouSection.tsx |  47 ++++--
 .../src/features/workspace/QuestionsSection.tsx    |  51 +++++++
 hub/web/src/features/workspace/RunCard.tsx         |   9 +-
 .../src/features/workspace/WorkspacePage.test.tsx  | 160 +++++++++++++++++++--
 hub/web/src/features/workspace/WorkspacePage.tsx   |  24 ++--
 hub/web/src/lib/status.ts                          |   2 +-
 13 files changed, 398 insertions(+), 69 deletions(-)
````

(diff is 837 lines; read the full diff file)

## Review round 1: PASS (30/10/26 01:54)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 86de793fcfe2, commits 86de793fcfe2

# Review: hub9 T3 web questions, filters, paging

Verdict: PASS

## Checked
- Questions tab/panel (`QuestionsSection`): inbox decisions only, ids shown as Q<n>; inbox excluded from Decisions/NeedsYou/in-flight; open questions counted separately on the tab.
- Documents: chips Run/Plan/Other (none = all); Run reveals Final report/Diff/Decisions/Scout toggles (default on); Plan=plan, Other=review+other; filter/search reset page.
- Shared `Pager` (30/page) on Documents, Decisions (All decisions), Questions, History; Everything shows first 15 + "More…" switching tab.
- History: inbox rows labelled "Question"; prompt FAILED shows reason; HELD label "Waiting for Opus".
- 65 web tests + tsc pass (rerun by Opus).

## Notes
- Decision detail page still titles inbox questions "D<n>" (panel shows Q<n>); cosmetic.

## Integration: merged (30/10/26 02:04)

- On `agent/integration-hub9` at c7aed2b45378; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub9/logs/post-merge-T3-a1.log`)

## Final gate: PASS (30/10/26 02:07)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub9 at c7aed2b45378 (log `.orchestrator/runs/hub9/logs/verify-1793300785.log`)
- Task MERGED; run DONE

## Finished (30/10/26 02:16)

- merged into hub/plan (decision D1)
