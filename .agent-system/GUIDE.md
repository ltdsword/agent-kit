# Guide: using Herdr and the multi-agent workflow

This guide takes you from zero to a finished, reviewed feature. Read parts 1-3 once. After that
you mostly use part 4. Command reference: [README.md](README.md).

**Who does what**

| Role | Model | Job |
|---|---|---|
| You | - | Ask for a feature, answer decisions, approve the merge and push |
| Orchestrator | Any agent program and model you choose (default Claude Code, Opus 5.5) | Plans, writes task specs, reviews, integrates |
| Scout | Claude Code subagent, the model you choose (default Sonnet 5.5), read-only | Reads the codebase and reports evidence to Opus |
| Workers 1-3 | Any agent program and model you choose (default Codex `gpt-6-luna` at `xhigh`) | Write the code, each in its own git worktree |
| Herdr | - | Runs and shows all of these terminals; keeps them alive if you detach |
| `scheduler.py` | - | Tracks who works on what, enforces the rules |

---

## Part 1 - Herdr in 5 minutes

Herdr is a terminal multiplexer built for coding agents (like tmux, but it understands agent state).

**Structure:** *session* -> *workspaces* (left sidebar, one per project or worker) -> *tabs* -> *panes*.
Herdr recognizes agents in panes and shows their state: `working`, `idle`, `blocked` (waiting for
approval), `done`.

**Start it**

```bash
cd ~/Code/thrift-demo.workspace   # the workspace, not the repo (docs/WORKSPACE-SETUP.md)
herdr                 # launch or re-attach the persistent session
```

**Keys** (prefix is `ctrl+b`: press it, release, then press the key)

