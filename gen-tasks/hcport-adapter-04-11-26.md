# hcport adapter (04/11/26)

## Goal
`scheduler.py` can drive workers through the new Herdr app's core (`hc`) as well as old herdr, chosen by
`herdr.backend` (auto/hc/legacy) and recorded per run, with every agent state normalized to the hub's enum.

## Read first
- `plans/261104-2103-herdr-app-hc/plan.md`: the whole plan; **sections "Verified facts", "Exact output
  samples", C1 and C2 are your spec** (follow them exactly; they are the contract T2/T3 build on).
- `.agent-system/scheduler.py`: `_agent_state`, `_pick_id`, `class Herdr` (~646-712), `Scheduler.__init__`
  (`self.herdr`), `_launch_session`, `dispatch_ready`, `wait` (blocked check + "herdr agent read" hint),
  `collect`, `status/reconcile` (~2300), `cleanup` (~2375), `validate_config` (herdr keys), `doctor` (~2567-2606).
- `.agent-system/agentctl.py:42-44`: `READY_STATES` (move the definition to scheduler.py, see Steps).
- `.agent-system/models.py`: `binary(kind)`.
- `.agent-system/tests/test_scheduler.py`: `FakeHerdr`, `StartHerdr`, `TestDispatch`, doctor tests.

## Steps
1. In `scheduler.py`, add `READY_STATES = ("idle", "done")` near `_agent_state`, with the existing comment
   from agentctl. Add `HUB_STATES = ("idle", "working", "blocked", "done", "unknown", "absent")`.
2. Add `agent_state_from_hc(rec: dict | None) -> str` and `_hc_record(raw: dict) -> dict` (REC per C1:
   name, agent_status, cwd, pane_id=address, workspace_id=labels["herdr.space"], kind, backend="hc", plus
   `reported`). Kind mapping per C1 (`claude-code`->claude, `codex`->codex, else foreground.name, else agent).
3. Class `Herdr` (legacy): add `backend = "legacy"` and the new methods of C1 built on the existing CLI:
   `agent_record(name)` (wraps `agent get`; "not found" in the error -> (None, "absent"); other errors ->
   (None, "unknown"); REC = original agent dict plus normalized keys `agent_status` (state forced into
   HUB_STATES), `backend`, `kind` (`kind` or `agent` field), `pane_id`, `workspace_id`, `cwd`),
   `agent_list()` (`agent list`; None on failure), `agent_read(name, lines)` (`agent read NAME --source
   visible --lines N`; None on failure), `focus(name)` (`agent focus NAME`, swallow errors),
   `server_running()` (`herdr status server` contains `status: running`). Existing methods unchanged.
4. Add class `Hc` exactly per C1 (constructor, available, require, server_running, workspace_create,
   workspace_close, agent_start, agent_prompt, agent_get, agent_record, agent_list, agent_read, focus).
   Use a private `_run(args, timeout)` -> CompletedProcess|None (None on FileNotFoundError/OSError/
   TimeoutExpired), argv lists, shell=False. Polling uses an injectable `sleep`/`clock`
   (constructor kwargs `sleep=time.sleep, clock=time.monotonic`) so tests never wait.
   `agent_start` argv: `[hc, "run", "--bg", "--no-parent", "--no-notify", "--keep", "--name", name, "--cwd",
   cwd, "--label", f"herdr.space={pane}", "--label", f"agentkit.kind={kind}", "--", M.binary(kind), *args]`.
   `agent_list()`: `hc ls --json`, then `hc get <address> --json` for each live terminal -> RECs (None if
   `ls` fails). `workspace_close(id)`: from `agent_list()`, every REC with workspace_id == id: `hc kill
   <address>`, then `hc rm <address>` (ignore their failures).
5. Add `make_herdr(cfg, env=None, runner=subprocess.run)` per C2, and `validate_config`: `herdr.backend`, if
   present, must be one of auto/hc/legacy. Do NOT edit `.agent-system/config.json` (missing = auto).
6. `Scheduler.__init__`: `self.herdr = herdr or make_herdr(self.cfg)`; remember whether it was injected.
   Add `herdr_for(state)` per C2. In `_launch_session` record `state["herdr_backend"] = self.herdr.backend`
   when not set (before `workspace_create`), and use `herdr_for(state)` in `_launch_session`, the
   same-session prompt in `dispatch_ready`/repair (~1605), `wait`'s blocked check, `collect`, the status/
   reconcile observation (~2304) and `cleanup` (~2379). Replace the blocked hint
   `herdr agent read X --lines 80` with the backend's equivalent (`hc read --lines 80 X` for hc).
7. Doctor: keep check order, change only the herdr part: `hc` tool check (warn when missing and backend is
   auto/hc), `herdr-app` (warn when missing), `herdr` required (fail) only when backend is legacy, else warn
   when missing; replace `herdr-env` with check `herdr-session`: ok when `HC_TERMINAL_ID` or `HERDR_ENV=1`,
   warn otherwise ("start with `agent-kit start`"); run `herdr integration status` only when `herdr` exists
   and backend is legacy or HERDR_ENV=1.
