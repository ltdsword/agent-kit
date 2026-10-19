# agent-kit: Low-cost solution for Multi-agent systen to Developers

---

A kit for multi-agent coding on any Git repository. You ask Claude for a change; Claude plans it,
Codex workers implement it in parallel git worktrees, Claude reviews and integrates the results into
one branch, and hands you **one report and one total diff**. You decide whether to merge and push, and
into which branch; the kit then does it. All AI tooling lives in a separate **workspace folder** next
to the repo, so the repo only ever sees the code changes you approve.

```text
You ──request──> orchestrator: Claude Code, model you choose (default Opus 5.5): plans, reviews, integrates
                   ├─ scout: Claude Code subagent (default Sonnet 5.5), read-only (max 3 research rounds per request)
                   ▼
                 1-3 tasks ──> scheduler.py (leases, state machine, durable JSON)
                   ├─ worker-1 ┐
                   ├─ worker-2 ├─ your chosen worker model (default Codex gpt-6-luna @ xhigh), one Herdr pane + git worktree each
                   └─ worker-3 ┘
                   ▼
                 review ─> cherry-pick onto agent/integration-<run> ─> quality gate
                   ▼
                 final report + one total diff  (.orchestrator/runs/<run>/final-report.md, final.diff)
                   ▼
Claude asks with clickable choices (you get notified via Herdr / Remote Control), you click:
   1) A merge and push   B merge locally only, no push   C don't merge
   2) if A/B: which branch?   A this branch (<name>)   B other branch (you type it)
                   ▼
                 scheduler merges (fast-forward), pushes if A (never with force), cleans up
```

| Role | Who | Job |
|---|---|---|
| You | - | Ask for a change, make the critical decisions, approve the merge and push |
| Orchestrator | Claude Code, the model you choose (default Opus 5.5) | Plans tasks, writes task files, reviews, integrates |
| Scout | Claude Code subagent, the model you choose (default Sonnet 5.5), read-only | Reads the codebase and reports evidence |
| Workers 1-3 | Codex, any model you choose (default `gpt-6-luna`, `xhigh`) | Write the code, each in its own git worktree |
| Herdr | terminal multiplexer | Runs all agents; keeps them alive when you detach |
| `scheduler.py` | Python stdlib CLI | Tracks who works on what and enforces the rules |

---

## Contents