| Keys | Action |
|---|---|
| `ctrl+b ?` | Help, lists every binding |
| `ctrl+b v` / `ctrl+b -` | Split pane vertically / horizontally |
| `ctrl+b h/j/k/l` | Move focus left/down/up/right |
| `ctrl+b z` | Zoom the current pane |
| `ctrl+b x` | Close pane |
| `ctrl+b c`, `ctrl+b n` / `p` | New tab, next / previous tab |
| `ctrl+b w` | Workspace picker (jump to a worker's workspace) |
| `ctrl+b b` | Toggle sidebar |
| `ctrl+b q` | **Detach**: agents keep running in the background |

Re-attach any time with `herdr`. Change keys in `~/.config/herdr/config.toml` (`herdr --default-config`
prints every option).

**Useful CLI commands** (run inside a Herdr pane)

```bash
herdr agent list                                            # all agents and states
herdr agent read worker-1-r1 --source recent-unwrapped --lines 120   # see what a worker is doing
herdr agent wait worker-1-r1 --timeout 600000               # block until it settles
herdr status                                                # client/server versions
```

Worker agents are named `<slot>-<run>`, e.g. `worker-1-r1`. Their workspaces are labeled `<run>-<slot>`.

---

## Part 2 - One-time setup checklist

`agent-kit create` sets up the kit files and the scout agent. You set up once per machine: the
programs you chose for each role, installed and logged in; their Herdr integrations
(`herdr integration install <program>`, so Herdr can track their state); for Codex workers
`~/.codex/worker.config.toml` (see the top-level README); and a git repo with a baseline commit
(`agent-kit create` offers to make one: `git init` + a first commit, only if you answer yes).
Steps 1-2 below apply to Codex.

1. **Codex client 0.163.0 or newer, logged in.** Older clients (e.g. 0.154.0) reject the worker model
   with *"The '<model>' model is not supported when using Codex with a ChatGPT account."* even on
   an account that has access. Fix with `codex update`, then confirm:
   ```bash
   .agent-system/scripts/doctor.sh --probe-codex     # expect: PASS: <worker model>/<effort> request completed
   ```
   Choose the models for each role with `agent-kit config` (README, "Choosing models"), and the number of
   parallel workers with `agent-kit config --num-worker=N` (1..10, default 3).
2. **Codex's sandbox must be able to start.** Run `codex sandbox -- sh -c 'echo sandbox-ok'`.
   On Ubuntu 24.04+ it fails with `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`
   because `kernel.apparmor_restrict_unprivileged_userns=1` blocks user namespaces. Fix it by
   allowing only bubblewrap (needs sudo):
   ```bash
   sudo tee /etc/apparmor.d/bwrap-codex >/dev/null <<'EOF'
   abi <abi/4.0>,
   include <tunables/global>
   profile bwrap-codex /usr/bin/bwrap flags=(unconfined) {
     userns,
     include if exists <local/bwrap-codex>
   }
   profile bwrap-codex-bundled /home/*/.codex/packages/standalone/releases/*/codex-resources/bwrap flags=(unconfined) {
     userns,
   }
   EOF
   sudo apparmor_parser -r /etc/apparmor.d/bwrap-codex
   ```
   Undo: `sudo apparmor_parser -R /etc/apparmor.d/bwrap-codex && sudo rm /etc/apparmor.d/bwrap-codex`.
   Never "fix" this by giving workers `danger-full-access`.
3. **Check everything:**
   ```bash
   .agent-system/scripts/doctor.sh
   python3 -m unittest discover -s .agent-system/tests
   ```
4. Optional: review `owned_paths`/gate commands in `.agent-system/config.json` and `scripts/verify.sh`
   (for a Gradle project: `./gradlew test` after each merge, `./gradlew build` for the final gate).

---

## Part 3 - Start a session the right way

The workflow only dispatches live workers when the orchestrator runs **inside** Herdr (it checks
`HERDR_ENV=1`). `agent-kit start` takes care of that:

```bash
cd ~/Code/thrift-demo.workspace    # workspace: kit + state; the repo is the symlink thrift-demo/
agent-kit start                    # opens Herdr (starts it if needed) and launches the orchestrator
```

**What `agent-kit start` does:**
- It launches the program, model and effort you chose (`agent-kit config --show`) in a new Herdr
  workspace named after the project, as agent `orch-<repo>`.
- From a normal terminal it attaches you to Herdr afterwards; inside Herdr it just switches to the
  new workspace.
- Running it again switches to the running orchestrator instead of starting a second one.
- Programs other than Claude Code get a first prompt telling them to read `AGENTS.md` (their rules)
  and the notes in `CLAUDE.md`.
- If the program asks something at startup (e.g. "trust this folder"), answer it in the pane.

**After changing models: `agent-kit continue`.** It closes the running orchestrator (only if idle;
`--force` otherwise) and reopens the workspace's last active chat with the new settings, from inside
or outside Herdr. The chat id lives in `.orchestrator/orchestrator.json`; a Claude Code hook updates it
whenever a chat in the workspace starts or gets a prompt. See README, "Continuing the last chat".

**Doing it by hand instead:** run `herdr`, then start the program in a pane, e.g. plain `claude`
(it uses the model from `.claude/settings.json`). If Claude was already running before the scout
agent existed, restart it once so `.claude/agents/scout.md` loads.

---

## Part 4 - Submitting a coding task

Type your request normally. Be specific about the outcome; Opus handles the rest. Example:

> Add input validation to `registerUser`: reject empty names and malformed emails with a clear
> error in `RegisterUserResp`, and add unit tests. Use the multi-agent workflow.

What happens next, and where you come in:

| Step | Who | What you see |
|---|---|---|
| 1. Size the request | Opus | Small change: one trivial task, no scouting. Bigger: continues below |
| 2. Scout round 1 | Sonnet | Opus says what it is asking; the dossier is saved to `.orchestrator/runs/<run>/research/` |
| 3. Readiness gate | Opus | READY, or a targeted round 2/3 (max 3 total). If still not ready, Opus inspects directly, narrows scope, or tells you what is missing |
| 4. Plan | Opus | 1-3 tasks with dependencies; one plan file per task in `gen-tasks/<task-name>-<dd-mm-yy>.md` (open them to see exactly what each worker is told) |
| 5. Dispatch | scheduler | New Herdr workspaces `<run>-worker-N` appear with the worker program running. Each worker gets a short prompt: read your task file, `WORKER-RULES.md`, key facts, cautions |
| 6. Work | Workers | Watch with `ctrl+b w` or `herdr agent read ...`. A `blocked` worker is waiting on an approval: the orchestrator approves routine ones and asks you about the rest |
| 7. Review | Opus | `wait` -> `collect` captures the worker's diff and appends it to the task file -> Opus reviews and appends its verdict + report -> PASS / minor fix / fix round: errors + proposed fix go to the same worker and into the task file, then review again (max 2 rounds, then merge) |
| 8. Integrate | scheduler | Accepted commits are cherry-picked onto `agent/integration-<run>`; `./gradlew test` after each |
| 9. Final gate | scheduler | `verify.sh` (full `./gradlew build` + checks); run is DONE only if it passes |
| 10. Report | Opus | Summary in chat + `final-report.md` and one total diff `final.diff` |
| 11. Merge decision | You | Click: A merge and push / B merge locally / C don't merge, then which branch |
| 12. Finish | scheduler | Fast-forward the chosen branch, push if A (never force), clean up worktrees and branches |

Under the hood Opus runs commands like these (you can run them too):

```bash
S="python3 .agent-system/scheduler.py"
$S task new --name "email validation"        # -> gen-tasks/email-validation-16-10-26.md, Opus fills it
$S run create --run r1 --tasks .orchestrator/runs-input/r1-tasks.json
$S research round --run r1 --evidence /tmp/scout-1.md --question "Where is RegisterUserReq validated?"
$S research readiness --run r1 --status READY --preserve "..." --contracts "..." \
   --interactions "..." --testing "..." --assumptions "..."
$S dispatch-ready --run r1
$S wait --run r1                              # returns when a worker writes its report
$S collect --run r1 --task T1                 # diff -> reports/T1.diff + task file
$S commit-task --run r1 --task T1 -m "..."    # workers can't commit inside the sandbox
$S mark-reviewed --run r1 --task T1 --verdict PASS --report review-T1.md
$S integrate --run r1
$S verify --run r1
$S run status --run r1          # anytime
$S resume --run r1              # after a crash/restart: shows next actions
```

**The task file** (`gen-tasks/<task-name>-<dd-mm-yy>.md`) is the full record of one worker task:

```text
# Limit name length (16/10/26)        <- Opus's plan, written for Luna: decisions already made
## Goal / Read first / Steps / Boundaries / Do not / Done when / Run these / Notes
---
## Worker result - attempt 1         <- appended by collect: status, files, tests, risks,
   diffstat + inline diff                 full diff in .orchestrator/runs/<run>/reports/T1.diff
## Review round 1: MAJOR_FIX        <- appended by mark-reviewed: verdict + Opus's report
## Fix round 1/2: errors and proposed fix, sent to worker-1   <- appended by repair
## Worker result - attempt 2         <- the same worker's fix
## Review round 2: PASS              <- (after round 2 there is no further review: PASS + known issues)
## Integration: merged               <- appended by integrate
## Final gate: PASS                  <- appended by verify
```

Workers can't `git commit` (the sandbox keeps `.git` read-only), so their changes stay in the worktree.
The diff is captured straight from git, not from what the worker claims. After review, Opus commits
it with an audited `Orchestrator-Commit` trailer.

**The review loop (max 2 fix rounds per task).** When Opus finds an error (in review, or when the task
breaks the build or conflicts at integration), it writes the errors and a proposed fix in
`<task file>-repairN.md` and sends it to the worker that did the task (same session, branch and
worktree). The errors and the fix are also copied into the task file, so you can read every problem
there. The worker fixes, Opus collects and reviews again. Both rounds are Opus's call (with the
evidence recorded). After round 2 there is no further review round: Opus accepts the task and lists
anything still wrong as **known issues** in the task file and the final report, and you decide at the
merge question. Only a task that still cannot merge (conflict, failing check) stops and asks you.

