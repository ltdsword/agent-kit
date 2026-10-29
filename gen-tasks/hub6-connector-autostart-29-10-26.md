# hub6 connector autostart (29/10/26)

## Goal
The hub survives reboots (systemd user service, connectors for every enabled workspace), finds orchestrators by workspace folder, and old pre-v2 runs no longer block a workspace's snapshot.

## Read first
- `plans/261029-1040-hub6-reboot-legacy-kit/plan.md` section **T1**: **the full spec** (work items, tests). Follow it exactly.
- `.agent-system/agentctl.py` (`make_snapshot`, `_herdr_record`, `watch`), `hubctl.py`, `kitstart.py`; `.agent-system/hub-protocol.schema.json` (Snapshot, Run, Task).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/agentctl.py`
- `.agent-system/hubctl.py`
- `.agent-system/kitstart.py`
- `.agent-system/scripts/install.sh`
- `.agent-system/README.md`
- `.agent-system/tests/test_agentctl.py`
- `.agent-system/tests/test_hubctl.py`

**You must not edit:**
- Any other file under `.agent-system/` (the other hub6 task owns it), `hub/**`, `docs/**`, `plans/**`, `gen-tasks/**`, root files.
- `hubschema.py`, `hub-protocol.schema.json`.

**You may run:**
- `python3 -m unittest discover -s .agent-system/tests` and single modules; `python3 .agent-system/*.py ...` against temp dirs, fake HTTP servers on 127.0.0.1 and fake runners (herdr, systemctl, git where the spec allows); read-only git. Python stdlib only (3.10+ syntax).

**You must not run:**
- `git push/merge/rebase/reset/checkout`; real `herdr`/`codex`/`claude`/`systemctl`; anything that talks to Cloudflare or Vercel;
  touching the real `~/.config/agent-hub`, `~/.config/systemd` or `~/.local/share/agent-hub` (use temp dirs via env vars); downloads.

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

## Worker result - attempt 1 (29/10/26 10:48)

- Status: **done** (worker worker-2, branch `agent/hub6-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/README.md`, `.agent-system/agentctl.py`, `.agent-system/hubctl.py`, `.agent-system/kitstart.py`, `.agent-system/scripts/install.sh`, `.agent-system/tests/test_agentctl.py`, `.agent-system/tests/test_hubctl.py`
- Scope: OK
- Tests reported:
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 1
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 1
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub6/reports/T1.diff`

````text
 .agent-system/README.md              |   5 +-
 .agent-system/agentctl.py            | 215 +++++++++++++++++++++++++++++++++--
 .agent-system/hubctl.py              | 151 ++++++++++++++++++++++--
 .agent-system/kitstart.py            |   7 +-
 .agent-system/scripts/install.sh     |   2 +-
 .agent-system/tests/test_agentctl.py |  87 ++++++++++++++
 .agent-system/tests/test_hubctl.py   | 131 +++++++++++++++++----
 7 files changed, 553 insertions(+), 45 deletions(-)
````

(diff is 884 lines; read the full diff file)

## Review round 1: PASS (29/10/26 10:50)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 97cf513a5ac4, commits 97cf513a5ac4

# Review: hub6 T1, reboot survival + legacy runs (`.agent-system`)

Verdict: **PASS**

## Checked (re-run by lead)
- Kit suite: 152 OK. No stray connector processes left by the tests.
- **Legacy runs:** `_legacy_run` maps old task ids to `T<n>`, cuts titles to 59 chars + `…`, writes a `(legacy task)` summary, and falls back to the run id for the title and `Legacy run <id>` for the goal. `_snapshot_runs` validates each run on its own; a run that is still invalid is skipped and logged once (`LEGACY_RUN_LOGGED`).
- **Orchestrator lookup:** if the name lookup fails, it uses a herdr agent of the configured kind whose resolved `cwd` equals the workspace, and targets its pane id.
- **Autostart:** a systemd user unit (`Type=oneshot`, `ExecStart`/`ExecStop` = `install.sh hub start|stop`, `WantedBy=default.target`), then `daemon-reload` and `enable --now`. `off` runs `disable --now` and removes the unit. A clear message is printed when `systemctl` is missing.
- The workspace registry, `hub start`/`hub stop` for every registered workspace, and README rows are covered by tests (fakes only).

## Integration: merged (29/10/26 10:52)

- On `agent/integration-hub6` at 200053640f2a; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub6/logs/post-merge-T1-a1.log`)

## Final gate: PASS (29/10/26 10:53)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub6 at 5b2f4ab032b7 (log `.orchestrator/runs/hub6/logs/verify-1793245949.log`)
- Task MERGED; run DONE

## Final gate: PASS (29/10/26 10:53)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub6 at 5b2f4ab032b7 (log `.orchestrator/runs/hub6/logs/verify-1793245994.log`)
- Task MERGED; run DONE

## Finished (29/10/26 11:20)

- merged into hub/plan (decision D1)
