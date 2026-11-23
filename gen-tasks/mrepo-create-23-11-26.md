# mrepo T1: `agent-kit create` with name, location and several repos; `config --repo` (23/11/26)

## Goal
`agent-kit create` makes a workspace with a chosen name and location that links one or more git repos.
The scheduler still works on one active repo (`project.path`); `agent-kit config --repo NAME` switches it.

## Read first
- `plans/261123-1500-mrepo/plan.md` (behaviour + the dialog contract).
- `.agent-system/scripts/install.sh`: header usage (lines 2-25), arg parsing (~36-75), `resolve_folder` (~296),
  `cmd_create` (~306-410), `ensure_git_repo`, `check_repo_unchanged`, `cmd_update` (~411), `cmd_config` (~478).
- `.agent-system/kitconfig.py` (`main`, `describe`); `.agent-system/scheduler.py` `project_root_for` (~151, read only).
- Existing install tests in `.agent-system/tests/test_scheduler.py` / `test_hubctl.py` (how they run install.sh in temp dirs).

## Steps
1. Options for create: `--name=N`, `--location=DIR`, `--repo=PATH` (repeatable; also `--name N` form).
   Reject them for other commands. `--folder=<repo>` on create keeps today's result exactly
   (= one repo, location its parent, name `<repo>.workspace`); `--folder` with `--repo/--name/--location` is an error.
2. Path rules (one helper): absolute, `~`/`~/...`, else relative to the current folder; resolved with
   symlinks (`pwd -P`/realpath). Name: append `.workspace` if missing; no `/`. Defaults:
   name `<basename cwd>.workspace`; location = cwd, or the parent of the repo top when cwd is inside a git repo;
   repos = cwd when cwd is a repo top folder, else none.
3. Questions: when none of --name/--location/--repo/--folder is given, stdin and stdout are terminals and
   `--no-input` is absent: run `"$SRC/.agent-system/scripts/create-dialog.sh" --cwd "$PWD" --name N --location L [--repo R]`
   if that file exists and is executable. Exit 0: parse its one JSON line (python3) for name/location/repos.
   Exit 1: `die "cancelled"`. Exit 2 or missing file: terminal prompts with bash `read -e -i <default>`
   (Tab completes paths): "Workspace name", "Location", then "Repo 1", "Repo 2 (empty: done)", ... at least one.
   Not interactive and no repo given and cwd not a repo top -> die with a hint to pass --repo.
4. Create: dest = location/name; die if it already has `.agent-system`; die if dest is inside any chosen repo
   (or equals one). For each repo: ensure_git_repo, top-folder check, link name = basename (two repos with the
   same basename -> die naming both), relative symlink `dest/<link>` (reuse today's existing-link checks),
   record `repo_status` before. config.json: `project.path` = first link, `project.repos` = all links (keep key
   order logic). Stack detection and `writable_dirs` = union over repos; CLAUDE.md: one bullet per repo
   (`<link>/` -> path, stack, build), first marked active, plus a line "switch with `agent-kit config --repo NAME`".
   `merge_settings` gets the active repo; `check_repo_unchanged` for every repo. Dry-run prints the plan.
   The final "done" lines print the new workspace path and `agent-kit start --folder=<dest>`.
5. update: if `project.repos` exists, check every listed link resolves to a git repo (die naming a broken
   link) and run the unchanged check on each; otherwise today's single-repo path.
6. `agent-kit config --repo NAME` (kitconfig.py, passed through MODEL_ARGS like the other options):
   NAME must be in `project.repos` (error lists them); refuse when any `.orchestrator/runs/*/state.json`
   has `"status": "RUNNING"` (name the run); write `project.path = NAME`; `--show` lists repos with the
   active one marked. A workspace without `project.repos` -> error "this workspace links one repo".
7. Docs: header usage in install.sh; README (config rows `project.path`/`project.repos`, the create questions);
   `.agent-system/docs/WORKSPACE-SETUP.md` short section "Several repos".
8. Tests in a NEW file `.agent-system/tests/test_create_repos.py` (temp dirs, `HOME` set to a temp dir,
   `--no-hub`, model options so nothing prompts, `PATH` without herdr-app): two repos via --repo (relative,
   `~/`, absolute) -> links, config, CLAUDE.md; same basename -> error; dest inside a repo -> error;
   --folder legacy unchanged; create-dialog stub (a fake `$SRC/.agent-system/scripts/create-dialog.sh`
   is NOT allowed: instead put the dialog path behind env `AGENT_KIT_CREATE_DIALOG` (default the script) so
   tests point it at a stub printing JSON / exiting 1 / exiting 2 — run with a pty or `script` only if
   needed, or add env `AGENT_KIT_ASSUME_TTY=1` for tests); config --repo switch, unknown name, RUNNING refusal.

## Boundaries
**You may edit:** `.agent-system/scripts/install.sh`, `.agent-system/kitconfig.py`, `.agent-system/README.md`,
`.agent-system/docs/WORKSPACE-SETUP.md`, `.agent-system/tests/test_create_repos.py` (new).
**You must not edit:** scheduler.py, `.agent-system/scripts/create-dialog.sh`, `.agent-system/herdr-mods/**`
(T2), hub/**, plans/**, gen-tasks/**, .orchestrator/**, `.agent-system/config.json`.
**You may run:** `python3 -m pytest`, `bash -n`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** herdr-app, hc, herdr-task, agent-kit against real folders, anything touching real `~/.config`,
`~/.herdr` or `~/Code`; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Steps 1-8; `bash -n` clean; whole suite green.

## Run these
- `bash -n .agent-system/scripts/install.sh`
- `python3 -m pytest -q .agent-system/tests`: expect all passed.
