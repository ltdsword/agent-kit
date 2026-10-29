# hub6 scheduler fixes (29/10/26)

## Goal
The scheduler ignores stale reports, forwards unblock notes to workers, keeps partial work on re-dispatch, refuses runs whose task files aren't committed, and its tests don't depend on the local config.

## Read first
- `plans/261029-1040-hub6-reboot-legacy-kit/plan.md` section **T2**: **the full spec** (work items, tests). Follow it exactly.
- `.agent-system/scheduler.py` (`dispatch_ready`, `relaunch`, `wait`, `collect`, `task_unblock`, `create_run`), `tests/test_scheduler.py` (`TestStart`, `WorkspaceBase`).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/scheduler.py`
- `.agent-system/tests/test_scheduler.py`

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
- [ ] Every work item and test in spec section T2 is done.
- [ ] `python3 -m unittest discover -s .agent-system/tests` passes.

## Run these
- `python3 -m unittest discover -s .agent-system/tests`: expect OK

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (29/10/26 10:51)

- Status: **done** (worker worker-3, branch `agent/hub6-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/scheduler.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m unittest discover -s .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hub6/reports/T2.diff`

````text
 .agent-system/scheduler.py            | 163 +++++++++++++++++++++++++++--
 .agent-system/tests/test_scheduler.py | 189 +++++++++++++++++++++++++++++++---
 2 files changed, 328 insertions(+), 24 deletions(-)
````

(diff is 562 lines; read the full diff file)

## Review round 1: PASS (29/10/26 10:52)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: f22d657485d5, commits f22d657485d5

# Review: hub6 T2, scheduler fixes (`.agent-system/scheduler.py`)

Verdict: **PASS**

## Checked (re-run by lead)
- Kit suite in the worktree: 151 OK.
- **Stale reports:** on dispatch and relaunch, `_archive_report` moves `reports/<T>.json` to `<T>.attempt<N>.json` (with a suffix if that name is taken) and records a fresh `dispatched_at`. A report is accepted only if its task id matches and it is newer than `dispatched_at`; old state without `dispatched_at` still works.
- **Unblock notes:** `task-unblock --note` is stored as `lead_note` and shown as "Lead note: ..." in the dispatch/relaunch prompt and the packet header.
- **Partial work:** a re-dispatched BLOCKED/FIX_REQUIRED task with a dirty worktree reuses its own slot and branch when that slot is free. Otherwise it saves the changes as a `WIP: preserve <T> partial work` commit on the recorded branch, and refuses (with a clear error) if the worktree is on a different branch. Nothing is discarded.
- **`run create`:** refuses packets, and `plans/`/`gen-tasks/` files named under "Read first", that aren't tracked and unmodified at the base.
- **Test isolation:** `TestStart` uses the template config with the hub disabled.

## Integration: merged (29/10/26 10:52)

- On `agent/integration-hub6` at 5b2f4ab032b7; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub6/logs/post-merge-T2-a1.log`)

## Final gate: PASS (29/10/26 10:53)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub6 at 5b2f4ab032b7 (log `.orchestrator/runs/hub6/logs/verify-1793245949.log`)
- Task MERGED; run DONE

## Final gate: PASS (29/10/26 10:53)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub6 at 5b2f4ab032b7 (log `.orchestrator/runs/hub6/logs/verify-1793245994.log`)
- Task MERGED; run DONE
