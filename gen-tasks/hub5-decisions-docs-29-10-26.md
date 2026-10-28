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
