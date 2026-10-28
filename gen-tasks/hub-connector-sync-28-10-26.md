# Hub connector sync, kit side (28/10/26)

## Goal
A workspace with `hub.enabled` runs `python3 .agent-system/agentctl.py watch`, which pushes the
snapshot, decisions, events and documents to the hub backend over the v1 protocol, writes the
`.orchestrator/hub.json` hint, and exits with the workspace. `decision ask` tells Opus to ask in
plain chat when the hub is online.

## Read first
- `plans/261028-1511-agent-hub-build/phase-a1-kit-sync.md`: **the full spec for this task**
  (work items 1-7, tests, done criteria). Every design decision is made there; follow it exactly.
- `docs/hub-api.md` sections 1-3, 5, 8: the protocol behavior (the contract).
- `.agent-system/hubschema.py`: `validate(def, data)`; use it for every message.
- `hub/protocol/fixtures/*.json`: the exact shapes to produce (`Snapshot.running.json`,
  `Decision.*.json`, `Document.final-report.json`, `HelloRequest.json`, ...).
- `.agent-system/scheduler.py`: `log_event`, `decision_ask`, `doctor`, `SECRET_PATTERNS`, `Store`.
- `.agent-system/kitstart.py`: `agent_name`, `launch`. `.agent-system/tests/test_scheduler.py`: test
  helpers and the fake Herdr runner style to copy.

## Steps
1. Implement work items 1-7 of the phase file in order: scheduler bits, the `hub` block in
   `config.json`, the new `agentctl.py`, kitstart, deny rules, install list, the README rows.
2. Add `tests/test_agentctl.py` and the scheduler test additions listed under "Tests" in the phase
   file (fake backend = `http.server` on 127.0.0.1:0; fake Herdr = an injected runner).
3. **No command handling** (no `GET .../commands`, no answers or prompts): that's a later task.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/**` except `.agent-system/hubschema.py` and `.agent-system/hub-protocol.schema.json`

**You must not edit:**
- `hub/**`, `docs/**`, `plans/**`, `gen-tasks/**`, `.gitignore`, `README.md` (root).
- The protocol (schema, fixtures, `docs/hub-api.md`): if it doesn't fit, work within it and list
  the gap in your report's `risks`.

**You may run:**
- `python3 -m unittest discover -s .agent-system/tests` and single test modules; `python3
  .agent-system/agentctl.py ...` against temp folders and your fake backend; read-only git.

**You must not run:**
- Real Herdr commands against live agents (`herdr agent ...`, `herdr workspace ...`), real
  `codex`/`claude`, anything touching `~/.config/agent-hub` or `~/.local/share/agent-hub` (use temp
  dirs via `AGENT_HUB_CONFIG`), package installs, `git push/merge/rebase/reset/checkout`.

**When to ask:** only for a real blocker (the spec contradicts the code) → report "blocked" with
the reason. Everything else: just do it.

## Do not
- Refactor or reformat existing scheduler code beyond the listed changes. Add no dependencies
  (stdlib only, Python 3.10-compatible).

## Done when
- [ ] Every item and test in the phase file is done.
- [ ] Every message the fake backend receives passes `hubschema.validate`.
- [ ] The full kit suite passes (it was 104 tests before this task).

## Run these
- `python3 -m unittest discover -s .agent-system/tests`: expect OK.
- `python3 -m unittest .agent-system/tests/test_hubschema.py -v` (or `discover -p test_hubschema.py`):
  expect OK (it must still pass untouched).

## Notes
- The org sets `HTTPS_PROXY`; loopback HTTP must use `urllib.request.build_opener(ProxyHandler({}))`.
- Canonical JSON for hashes: `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()`.
- In your report, explain how you derived worker `since`, `review` documents, research evidence
  paths and decision `agent`.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (28/10/26 15:33)

