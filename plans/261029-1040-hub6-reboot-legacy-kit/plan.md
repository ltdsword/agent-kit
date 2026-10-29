# hub6: survive reboots, legacy runs, scheduler fixes

Found in P4 and overnight (29/10/26). Contract `docs/hub-api.md` (v2) unchanged.

## User decision (verbatim)
- Reboot: "systemd user service (Recommended)": `agent-kit hub autostart on|off` installs a systemd
  --user unit that starts the backend at login and a connector for every enabled workspace
  (connectors keep running even before the orchestrator starts).

## Observed
- After a reboot nothing restarts the backend or connectors; herdr forgets pane names, so the
  connector (which finds the orchestrator only by the name `orch-<project>`) reports it absent and
  `watch` exits with `orchestrator_gone`.
- `zadnexplorerpage` (project `cmsclientv3`) has pre-v2 runs (`zadn-ui`, `zadn-review-fix`): task ids
  like `register-validation`, titles > 60, no summary. The whole Snapshot fails validation and the
  connector retries every few seconds, so nothing of that workspace reaches the hub.
- Scheduler bugs seen in runs hub2-hub5: stale report from an earlier attempt returned by `wait` and
  accepted by `collect`; `task-unblock --note` never reaches the worker; re-dispatch after a block
  starts a fresh branch and drops the partial work; `run create` accepted task files/plans that
  weren't committed (workers' worktrees didn't have them); `TestStart` copies the repo's real
  `config.json`, so it fails when the hub is enabled locally.

## T1 connector + hub commands (`agentctl.py`, `hubctl.py`, `kitstart.py`, `scripts/install.sh`, `README.md`, `tests/test_agentctl.py`, `tests/test_hubctl.py`)

1. **Legacy runs in the snapshot**: build each run, then make it v2-valid instead of failing the whole
   Snapshot:
   - task id not `^T[1-9][0-9]{0,2}$` → `T<n>` by the task's order in state (stable), and map the same
     ids in decisions/edges (`depends_on`) of that run;
   - title > 60 → cut to 59 + `…`; no/short summary → `(legacy task) <title>` padded/cut to 20..300;
   - run without `title`/`goal` → title = run id, goal = `Legacy run <id>`;
   - a run that is still invalid after this is left out of the snapshot and logged **once** per run id
     (not every loop). Validation of the rest must pass.
2. **Find the orchestrator by workspace too**: if `herdr agent get orch-<project>` is absent, use the
   herdr agent (kind = configured orchestrator kind) whose `cwd` equals the workspace path; use its
   pane id as the target for screen reads and `herdr agent prompt`. Same rule in `watch` liveness.
3. **Workspace registry**: `agentctl enable` adds the workspace path to
   `~/.config/agent-hub/workspaces.json` (0600, `{"workspaces": [paths]}`, honours `AGENT_HUB_CONFIG`);
   `agentctl` gains `disable` that sets `hub.enabled=false` and removes it.
4. **`hub start`** starts the backend (as now) and then a detached connector for **every** registered
   workspace whose hub is enabled and that has no live connector pid, with `--no-orchestrator`
   (keeps running; the hub shows the orchestrator as not running until it starts). Missing folders are
   skipped with one line. `hub stop` stops those connectors too (`agentctl stop` per workspace) and
   then the backend (as now, waits ≤ 10 s).
5. **`agent-kit hub autostart on|off|status`**: `on` writes `~/.config/systemd/user/agent-hub.service`
   (`Type=oneshot`, `RemainAfterExit=yes`, `ExecStart=<kit install.sh> hub start`,
   `ExecStop=<kit install.sh> hub stop`, `WantedBy=default.target`), runs `systemctl --user
   daemon-reload` and `enable --now`; `off` disables and removes it; `status` prints enabled/active.
   No systemd (`systemctl` missing) → clear message. The unit holds no secrets.
6. README rows.

Tests: legacy run mapped (ids, decision refs, title cut, summary, run title/goal) and validates; an
unfixable run is skipped and logged once; orchestrator found by cwd when the name is absent; registry
add/remove 0600; hub start launches connectors for registered enabled workspaces only and skips
missing folders; hub stop stops them; autostart writes the unit and calls systemctl (fake runner);
no-systemd message. Fakes only (no real herdr/systemctl).

## T2 scheduler fixes (`scheduler.py`, `tests/test_scheduler.py`)

1. **Stale reports**: on dispatch/relaunch, move an existing `reports/<T>.json` to
   `reports/<T>.attempt<N>.json` (N = previous attempt). `wait`/`collect` accept a report only if
   its `task_id` matches and the file is newer than the task's latest dispatch (record a new
   `dispatched_at` timestamp on the task at every dispatch/relaunch; old state without it keeps working).
2. **Unblock note reaches the worker**: `task-unblock --note` is stored on the task and included in
   the next dispatch/relaunch prompt and the packet header ("Lead note: ...").
3. **Keep partial work on re-dispatch**: when a task that was BLOCKED (or FIX_REQUIRED) is
   re-dispatched and its previous worktree still has uncommitted changes, reuse that slot and branch
   (no fresh branch), or, if the slot is taken, commit the changes as a WIP commit on the old branch
   and start the new branch from it. Never discard changes silently.
4. **`run create` checks files are committed**: every task `packet` and every repo file the packet
   names under "Read first" that lives in `plans/` or `gen-tasks/` must be tracked and unmodified in
   git at the integration base; otherwise refuse with the list of paths.
5. **Test isolation**: `TestStart` (and any test reading the repo config) uses the kit template config
   with `hub.enabled=false`, not the working copy's `config.json`.

Tests for each item.

## Done
`python3 -m unittest discover -s .agent-system/tests` passes (both tasks).
