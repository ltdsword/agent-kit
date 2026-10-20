# Rule: setting up a work project for AI workflows (workspace + symlink)

Status: **rule adopted 2026-10-16; workspace mode built 2026-10-19** (scheduler, doctor, tests and
`agent-kit create/update`, section 6). Kit home: `~/Code/agent-kit`. Example: `~/Code/thrift-demo.workspace`.

## 1. Why

A work repository belongs to the team. Our AI tooling (`CLAUDE.md`, `AGENTS.md`, `.agent-system/`,
`.claude/`, `gen-tasks/`, `.orchestrator/`) must not appear in it:

- Committing it pushes personal tooling into the team's history.
- Leaving it untracked makes `git status` dirty, and someone eventually runs `git add -A`.
- Adding it to `.gitignore` changes a tracked team file (tampering) just to hide our files.

So the tooling lives in a separate folder next to the repo, and the repo is reached through a
symlink. Edits made through the symlink are edits to the real repo, so code changes persist
normally. Nothing else is written into the repo.

## 2. The rule

1. **One workspace per work repo**: `<repo>.workspace` next to the repo, e.g.
   `~/Code/thrift-demo` and `~/Code/thrift-demo.workspace`.
2. **All AI-generated files live in the workspace.** In the repo, only the intended code changes
   ever appear, and only on agent branches until you approve the merge.
3. **Only the repo is a git repo for the kit.** The scheduler runs every git command in the repo
   (`project.path`); it never treats the workspace as a repo.
4. **Never edit the repo's `.gitignore`, `.git/info/exclude`, hooks or git config** for our tooling.
5. **The repo's own instructions win.** If the team ships its own `CLAUDE.md`/`AGENTS.md`, keep
   it. Ours add orchestration rules and must not contradict it.
6. **Humans approve the merge and push.** Agents work on `agent/*` branches and git worktrees. You review
   the final report and total diff and answer the merge decision in chat (`finish ask`); the scheduler
   then fast-forwards the branch you chose and pushes only if you chose to, never with force. If team
   conventions require a PR, choose "merge and push" with a new branch name (e.g. `feature/...`) and
   open the PR yourself; never push straight to a protected team branch.
7. **Check team policy before using AI on the code at all**, and before sending any code or text to
   an external service (including a dashboard, see `DECISION-HUB-PLAN.md`). Commit trailers like
   `Co-Authored-By: Claude` may also be against team convention: check, and drop them if needed.
8. **No secrets in the workspace.** Tokens live in `~/.config/...` or environment variables.
9. **The workspace may be its own private git repo** (local only, for the history of `gen-tasks/`
   and notes). Never add the work repo's remote to it and never push it to a company remote.
   The scheduler ignores it either way.

## 3. Layout

```text
~/Code/
├── thrift-demo/                        # the team repo: untouched except for real code changes
└── thrift-demo.workspace/              # ours
    ├── thrift-demo -> ../thrift-demo   # symlink to the repo (relative: survives moving both)
    ├── CLAUDE.md                       # project notes + orchestrator rules (Claude reads it here)
    ├── AGENTS.md                       # orchestrator rules for programs other than Claude Code
    ├── .claude/
    │   ├── agents/scout.md
    │   └── settings.json               # deny rules + additionalDirectories (the real repo path)
    ├── .agent-system/                  # the kit; config.json has "project": {"path": "thrift-demo"}
    ├── gen-tasks/                      # task files (plan, worker result, review, outcome)
    ├── .orchestrator/                  # runtime state, reports, diffs, decisions
    ├── worktrees/                      # worker-1..N, integration-<run> (git worktrees of the repo)
    └── notes/                          # anything else you want to keep
```

What workspace mode still leaves inside the repo's `.git/` (not its working tree, so
`git status` stays clean): worktree metadata in `.git/worktrees/` and local `agent/*` branches.
Both are local, never pushed unless you push them, and `scheduler.py cleanup --remove-worktrees`
plus `git branch -D agent/...` remove them.

## 4. Procedure: when you first receive a project

Run once per project. The kit lives in its own home, `~/Code/agent-kit` (a local git repo), and
`agent-kit` (`~/.local/bin/agent-kit` -> `~/Code/agent-kit/.agent-system/scripts/install.sh`) copies
it into workspaces.

