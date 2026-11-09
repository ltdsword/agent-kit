# codextrust docs: orchestrator rules name the Herdr app commands (09/11/26)

## Goal
The orchestrator rules and the guide tell Opus how to read and answer a worker's screen in the Herdr app
(`hc`), so it never runs the old Herdr TUI CLI and wrongly concludes "Herdr server not running".

## Evidence (Opus)
- BanCaZagooMW orchestrator followed `CLAUDE.md` text "read it with `herdr agent read <agent> --source visible`,
  approve once with `herdr agent send-keys`", ran `herdr agent ...`, got server_not_running, and told the person
  to start the old Herdr - while the scheduler was correctly on the hc backend (Herdr app).
- Mentions: `.agent-system/templates/ORCHESTRATOR.section.md:83-84,114`, `.agent-system/GUIDE.md:154,323`.
- hc commands (check exact flags with `hc --help`, `hc read --help`, `hc send --help`; read-only help is allowed):
  read a worker screen `hc read <address-or-name>`, list `hc ls --all`, send keys/text `hc send ...`.
  Never `hc send --force`.

## Read first
- `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/GUIDE.md` (lines above and the backend part
  around line 46), `.agent-system/README.md` (`herdr.backend` row).

## Steps
1. Template: where it says `herdr agent read` / `herdr agent send-keys`, say the Herdr app way first (`hc read`,
   `hc send`, exact syntax from `--help`), and the old CLI only "with `herdr.backend: legacy`". Add one line: a
   worker started but not reporting may be stuck on a startup screen (trust, hooks, update): read its screen
   before relaunching; never relaunch while its agent is live; the old `herdr` CLI saying "server not running"
   says nothing about the Herdr app.
2. GUIDE.md lines 154 and 323: same switch (app command first, legacy in brackets).
3. Keep wording short; do not restructure other sections.

