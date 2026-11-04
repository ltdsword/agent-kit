# hcport connector (04/11/26)

## Goal
The hub connector (`agentctl.py`) finds the orchestrator, reads its screen and delivers phone/website
prompts through either backend (new Herdr app `hc` or old herdr), so a workspace stays ONLINE wherever
its orchestrator runs.

## Read first
- `plans/261104-2103-herdr-app-hc/plan.md`: sections "Exact output samples", C1 (the adapter API, already
  merged from T1) and **C3 (your spec)**.
- `.agent-system/scheduler.py`: `Hc`, `Herdr` new methods (`agent_record`, `agent_list`, `agent_read`),
  `make_herdr`, `READY_STATES`, `HUB_STATES` (merged by T1; read the real code).
- `.agent-system/agentctl.py`: `READY_STATES` (~42), `_herdr_record` (~396), `_herdr_record_for_workspace`
  (~422), `_screen` (~539), `_run_snapshot`/`build_sync` orchestrator + worker states (~626-670),
  `_orchestrator_alive` (~1118), prompt delivery (~1175-1185, ~1310-1330, ~1380-1390), `watch` (~1533).
- `.agent-system/kitstart.py`: `saved_session` / `session_file` (orchestrator.json; T3 adds key `backend`).
- `.agent-system/tests/test_agentctl.py`: `fake_herdr` and the watch tests.

## Steps
1. In `agentctl.py`, `READY_STATES` becomes `from scheduler: S.READY_STATES` (keep the module-level name).
2. Add `_backends(ws, cfg, runner) -> list` (C3 order): `.orchestrator/orchestrator.json` `backend`
   (hc/legacy) first if present; else `cfg["herdr"].get("backend", "auto")` if hc/legacy; else
   `[S.Hc(runner=runner), S.Herdr(runner=runner)]`. Instances are built with the given `runner`.
3. Rewrite `_herdr_record(name, runner, backends=None)` -> `(rec, state, backend)` using
   `backend.agent_record`: first backend whose state is not absent/unknown wins; else "absent" if any
   backend answered absent; else "unknown". Keep a thin compatibility wrapper if other code expects the old
   2-tuple, or update every caller in this file.
4. Rewrite `_herdr_record_for_workspace` on top of step 3, then each backend's `agent_list()` for the
   unnamed-orchestrator fallback (REC.kind == configured kind, resolved REC.cwd == workspace); return the
   backend too. Target for later calls = REC name if set, else REC.pane_id.
5. `_screen(name, lines, runner, backend)` -> `backend.agent_read` + `scrub`, last `min(max(lines,1),200)` lines.
6. Prompt delivery (all three places): look up via step 3/4, require state in READY_STATES, deliver with
   `backend.agent_prompt(target, text, cfg["herdr"]["prompt_ack_timeout_ms"])` of the backend that found it.
   Keep the existing HELD/retry behaviour and log lines unchanged.
7. Snapshot: orchestrator and worker `herdr_state` from REC states (always in `S.HUB_STATES`); workers use
   the run's `state.get("herdr_backend")` backend when recorded, else the probe order.
8. `watch` + `_orchestrator_alive`: same liveness rule (2 consecutive absent/unknown -> orchestrator_gone),
   now via step 4.