1. [Requirements](#1-requirements)
2. [Quick start](#2-quick-start)
3. [How it works](#3-how-it-works)
4. [agent-kit commands](#4-agent-kit-commands)
5. [Language detection](#5-language-detection)
6. [Daily workflow](#6-daily-workflow)
7. [Command reference](#7-command-reference)
8. [Who decides what](#8-who-decides-what)
9. [Configuration](#9-configuration)
10. [Changing the kit](#10-changing-the-kit)
11. [Troubleshooting](#11-troubleshooting)
12. [More documentation](#12-more-documentation)

---

## 1. Requirements

| Tool | Why | Check |
|---|---|---|
| Linux or macOS, `bash`, `git`, `python3` 3.11+ | scheduler and scripts (Python stdlib only, no pip installs) | `python3 --version` |
| Claude Code, logged in (any Claude model) | orchestrator and scout | `claude --version` |
| Codex CLI 0.163.0+, logged in (any Codex model) | workers | `codex --version`, `codex login status` |
| Herdr 0.9+ (terminal workspace manager for AI coding agents), with its Claude and Codex integrations | runs and shows the agents; live dispatch needs `HERDR_ENV=1` | `herdr status` |
| `jq` (optional) | nicer error messages in `doctor.sh --probe-codex` | |

**Models.** You choose the program, model and effort for each role with `agent-kit config` (section 4):
Claude Code and Codex are verified; every other program Herdr can launch is listed as **unverified**.
Workers always use exactly the configured model and effort; there is deliberately no automatic
fallback. Higher efforts cost more and are slower.

**Codex worker profile.** Codex workers run with `codex --profile worker` (the model and effort are
passed explicitly from `config.json`). Create `~/.codex/worker.config.toml`:

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

**Linux sandbox.** On Ubuntu 24.04+, Codex's bubblewrap sandbox is blocked by
`kernel.apparmor_restrict_unprivileged_userns=1`; `.agent-system/GUIDE.md` Part 2, step 2 has a
narrow AppArmor profile that allows only bubblewrap. Never work around it with `danger-full-access`.
Test with `codex sandbox -- sh -c 'echo ok'`.

### Install

Clone the kit anywhere (the examples below use `~/Code`) and put `agent-kit` on your PATH:

```bash
git clone <this-repo-url> ~/Code/agent-kit
mkdir -p ~/.local/bin
ln -s ~/Code/agent-kit/.agent-system/scripts/install.sh ~/.local/bin/agent-kit   # ~/.local/bin must be on PATH
agent-kit --help
python3 -m unittest discover -s ~/Code/agent-kit/.agent-system/tests            # optional: offline self-test
```

`agent-kit` follows its symlink to find the kit, so the kit folder can live anywhere.

---

## 2. Quick start

```bash
# 1. Create the workspace next to the repo (writes nothing into the repo).
cd ~/Code
agent-kit create --folder=myrepo             # creates ~/Code/myrepo.workspace; asks which models to use

# 2. Finish the project notes and check.
cd myrepo.workspace
$EDITOR CLAUDE.md                            # fill in the remaining TODOs at the top
.agent-system/scripts/doctor.sh              # every line should be OK

# 3. Start working, inside Herdr.
herdr
claude                                       # uses the orchestrator model you chose (agent-kit config --show)
```

Then type a request in Claude, for example:

> Add input validation to `registerUser`: reject empty names and malformed emails with a clear
> error in `RegisterUserResp`, and add unit tests. Use the multi-agent workflow.

When the run is done, Claude gives you the report and total diff and asks (clickable) whether to merge
and push, and into which branch (section 6).

---

## 3. How it works

### Layout

```text
~/Code/
├── agent-kit/                        # the kit's home (this folder)
├── myrepo/                           # the repo: untouched except for merges you approve
└── myrepo.workspace/                 # created by `agent-kit create`
    ├── myrepo -> ../myrepo           # relative symlink to the repo
    ├── CLAUDE.md                     # project notes + orchestrator rules (Claude reads it here)
    ├── AGENTS.md                     # worker rules (workers are told to read it)
    ├── .claude/
    │   ├── agents/scout.md           # the Sonnet scout
    │   └── settings.json             # deny rules + additionalDirectories (the real repo path)
    ├── .agent-system/                # copy of the kit; config.json has "project": {"path": "myrepo"}
    ├── gen-tasks/                    # one task file per worker task (plan, result, review, outcome)
    ├── .orchestrator/                # runtime state, reports, diffs, decisions, logs
    ├── worktrees/                    # worker-1..3 and integration-<run> (git worktrees of the repo)
    ├── notes/                        # your own notes
    └── .gitignore                    # in case you `git init` the workspace (local only)
```

### Two roots

- **Workspace** (the folder holding `.agent-system/`): config, state, task files, worktrees.
- **Repo** (`project.path` in `config.json`): the only git repository the kit uses. Every git command
  (branches, worktrees, cherry-picks) runs there; the workspace is never treated as a repo.

Without `project.path`, the kit runs in **in-repo mode** (kit committed inside the repo, both roots
the same). Use that only for repos you own.

### Safety rules built in

- Workers run in Codex's `workspace-write` sandbox with `on-request` approvals and no network.
  `danger-full-access` is rejected by config validation.
- Workers edit only their own worktree and the task's owned paths; the scheduler flags anything else.
- Results land on `agent/integration-<run>`. Your branches change, and anything is pushed, only after
  you answer the merge decision; merges are fast-forwards and pushes never use force.
- Dirty worker worktrees are quarantined, never reset or cleaned.
- Critical decisions belong to you (section 8). Claude asks you (clickable choices) and waits; the scheduler refuses
  critical actions until your answer is recorded, and every answer is stored with your exact words,
  so you can audit what Claude acted on. This is a guardrail, not a sandbox: it relies on Claude
  following its rules, and every step is logged.
- `agent-kit` never writes into the repo and fails if the repo's `git status` changes while it runs.

---

## 4. agent-kit commands

```bash
agent-kit create [--folder=<repo>] [--dry-run]
agent-kit update [--folder=<repo>] [--dry-run] [--force-agent]
agent-kit [--dry-run] [--force-agent] <target-repo>      # legacy in-repo mode
agent-kit --help
```

| Command | What it does |
|---|---|
| `agent-kit create --folder=myrepo` | From the repo's parent folder: create `myrepo.workspace` next to `myrepo` and install everything |
| `agent-kit create` | Same, run from inside the repo (the current folder is the repo; it must be the repo's top folder) |
| `agent-kit update --folder=myrepo` | Bring `myrepo.workspace` up to the latest kit |
| `agent-kit update` | Same, run from inside the workspace (a folder named `*.workspace` is taken as the workspace itself) or from inside the repo |
| `agent-kit config --model-worker=gpt-6-sol --effort-worker=high` | Change a workspace's models (orchestrator, scout, worker); see "Choosing models" below |
| `agent-kit config` | On a terminal: asks for each role (program → model → effort), picking from a numbered table |
| `agent-kit config --show` / `--list` | Show the workspace's current roles / every known model |
| `agent-kit <target-repo>` | Legacy: install the kit **inside** a repo you own (also edits its `.gitignore`) |

| Flag | Meaning |
|---|---|
| `--folder=<repo>` (or `--folder <repo>`) | The repo folder, relative or absolute. Default: the current folder. A `*.workspace` folder is accepted as the workspace itself |
| `--dry-run` | Print what would happen; change nothing |
| `--force-agent` | Replace a customized `.claude/agents/scout.md` with the kit's version |
| `--model-orchestrator=M`, `--model-scout=M`, `--model-worker=M` | (`create`, `config`) Model per role: an ID or alias, or `<program>/<model>` for an unverified program |
| `--effort-orchestrator=E`, `--effort-scout=E`, `--effort-worker=E` | (`create`, `config`) Effort per role; must be one the model supports |
| `--show`, `--list` | (`config`) Show the workspace's roles / every known model with its efforts |
| `--no-input` | (`create`, `config`) Never prompt; fail on an unknown model instead of asking |

**`create`** makes `<repo>.workspace/` with:

- the symlink `<repo> -> ../<repo>`, and `gen-tasks/`, `worktrees/`, `notes/`, `.gitignore`;
- `.agent-system/` copied from the kit home, with `config.json` set to `project.path: <repo>`,
  `worktree_root: worktrees` and the detected cache folders (section 5);
- `.claude/agents/scout.md` and `.claude/settings.json` (deny rules + the real repo path);
- `CLAUDE.md` with project notes (detected stack and build/test command; TODOs for the rest) plus the
  orchestrator section, and `AGENTS.md` with the worker section.

It refuses when the workspace already has a kit (use `update`), when the folder is not a Git repo's
top folder, or when the repo has no commit. At the end it checks that the new workspace loads.

**`update`** replaces the kit files (scheduler, prompts, scripts, docs, tests, templates) and the
marked sections of `CLAUDE.md`/`AGENTS.md`. It **keeps** `config.json`, your project notes, your task
files and state, and a customized `scout.md`. It reports keys in the kit's config template that your
`config.json` lacks.

---

### Choosing models

Each workspace has three roles. `agent-kit create` asks for them on a terminal (or takes the same
`--model-*` / `--effort-*` options as `config`); change them any time with `agent-kit config`.

| Role | What it does | Programs | Default |
|---|---|---|---|
| orchestrator | The main session: plans, reviews, integrates, asks you | Claude Code (verified); Codex and others recorded, launched by `agent-kit start` in a later version | `claude-opus-5-5`, `high` |
| scout | Read-only research subagent | Claude Code only | `claude-sonnet-5-5`, `medium` |
| worker | Implements the tasks | Codex (verified). Other programs are recorded but not launched yet | `gpt-6-luna`, `xhigh` |

```bash
agent-kit config --model-orchestrator=opus --effort-orchestrator=high
agent-kit config --model-worker=gpt-6-sol --effort-worker=high
agent-kit config --model-worker=grok/grok-4      # unverified program: <program>/<model>
agent-kit config --list                          # every known model with its efforts
```

- **A model name is enough:** the program is worked out from it (Claude aliases `fable`, `opus`,
  `sonnet`, `haiku` work too).
- **Codex models and their efforts** come from Codex's own catalog (`~/.codex/models_cache.json`).
- **Claude models** come from a list shipped with the kit; other `claude-*` names are accepted with a note.
- **Unknown name or unsupported effort:** prints a numbered table to choose from; on a terminal you
  type the number.
- **Unverified programs** (agy, amp, cline, copilot, cursor, devin, droid, gemini, grok, hermes,
  kilo, kimi, kiro, letta, maki, mastracode, muse, omp, opencode, pi, qodercli, qwen, i.e. every
  agent Herdr supports apart from Claude Code and Codex) are typed as `<program>/<model>`. They are
  not tested with this kit, their model names are not checked, and `doctor` warns about them.

## 5. Language detection

`agent-kit create` looks at the repo's top folder to fill in the project notes in `CLAUDE.md`
(`Stack:` and `Build and test:` lines) and `worker.writable_dirs` in `config.json` (cache folders
workers may write to; everything else outside their worktree stays read-only). The quality gate
`.agent-system/scripts/verify.sh` detects the same stacks on every merge and final check.

| Language / stack | Recognized by | Build/test command written to `CLAUDE.md` | Cache folder workers may write to | What `verify.sh` runs (quick / full) |
|---|---|---|---|---|
| Java (Gradle) | `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `gradlew` | `./gradlew build` | `~/.gradle` | `./gradlew test` / `./gradlew build` |
| Java (Maven) | `pom.xml` | `mvn verify` | `~/.m2` | `mvn test` / `mvn verify` |
| Node | `package.json` | `npm test` | `~/.npm` | npm scripts `typecheck`, `test` / plus `lint`, `build` (only scripts that exist) |
| Go | `go.mod` | `go test ./...` | `~/go/pkg/mod` | `go vet` + `go test` / `go vet` + `go test -race` |
| Rust | `Cargo.toml` | `cargo test` | `~/.cargo` | `cargo test` / plus `cargo clippy -D warnings` |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements*.txt`, `pytest.ini`, `tox.ini` | `python3 -m pytest` | none needed | `python3 -m pytest` (SKIP with a reason if pytest is not installed or no tests are collected) |
| C/C++ (CMake) | `CMakeLists.txt` | `cmake -S . -B build && cmake --build build && ctest --test-dir build` | none | configure + build in a temp dir outside the worktree, then `ctest` (SKIP if cmake is missing) |
| C/C++ (make) | a `Makefile` **plus** C/C++ source files in the repo (`*.c`, `*.cc`, `*.cpp`, `*.cxx`, `*.h`, `*.hh`, `*.hpp`) | `make && make test` | none | `make`, then `make test` or `make check` if the target exists |
| Conan / vcpkg | `conanfile.txt` / `conanfile.py`, `vcpkg.json` | (alongside CMake) | `~/.conan2`, `~/.cache/vcpkg` | (through CMake) |

Notes:

- A repo can match several rows (e.g. CMake + Conan); all matches are listed.
- A `Makefile` without C/C++ sources is ignored: its default target could do anything.
- C/C++ sources without CMake or a Makefile are reported as `Stack: C/C++` with no build command.
- Nothing detected: `Stack: TODO`, `Build and test: TODO`, no cache folders. Fill them in by hand.
- `verify.sh` always runs `git diff --check` (whitespace errors) and, in full mode, the kit's own
  tests when `.agent-system/tests` exists in the checked folder (in-repo mode only).
- Detection runs once at `create`. `update` never rewrites your notes or `config.json`; edit them by hand.

---

## 6. Daily workflow

1. **Start**: `cd ~/Code/myrepo.workspace && herdr`, then `claude` in a pane (it starts with the orchestrator
   model you chose; add `--effort <level>` if you set one).
   Inside Claude, `!echo $HERDR_ENV` must print `1`.
2. **Ask**: describe the outcome you want. Small changes become one trivial task; larger ones get up to
   3 scout rounds, then 1-3 tasks.
3. **Watch** (optional): `ctrl+b w` jumps to a worker's Herdr workspace (`<run>-worker-N`).
   `ctrl+b q` detaches; agents keep running. Claude acts only while its turn is active: when you come
   back, ask it to "resume run r1".
4. **Decide**: only important decisions reach you (section 8). Claude asks with clickable choices and
   waits; Herdr (and Remote Control, if you use it) notifies you. Click an option, or type in "Other",
   from the terminal or your phone.
5. **Review and merge** when the run is DONE. Claude runs `report` and gives you a summary plus two files:
   `.orchestrator/runs/<run>/final-report.md` (tasks, commits, files, gate result, risks, decisions) and
   `final.diff` (everything the run changed, as one diff). Then Claude asks two clickable questions:

   ```text
   D3  Merge run r1?
       ( ) B: Merge locally only, no push (Recommended)
       ( ) A: Merge and push
       ( ) C: Don't merge
       ( ) Other: ____
   D3  What branch do you choose to merge?        (only for A or B)
       ( ) This branch (main)
       ( ) New branch feature/r1
       ( ) Other: type a branch name
   ```

   Claude records your answers word for word (`decision record ... --quote`) and runs `finish apply`:
   - **Merge into a branch checked out in your folder** (usually "this branch"): your folder must have no
     uncommitted changes (commit or stash first); your files update to the result.
   - **Other branch**: a new name is created at the result, an existing one is fast-forwarded; your
     folder is not touched unless that branch is checked out there.
   - **Your branch moved during the run**: it is merged into the integration branch first and the quality
     gate runs again; on a conflict or a failed gate nothing changes on your branch.
   - **A (push)**: pushes to the branch's upstream (or `origin`), never with force, never waiting for a
     password. If the push fails, the merge stays local and you push by hand.
   - Afterwards it closes the run's Herdr workspaces, removes its worktrees and deletes its `agent/*`
     branches. With **C**, everything stays on `agent/integration-<run>` for you to handle yourself.

   If `finish apply` refuses (uncommitted changes, conflict, failed gate, no remote), Claude tells you why;
   when nothing was changed, the same decision can be used again after you fix it.

---

## 7. Command reference

Run these from the workspace. `S` below means `python3 .agent-system/scheduler.py`. Global options go
**before** the command: `--json` (machine-readable output), `--workspace-root <dir>` (default: the
kit's parent folder; old name `--repo-root` still works). Every command has `--help`.

Most of these are run by Claude as orchestrator. The ones marked **you** are meant for you.

### Scripts

| Command | Who | What it does |
|---|---|---|
| `.agent-system/scripts/doctor.sh [--probe-codex]` | you | Tool versions, Herdr and Codex status, sandbox check, then `scheduler.py doctor`. `--probe-codex` makes one tiny live request with the configured Codex worker model |
| `.agent-system/scripts/verify.sh [--quick] [--dir PATH]` | you / scheduler | Quality gate for the stacks in section 5. `--quick` = post-merge smoke test |

### Setup and inspection

| Command | What it does |
|---|---|
| `S doctor` | Validate config, project/repo separation, tools, scout agent, Codex profile and model catalog |
| `S pool init` | Create the worktree folder; show each slot's state |
| `S pool show` | Show per-slot model/effort resolution |
| `S run list` | All runs and their status |
| `S run status --run R` | Tasks, workers, research gate, decisions and gate result of one run |

### Runs and planning

| Command | What it does |
|---|---|
| `S run create --run R --tasks FILE [--base REF] [--request-id ID]` | Validate the 1-3 task DAG and create `agent/integration-R` |
| `S run close --run R --status BLOCKED\|FAILED --reason "..." --decision D<n>` | Close a run (needs your decision) |
| `S research round --run R --evidence FILE [--question Q ...] [--summary S]` | Register a scout dossier (max 3 rounds per request) |
| `S research readiness --run R --status READY\|NOT_READY --preserve .. --contracts .. --interactions .. --testing .. --assumptions .. [--missing ..]` | Record the architecture-readiness gate; non-trivial tasks dispatch only after READY |
| `S task new --name "<task name>" [--date DD-MM-YY]` | Create `gen-tasks/<task-name>-<dd-mm-yy>.md` from the template |
| `S task new --repair-of gen-tasks/<file>.md` | Create a repair file for the same task |

### Dispatch and monitoring

| Command | What it does |
|---|---|
| `S dispatch-ready --run R [--launch herdr\|none] [--dry-run]` | Lease READY tasks to idle slots, create branches, start Codex in Herdr |
| `S wait --run R [--task T] [--timeout SEC] [--interval SEC]` | Block until a task reports, or its agent needs an approval |
| `S relaunch --run R --task T [--launch herdr\|none]` | Restart a lost worker session (same worktree) |
| `herdr agent list` / `herdr agent read <name> --source recent-unwrapped --lines 120` | See agents and what a worker is doing (worker names: `worker-N-<run>`) |

### Review and repair

| Command | What it does |
|---|---|
| `S collect --run R --task T` | Check the worker report against git; save the diff to `.orchestrator/runs/R/reports/T.diff` and append it to the task file |
| `S commit-task --run R --task T -m "msg" [--allow-outside --decision D<n>]` | Audited commit of an uncommitted worker diff or a minor fix (the sandbox keeps `.git` read-only) |
| `S mark-reviewed --run R --task T --verdict PASS\|MINOR_FIX\|MAJOR_FIX\|BLOCKED\|FAIL --report FILE [--notes ..] [--accept-scope --decision D<n>]` | Record the verdict; the report is appended to the task file |
| `S repair --run R --task T --packet FILE (--reason "evidence" \| --decision D<n>) [--relaunch]` | Send a repair to the same worker. First repair: routine (reason). Later ones: your decision |
| `S task-unblock --run R --task T --decision D<n> [--reset-repairs] [--note ..]` | BLOCKED -> PENDING after re-scoping (needs your decision) |
| `S worker-release --run R --worker worker-N` | Return an inspected, clean BLOCKED/BROKEN slot to IDLE |

### Integration and finish

| Command | What it does |
|---|---|
| `S integrate --run R` | Cherry-pick PASSED tasks in DAG order onto the integration branch, with a post-merge check after each |
| `S verify --run R` | Full `verify.sh` on the integration worktree; the run becomes DONE only on pass |
| `S report --run R [--summary FILE]` | DONE run: write `final-report.md` (Claude's summary on top, tasks, commits, files, gate, risks, decisions) and `final.diff` (the whole run as one diff) |
| `S finish ask --run R [--recommend A\|B\|C]` | Open your merge decision: A merge and push / B merge locally / C don't merge, then the branch (this branch or one you type) |
| `S finish apply --run R --decision D<n>` | Carry out your answer: fast-forward (merging a moved branch in and re-gating first), push for A, then clean up worktrees and `agent/*` branches |
| `S resume --run R` | After an interruption: reconcile state and print the next actions (never relaunches by itself) |
| `S cleanup --run R [--remove-worktrees]` | Close the Herdr workspaces this run created; remove clean worktrees |

### Decisions

| Command | Who | What it does |
|---|---|---|
| `S decision ask --run R --kind KIND [--task T] --title ".." --question ".." --option A=".." --option B=".." [--recommend A]` | Claude | Open a decision for you. Kinds: `blocker`, `repair`, `scope_exception`, `abandon`, `worker_approval`, `question` |
| `S decision record --run R --id D<n> --choice K --quote "<your reply>" [--followup K [--value TEXT]] [--note ..]` | Claude | Record the answer you gave in chat, with your exact words (`--followup`/`--value` for the second question, e.g. the branch) |
| `S decision wait --run R --id D<n> [--timeout SEC]` | Claude | Block until a decision is answered (rarely needed: Claude simply stops and waits for your reply) |
| `S decision routine --run R --kind KIND [--task T] --action ".." --reason ".."` | Claude | Record a routine call Claude made itself (e.g. approving a worker's in-worktree command) |
| `S decision list [--run R] [--all]` | anyone | Show pending (or all) decisions |
| `S decision cancel --run R --id D<n> --reason ".."` | Claude | Withdraw a decision that is no longer needed |

### Task states

Tasks: `PENDING -> READY -> RUNNING -> REVIEW -> PASSED -> MERGED`, plus `FIX_REQUIRED` (repair loop),
`BLOCKED`, `FAILED`. Workers: `IDLE`, `BUSY`, `BLOCKED` (quarantined dirty worktree), `BROKEN`.
Runs: `RUNNING`, `DONE`, `BLOCKED`, `FAILED`; a DONE run then records its `finish` outcome (merged into,
pushed to, or not merged). One run is active at a time.

---

## 8. Who decides what

**You decide (critical)**. Claude opens a decision and asks you with clickable choices (plus "Other"
to type), and waits for your answer. Only these reach you:

- unblocking a BLOCKED task, or a 2nd+ repair of the same task;
- accepting changes outside a task's owned paths; giving up a task (FAIL) or a run;
- any change to requirements, scope, acceptance criteria, public APIs/schemas, dependencies,
  security-sensitive behavior, data or migrations, or anything irreversible;
- **worker approval prompts that step outside the worker's worktree or sandbox** (writing elsewhere,
  network, installs, push, deleting, or anything the task forbids): if you approve, Claude types the
  matching key into the worker's prompt;
- a final-gate failure or integration conflict whose fix is not clear-cut;
- **merging and pushing the result** (`finish ask`): always yours, whatever `decisions.require_user_for` says.

**Claude decides (routine)**, with a recorded reason (`decision routine`): approving a worker's command
inside its worktree that the task allows (build, test, read-only), the first repair of a task with clear evidence,
minor fixes, re-collecting after a report-format error, relaunching a lost session, correcting its own
plan steps without changing goal, acceptance or owned paths.

Workers are told to ask only about real blockers (code or logic problems) and about stepping outside
their worktree or sandbox; every task file lists what the worker may and must not edit and run
("Boundaries"). To avoid approval prompts in the first place, list the build cache folders your stack
needs in `worker.writable_dirs` (section 5).

---

## 9. Configuration

`.agent-system/config.json` in each workspace (the kit's copy is the template):

| Key | Meaning |
|---|---|
| `project.path` | The repo, relative to the workspace (e.g. `"myrepo"`). Absent = in-repo mode |
| `orchestrator.kind/model/effort` | The main session's program, model and effort (set with `agent-kit config`; a Claude model is also written to `.claude/settings.json`) |
| `scout.model/effort` | The Claude Code research subagent (also written to `.claude/agents/scout.md`) |
| `worker.kind/model/reasoning_effort` | The workers' program, model and effort. Used exactly, never downgraded |
| `worker.profile`, `sandbox`, `approval_policy` | Codex profile `worker`, `workspace-write`, `on-request` |
| `worker.trust_worktree` | Mark the worker's own worktree as trusted so Codex skips its trust dialog |
| `worker.writable_dirs` | Extra folders workers may write (build caches). `~`, `/`, `~/.ssh`, `~/.codex`, `~/.config`, ... are rejected |
| `pool.size` / `pool.slots` | 1-3 worker slots |
| `pool.worktree_root` | Where worktrees go: `worktrees` (workspace mode) or `../{repo_name}.agent-worktrees` (in-repo) |
| `limits` | Max 3 tasks per request, parallelism, `max_major_repairs` (2), scout rounds (fixed at 3) |
| `decisions.require_user_for` | Decision kinds that need you: `blocker`, `repair`, `scope_exception`, `abandon` |
| `decisions.routine_repairs` | How many repairs per task Claude may send on its own (default 1) |
| `tasks.dir`, `tasks.inline_diff_max_lines` | Task file folder (`gen-tasks`) and how much diff is inlined into it |
| `herdr.*_timeout_ms` | Agent start and prompt acknowledgement timeouts |
| `gate.post_merge_check`, `gate.verify_cmd`, `gate.timeout_seconds` | Commands for the post-merge check and the final gate |

`.claude/settings.json` in the workspace holds the deny rules (Claude cannot edit run state or decision
files directly) and `permissions.additionalDirectories` with the real repo path, so Claude started in
the workspace can read and edit the repo through the symlink.

---

## 10. Changing the kit

The kit's source of truth is this folder. Each workspace has a copy that `agent-kit update` overwrites,
so never edit a workspace's `.agent-system/` directly.

```bash
cd ~/Code/agent-kit
$EDITOR .agent-system/scheduler.py                   # or prompts/, scripts/, templates/, docs/
python3 -m unittest discover -s .agent-system/tests   # offline: real git in temp dirs, fake Herdr
git add -A && git commit -m "..."
agent-kit update --folder=~/Code/myrepo              # roll it out to each workspace
```

| Path (inside `.agent-system/`) | Purpose |
|---|---|
| `scheduler.py` | Scheduler CLI: DAG, leases, state machines, research gate, decisions, git/Herdr wrappers |
| `models.py` | Model registry: the programs Herdr can launch (Claude Code and Codex verified, the rest unverified), Claude model list, Codex catalog, effort checks, the pick-from table |
| `kitconfig.py` | `agent-kit config`: choose program, model and effort per role; writes config, Claude settings and the scout file |
| `config.json` | Config template (no `project`; `create` fills it in; default models per role) |
| `prompts/` | Task and repair file templates, review checklist, research packet, readiness gate |
| `scripts/install.sh` | `agent-kit` itself (`create`, `update`, `config`) |
| `scripts/doctor.sh`, `verify.sh` | Health check, quality gate |
| `templates/` | `CLAUDE.md`/`AGENTS.md` sections and Claude deny rules |
| `tests/test_scheduler.py` | Scheduler, workspace mode and installer tests |
| `docs/` | Workspace rule; Decision Hub plan (not planned) |
| `../.claude/agents/scout.md` | The Sonnet scout definition |

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `ls` in the workspace shows no `.agent-system` | It is hidden (starts with a dot): use `ls -A` |
| `not running inside Herdr (HERDR_ENV != 1)` | Start Claude from a Herdr pane, or use `--launch none` and run the printed `codex` command |
| `... model is not supported when using Codex with a ChatGPT account` | Codex client too old: `codex update`, then `doctor.sh --probe-codex`; or choose another model with `agent-kit config` |
| `agent-kit config`: "unknown model" | Pick from the table it prints (on a terminal, type the number), or use `<program>/<model>` for an unverified program |
| Worker: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` | Add the bubblewrap AppArmor profile (GUIDE.md Part 2, step 2) |
| Worker's build fails on a lock file in `~/.gradle` (or another cache) | Add that cache folder to `worker.writable_dirs` |
| Report says `committed: false`, `index.lock: Read-only file system` | Expected: the sandbox keeps `.git` read-only. Review, then `commit-task` |
| A worker sits `blocked` | It wants an approval. Inside its worktree and allowed by the task: Claude approves it. Outside the worktree/sandbox: Claude asks you |
| `collect` says `pending` / `ambiguous` | No report yet / report disagrees with git: inspect `worktrees/worker-N` |
| `doctor`: `project-clean-of-kit` FAIL | AI tooling files show in the repo's `git status`: move them to the workspace |
| `agent-kit create`: "inside a Git repository, not its top folder" | Run it from the repo's top folder, or pass `--folder=<repo>` |
| `verify.sh`: `SKIP pytest - ... not installed` | `python3 -m pip install pytest`; until then Python tests are not run |
| A run is stuck | `S run status --run R`, `S resume --run R`, or close it via a decision |

---

## 12. More documentation

Inside `.agent-system/` (copied into every workspace):

- `GUIDE.md`: step-by-step walkthrough (Herdr basics, setup, first task, adopting results).
- `README.md`: scheduler file and command reference.
- `docs/WORKSPACE-SETUP.md`: the workspace rule (why the tooling lives outside the repo) and setup.
- `docs/DECISION-HUB-PLAN.md`: a web dashboard for remote decisions, not planned: Claude Remote Control
  plus chat answers covers it for a single user. Kept for reference.
- `prompts/review-checklist.md`, `prompts/task-packet.md`: how tasks are written and reviewed.

---

## Status and limitations

- **Tested:** the scheduler, workspace mode and installer have an offline test suite (real git in
  temp folders, a fake Herdr, no model calls). The full workflow with live Codex workers has been run
  in in-repo mode on a Java/Gradle project.
- **Not yet proven live:** a full run with live workers in workspace mode, `finish` against a real hosted
  remote (tested with a local bare repo), and real CMake/Conan/vcpkg projects (covered by tests only).
- **Platform:** developed on Linux (Ubuntu). macOS should work but is untested; Windows is not supported.
- **One active run at a time** per workspace; at most 3 workers and 3 tasks per request.
- **Using it on code you don't own:** check your team's policy on AI tools and on sending code to
  model providers before you start (`docs/WORKSPACE-SETUP.md`, rule 7).

## Contributing

Run the tests before sending changes: `python3 -m unittest discover -s .agent-system/tests`.
Keep `scheduler.py` stdlib-only.

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.

Copyright (c) 2026 Le Tien Dat.