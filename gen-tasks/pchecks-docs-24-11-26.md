# pchecks-docs (24/11/26)

## Goal
The orchestrator rules and the docs describe the new review flow: after `collect`, run `check start` (a separate
review session plus a Code Mode test session in parallel) and `check wait`. On FAIL, repair; on PASS,
`mark-reviewed` with the review report. Gates and tests never run inside the orchestrator session.

## Read first
- `plans/261124-0230-pchecks/plan.md` (design; numbers behind it).
- `gen-tasks/pchecks-scheduler-24-11-26.md`: the command contract you document. Do not change it:
  `check start --run R --task T`, `check wait --run R --task T [--timeout S]` -> result pass|fail|blocked|lost|timeout;
  `check status --run R --task T`. Reports are `.orchestrator/runs/R/reports/T.check-review.md|json` and
  `T.check-test.md|json`. Config is the optional `checks` block (enabled, timeout_seconds, review/test: kind
  claude, model, effort, code_mode). Checks need `herdr.backend: hc`.
- `.agent-system/templates/ORCHESTRATOR.section.md` step 4 and the "Routine" paragraph.
- `.agent-system/GUIDE.md` Part 4; `.agent-system/README.md` command table (~100-115) and the file table (~37).

## Steps
1. `templates/ORCHESTRATOR.section.md`, step 4. After "`collect` ...", insert: "Then `scheduler.py check start
   --run <run> --task <T>`: a separate review session and a Code Mode test session check the task in parallel
   (task worktree, read-only). Run `scheduler.py check wait --run <run> --task <T>` in the background. The first
   FAIL ends both sessions: read its report and go to the repair loop (FAIL report = the evidence). When both
   pass, `commit-task` if uncommitted, then `mark-reviewed --verdict PASS --report <the check-review.md path>`.
   `blocked` = a checker's approval prompt (handle it like a worker approval). `lost`/`timeout` = start the checks
   again once, then review yourself."
   Keep the current own-review text as the fallback when checks are off (`checks.enabled: false`) or the backend
   is not hc. Add one rule line: "Never run builds, tests or gates inside your own session: the test checker,
   `integrate` (post-merge check) and `verify` run them; read their logs and reports."
   Add to the Routine list: "`check start`/`check wait` and restarting lost checks once".
   Keep the wording style (short, imperative) and the existing markers. Do not touch other steps.
2. `GUIDE.md` Part 4: a short paragraph "Review and test run in parallel", with a 3-line flow sketch (collect ->
   check start [review | test (Code Mode)] -> pass: mark-reviewed / fail: repair). Add the task-file sections that
   `check` appends ("Checks started", "Checks: PASS|FAIL") to the section list near line 186-195.
3. `README.md`: in the command table add rows for `check start`, `check wait` and `check status`; in the file
   table add `prompts/check-review.md` and `prompts/check-test.md`; add one paragraph "Checks and Code Mode" with
   the config block, the defaults (model/effort null = the orchestrator's; test uses Code Mode; review is normal),
   the requirements (hc backend, Claude Code with Code Mode: interactive session, direct Anthropic API), and how to
   turn it off.
4. `README.md` or GUIDE Part 7 (troubleshooting), short entries:
   - "PreToolUse:Read hook error: scan-secrets.sh not found": the company managed settings expect the script in
     the project dir; workspaces get a wrapper that runs the linked repo's script (`agent-kit update` installs it).
   - "SessionStart hook error: node: not found": sessions started by the scheduler now inherit its PATH; start the
     orchestrator from a shell where `node` is on PATH.

## Boundaries
**You may edit** (owned_paths): `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/GUIDE.md`,
`.agent-system/README.md`.

**You must not edit:** CLAUDE.md / AGENTS.md (they are generated from the template by install.sh), code, tests,
prompts, other docs, `.orchestrator/`, other worktrees.

**You may run:** the commands in "Run these"; read-only git; `git add` / `git commit` on your branch.

**You must not run:** install.sh, agent-kit, hc, herdr; downloads or installs; git push, merge, rebase, reset,
checkout or clean.

**When to ask:** only a real blocker: report "blocked" with the exact reason.

## Done when
- [ ] Steps 1-4; the suite still passes (some tests check the template markers).

## Run these
- `python3 -m pytest -q .agent-system/tests`

## Worker result - attempt 1 (24/11/26 02:41)

- Status: **done** (worker worker-3, branch `agent/pchecks-t3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/GUIDE.md`, `.agent-system/README.md`, `.agent-system/templates/ORCHESTRATOR.section.md`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/pchecks/reports/T3.diff`

