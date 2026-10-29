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
