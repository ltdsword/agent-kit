# Kit: WSL doctor checks and portable path resolution (31/10/26)

## Goal
`scheduler.py doctor` detects WSL and reports wsl-version, wsl-location, wsl-systemd and wsl-keepalive (plus python-version everywhere), and `install.sh` resolves `--folder` without GNU-only `realpath -m`, so macOS works.

## Read first
- `plans/261031-1819-windows-wsl2/plan.md`: sections **User decisions**, **Contract** and **T1**: **the full spec** (check names, levels, messages, detection rules, tests). Follow it exactly.
- `.agent-system/scheduler.py` (`doctor`, its `add` helper, the tool checks near `for tool, required in`), `.agent-system/scripts/install.sh` (line ~288, `realpath -m`), `.agent-system/scripts/doctor.sh` (how checks print), tests in `.agent-system/tests/test_scheduler.py` (`test_validate_config_and_doctor_hub_checks`, `test_doctor_checks_repo_separation`, class `TestInstall` and its `kit` helper).

## Steps
1. Add the helpers and the five checks to `scheduler.py` exactly as the spec's Contract table says. Read the osrelease text through one small function so tests can patch it; never shell out.
2. Replace `realpath -m` at `install.sh:288` with the Python one-liner from the spec.
3. Write the tests listed in spec T1.
4. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/scheduler.py`
- `.agent-system/scripts/install.sh`
- `.agent-system/tests/test_scheduler.py`

**You must not edit:**
- Any other file; also `README.md`, `plans/**`, `gen-tasks/**`, `.orchestrator/**`, `.claude/**`.

**You may run:**
- Python 3 (`python3 -m pytest`), `bash -n`, read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `systemctl`; `wsl.exe`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Change existing doctor checks or their order. Log or print secrets.

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh` passes.

## Run these
- `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh`: expect all tests pass

## Notes
- Report: files changed, decisions you made where the spec left room, open questions.