````text
 .agent-system/GUIDE.md                          | 12 ++++++++++++
 .agent-system/README.md                         | 20 ++++++++++++++++++++
 .agent-system/templates/ORCHESTRATOR.section.md | 17 +++++++++++++----
 3 files changed, 45 insertions(+), 4 deletions(-)
````

````diff
diff --git a/.agent-system/GUIDE.md b/.agent-system/GUIDE.md
index 8c37d61..9d796ec 100644
--- a/.agent-system/GUIDE.md
+++ b/.agent-system/GUIDE.md
@@ -159,6 +159,14 @@ What happens next, and where you come in:
 | 11. Merge decision | You | Click: A merge and push / B merge locally / C don't merge, then which branch |
 | 12. Finish | scheduler | Fast-forward the chosen branch, push if A (never force), clean up worktrees and branches |
 
+**Review and test run in parallel.** After collecting the task diff, start both read-only checks and wait for their result:
+
+```text
+collect -> check start [review | test (Code Mode)]
+        -> pass: mark-reviewed
+        -> fail: repair
+```
+
 Under the hood Opus runs commands like these (you can run them too):
 
 ```bash
@@ -187,6 +195,8 @@ $S resume --run r1              # after a crash/restart: shows next actions
 ---
 ## Worker result - attempt 1         <- appended by collect: status, files, tests, risks,
    diffstat + inline diff                 full diff in .orchestrator/runs/<run>/reports/T1.diff
+## Checks started                     <- appended by check start: review and test sessions
+## Checks: PASS|FAIL                   <- appended by check wait: verdicts, summaries and report paths
 ## Review round 1: MAJOR_FIX        <- appended by mark-reviewed: verdict + Opus's report
 ## Fix round 1/2: errors and proposed fix, sent to worker-1   <- appended by repair
 ## Worker result - attempt 2         <- the same worker's fix
@@ -319,6 +329,8 @@ mode, commit the kit before the first run, since worktrees are created from a co
 | Model not supported with ChatGPT account | Old client: `codex update` (Part 2, step 1), or choose another model with `agent-kit config` |
 | Worker says `bwrap: ... RTM_NEWADDR: Operation not permitted` | Ubuntu's user-namespace restriction blocks Codex's sandbox: add the AppArmor profile (Part 2, step 2). Never switch workers to `danger-full-access` |
 | Worker's `./gradlew test` fails on a lock file in `~/.gradle` | Gradle's cache must be writable: keep `"writable_dirs": ["~/.gradle"]` in `config.json` (other stacks: README, Safety) |
+| `PreToolUse:Read hook error: scan-secrets.sh not found` | Company managed settings expect the script in the project directory; workspaces get a wrapper that runs the linked repo's script (`agent-kit update` installs it) |
+| `SessionStart hook error: node: not found` | Scheduler-started sessions inherit its `PATH`; start the orchestrator from a shell where `node` is on `PATH` |
 | Worker report says `git add` failed: `index.lock: Read-only file system` | Normal: the sandbox keeps `.git` read-only. The worker leaves changes uncommitted (`committed: false`), `collect` shows `needs_orchestrator_commit`, and Opus runs `commit-task` |
 | A worker sits `blocked` | `hc read --lines 80 <name>` (`herdr agent read <name> --lines 80` only with `herdr.backend: legacy`); tell Opus what to approve or deny |
 | Worker finished but Opus says `ambiguous` | Report and git disagree; Opus will ask the worker to fix or inspect it |
diff --git a/.agent-system/README.md b/.agent-system/README.md
index 15e6275..1f85083 100644
--- a/.agent-system/README.md
+++ b/.agent-system/README.md
@@ -35,6 +35,8 @@ User request -> orchestrator: configured program + model (default Claude Code, O
 | `prompts/task-packet.md` | Template + authoring guidance for a worker task file (`task new` copies it) |
 | `prompts/repair-packet.md` | Template for a repair file to the same worker (`task new --repair-of`) |
 | `prompts/review-checklist.md` | Review policy, verdict table, review-report format |
+| `prompts/check-review.md` | Read-only review checker prompt used by `check start` |
+| `prompts/check-test.md` | Read-only test checker prompt used by `check start` (Code Mode) |
 | `prompts/research-packet.md` | Research dossier format (+ request format when delegating to the scout) |
 | `prompts/architecture-readiness.md` | Planning gate checklist (a)-(e) |
 | `scripts/doctor.sh` | Tooling/model/integration report (`--probe-codex` for a live model check) |
@@ -105,6 +107,9 @@ Prefix every command with `python3 .agent-system/scheduler.py`. Add `--json` bef
 | `decision routine --run ID --kind K [--task T] --action ".." --reason ".."` | Record a routine call Opus made itself, e.g. approving a worker's in-worktree command |
 | `wait --run ID [--task T] [--timeout 540]` | Block until a worker writes its report or shows an approval prompt; exit 3 on timeout |
 | `collect --run ID --task T` | Validate the report against git (`pending` / `ambiguous` / `REVIEW`); save `reports/T.diff` (commits + uncommitted + new files); append "Worker result" to the task file |
+| `check start --run ID --task T` | Start review and Code Mode test sessions in parallel on the task worktree |
+| `check wait --run ID --task T [--timeout S]` | Wait for checks; return `pass`, `fail`, `blocked`, `lost` or `timeout` |
+| `check status --run ID --task T` | Show the task's check state |
 | `commit-task --run ID --task T -m MSG` | Audited orchestrator commit of an uncommitted worker diff or Opus minor fix |
 | `mark-reviewed --run ID --task T --verdict PASS\|MINOR_FIX\|MAJOR_FIX\|BLOCKED\|FAIL --report FILE [--notes ..] [--known-issues ..]` | Record review; verdict + report appended to the task file. No MAJOR_FIX after the last fix round |
 | `repair --run ID --task T --packet FILE --reason ..` | Fix round to the same worker session (max 2); errors + proposed fix copied into the task file |
@@ -118,6 +123,21 @@ Prefix every command with `python3 .agent-system/scheduler.py`. Add `--json` bef
 | `task-unblock --run ID --task T [--reset-repairs]` | BLOCKED -> PENDING after Opus re-scopes |
 | `cleanup --run ID [--remove-worktrees]` | Close Herdr spaces this run created; remove clean worktrees |
 
+### Checks and Code Mode
+
+Checks are enabled by default and require `herdr.backend: hc`. Both sessions use Claude Code; review runs normally and test uses Code Mode, which requires an interactive session and the direct Anthropic API. A null `model` or `effort` uses the orchestrator's setting. Set `enabled` to `false` to turn checks off.
+
+```json
+{
+  "checks": {
+    "enabled": true,
+    "timeout_seconds": 1800,
+    "review": {"kind": "claude", "model": null, "effort": null, "code_mode": false},
+    "test": {"kind": "claude", "model": null, "effort": null, "code_mode": true}
+  }
+}
+```
+
 ### tasks.json
 
 ```json
