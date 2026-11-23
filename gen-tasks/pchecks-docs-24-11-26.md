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