## Boundaries
**You may edit:** `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/GUIDE.md`.
**You must not edit:** scheduler.py, tests, README, agentctl.py, hub/**, plans/**, gen-tasks/**, .orchestrator/**, CLAUDE.md, AGENTS.md.
**You may run:** `hc --help` and `hc <cmd> --help` only; `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** any other `hc`/`herdr*`/`herdr-app` command; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] No `herdr agent` instruction is left without the hc equivalent first; suite green (template tests).

## Run these
- `grep -n "herdr agent" .agent-system/templates/ORCHESTRATOR.section.md .agent-system/GUIDE.md`
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (09/11/26 11:39)

- Status: **done** (worker worker-2, branch `agent/codextrust-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/GUIDE.md`, `.agent-system/templates/ORCHESTRATOR.section.md`
- Scope: OK
- Tests reported:
  - `grep -n "herdr agent" .agent-system/templates/ORCHESTRATOR.section.md .agent-system/GUIDE.md` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
  - `git diff --check` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/codextrust/reports/T2.diff`

````text
 .agent-system/GUIDE.md                          |  4 ++--
 .agent-system/templates/ORCHESTRATOR.section.md | 15 ++++++++++-----
 2 files changed, 12 insertions(+), 7 deletions(-)
````

````diff
diff --git a/.agent-system/GUIDE.md b/.agent-system/GUIDE.md
index 396c91e..8c37d61 100644
--- a/.agent-system/GUIDE.md
+++ b/.agent-system/GUIDE.md
@@ -151,7 +151,7 @@ What happens next, and where you come in:
 | 3. Readiness gate | Opus | READY, or a targeted round 2/3 (max 3 total). If still not ready, Opus inspects directly, narrows scope, or tells you what is missing |
 | 4. Plan | Opus | 1-3 tasks with dependencies; one plan file per task in `gen-tasks/<task-name>-<dd-mm-yy>.md` (open them to see exactly what each worker is told) |
 | 5. Dispatch | scheduler | New Herdr workspaces `<run>-worker-N` appear with the worker program running. Each worker gets a short prompt: read your task file, `WORKER-RULES.md`, key facts, cautions |
-| 6. Work | Workers | Watch with `ctrl+b w` or `herdr agent read ...`. A `blocked` worker is waiting on an approval: the orchestrator approves routine ones and asks you about the rest |
+| 6. Work | Workers | Watch with `ctrl+b w` or `hc read <name>` (`herdr agent read ...` only with `herdr.backend: legacy`). A `blocked` worker is waiting on an approval: the orchestrator approves routine ones and asks you about the rest |
 | 7. Review | Opus | `wait` -> `collect` captures the worker's diff and appends it to the task file -> Opus reviews and appends its verdict + report -> PASS / minor fix / fix round: errors + proposed fix go to the same worker and into the task file, then review again (max 2 rounds, then merge) |
 | 8. Integrate | scheduler | Accepted commits are cherry-picked onto `agent/integration-<run>`; `./gradlew test` after each |
 | 9. Final gate | scheduler | `verify.sh` (full `./gradlew build` + checks); run is DONE only if it passes |
@@ -320,7 +320,7 @@ mode, commit the kit before the first run, since worktrees are created from a co
 | Worker says `bwrap: ... RTM_NEWADDR: Operation not permitted` | Ubuntu's user-namespace restriction blocks Codex's sandbox: add the AppArmor profile (Part 2, step 2). Never switch workers to `danger-full-access` |
 | Worker's `./gradlew test` fails on a lock file in `~/.gradle` | Gradle's cache must be writable: keep `"writable_dirs": ["~/.gradle"]` in `config.json` (other stacks: README, Safety) |
 | Worker report says `git add` failed: `index.lock: Read-only file system` | Normal: the sandbox keeps `.git` read-only. The worker leaves changes uncommitted (`committed: false`), `collect` shows `needs_orchestrator_commit`, and Opus runs `commit-task` |
-| A worker sits `blocked` | `herdr agent read <name> --lines 80`; tell Opus what to approve or deny |
+| A worker sits `blocked` | `hc read --lines 80 <name>` (`herdr agent read <name> --lines 80` only with `herdr.backend: legacy`); tell Opus what to approve or deny |
 | Worker finished but Opus says `ambiguous` | Report and git disagree; Opus will ask the worker to fix or inspect it |
 | Slot shows `BLOCKED` (dirty worktree) | Look in `worktrees/worker-N` in the workspace; keep/commit what matters; `worker-release` |
 | A run got stuck | `run status` / `resume`; close it with `run close --status BLOCKED --reason ...` |
diff --git a/.agent-system/templates/ORCHESTRATOR.section.md b/.agent-system/templates/ORCHESTRATOR.section.md
index 26cec8d..8305e62 100644
--- a/.agent-system/templates/ORCHESTRATOR.section.md
+++ b/.agent-system/templates/ORCHESTRATOR.section.md
@@ -80,15 +80,19 @@ Critical (the user decides; never resolve alone):
 - when you are unsure whether something is critical: treat it as critical.
 
 Routine (you decide, with a recorded reason): a worker approval prompt for a command inside its
-worktree that the task's Boundaries allow (build, test, read-only): read it with `herdr agent read
-<agent> --source visible`, approve once with `herdr agent send-keys`, then `scheduler.py decision
-routine --run <run> --kind worker_approval --task <T> --action "approved <command>" --reason "<why>"`;
+worktree that the task's Boundaries allow (build, test, read-only): read it in the Herdr app with
+`hc read <agent>`; reply with `hc send <agent> <text>` or press keys with `hc keys <agent> <keys...>`
+(never `hc send --force`). Use `herdr agent read <agent> --source visible` and `herdr agent
+send-keys` only with `herdr.backend: legacy`, then `scheduler.py decision routine --run <run> --kind
+worker_approval --task <T> --action "approved <command>" --reason "<why>"`;
 fix rounds 1 and 2 of a task with clear evidence
 (failing test, review finding, mechanical merge conflict, post-merge failure caused by the task)
 via `repair ... --reason "<evidence>"`, unless the fix changes requirements, scope or contracts; MINOR_FIX; re-collect after a report-format error;
 `relaunch` of a lost session; correcting your own plan steps without changing goal, acceptance,
 or owned paths. The scheduler records each routine call in the task file; list them in your report.
 
+Before relaunching a started worker that is not reporting, read its screen: it may be stuck on a startup screen (trust, hooks, update); never relaunch while its agent is live, and the old `herdr` CLI saying `server not running` says nothing about the Herdr app.
+
 Only critical decisions go to the user; decide routine ones yourself (above). For a critical one
 (the user clicks an answer; Herdr, or Claude Remote Control, notifies them):
 1. `scheduler.py decision ask --run <run> --kind blocker|repair|scope_exception|abandon|worker_approval|question
@@ -110,8 +114,9 @@ Only critical decisions go to the user; decide routine ones yourself (above). Fo
    [--followup K --value V] --quote "<the text verbatim>" --note "answered in the Herdr app card"`.
 4. Carry out exactly the chosen option, passing the id to the command that acts: `repair|task-unblock|
    run close|commit-task --allow-outside|mark-reviewed --accept-scope|--verdict FAIL|finish apply ...
-   --decision D<n>`. For `worker_approval`: send the matching key to the worker's prompt with
-   `herdr agent send-keys`, then check that it left `blocked`. The scheduler refuses critical actions
+   --decision D<n>`. For `worker_approval`: press the matching key in the Herdr app with
+   `hc keys <agent> <keys...>` (or use `herdr agent send-keys` only with `herdr.backend: legacy`),
+   then check that it left `blocked`. The scheduler refuses critical actions
    without an answered, unused decision of the right kind (and routine ones without a reason).
 Record only what the user actually wrote, in their words: never invent, paraphrase or pre-fill an
 answer, never record one from your own reasoning, never edit `.orchestrator/**/state.json` or
````

## Review round 1: PASS (09/11/26 11:40)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 3e8d927f140b, commits 3e8d927f140b
- Notes: hc syntax verified; legacy CLI kept for legacy backend

# Review codextrust T2 (docs) - PASS
- Template: approval/worker_approval steps name `hc read`/`hc send`/`hc keys` first, legacy herdr CLI only for `herdr.backend: legacy`; never `hc send --force`. New line: read a non-reporting worker's screen before relaunch; never relaunch a live agent; old CLI "server not running" says nothing about the app.
- GUIDE.md 154, 323 switched likewise.
- Syntax checked against `hc --help`: `read [--lines N] <t>`, `send <t> <text>`, `keys <t> <keys...>`.
- In scope (2 owned files). No issues.

## Integration: merged (09/11/26 11:49)

- On `agent/integration-codextrust` at c7afff53e72e; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/codextrust/logs/post-merge-T2-a1.log`)

## Final gate: PASS (09/11/26 11:50)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-codextrust at c7afff53e72e (log `.orchestrator/runs/codextrust/logs/verify-1794199776.log`)
- Task MERGED; run DONE

## Finished (09/11/26 12:23)

- merged into hub/plan (decision D2)