```bash
# 0. Get the repo the normal way, on a clean state.
cd ~/Code && git clone <team-url> myrepo
git -C myrepo status --porcelain             # must print nothing

# 1. Create the workspace: everything in one command.
agent-kit create --folder=myrepo            # from ~/Code; or from inside the repo: cd myrepo && agent-kit create
```

`agent-kit create [--folder=<repo>]` names the repo (default: the current folder, which must be the
repo's top folder) and creates the new folder `<repo>.workspace` next to it, with:
- the symlink `myrepo -> ../myrepo`, and `gen-tasks/`, `worktrees/`, `notes/`, a local `.gitignore`;
- `.agent-system/` copied from the kit home, with `config.json` set to `project.path: myrepo`,
  `worktree_root: worktrees`, and `worker.writable_dirs` from the repo's build files (Gradle `~/.gradle`,
  Maven `~/.m2`, npm `~/.npm`, Go `~/go/pkg/mod`, Cargo `~/.cargo`, Conan `~/.conan2`, vcpkg
  `~/.cache/vcpkg`; Python, CMake and make need none). The detected stack and build/test command
  (e.g. `python3 -m pytest`, CMake + `ctest`, `make && make test`) go into the `CLAUDE.md` notes;
- `.claude/agents/scout.md` and `.claude/settings.json` (deny rules, the chat-id hooks, `additionalDirectories` = real repo path);
- `CLAUDE.md` (project notes with TODOs + orchestrator rules) and `AGENTS.md` (the same orchestrator
  rules, for programs other than Claude Code); worker rules are in `.agent-system/WORKER-RULES.md`.
- the models for each role (orchestrator, scout, worker): asked on a terminal, or from `--model-*` /
  `--effort-*` options; change them later with `agent-kit config` (README, "Choosing models").

If the folder is not a Git repository yet (or has no commit), it explains and asks before running
`git init && git add -A && git commit -m "Initial commit"` there: yes creates it and continues, no (or
no terminal to ask on) stops without changes; `--init-git` answers yes. That first commit is the only
thing it ever writes into the repo. It refuses an existing workspace (use `update`), a missing folder,
or a folder inside another repo that is not its top folder, and fails if the repo's `git status`
changes. `--dry-run` prints the plan.

```bash
# 2. Fill in the TODOs at the top of CLAUDE.md (stack, generated code); check gate commands and
#    writable_dirs in .agent-system/config.json.

# 3. Check.
cd ~/Code/myrepo.workspace
.agent-system/scripts/doctor.sh              # project resolves, repo clean of kit files, settings OK
git -C myrepo status --porcelain             # still nothing
git init -q                                  # optional: local-only history of gen-tasks/ and notes

# 4. Work from the workspace.
agent-kit start                              # opens Herdr and launches the orchestrator with its model
```

**Updating a workspace to the latest kit**: `agent-kit update [--folder=<repo>]` (or `agent-kit update`
inside the workspace: a folder named `*.workspace` is taken as the workspace itself) refreshes the kit
files (scheduler, prompts, scripts, docs, tests, templates, the marked sections of `CLAUDE.md` and
`AGENTS.md`) and keeps `config.json`, your project notes and a customized `scout.md`
(`--force-agent` replaces it). It reports template keys missing from your `config.json`.

**Changing the kit**: edit and commit it in `~/Code/agent-kit`, run its tests
(`python3 -m unittest discover -s .agent-system/tests`), then `agent-kit update` each workspace.
Edits made inside a workspace's `.agent-system/` are overwritten by the next update.

Claude reads `CLAUDE.md` from the folder it starts in (the workspace). It reaches the code
through `myrepo/`. Because the symlink resolves outside the workspace, Claude needs the repo
as an additional directory: `"permissions": {"additionalDirectories": ["<real repo path>"]}` in
`.claude/settings.json` (equivalent to `claude --add-dir <repo>`). `doctor` warns when it is missing.

## 5. Daily rules of thumb

