# mrepo: `agent-kit create` dialog with several linked repos (23/11/26)

Decisions (Agent Hub, 23/11/26): D16 = C "Create dialog only" (a workspace links N repos; the
scheduler keeps using ONE active repo = `project.path`, switched with `agent-kit config --repo`);
D17 = B "Herdr dialog" (inside Herdr a dialog mod asks; elsewhere terminal prompts).

## Behaviour
`agent-kit create` with no --name/--location/--repo/--folder on a terminal asks:
- Name: default `<basename of cwd>.workspace` (`.workspace` appended if missing).
- Location (parent folder of the workspace): default cwd; when cwd is inside a git repo, that
  repo's parent (today's sibling layout; never inside a repo).
- Repos (>= 1): default cwd when cwd is a repo's top folder. Paths absolute, `~/...` or relative to cwd.
  Each must be a git repo top folder (no-commit/no-git: today's ensure_git_repo offer).
Each repo is linked into the workspace as `<basename>` (relative symlink); `project.repos` lists
the link names, `project.path` = the first (active). Stack detection / writable_dirs over all repos;
CLAUDE.md lists each repo. `agent-kit config --repo NAME` switches the active repo (refused while a run
is RUNNING). Flags `--name --location --repo` (repeatable) skip the questions; `--folder=<repo>` keeps
today's meaning.

## Tasks
- T1 shell side (install.sh create/config/update, kitconfig.py --repo, docs, tests).
- T2 Herdr dialog (`.agent-system/herdr-mods/agent-kit-create/` mod + `scripts/create-dialog.sh`).
Contract between them: `create-dialog.sh --cwd D --name N --location L [--repo R]...` prints one JSON
line `{"name","location","repos":[...]}` and exits 0; exit 1 = cancelled; exit 2 = no Herdr (fall back).