- Status: **blocked** (worker worker-1, branch `agent/hub1-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported:
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 0
  - `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py -v` -> exit 0
- Risks:
  - Blocked: the phase requires uploading review reports passed to mark-reviewed and says to find the paths recorded by the scheduler. In scheduler.py, mark_reviewed accepts report text only; the CLI reads --report and passes its contents, while state records verdict/notes and appends the text to the task packet. No review report path is stored in run state, so the requested review-document source cannot be derived without changing scheduler behavior beyond the plan.
- Not done:
  - Stopped before implementation as required by the task rules for a code/spec mismatch. Worker since derivation and sync mappings were not implemented; the spec identifies research evidence via research.rounds[].evidence_path and decision agent via tasks[task_id].worker, otherwise orchestrator.
- Full diff: `.orchestrator/runs/hub1/reports/T1.diff`

## Decision D1 needed (blocker) (28/10/26 15:33)

**T1 blocked: spec asks for review-report files the scheduler doesn't store**

Worker stopped before coding: phase A1 says upload review reports from paths recorded by mark-reviewed, but mark-reviewed stores only the text (appended to the task file). Fix: drop the separate review source (review text already ships inside task_file documents) and define worker since = time of the slot's last worker transition event; then relaunch T1 unchanged otherwise.

- `A`: Clarify spec as proposed and relaunch T1 (recommended)
- `B`: Stop T1, I'll rethink the spec

Waiting for the user's answer in chat.

## Decision D1 answered by the user (28/10/26 15:34)

- Choice: **A**: Clarify spec as proposed and relaunch T1
- User's words (chat): "A: Clarify spec, relaunch (Recommended)"

## Clarification after block (decision D1: user chose A, 28/10/26)

This overrides the phase file where they differ:
- **Review documents:** drop the separate `review` source. `mark-reviewed` stores no report path;
  the review text is appended to the task file, which is already uploaded as `task_file`. Never
  produce `kind: "review"` documents. Don't change `mark-reviewed`.
- **Worker `since`:** the `at` of the newest event in that run's `events` with `kind == "worker"`
  and `worker == <slot>`. If there is none, use the slot's `session_started_at`, else `null`.
- Everything else in the task file and the phase file stands. Start the implementation now.

## Worker result - attempt 2 (28/10/26 15:53)

- Status: **done** (worker worker-1, branch `agent/hub1-t1-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/README.md`, `.agent-system/agentctl.py`, `.agent-system/config.json`, `.agent-system/kitstart.py`, `.agent-system/scheduler.py`, `.agent-system/scripts/install.sh`, `.agent-system/templates/claude-settings.json`, `.agent-system/tests/test_agentctl.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 0
  - `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py -v` -> exit 0
  - `git diff --check` -> exit 0
- Risks:
  - Worker since comes from the newest run event with kind=worker and matching worker slot; it falls back to workers[slot].session_started_at, then null.
  - No separate review document is uploaded: per the D1 clarification, review text is already included in task_file content and kind=review is never emitted.
  - Research documents use research.rounds[].evidence_path. Decision agent uses tasks[task_id].worker, falling back to orchestrator.
  - The checkout contains the hub protocol schemas and fixtures but no backend implementation. Fake-backend requests passed schema validation; production endpoint integration remains unverified. No other contract mismatch or open question was found.
- Not done: none
- Full diff: `.orchestrator/runs/hub1/reports/T1.diff`

````text
 .agent-system/README.md                      |    2 +
 .agent-system/agentctl.py                    | 1044 ++++++++++++++++++++++++++
 .agent-system/config.json                    |    1 +
 .agent-system/kitstart.py                    |   35 +
 .agent-system/scheduler.py                   |   62 +-
 .agent-system/scripts/install.sh             |    2 +-
 .agent-system/templates/claude-settings.json |    6 +-
 .agent-system/tests/test_agentctl.py         |  353 +++++++++
 .agent-system/tests/test_scheduler.py        |   87 +++
 9 files changed, 1585 insertions(+), 7 deletions(-)
````

(diff is 1730 lines; read the full diff file)

## Review round 2: PASS (28/10/26 15:56)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: e87fb6bc8fb0, commits e87fb6bc8fb0

# Review: hub1 T1, kit connector sync (phase A1)

Verdict: **PASS**

## Checked
- Scheduler diff: `log_event` `n` counter + trim kept; `decision_ask` hub hint (online needs backend online,
  heartbeat < 90 s, live pid; any error → offline); `doctor` hub checks only when enabled, ping lazily
  imported from agentctl, backend down = warn.
- agentctl: ProxyHandler({}) on every request; canonical hash matches contract; scrubber applied to
  snapshot, hello, documents, log lines; key never printed; 409 duplicate → exit 2; goodbye + pidfile
  cleanup + offline hint in `finally`; backoff 1→60 s; resync by hello hashes after reconnect.
- kitstart: connector start is best-effort, never fails start.
- Tests: 120 OK (`python3 -m unittest discover -s .agent-system/tests`).
- Real-data dry run (hub1 state copied to a temp workspace with an id): hello, snapshot, 2 decisions,
  3 documents all validate. 0 events because hub1 events predate `n` (expected per spec).

## Minor (follow-up, not blocking)
- Idle loop wakes every 0.5 s and runs `herdr agent get` for the orchestrator on every wake (~2 subprocess
  calls/s). Check liveness only when `due`. Fix in A2.
- Snapshot hash excludes `taken_at`; if the backend hashes differently, the first post-hello snapshot is
  resent once. Harmless; confirm at M1.
- Backend integration unverified until M1 (real `watch` against T2 server).

## Integration: merged (28/10/26 15:57)

- On `agent/integration-hub1` at 079699fea38f; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub1/logs/post-merge-T1-a2.log`)

## Final gate: PASS (28/10/26 15:59)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub1 at bbb60fb72f7b (log `.orchestrator/runs/hub1/logs/verify-1793177959.log`)
- Task MERGED; run DONE

## Finished (28/10/26 16:00)

- merged into hub/plan (decision D3)
