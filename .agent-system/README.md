# .agent-system - Opus + Sonnet + Codex orchestration kit

Reference for the files and commands in this directory. For a step-by-step walkthrough
(Herdr basics, first task, adopting results, reusing in another repo) read **[GUIDE.md](GUIDE.md)**.

```text
User request -> orchestrator: configured program + model (default Claude Code, Opus 5.5), launched by `agent-kit start`
                 |- scout subagent: configured Claude model (default Sonnet 5.5, effort medium), read-only (max 3 rounds/request)
                 v
            1..N task DAG -> scheduler.py (leases, states, durable JSON) -> workers
                 worker-1 / worker-2 / worker-3: the configured program + model (default Codex gpt-6-luna @ xhigh), one Herdr workspace + git worktree each
                 task plan per worker: gen-tasks/<task-name>-<dd-mm-yy>.md (written by Opus)
                 -> wait -> collect (diff captured + appended to the task file) -> Opus review
                 (verdict + report appended) -> sequential cherry-pick onto agent/integration-<run>
                 -> post-merge check -> verify.sh full gate -> report (final-report.md + final.diff)
                 -> Opus asks you (clickable, `finish ask`): merge+push / merge / don't; which branch
                 -> finish apply: fast-forward, push if chosen (never force), cleanup
```

## Files