9. Tests in `test_agentctl.py` (fake runner answering both `herdr ...` and `hc ...` argv; replay the plan's
   samples). Existing tests: keep them passing; if a fake only speaks old herdr, pin
   `cfg["herdr"]["backend"] = "legacy"` in that test's config rather than changing its assertions. New cases:
   - hc-only orchestrator by name: snapshot state working; screen from `hc read` (scrubbed, `[hc]` lines gone).
   - unnamed hc orchestrator found by cwd + kind (status.app claude-code -> claude).
   - hc `error` status -> snapshot `unknown` (valid against the protocol enum).
   - phone prompt to an idle hc orchestrator -> `hc send` called once; while working -> HELD, no send.
   - hc says not_found and legacy has it -> legacy wins (mixed backends).
   - orchestrator.json backend "hc" -> legacy never called.
   - orchestrator finished in hc on two checks -> watch ends with reason orchestrator_gone.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/agentctl.py`
- `.agent-system/tests/test_agentctl.py`

**You must not edit:**
- `scheduler.py` (if the T1 API is missing something you need, report "blocked" naming it), `kitstart.py`,
  `hubctl.py`, `hub-protocol.schema.json`, `hub/**`, docs, `plans/**`, `gen-tasks/**`, `.orchestrator/**`.

**You may run:**
- `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.

**You must not run:**
- `hc`, `herdr`, `herdr-app`, the hub backend or `agentctl.py watch` against the real machine; network to the
  real hub; `git push/merge/rebase/reset/checkout`; installs; `systemctl`.

**When to ask:** only for a real blocker -> report "blocked" with the exact reason. Otherwise just do it.

## Do not
- Change the hub protocol, sync payload shape, command ack semantics, scrub rules or the connector's
  backoff/HELD logic. Print secrets (keys, tokens) anywhere, including tests.

## Done when
- [ ] No raw `["herdr", ...]` subprocess call remains in agentctl.py; all go through backend objects.
- [ ] New and existing tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

## Notes
- The hub validates snapshot states against `idle, working, blocked, done, unknown, absent`; never pass
  through a raw hc status.
- hc `send` refuses while blocked unless --force: never use --force (a blocked agent needs the person).

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (04/11/26 21:49)

- Status: **done** (worker worker-1, branch `agent/hcport-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/agentctl.py`, `.agent-system/tests/test_agentctl.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k 'hc or unnamed_hc or missing_hc or saved_hc'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k 'hc or unnamed_hc or missing_hc or saved_hc'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k 'hc or unnamed_hc or missing_hc or saved_hc'` -> exit 0
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k workers_without_recorded_backend` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k workers_without_recorded_backend` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done:
  - Commit left uncreated because .git is read-only in this worktree.
- Full diff: `.orchestrator/runs/hcport/reports/T2.diff`

````text
 .agent-system/agentctl.py            | 199 ++++++++++++++++++++---------------
 .agent-system/tests/test_agentctl.py | 185 +++++++++++++++++++++++++++++++-
 2 files changed, 300 insertions(+), 84 deletions(-)
````

(diff is 533 lines; read the full diff file)

## Review round 1: PASS (04/11/26 21:54)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 115e3d540e39, commits 115e3d540e39
- Notes: connector per C3; PEM scrub regression fixed in review; 219 tests pass

# Review hcport T2 - connector (Opus)

Verdict: PASS (with one orchestrator fix applied before commit)

- C3 met: `_backends` order orchestrator.json backend -> config -> [Hc, Herdr]; `_herdr_record` returns
  (rec, state, backend), first non-absent/unknown wins, states forced into HUB_STATES; workspace fallback via
  `agent_list` by kind + resolved cwd; target = REC name or pane_id.
- No raw `["herdr", ...]` subprocess call left in agentctl.py; all 3 prompt-delivery paths use the finding
  backend's `agent_prompt`, HELD/retry + log lines unchanged; READY_STATES imported from scheduler.
- Snapshot workers use the run's `herdr_backend`, else probe both; watch/_orchestrator_alive use the same rule.
- **Fixed (MAJOR, security):** `_screen` scrubbed line by line, so a multi-line PEM block was no longer
  matched by PEM_RE and its body would reach the hub. Now scrubs the joined text then splits (old behaviour).
  Added `test_hc_screen_redacts_multiline_pem_block`.
- Minor (accepted): an hc agent with null status (unknown) plus legacy absent reports `absent`; liveness rule
  treats both the same.
- Tests: 9 worker tests + 1 review test; whole suite 219 passed (Opus rerun).

## Integration: merged (04/11/26 21:54)

- On `agent/integration-hcport` at 6470aff8a86d; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcport/logs/post-merge-T2-a1.log`)

## Final gate: PASS (04/11/26 21:57)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcport at 924a5efe4623 (log `.orchestrator/runs/hcport/logs/verify-1793804198.log`)
- Task MERGED; run DONE

## Finished (04/11/26 22:39)

- merged into hub/plan (decision D1)