diff --git a/.agent-system/templates/ORCHESTRATOR.section.md b/.agent-system/templates/ORCHESTRATOR.section.md
index 01cbda6..2a11c85 100644
--- a/.agent-system/templates/ORCHESTRATOR.section.md
+++ b/.agent-system/templates/ORCHESTRATOR.section.md
@@ -46,9 +46,16 @@ How to operate (details: `.agent-system/GUIDE.md`, `.agent-system/README.md`):
    Keep the packet, owned paths and acceptance fields; then `run create`, `dispatch-ready`.
 4. `scheduler.py wait --run <run>` until a report appears, then `collect`: it saves the worker's full
    diff to `.orchestrator/runs/<run>/reports/<T>.diff` and appends a "Worker result" section (with
-   the diff) to the task file. Review per `prompts/review-checklist.md`, write the review report to
-   a file, then `commit-task` if uncommitted and `mark-reviewed --verdict ... --report <file>`: the
-   verdict and report are appended to the end of the task file. Then `integrate` -> `verify`.
+   the diff) to the task file. When `checks.enabled: false` or `herdr.backend` is not `hc`, review
+   per `prompts/review-checklist.md`, write the review report to a file, then `commit-task` if
+   uncommitted and `mark-reviewed --verdict ... --report <file>`: the verdict and report are
+   appended to the end of the task file. Otherwise, run `scheduler.py check start --run <run> --task <T>`:
+   a separate review session and a Code Mode test session check the task in parallel (task worktree,
+   read-only). Run `scheduler.py check wait --run <run> --task <T>` in the background. The first
+   FAIL ends both sessions: read its report and go to the repair loop (FAIL report = the evidence).
+   When both pass, `commit-task` if uncommitted, then `mark-reviewed --verdict PASS --report <the
+   check-review.md path>`. `blocked` = a checker's approval prompt (handle it like a worker approval).
+   `lost`/`timeout` = start the checks again once, then review yourself. Then `integrate` -> `verify`.
    **Review loop, max 2 fix rounds per task** (review finding, failing test, merge conflict or a
    post-merge failure caused by the task): `task new --repair-of <task file>`, fill in "Errors found"
    (exact location + evidence) and "Proposed fix", then `repair ... --reason "<evidence>"`: the SAME
