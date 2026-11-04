# hcport start docs (04/11/26)

## Goal
`agent-kit start` / `continue` run the orchestrator inside the new Herdr app (hc) when that is the backend,
never start a second orchestrator for a workspace, and the docs describe the new app as the default.

## Read first
- `plans/261104-2103-herdr-app-hc/plan.md`: "Verified facts", C1, C2 and **C4 (your spec)**.
- `.agent-system/scheduler.py`: `Hc`, `Herdr` (new methods), `make_herdr` (merged by T1; read the real code).
- `.agent-system/kitstart.py`: `save_session`, `live_agent`, `live_session_id`, `remember_session`,
  `server_running`, `launch`, `stop_for_continue`, `main`.
- `.agent-system/tests/test_scheduler.py`: `StartHerdr`, `class TestStart`.
- `README.md` (Herdr/Windows/start sections), `.agent-system/GUIDE.md` Part 1 + 3, `.agent-system/README.md`.

## Steps
1. `kitstart.py`: `main` builds `herdr = herdr or S.make_herdr(cfg, env)`. `save_session(ws, kind, sid,
   name, backend=None)` writes `backend` when given; every launch path passes `herdr.backend`.
2. `live_agent(herdr, name)` -> uses `herdr.agent_record(name)`; returns REC or None (absent/unknown with no
   REC = None). `launch` focuses via `herdr.focus(name)` (not `_call`), and after start calls
   `herdr.focus(p["name"])` instead of `_call("workspace", "focus", ...)`. Keep the `agent_not_ready` message.
3. One orchestrator per workspace: add `find_orchestrator(ws, cfg, p, env, runner) -> (rec, backend)|None`
   that checks BOTH backends (`S.Hc(runner=...)`, `S.Herdr(runner=...)`; injected fakes in tests) by name and
   by the workspace fallback (REC.kind == p["kind"] and REC.cwd resolves to the workspace). In `main`
   (start, not dry-run): if found in the current backend -> focus it and say so (existing behaviour); if found
   in the other backend -> print an error naming the backend and `agent-kit continue` and return 1.
4. hc backend in `main`: no `server_running`/`--when-ready` helper and no `execvp("herdr")`; `inside` = env
   `HC_TERMINAL_ID` set; outside the app with hc: launch anyway (it shows in the app), print where to find
   it. Legacy backend: unchanged code path.
5. `stop_for_continue`: close via `herdr.workspace_close(rec["workspace_id"])` for both backends (every
   terminal the app or the kit starts carries a `herdr.space` label, so hc RECs have one). When
   `workspace_id` is missing keep the existing "exit it yourself" error. Keep the 40 x 0.25 s wait.
6. `remember_session`: hc has no chat id: return the saved session (orchestrator.json) unchanged for hc.
7. Tests in `TestStart` (`test_scheduler.py`): add a `StartHc` fake (subclass of `S.Hc` with overridden
   methods, `backend = "hc"`). Cases: start with HC_TERMINAL_ID -> hc launch, no execvp, orchestrator.json
   has backend hc; already running in hc -> focus, no new launch; running in legacy while backend hc ->
   returns 1 with the message; continue in hc closes the space then resumes the saved chat; legacy start
   tests unchanged and passing.