The `gen-tasks/` files are not git-ignored. Commit them with the feature if you want the history,
or delete them.

**When something goes wrong: you decide the critical things, Opus the routine ones.**
Critical, so Opus asks you: unblocking a blocked task (e.g. still failing to merge after 2 fix rounds), changes
outside the planned files, giving up a task or run, any requirement/scope/API/dependency/security/
data change, a worker's approval prompt, an unclear final-gate failure. Routine, so Opus decides
and writes its reason into the task file: fix rounds 1 and 2 with clear evidence (failing test,
review finding, mechanical conflict), minor fixes, relaunching a lost session, fixing its own plan
steps without changing the goal. For a critical one, Opus opens a decision (question, evidence,
options, its recommendation) and asks you with clickable choices. Herdr marks the session as waiting,
and Remote Control (if you use it) notifies your phone. Click an option, or type in "Other":

```text
D2  T1 is blocked: the spec doesn't say whether to use contract X or Y.
    ( ) A: Use X (Recommended)
    ( ) B: Use Y
    ( ) Other: B, use the 2024 contract
```

Opus records your answer word for word (`decision record --run r1 --id D2 --choice B --quote "..."`) and
carries it out. The scheduler refuses critical actions (`task-unblock`, `run close`,
scope exceptions, FAIL, merge/push) without a recorded answer, and routine ones without Opus's reason.
If your reply is ambiguous, Opus asks again instead of guessing. Every question and answer is
appended to the task file and saved in `.orchestrator/runs/<run>/decisions/`. Tune it in
`config.json` -> `decisions`: `require_user_for` (critical kinds) and `routine_repairs` (how many
fix rounds per task Opus may start alone; default 2, set 0 to approve every round). The number of
rounds is `limits.max_major_repairs` (2).

**While it runs:** you can detach (`ctrl+b q`); workers keep going. Note that Opus only acts while its
Claude turn is active. When you come back, ask Opus to "resume run r1": it runs `resume`, collects
finished reports, and continues.

**Small requests:** say "just do it directly" or let Opus choose a single trivial task; there is no need
for several workers and a DAG for a one-line change.

---

## Part 5 - Adopting the result