8. Tests (`.agent-system/tests/test_hc_adapter.py`, new; plus FakeHerdr in test_scheduler.py): a fake runner
   replaying the plan's exact samples. Cases, one test each:
   - REC mapping: claude-code working; codex done; `error` -> unknown; status null -> unknown;
     finished -> absent; not_found (exit 3) -> absent; runner raising FileNotFoundError -> unknown.
   - agent_start: exact argv (no-parent, no-notify, labels, `--` then binary), space.rename attempted,
     waits for reported idle; never reported -> SchedulerError containing `agent_not_ready`.
   - agent_prompt: refuses when working/blocked; sends then returns on working; timeout -> SchedulerError.
   - workspace_close kills+rms only terminals whose herdr.space matches.
   - agent_read drops `[hc] ` lines and keeps the last N.
   - make_herdr matrix (hc/legacy/auto x env HC_TERMINAL_ID/HERDR_ENV/none x hc on PATH/server running).
   - per-run backend: run dispatched with an hc fake records `herdr_backend == "hc"`; `herdr_for` of a state
     recorded "legacy" with a non-injected scheduler returns a legacy instance.
   - validate_config rejects `herdr.backend = "x"`.
   - doctor: backend auto, hc present, no herdr -> no fail from herdr; legacy without herdr -> fail.
   Update `FakeHerdr` (add `backend = "legacy"`, `agent_record`, `agent_list`, `agent_read`, `focus`,
   `server_running`) so existing tests keep passing unchanged otherwise.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/scheduler.py`
- `.agent-system/tests/test_scheduler.py`
- `.agent-system/tests/test_hc_adapter.py` (new)

**You must not edit:**
- `.agent-system/agentctl.py` (T2 imports READY_STATES from scheduler later; leave agentctl's copy as is),
  `kitstart.py`, `hubctl.py`, `config.json`, `hub-protocol.schema.json`, docs, `plans/**`, `gen-tasks/**`,
  `.orchestrator/**`, `.claude/**`.

**You may run:**
- `python3 -m pytest`, `python3 -m unittest`, read-only git, `git add`/`git commit` on your branch.

**You must not run:**
- `hc`, `herdr`, `herdr-app` against the real machine (tests use fakes only); `git push/merge/rebase/reset/
  checkout`; installs or downloads; `systemctl`; `agent-kit` on real workspaces.

**When to ask:** only for a real blocker (the spec contradicts the code, a sandbox-blocked command) ->
report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Change legacy `Herdr` behaviour of existing methods, the run state schema beyond `herdr_backend`, the hub
  protocol, or unrelated code. Print secrets.

## Done when
- [ ] `Hc`, `make_herdr`, `herdr_for`, `agent_state_from_hc`, `READY_STATES`, `HUB_STATES` exist per C1/C2.
- [ ] Every scheduler live call goes through `herdr_for(state)`; runs record `herdr_backend`.
- [ ] All new tests and the whole suite pass.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed (was 192 + yours).

## Notes
- Keep `Herdr`'s name and constructor (agentctl, kitstart and tests use them).
- REC states must always be in HUB_STATES: the hub validates snapshots against that enum.
- No real sleeps in tests; inject sleep/clock.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (04/11/26 21:30)

- Status: **done** (worker worker-1, branch `agent/hcport-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/scheduler.py`, `.agent-system/tests/test_hc_adapter.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_hc_adapter.py` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_hc_adapter.py .agent-system/tests/test_scheduler.py -k 'HerdrBackendSchedulerTests or HcRecordTests'` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - No live hc/herdr integration run; task boundaries required fake-only CLI tests.
- Not done: none
- Full diff: `.orchestrator/runs/hcport/reports/T1.diff`

````text
 .agent-system/scheduler.py             | 361 ++++++++++++++++++++++++++++++---
 .agent-system/tests/test_hc_adapter.py | 285 ++++++++++++++++++++++++++
 .agent-system/tests/test_scheduler.py  |  58 ++++++
 3 files changed, 677 insertions(+), 27 deletions(-)
````

(diff is 873 lines; read the full diff file)

## Review round 1: PASS (04/11/26 21:32)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: f93368c3599a, commits f93368c3599a
- Notes: adapter per C1/C2; 209 tests pass

# Review hcport T1 - adapter (Opus)

Verdict: PASS

- Contract C1/C2 met: `Hc` mirrors `Herdr` (+ agent_record/agent_list/agent_read/focus/server_running on both);
  REC normalized; states only from HUB_STATES (`error`/no status -> unknown, finished/not_found -> absent).
- `hc run` argv uses `--no-parent --no-notify --keep`, labels `herdr.space` + `agentkit.kind`, binary from
  `M.binary(kind)` after `--`; space.rename best effort; readiness waits for `reported` + idle/done with
  injectable sleep/clock; `agent_not_ready` marker kept for kitstart.
- `make_herdr` matrix per C2; `herdr_for(state)` + `herdr_backend` recorded on first live launch; all live
  call sites (launch, same-session prompt, wait blocked check + backend-specific hint, collect, status,
  cleanup) go through it; old runs default to legacy.
- Doctor: hc/herdr-app warn, herdr fail only for legacy, `herdr-session` replaces `herdr-env`; integration
  status only for legacy / HERDR_ENV. Order kept.
- Tests: 17 new fake-runner tests replaying the hc 0.1.17 samples; whole suite 209 passed (Opus rerun).
- Minor (accepted): `hc` missing with backend legacy is reported via level "ok"; fine.

## Integration: merged (04/11/26 21:32)

- On `agent/integration-hcport` at f9609bbf1001; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcport/logs/post-merge-T1-a1.log`)

## Final gate: PASS (04/11/26 21:57)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcport at 924a5efe4623 (log `.orchestrator/runs/hcport/logs/verify-1793804198.log`)
- Task MERGED; run DONE

## Finished (04/11/26 22:39)

- merged into hub/plan (decision D1)
