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