Nothing touches your branches until you answer. When the run is DONE, Opus runs `report` and points you
to two files in `.orchestrator/runs/<run>/`: `final-report.md` (tasks, commits, files, gate, risks,
decisions) and `final.diff` (the whole run as one diff; no need to look at individual worktrees). You
can also inspect the branch directly: `git -C thrift-demo log --oneline main..agent/integration-r1`.

Then Opus asks two clickable questions: "Merge run r1?" (A merge and push / B merge locally only /
C don't merge), and for A or B, "What branch do you choose to merge?" (this branch, a suggested new
branch, or type any name in "Other").

Opus then runs `finish apply`. It fast-forwards the chosen branch (a new name is created at the result;
if the branch moved during the run it is merged in first and the gate runs again), pushes for A (to the
branch's upstream or `origin`, never with force), then closes the run's Herdr workspaces, removes its
worktrees and deletes its `agent/*` branches. Merging into the branch checked out in your folder needs a
clean folder (commit or stash first). With C, everything stays on `agent/integration-r1`; clean up later
with `python3 .agent-system/scheduler.py cleanup --run r1 --remove-worktrees`.

---

## Part 6 - Reusing the kit in another project

The kit has no project-specific paths. `verify.sh` detects Gradle, Maven, npm, Go, Cargo,
Python (`pyproject.toml`, `setup.py`, `requirements*.txt`, ...: runs pytest, or reports SKIP when pytest is
not installed) and C/C++ (CMake, built in a temp dir + `ctest`; or `make` + `make test`/`check` when the
repo has C/C++ sources).

The kit's home is `~/Code/agent-kit`; the `agent-kit` command copies it.

**Any repo, especially work repos: use a workspace.** Nothing is written into the repo.

```bash
cd ~/Code
agent-kit create --folder=other-project   # creates other-project.workspace: link, kit copy, config;
                                          # asks which models to use (agent-kit config changes them later)
cd other-project.workspace
.agent-system/scripts/doctor.sh                     # then fill in the TODOs at the top of CLAUDE.md
```

Later, `agent-kit update` (inside the workspace, or `agent-kit update --folder=other-project`) brings it to the latest kit and
keeps its `config.json` and notes. Details: `docs/WORKSPACE-SETUP.md` section 4.

**Your own repos only: in-repo mode** (the kit is committed into the repo and its `.gitignore` is edited):

```bash
cd ~/Code/other-project
agent-kit --dry-run ~/Code/other-project                  # preview
agent-kit ~/Code/other-project                            # not a git repo yet? it offers git init + a first commit
git add .agent-system .claude CLAUDE.md AGENTS.md .gitignore
git commit -m "chore: add multi-agent orchestration kit"
```

Both modes preserve existing CLAUDE.md/AGENTS.md content (they only add or replace their own marked
block), keep an existing `config.json` and a customized `scout.md`, and never touch `.orchestrator/`.
Re-run them later to update the kit. The Codex profile `~/.codex/worker.config.toml` is global, so it
is shared by every project.

Workers read `.agent-system/WORKER-RULES.md` (their prompt points to it) in both modes. In in-repo
mode, commit the kit before the first run, since worktrees are created from a commit.

---

## Part 7 - Troubleshooting

| Problem | What to do |
|---|---|
| Orchestrator says "not running inside Herdr" | Quit it and use `agent-kit start` (Part 3) |
| An unverified program fails to start, or ignores the model | Set `launch_args` for that role in `.agent-system/config.json` (README, "Choosing models") |
| Model not supported with ChatGPT account | Old client: `codex update` (Part 2, step 1), or choose another model with `agent-kit config` |
| Worker says `bwrap: ... RTM_NEWADDR: Operation not permitted` | Ubuntu's user-namespace restriction blocks Codex's sandbox: add the AppArmor profile (Part 2, step 2). Never switch workers to `danger-full-access` |
| Worker's `./gradlew test` fails on a lock file in `~/.gradle` | Gradle's cache must be writable: keep `"writable_dirs": ["~/.gradle"]` in `config.json` (other stacks: README, Safety) |
| Worker report says `git add` failed: `index.lock: Read-only file system` | Normal: the sandbox keeps `.git` read-only. The worker leaves changes uncommitted (`committed: false`), `collect` shows `needs_orchestrator_commit`, and Opus runs `commit-task` |
| A worker sits `blocked` | `herdr agent read <name> --lines 80`; tell Opus what to approve or deny |
| Worker finished but Opus says `ambiguous` | Report and git disagree; Opus will ask the worker to fix or inspect it |
| Slot shows `BLOCKED` (dirty worktree) | Look in `worktrees/worker-N` in the workspace; keep/commit what matters; `worker-release` |
| A run got stuck | `run status` / `resume`; close it with `run close --status BLOCKED --reason ...` |
| Scout not available | Restart Claude once (new `.claude/agents/` directory) |

More detail: [README.md](README.md#troubleshooting).
