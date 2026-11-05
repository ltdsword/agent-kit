# hcnotify: deliver hub notices to a working orchestrator in the Herdr app (05/11/26)

## Goal
When the person answers a decision or sends a prompt from the phone/website, the connector types it into
the orchestrator's terminal even while the orchestrator is working (hc backend), so the orchestrator never
has to remember to watch for answers. Old herdr keeps today's behaviour.

## Facts (Opus, verified 05/11/26)
- User decision 05/11/26: "ok approve" (T4: deterministic notice delivery instead of the model remembering).
- `hc send <t> <text>` into a terminal whose agent status is `working` succeeds (exit 0, stdout
  `{"started":true,"status":"working","turn":23}`); Claude Code queues it and shows it as the next user
  message. `hc send` refuses while `blocked` (never use `--force`).
- Today `_type_hub_notice`, `_deliver_command` and `_retry_hub_commands` in `.agent-system/agentctl.py` only
  deliver when the state is in `READY_STATES` (idle/done) and otherwise HOLD; answer notices are dropped after
  `HUB_DELIVERY_TIMEOUT` (10 min). Logs: "answer notice dropped after 10 minutes" seen repeatedly.
- `S.Hc.agent_prompt` refuses non-ready states, so it cannot be used for a working target.

## Read first
- `.agent-system/agentctl.py`: `READY_STATES`, `_type_hub_notice` (~1206), `_deliver_command` (~1297),
  `_retry_hub_notices`, `_retry_hub_commands` (~1395), `_backends`, `_herdr_record_for_workspace`.
- `.agent-system/scheduler.py`: `class Hc` (`binary`, `runner`, `_run`, `agent_prompt`) - read only.
- `.agent-system/tests/test_agentctl.py`: `fake_connectors` and the hc prompt tests.

## Steps
1. In agentctl.py add `_deliverable(state, backend) -> bool`: True when `state in READY_STATES`, or when
   `getattr(backend, "backend", None) == "hc"` and `state == "working"`.
2. Add `_send_notice(backend, target, state, text, cfg)`: if the state is in READY_STATES -> existing
   `backend.agent_prompt(target, text, cfg["herdr"]["prompt_ack_timeout_ms"])`; else (hc + working) ->
   run `[backend.binary, "send", target, text]` with `backend.runner` (capture_output, text, shell=False,
   timeout=5); non-zero exit or no process -> raise `S.SchedulerError("hc send failed: ...")`. Never `--force`.
3. Use them in all three places: `_type_hub_notice`, `_deliver_command` (prompt path) and
   `_retry_hub_commands`: replace `state not in READY_STATES` by `not _deliverable(state, backend)` and the
   delivery call by `_send_notice(...)`. HELD/retry/ack/log behaviour, texts and timeouts otherwise unchanged
   (blocked/absent/unknown still hold and expire as today).
4. Tests (fakes only) in test_agentctl.py:
   - hc orchestrator working + answer command -> one `hc send <target> <notice>` call, no HELD ack, no retry.
   - hc orchestrator working + phone prompt -> delivered (`hc send`), ack DELIVERED.
   - hc orchestrator blocked -> HELD as today, no send.
   - legacy orchestrator working -> HELD as today (unchanged).
   - hc send exit 1 while working -> answer notice goes to the retry list; prompt acks FAILED as today.

## Boundaries
**You may edit:** `.agent-system/agentctl.py`, `.agent-system/tests/test_agentctl.py`.
**You must not edit:** scheduler.py, kitstart.py, hubctl.py, hub protocol, hub/**, docs, plans/**,
gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `hc`, `herdr*`, `agentctl.py watch`, the hub backend; git push/merge/rebase/reset/
checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Do not
- Use `hc send --force`; deliver to a blocked agent; change the hub protocol or ack semantics; print secrets.

## Done when
- [ ] Working hc orchestrators receive notices and prompts; legacy unchanged; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
