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
