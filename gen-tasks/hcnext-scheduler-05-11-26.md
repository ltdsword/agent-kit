# hcnext scheduler: Codex startup, event-aware wait, local alerts (05/11/26)

## Goal
Codex workers launched through hc get past the update and hooks-review prompts on their own, `wait` wakes
on hc events instead of sleeping, and the person gets an in-app alert when a decision or worker needs them.

## Read first
- `plans/261105-0839-herdr-app-next/plan.md`: "Verified facts" and **C1, C2, C3 (your spec)**.
- `.agent-system/scheduler.py`: `class Hc` (`agent_start` ~52 lines into the class, `agent_read`, `_run`),
  `class Herdr`, `codex_args` (~1109), `_launch_session` (~1440), `wait` (~1585), `decision_ask` (~2211),
  `report`, `validate_config` (herdr keys).
- `.agent-system/tests/test_hc_adapter.py` (fake runner, `FakeTime`), `.agent-system/tests/test_scheduler.py`
  (`FakeHerdr`, wait and decision tests).

## Steps
1. C1: `codex_args` always adds `-c`, `check_for_update_on_startup=false`. Add `Hc.keys(name, *keys)`
   (`hc keys <name> <keys...>`, errors swallowed, returns bool). In `Hc.agent_start`'s readiness loop, while
   the agent has not reported, at most every 2 s (injected clock) read the screen with `agent_read(name, 40)`:
   - text has "Hooks need review" and an option line "N. Continue without trusting": find the selected line
     (starts with "›") number S and target N; press `down` (N-S) times (or `up`), then `enter`. Once per dialog.
   - text has "Update available" and "Skip": press `esc` once.
   - never touch "Trust this folder?" or any other dialog.
   Record what was answered in the returned record: `rec["auto_answered"] = ["hooks_review", "update"]`.
2. C2: `Hc.agent_start(..., labels: dict | None = None)` adds `--label k=v` for each; `_launch_session` passes
   `{"agentkit.run": run_id, "agentkit.slot": wid}`. Add `Hc.wait_change(addresses, timeout_s)` per C2 with an
   injectable `popen` (constructor kwarg, default `subprocess.Popen`) and `select`-based line reads bounded by
   the injected clock; always terminate the child. `Herdr.wait_change` sleeps `timeout_s` via `self.sleep` if
   present else `time.sleep`. `FakeHerdr` in tests: add `wait_change` that calls the test's fake sleep.
   In `Scheduler.wait`, replace the final `sleep(interval_s)` with: if `herdr.backend == "hc"` and addresses
   known -> `herdr.wait_change(addrs, interval_s)`, else `sleep(interval_s)`.
3. C3: module function `local_alert(project_root, cfg, title, body, env=None, runner=subprocess.run)` per C3,
   called from `decision_ask` (after the decision is saved), `wait` (when it returns blocked: one alert per
   blocked agent) and `report` (when the run status is DONE). `validate_config` accepts bool `herdr.alerts` and
   `herdr.artifacts` (reject non-bool). Do not edit `.agent-system/config.json`.
4. Tests (fakes only):
   - hooks dialog sample below -> keys `down`,`down`,`enter` sent once; `auto_answered` has "hooks_review".
   - update dialog -> `esc` once; trust dialog -> no keys, ends in `agent_not_ready` as before.
   - `codex_args` contains `check_for_update_on_startup=false`; launch argv has both agentkit labels.
   - `wait_change`: snapshot line ignored; event for another terminal ignored; event for ours -> True; no event
     before timeout -> False; Popen raising -> False after sleeping; child always terminated.
   - `wait` with hc backend calls `wait_change` (not sleep) between checks; legacy still sleeps.
   - `local_alert`: called with the exact argv when env has HC_TERMINAL_ID and herdr-task exists; not called
     when alerts false / no HC_TERMINAL_ID / tool missing; runner raising is swallowed.
   - `validate_config` rejects `herdr.alerts = "yes"`.

Hooks dialog sample (real, Codex 0.165):
```
  Hooks need review
  1 hook is new or changed.
  Hooks can run outside the sandbox after you trust them.
› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)
  enter confirm · esc skip
```
Update dialog sample:
```
  Update available · 0.165.0 → 0.166.0
› 1. Update now (runs `sh -c '...'`)
  2. Skip
  3. Skip until next version
  enter continue · esc skip
```

## Boundaries
**You may edit:** `.agent-system/scheduler.py`, `.agent-system/tests/test_hc_adapter.py`,
`.agent-system/tests/test_scheduler.py`.
**You must not edit:** agentctl.py, kitstart.py, hubctl.py, config.json, hub protocol, hub/**, docs, plans/**,
gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `hc`, `herdr`, `herdr-app`, `herdr-task`, `herdr-artifact`, `codex` against the real
machine; git push/merge/rebase/reset/checkout; installs; systemctl.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Do not
- Choose "Trust all", "Trust and continue" or any trust option; use `hc send --force`; change legacy Herdr
  behaviour; print secrets.

## Done when
- [ ] C1, C2, C3 implemented; all listed tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
