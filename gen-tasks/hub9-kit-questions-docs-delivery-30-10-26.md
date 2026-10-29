# Kit: questions inbox, publish, idle-only hub delivery (30/10/26)

## Goal
Kit and connector deliver hub notices/prompts only when Opus is idle on the 1-2-4-8-16x4 then 32 s/10 min schedule, provide the `inbox` questions run with `ask` and pruning to 100, publish plans/reviews/side documents, and install the AskUserQuestion and auto-publish hooks into every workspace.

## Read first
- `plans/261030-0141-hub9-questions-docs-delivery/plan.md`: sections **User decisions**, **Contract** and **T1**: **the full spec** (work items, tests). Follow it exactly.
- `.agent-system/agentctl.py` (`_deliver_command`, `_type_hub_notice`, `_retry_hub_notices`, `watch`, `load_runs`, `document_refs`, `make_documents`), `.agent-system/scheduler.py` (`create_run`, `decision_ask`, `mark_reviewed`), `.agent-system/scripts/install.sh` (`merge_settings`), `.agent-system/templates/claude-settings.json`, existing tests in `.agent-system/tests/`.

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/agentctl.py`
- `.agent-system/scheduler.py`
- `.agent-system/scripts/install.sh`
- `.agent-system/scripts/hub-hooks.py`
- `.agent-system/templates/claude-settings.json`
- `.agent-system/templates/ORCHESTRATOR.section.md`
- `.agent-system/tests/test_agentctl.py`
- `.agent-system/tests/test_scheduler.py`
- `.agent-system/tests/test_hub_hooks.py`

**You must not edit:**
- Any other file; also `hub/protocol/**` and `hub/web/src/api/types.ts` (contract, fixed), `plans/**`, `gen-tasks/**`, `.orchestrator/**`, root files.

**You may run:**
- Python 3 (`python3 -m pytest`), `bash -n`, read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `wrangler` or `vercel`; anything that talks to Cloudflare or Vercel;
  reading `~/.config/.wrangler`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub`; `systemctl`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh` passes.

## Run these
- `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh`: expect tests (and typecheck) pass

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.