8. Docs (keep style; short):
   - README: Herdr section: the new Herdr app (herdr-core `hc`) is the default; old herdr still works
     (`herdr.backend: legacy`); `herdr.backend` auto/hc/legacy explained (auto: inside the app -> hc, inside
     old herdr -> legacy, else hc when its core runs); install line for the app (`herdr.dev`); the doctor
     checks `hc`, `herdr-app`, `herdr-session`. Fix any "HERDR_ENV" troubleshooting rows.
   - `.agent-system/GUIDE.md`: Part 1 (Herdr basics) and Part 3 (start): app terms (spaces, tabs),
     workers appear as spaces named `<run>-worker-N`; `hc read --lines 80 <name>` to look at a worker.
   - `.agent-system/README.md`: commands table rows mentioning herdr; `herdr.backend` config row.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/kitstart.py`
- `.agent-system/tests/test_scheduler.py` (class TestStart and its fakes only)
- `README.md`, `.agent-system/GUIDE.md`, `.agent-system/README.md`

**You must not edit:**
- `scheduler.py`, `agentctl.py`, `hubctl.py`, `install.sh`, `config.json`, `hub/**`, `plans/**`,
  `gen-tasks/**`, `.orchestrator/**`, `.claude/**`, other test classes.

**You may run:**
- `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.

**You must not run:**
- `hc`, `herdr`, `herdr-app`, `agent-kit` against the real machine; `git push/merge/rebase/reset/checkout`;
  installs; `systemctl`.

**When to ask:** only for a real blocker (e.g. you need a method scheduler.py lacks) -> report "blocked"
with the exact reason. Otherwise just do it.

## Do not
- Change the legacy start flow's behaviour, model/config handling, or docs sections unrelated to Herdr.

## Done when
- [ ] Start/continue work with an hc backend; a second orchestrator is refused across backends.
- [ ] orchestrator.json records `backend`.
- [ ] Docs updated; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

## Notes
- `hc run` children die with their parent: T1's `Hc.agent_start` already passes `--no-parent`; do not
  start orchestrators any other way.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (04/11/26 21:54)

- Status: **done** (worker worker-2, branch `agent/hcport-t3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/GUIDE.md`, `.agent-system/README.md`, `.agent-system/kitstart.py`, `.agent-system/tests/test_scheduler.py`, `README.md`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 1
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - No live Herdr app integration was run; HC behavior was tested with fakes.
- Not done: none
- Full diff: `.orchestrator/runs/hcport/reports/T3.diff`

````text
 .agent-system/GUIDE.md                |  44 ++++++------
 .agent-system/README.md               |  20 ++++--
 .agent-system/kitstart.py             | 127 ++++++++++++++++++++++++---------
 .agent-system/tests/test_scheduler.py | 130 ++++++++++++++++++++++++++++++++--
 README.md                             |  55 +++++++-------
 5 files changed, 282 insertions(+), 94 deletions(-)
````

(diff is 764 lines; read the full diff file)

## Review round 1: PASS (04/11/26 21:56)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: bf5079e40af7, commits bf5079e40af7
- Notes: start/continue per C4; docs updated; 213 tests pass

# Review hcport T3 - start/continue + docs (Opus)

Verdict: PASS

- C4 met: `main` uses `make_herdr(cfg, env)`; `save_session` records `backend` on every launch path;
  `live_agent` on `agent_record`; `launch` focuses via `herdr.focus`; hc path has no server wait / execvp,
  `inside` = HC_TERMINAL_ID; legacy path unchanged (when-ready helper + attach only for legacy).
- One orchestrator per workspace: `find_orchestrator` checks both backends by name + kind/cwd fallback;
  other backend -> exit 1 naming it and `agent-kit continue`; same backend -> focus.
- `stop_for_continue` closes via `workspace_close(workspace_id)` for both; `remember_session` returns the
  saved chat for hc.
- Docs: README / GUIDE / .agent-system README describe the app as default, `herdr.backend` auto/hc/legacy,
  `hc read --lines 80`, spaces `<run>-worker-N`; troubleshooting rows no longer cite HERDR_ENV.
- Minor (accepted): `find_orchestrator` rebuilds `make_herdr` instead of using the caller's backend; the
  "already running" block is duplicated in the when-ready and main paths; GUIDE keeps `ctrl+b w` (old key).
- Tests: 4 new TestStart cases; whole suite 213 passed in the worktree (Opus rerun).

## Integration: merged (04/11/26 21:56)

- On `agent/integration-hcport` at 924a5efe4623; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcport/logs/post-merge-T3-a1.log`)

## Final gate: PASS (04/11/26 21:57)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcport at 924a5efe4623 (log `.orchestrator/runs/hcport/logs/verify-1793804198.log`)
- Task MERGED; run DONE

## Finished (04/11/26 22:39)

- merged into hub/plan (decision D1)