@@ -94,10 +101,12 @@ fix rounds 1 and 2 of a task with clear evidence
 (failing test, review finding, mechanical merge conflict, post-merge failure caused by the task)
 via `repair ... --reason "<evidence>"`, unless the fix changes requirements, scope or contracts; MINOR_FIX; re-collect after a report-format error;
 `relaunch` of a lost session; correcting your own plan steps without changing goal, acceptance,
-or owned paths. The scheduler records each routine call in the task file; list them in your report.
+or owned paths; `check start`/`check wait` and restarting lost checks once. The scheduler records each routine call in the task file; list them in your report.
 
 Before relaunching a started worker that is not reporting, read its screen: it may be stuck on a startup screen (trust, hooks, update); never relaunch while its agent is live, and the old `herdr` CLI saying `server not running` says nothing about the Herdr app.
 
+Never run builds, tests or gates inside your own session: the test checker, `integrate` (post-merge check) and `verify` run them; read their logs and reports.
+
 Only critical decisions go to the user; decide routine ones yourself (above). For a critical one
 (the user clicks an answer; Herdr, or Claude Remote Control, notifies them):
 1. `scheduler.py decision ask --run <run> --kind blocker|repair|scope_exception|abandon|worker_approval|question
````

## Review round 1: PASS (24/11/26 02:41)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 5d639c78b781, commits 5d639c78b781

# Review pchecks T3: PASS
- Step 1: step 4 keeps own-review fallback (checks off / non-hc), adds check start/wait flow, first FAIL -> repair, PASS -> commit-task + mark-reviewed with check-review.md; blocked/lost/timeout handling; routine list extended; "never run builds/tests/gates in your own session" added. Markers untouched.
- Step 2: GUIDE flow sketch + task-file sections. Step 3: README command rows, prompt files, config block. Step 4: two troubleshooting rows.
- Contract matches T1 packet (commands, results, report names, config keys).
- Tests: worker ran full suite (exit 0); I re-run the suite after integrate.

## Integration: merged (24/11/26 03:22)

- On `agent/integration-pchecks` at 807e4c823f72; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/pchecks/logs/post-merge-T3-a1.log`)

## Final gate: PASS (24/11/26 03:24)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-pchecks at 807e4c823f72 (log `.orchestrator/runs/pchecks/logs/verify-1795465355.log`)
- Task MERGED; run DONE

## Finished (24/11/26 03:28)

- merged into hub/plan (decision D2)
