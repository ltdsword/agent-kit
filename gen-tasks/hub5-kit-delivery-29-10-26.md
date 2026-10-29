# hub5 kit delivery (29/10/26)

## Goal
The connector delivers website commands (answer, reply, prompt) to the orchestrator, and the hub setup commands work in the right order (hub-login, hub start/stop, enable keeps config formatting).

## Read first
- `plans/261029-0150-hub5-delivery-decisions/plan.md` section **T1**: **the full spec** (work items, tests). Follow it exactly.
- `docs/hub-api.md` sections 3.3 (commands) and 4 (connector behavior per command); `.agent-system/hub-protocol.schema.json` (`CommandsResponse`, `Command`, `AckRequest`).
- `.agent-system/agentctl.py` (`watch`, `_herdr_record`), `.agent-system/scheduler.py` (`decision_answer`, the herdr prompt helper), `.agent-system/hubctl.py`, `.agent-system/kitstart.py` (how `agent-kit start` launches `agentctl watch`).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/**` except `hubschema.py` and `hub-protocol.schema.json`

**You must not edit:**
- `hub/**`, `docs/**`, `plans/**`, `gen-tasks/**`, root `README.md`, `.gitignore`.
- The protocol contract: if it doesn't fit, implement the closest faithful behavior and list the gap in `risks`.

**You may run:**
- `python3 -m unittest discover -s .agent-system/tests` and single modules; `python3 .agent-system/*.py ...` against temp dirs, fake HTTP servers on 127.0.0.1 and fake herdr runners; read-only git. Python stdlib only (3.10+ syntax).

**You must not run:**
- `git push/merge/rebase/reset/checkout`; real `herdr`/`codex`/`claude`; anything that talks to Cloudflare;
  reading `~/.config/.wrangler/**`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub` (use temp dirs via env vars); downloads.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `python3 -m unittest discover -s .agent-system/tests` passes.

## Run these
- `python3 -m unittest discover -s .agent-system/tests`: expect OK

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (29/10/26 02:12)

- Status: **done** (worker worker-2, branch `agent/hub5-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/README.md`, `.agent-system/agentctl.py`, `.agent-system/hubctl.py`, `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/tests/test_agentctl.py`, `.agent-system/tests/test_hubctl.py`
- Scope: OK
- Tests reported:
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub5/reports/T1.diff`

````text
 .agent-system/README.md                         |   6 +-
 .agent-system/agentctl.py                       | 286 +++++++++++++++++++++++-
 .agent-system/hubctl.py                         |  60 ++++-
 .agent-system/templates/ORCHESTRATOR.section.md |   6 +
 .agent-system/tests/test_agentctl.py            | 200 ++++++++++++++++-
 .agent-system/tests/test_hubctl.py              |  94 +++++++-
 6 files changed, 638 insertions(+), 14 deletions(-)
````

(diff is 863 lines; read the full diff file)

## Review round 1: PASS (29/10/26 02:16)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: a956b117cee1, commits a956b117cee1

# Review: hub5 T1, command delivery + setup order (`.agent-system`)

Verdict: **PASS**, with one lead fix.

## Checked
- `python3 -m unittest discover -s .agent-system/tests`: 143 OK (re-run by lead).
- **Answer:** `scheduler.decision_answer(channel="hub", by=command.by, quote=note or label)`. A `SchedulerError` is acked `REJECTED` with its scrubbed message.
- **Notice texts** follow the contract (`[hub] D3 answered by …`, reply, prompt) and are scrubbed.
- **Acks:** orchestrator blocked or not live → `HELD`; other errors → `FAILED`.
- **No double typing:** `hub-log.jsonl` is written before acking and is checked on restart.
- **Network:** loopback with no proxy (`ProxyHandler({})`).
- The orchestrator template gets the `[hub]` rules. `hubctl` covers the setup order, `hub stop` waiting, and `enable` keeping the config formatting.

## Lead fix
- Commands were long-polled with `wait=25` in the same loop as the 5 s sync. Each idle loop then took about 30 s, which would have delayed decisions and screen updates on the website. Changed to `wait = sync interval` (5 s, capped at 25) and updated the test that pinned `25`.

## Integration: merged (29/10/26 02:26)

- On `agent/integration-hub5` at 9c865ec395d3; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub5/logs/post-merge-T1-a1.log`)

## Final gate: PASS (29/10/26 02:29)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub5 at 8f6674994aaa (log `.orchestrator/runs/hub5/logs/verify-1793215699.log`)
- Task MERGED; run DONE

## Finished (29/10/26 02:30)

- merged into hub/plan (decision D1)