- Open the workspace, not the repo, when using Claude/Herdr. Open the repo in your IDE as usual.
- Run scheduler commands from the workspace: `python3 .agent-system/scheduler.py ...`.
- Before merging an integration branch: `git -C thrift-demo log --oneline <your-branch>..agent/integration-<run>`.
- After merging: `scheduler.py cleanup --run <run> --remove-worktrees`, delete merged `agent/*` branches.
- Leaving the project: remove worktrees and `agent/*` branches, then delete the workspace (or
  archive `gen-tasks/` if you want the history). The repo needs no cleanup.

## 6. Workspace mode in the kit

### 6.1 Two roots in the scheduler (built)
- `config.json`: `"project": {"path": "thrift-demo"}` (relative to the workspace, or absolute).
- `Scheduler.workspace_root` = folder containing `.agent-system/` (config, state, `gen-tasks/`,
  `.orchestrator/`, `worktrees/`). CLI: `--workspace-root` (old name `--repo-root` still accepted).
- `Scheduler.project_root` = `project.path` resolved (symlink followed). Every git call (run creation,
  branches, `worktree add/remove`, HEAD for scout rounds) uses it; nothing runs git in the workspace.
- `pool.worktree_root: "worktrees"` (relative to the workspace).
- Task file paths (`packet`) and report paths are workspace-relative; workers get absolute paths.
- The scheduler refuses to start if `project.path` does not resolve to a folder, or if the workspace
  sits inside the repo.
- Without `project.path` the kit runs in **in-repo mode** (the kit inside the repo, both roots the
  same), so older installs keep working.

### 6.2 Doctor checks (built)
- `project`: `project.path` resolves to a folder and the workspace is not inside it.
- `git`: the repo has a commit.
- `project-clean-of-kit` (fail): the repo's `git status` shows none of `CLAUDE.md`, `AGENTS.md`,
  `.agent-system`, `.claude`, `gen-tasks`, `.orchestrator`.
- `project-own-instructions` (warn): the repo tracks its own `CLAUDE.md`/`AGENTS.md`; fine, just know.
- `claude-additional-dirs` (warn): `.claude/settings.json` lists the real repo path.

### 6.3 Worker rules without an AGENTS.md in the repo (built)
Worker worktrees are checkouts of the team repo, so they contain only the team's `AGENTS.md` (if
any), not ours. Every worker prompt points to `.agent-system/WORKER-RULES.md` and also carries the
essential cautions, whatever the worker program. The workspace's own `AGENTS.md` holds the
orchestrator rules (for orchestrators other than Claude Code), and tells a worker to ignore them.

### 6.4 agent-kit create / update (built)
`scripts/install.sh`, linked as `agent-kit`; see section 4. It finds the kit home from its own path
(symlinks resolved), so it works from any folder. Without `create`/`update`, `agent-kit <repo>` is
the legacy in-repo install (kit inside the repo, edits its `.gitignore`): own repos only.
`agent-kit --version` shows the kit's version (the package's `VERSION`, or `git describe` in a Git
checkout) and the version a workspace was last created/updated with (its `.agent-system/VERSION`).

### 6.4b agent-kit start and any program per role (built)
`agent-kit start` opens Herdr for the workspace and launches the orchestrator with the configured
program, model and effort (`kitstart.py`). `agent-kit continue` restarts it with the current config in
the last active chat (id in `.orchestrator/orchestrator.json`, kept current by the `record-session.py`
hook in `.claude/settings.json`). Workers can be any program Herdr supports; only Claude
Code and Codex are verified (`models.py`, README "Choosing models").

### 6.5 Tests (built)
`TestWorkspaceMode` in `tests/test_scheduler.py`: temp layout `repo/` + `repo.workspace/repo -> ../repo`;
full dispatch -> collect -> integrate -> verify -> cleanup with `git -C repo status --porcelain` empty
throughout, state/task files/worktrees under the workspace, the workspace not a git repo; refusal of
a bad `project.path`; doctor checks. `TestInstall`: `agent-kit create --folder=<repo>` from the parent
folder, from inside the repo, and from a `*.workspace` folder; refusals (missing folder, repo subfolder), the Git offer (no repo or no commit: answer no / no answer
aborts, yes or `--init-git` creates it), `update` keeping config and notes, stack detection, dry run,
legacy in-repo mode.
