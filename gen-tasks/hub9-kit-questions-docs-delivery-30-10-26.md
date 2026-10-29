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

## Worker result - attempt 1 (30/10/26 02:02)

- Status: **done** (worker worker-1, branch `agent/hub9-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/agentctl.py`, `.agent-system/scheduler.py`, `.agent-system/scripts/hub-hooks.py`, `.agent-system/scripts/install.sh`, `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/templates/claude-settings.json`, `.agent-system/tests/test_agentctl.py`, `.agent-system/tests/test_hub_hooks.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh` -> exit 0
  - `git diff --check` -> exit 0
- Risks:
  - Held prompt/reply retry schedules are process-local; a connector restart starts a fresh schedule when the backend reoffers the command.
- Not done: none
- Full diff: `.orchestrator/runs/hub9/reports/T1.diff`

````text
 .agent-system/agentctl.py                       | 285 +++++++++++++++++++++---
 .agent-system/scheduler.py                      | 102 ++++++++-
 .agent-system/scripts/hub-hooks.py              | 149 +++++++++++++
 .agent-system/scripts/install.sh                |  22 +-
 .agent-system/templates/ORCHESTRATOR.section.md |   6 +
 .agent-system/templates/claude-settings.json    |   6 +
 .agent-system/tests/test_agentctl.py            | 211 +++++++++++++++++-
 .agent-system/tests/test_hub_hooks.py           |  91 ++++++++
 .agent-system/tests/test_scheduler.py           |  49 ++++
 9 files changed, 872 insertions(+), 49 deletions(-)
````

(diff is 1345 lines; read the full diff file)

## Review round 1: PASS (30/10/26 02:04)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: b8fec88f59bb, commits b8fec88f59bb

# Review: hub9 T1 kit questions, docs, delivery

Verdict: PASS (2 small hook fixes by Opus before commit)

## Checked
- Delivery: constants HUB_RETRY_DELAYS (1,2,4,8,16,16,16,16), 32 s interval, 10 min timeout; idle-only typing; prompts/replies ack HELD "waiting for Opus…", re-offered HELD keeps schedule, DELIVERED on success, FAILED "Opus stayed busy for 10 minutes; not delivered"; answer notices dropped with log after 10 min. Watch loop long-poll shrinks to 1 s while anything is scheduled.
- Inbox: `scheduler.py ask` / `agentctl ask`, inbox run excluded from newest/active run and runs list, decisions synced; pruning to 100 never drops OPEN.
- Documents: `run create --plan`, review report paths stored by mark-reviewed; `agentctl publish/unpublish` manifest with path/suffix/size/secret checks; kinds by path rule.
- Hooks: PreToolUse AskUserQuestion → inbox + deny with wait commands when connector alive; PostToolUse Write|Edit auto-publishes plans/ and docs/ .md; install.sh merges template hooks by command, idempotent.
- 178 kit tests + `bash -n install.sh` pass (rerun by Opus).

## Opus fixes
- Hub not connected: hook returns no output (was "allow"), test updated.
- Wait command in deny reason uses `python3 .agent-system/scheduler.py`.

## Notes
- Delivery schedule is in memory; a connector restart restarts the schedule for held prompts (backend re-offers HELD after 5 s).

## Integration: merged (30/10/26 02:04)

- On `agent/integration-hub9` at 593e6d851675; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub9/logs/post-merge-T1-a1.log`)

## Final gate: PASS (30/10/26 02:07)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub9 at c7aed2b45378 (log `.orchestrator/runs/hub9/logs/verify-1793300785.log`)
- Task MERGED; run DONE