| Path | Purpose |
|---|---|
| `config.json` | Program/model/effort per role (orchestrator, scout, worker; set with `agent-kit config`), pool size, task cap and parallelism (3 by default; `agent-kit config --num-worker=N`, 1..10), max 2 fix rounds per task, 3 scout rounds, gate commands |
| `models.py` | Model registry: Herdr agent programs (Claude Code and Codex verified, others unverified), Claude list, Codex catalog, effort checks, pick-from table |
| `kitconfig.py` | `agent-kit config`: choose program/model/effort per role (flags, or interactive on a terminal) |
| `kitstart.py` | `agent-kit start` / `continue`: open Herdr and launch the orchestrator with its program/model/effort, or resume its last chat |
| `agentctl.py` | Agent Hub connector: enable the workspace, preview a sync, watch status and documents, and manage the connector |
| `hubctl.py` | Agent Hub account, computer registration, local backend and proxy-setup commands |
| `scripts/record-session.py` | Claude Code hook (SessionStart, UserPromptSubmit): saves the workspace's active chat id to `.orchestrator/orchestrator.json` |
| `WORKER-RULES.md` | Rules every worker reads, whatever its program (the worker prompt points to it) |
| `templates/ORCHESTRATOR.section.md` | Orchestrator rules, written into the workspace's `CLAUDE.md` and `AGENTS.md` |
| `scheduler.py` | Stdlib CLI: DAG validation, readiness, leases, state machine, research gate, git/Herdr wrappers |
| `prompts/task-packet.md` | Template + authoring guidance for a worker task file (`task new` copies it) |
| `prompts/repair-packet.md` | Template for a repair file to the same worker (`task new --repair-of`) |
| `prompts/review-checklist.md` | Review policy, verdict table, review-report format |
| `prompts/research-packet.md` | Scout request + dossier format |
| `prompts/architecture-readiness.md` | Planning gate checklist (a)-(e) |
| `scripts/doctor.sh` | Tooling/model/integration report (`--probe-codex` for a live model check) |
| `scripts/verify.sh` | Stack-detecting quality gate (`--quick` for post-merge smoke) |
| `scripts/install.sh` | `agent-kit create/update/config/start [--folder=<repo>]`: create `<repo>.workspace` next to the repo with the kit, or refresh it (`docs/WORKSPACE-SETUP.md` section 4). `agent-kit <repo>`: legacy in-repo install. `agent-kit --version`: kit version (and the workspace's, in `.agent-system/VERSION`) |
| `docs/WORKSPACE-SETUP.md` | Rule for work projects: tooling in `<repo>.workspace/`, repo via symlink (workspace mode) |
| `docs/DECISION-HUB-PLAN.md` | Agent Hub plan (planned, not built): web dashboard, decisions, prompts and reports per workspace, local backend |
| `templates/claude-settings.json` | Deny rules: Claude can't edit run state or decision files directly |
| `tests/test_scheduler.py` | Offline tests (real git in temp dirs, fake Herdr, no model calls) |
| `../.claude/agents/scout.md` | Sonnet scout definition |
| `../gen-tasks/<task-name>-<dd-mm-yy>.md` | One file per worker task: Opus's plan, then appended Worker result (with diff), Review (verdict + report), Integration, Final gate. Not git-ignored: commit them if you want the history |
| `../.orchestrator/runs/<run>/` | Git-ignored runtime state: `state.json`, `research/`, `packets/` (generated headers), `reports/<T>.json` + `<T>.diff`, `logs/` |
| `~/.codex/worker.config.toml` | Personal Codex profile used by `codex --profile worker` |

**Two roots.** The workspace (the folder holding `.agent-system/`) keeps config, state, task files and
worktrees. The git repo is `config.json` `project.path` (e.g. the symlink `thrift-demo -> ../thrift-demo`);
every git command runs there, never in the workspace. Without `project.path` the kit runs in-repo (both
roots the same). Worktrees live in `pool.worktree_root`, outside the repo: `worktrees/` in the workspace
(`worker-1..N`, `integration-<run>`).

## Commands (all implemented; `python3 .agent-system/scheduler.py <cmd> --help`)

Prefix every command with `python3 .agent-system/scheduler.py`. Add `--json` before the command for JSON output.

| Command | What it does |
|---|---|
| `doctor` | Validate config, tools, scout agent, Codex profile, cached model catalog |
| `agentctl enable [--url URL]` / `sync --dry-run [--json]` / `watch [--interval 5] [--no-orchestrator]` / `status` / `stop` / `reset-id` | Configure and inspect the optional Agent Hub connector (`python3 .agent-system/agentctl.py <command>`) |
| `agent-kit create-user --name=<u>` / `reset-password --name=<u>` | Admin-only account setup; prints the generated password once |
| `agent-kit hub-login --name=<u> [--url=<proxy>] [--computer-name=<n>]` | Register this computer and enable the connector in the current workspace |
| `agent-kit hub start\|stop\|status` | Start, stop or inspect the local Agent Hub backend |
| `agent-kit proxy-setup [--rotate-admin-key] [--origins ...]` | Provision the shared Agent Hub proxy |
| `pool init` / `pool show` | Create the worktree root, show slot paths/state; show per-slot model resolution |
| `run create --run ID --tasks FILE [--base REF] [--request-id ID]` | Validate run title/goal and task DAG (1..`max_tasks_per_request`), create `agent/integration-ID` worktree |
| `run status --run ID` / `run list` / `run close --run ID --status BLOCKED\|FAILED --reason ...` | Inspect or close runs |
| `research round --run ID --evidence FILE --question Q...` | Register a scout dossier (rejects a 4th round per request) |
| `task new --name "<name>" [--date dd-mm-yy]` | Create `gen-tasks/<name>-<dd-mm-yy>.md` from the template (`-2`, `-3` on collision) |
| `task new --repair-of gen-tasks/<file>.md` | Create `<file>-repairN.md` from the repair template |
| `research readiness --run ID --status READY\|NOT_READY --preserve .. --contracts .. --interactions .. --testing .. --assumptions .. [--missing ..]` | Record the gate after each round |
| `dispatch-ready --run ID [--launch herdr\|none] [--dry-run]` | Lease READY tasks to IDLE slots, create branches, start Codex in Herdr |
| `relaunch --run ID --task T` | Restart a lost session for a RUNNING task (same worktree) |
| `decision ask --run ID --kind K [--task T] --title .. --question .. --option 'A=label :: consequence' --option 'B=label :: consequence' [--evidence 'code :: note'] [--note ..]` | Opus asks the user with evidence and consequences; worker approvals also accept `--approval-command`, `--approval-cwd`, `--approval-why` |
| `decision wait --run ID --id D1` / `decision list [--all]` / `decision cancel` | Wait for / list / withdraw decisions |
| `decision record --run ID --id D<n> --choice K --quote "<user's reply>" [--followup K --value V]` | Record the user's answer (clicked or typed) with their exact words |
| `decision routine --run ID --kind K [--task T] --action ".." --reason ".."` | Record a routine call Opus made itself, e.g. approving a worker's in-worktree command |
| `wait --run ID [--task T] [--timeout 540]` | Block until a worker writes its report or shows an approval prompt; exit 3 on timeout |
| `collect --run ID --task T` | Validate the report against git (`pending` / `ambiguous` / `REVIEW`); save `reports/T.diff` (commits + uncommitted + new files); append "Worker result" to the task file |
| `commit-task --run ID --task T -m MSG` | Audited orchestrator commit of an uncommitted worker diff or Opus minor fix |
| `mark-reviewed --run ID --task T --verdict PASS\|MINOR_FIX\|MAJOR_FIX\|BLOCKED\|FAIL --report FILE [--notes ..] [--known-issues ..]` | Record review; verdict + report appended to the task file. No MAJOR_FIX after the last fix round |
| `repair --run ID --task T --packet FILE --reason ..` | Fix round to the same worker session (max 2); errors + proposed fix copied into the task file |
| `integrate --run ID` | Cherry-pick PASSED tasks in DAG order; post-merge check; MERGED; unlock dependents |
| `verify --run ID` | Full `verify.sh` on the integration worktree; run becomes DONE only on pass |
| `report --run ID [--summary FILE]` | DONE run: `final-report.md` + `final.diff` (the whole run as one diff) for the user |
| `finish ask --run ID [--recommend A\|B\|C]` | User decision: A merge+push / B merge locally / C don't, then the branch (this one or typed) |
| `finish apply --run ID --decision D<n>` | Carry it out: fast-forward (moved branch merged in + re-gated), push if A (never force), cleanup |
| `resume --run ID` | Reconcile after interruption; prints next actions; never relaunches by itself |
| `worker-release --run ID --worker W` | Return an inspected, clean BLOCKED/BROKEN slot to IDLE |
| `task-unblock --run ID --task T [--reset-repairs]` | BLOCKED -> PENDING after Opus re-scopes |
| `cleanup --run ID [--remove-worktrees]` | Close Herdr workspaces this run created; remove clean worktrees |

### tasks.json

```json
{"title": "Register email validation", "goal": "Reject invalid email addresses in registration.", "tasks": [
  {"id": "T1", "title": "Add email validation to registerUser", "summary": "Reject malformed email addresses before creating a user and cover the response with a unit test.", "depends_on": [],
   "owned_paths": ["src/main/java/org/example/user/server/", "src/test/java/"],
   "acceptance": ["invalid email -> error response", "unit test covers it"],
   "packet": "gen-tasks/email-validation-16-10-26.md", "trivial": false}
]}
```

## User-held decisions

Critical problems go to the user; routine ones are Opus's call, with a reason recorded in the task
file (`DECIDED_BY_OPUS` in state). Critical actions need `--decision D<n>`, an answered, unused
user decision of the right kind for that task: `task-unblock` (blocker), `run close` and
`mark-reviewed --verdict FAIL` (abandon), `commit-task --allow-outside` and `mark-reviewed
--accept-scope` (scope_exception), and `repair` (repair) beyond `decisions.routine_repairs`. With the
defaults both fix rounds of a task are routine: `repair ... --reason "<evidence>"`. After the last round
(`limits.max_major_repairs`, 2) `mark-reviewed` refuses MAJOR_FIX: PASS with `--known-issues`, or FAIL.
Configure in `config.json` -> `decisions`. Policy-level critical items (requirement/scope/API/
dependency/security/data changes, worker approval prompts, merge/push) are in `CLAUDE.md`. The user
clicks an answer (or types one); Opus records only the user's answer, verbatim (`decision record --quote`), and every
answer is logged with those words in the decision file and the task file. Deny rules in
`.claude/settings.json` keep Claude from editing state and decision files directly. These are
guardrails that make every decision auditable, not a sandbox.

## State machine

Tasks: `PENDING -> READY -> RUNNING -> REVIEW -> PASSED -> MERGED`, with `FIX_REQUIRED` (review loop, max 2 fix rounds; afterwards a failing merge is BLOCKED),
`BLOCKED`, `FAILED`. Invalid transitions are rejected. A task is READY only when every dependency is
MERGED **and** its post-merge check passed. Workers: `IDLE`, `BUSY`, `BLOCKED` (quarantined dirty
worktree), `BROKEN`. A worker holds its lease from dispatch until MERGED (retry affinity). State is
written atomically under an exclusive file lock (`.orchestrator/scheduler.lock`); one active run at a time.

## Safety

- Codex workers: `workspace-write` sandbox, `on-request` approvals; network on when `worker.network_access`
  is true (default, so tests can open sockets; Codex can't limit it to localhost); web search on when
  `worker.web_search` is true (default) to look up docs; no downloads or installs unless the task file
  allows them;
  never `danger-full-access` or `--dangerously-bypass-approvals-and-sandbox` (config validation rejects it).
- `writable_dirs` (default `["~/.gradle"]`) adds build-tool caches as extra writable roots so tests
  can run inside the sandbox (Gradle needs its lock files). Use `~/.m2` for Maven, `~/.npm` for npm,
  `~/.cargo` for Cargo, `~/go/pkg/mod` for Go, `~/.cache/pip` for pip. `/`, `$HOME`, `.ssh`, `.codex`,
  `.claude`, `.config`, `.aws`, `.gnupg`, `.git` (also through symlinks) are rejected.
- `trust_worktree: true` in config passes `-c projects."<worktree>".trust_level="trusted"` for the
  worker's own worktree only, so Codex does not stop at a trust dialog. Set it to `false` to approve manually.
- Dirty slot worktrees are quarantined, never reset or cleaned. Your branch is never modified;
  results land on `agent/integration-<run>` for you to merge.
- No pushes, PRs, deploys, or migrations without your explicit approval.

## Cost notes

Every worker task and repair runs the configured worker model and effort (`agent-kit config`; no
automatic downgrade); higher efforts raise latency and metered usage. Three parallel workers = three concurrent sessions. Keep
small requests to one trivial task. Scout rounds are capped at 3 per request.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `not running inside Herdr (HERDR_ENV != 1)` | Start Claude from a Herdr pane, or use `--launch none` and run the printed `codex` command yourself |
| `'<model>' model is not supported when using Codex with a ChatGPT account` | Client too old: `codex update` (0.163.0 works), check `codex login status`, then `scripts/doctor.sh --probe-codex`; or choose another model with `agent-kit config` |
| worker reports `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` | Ubuntu's `apparmor_restrict_unprivileged_userns=1` blocks Codex's sandbox. Add the bwrap AppArmor profile from GUIDE.md Part 2 step 2, test with `codex sandbox -- sh -c 'echo ok'`; never weaken the worker sandbox |
| report has `committed: false`, `index.lock: Read-only file system` | Expected: Codex's `workspace-write` keeps `.git` read-only. Review the diff, then `commit-task` (audited `Orchestrator-Commit` trailer) |
| worker's `./gradlew` fails: lock file / read-only `~/.gradle` | Add the cache dir to `worker.writable_dirs` (default has `~/.gradle`) |
| `collect` says `pending` | No report yet; `herdr agent read <name> --source recent-unwrapped --lines 120` to see progress |
| `collect` says `ambiguous` | Report disagrees with git (wrong HEAD/commits, stray changes); inspect the worktree, ask the worker to fix the report |
| worker `BLOCKED` with dirty worktree | Inspect `worktrees/worker-N` (in the workspace), keep or commit what matters, then `worker-release` |
| Codex shows an approval prompt | Herdr marks it `blocked`; read it with `herdr agent read`, decide, answer with `herdr agent send-keys` |
| `run(s) [...] still RUNNING` | Finish it (`verify`) or `run close --status BLOCKED --reason ...` |
| scout agent not found in an old session | First agent in a new `.claude/agents/` dir needs a Claude restart |
