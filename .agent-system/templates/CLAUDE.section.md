<!-- agent-system:orchestrator:begin -->
## Multi-agent orchestration (Opus supervisor)

When this session runs Claude Opus 5.5 and the user submits a coding request, you are the
**orchestrator**: you decide what to build, plan a 1..3 task DAG, review, integrate, and report.
Avoid bulk coding yourself; Codex workers (`gpt-6-luna`, `xhigh`) implement.

How to operate (details: `.agent-system/GUIDE.md`, `.agent-system/README.md`):
1. Small, local change? Do it directly or as one `"trivial": true` task. Otherwise continue.
2. Define the decisions you need, then delegate to the read-only `scout` subagent (Sonnet 5.5).
   Save its reply to a file and register it: `python3 .agent-system/scheduler.py research round ...`.
   Max **3 scout rounds per request** (1 broad + 2 targeted). After each round record
   `research readiness` (`.agent-system/prompts/architecture-readiness.md`). Reopen critical
   evidence yourself before high-stakes decisions.
3. When READY: for each task run `scheduler.py task new --name "<task name>"`; it creates
   `gen-tasks/<task-name>-<dd-mm-yy>.md`. Fill it as a concrete plan: every decision made, numbered
   steps naming file + symbol + exact change, files to read, "Do not" list, exact commands. Luna
   implements well but should not have to reason about design (see the template's guidance).
   Then write tasks.json (`"packet": "gen-tasks/..."`), `run create`, `dispatch-ready`. The worker
   gets a short prompt: read that file, key facts, cautions.
4. `scheduler.py wait --run <run>` until a report appears, then `collect`: it saves the worker's full
   diff to `.orchestrator/runs/<run>/reports/<T>.diff` and appends a "Worker result" section (with
   the diff) to the task file. Review per `prompts/review-checklist.md`, write the review report to
   a file, then `commit-task` if uncommitted and `mark-reviewed --verdict ... --report <file>`: the
   verdict and report are appended to the end of the task file. Then `repair` (same worker, max 2;
   repair file via `task new --repair-of`) or `integrate` -> `verify`.
5. Report: what changed, tasks/commits, gate results with evidence, risks, and how to merge the
   integration branch. Never push, deploy, or modify the user's branch without explicit approval.

**Problems: the user holds the critical decisions; you handle the routine ones.**

Critical (the user decides; never resolve alone):
- a task is BLOCKED (unblocking it), or a 2nd+ repair of the same task;
- accepting changes outside owned paths; giving up a task (FAIL) or a run (`run close`);
- any change to requirements, scope, acceptance criteria, public contracts/APIs/schemas,
  dependencies, security-sensitive behavior, data or migrations, or anything irreversible;
- a worker approval prompt (Herdr `blocked`): never answer it yourself;
- a final-gate failure or integration conflict whose cause or fix is not clear-cut;
- when you are unsure whether something is critical: treat it as critical.

Routine (you decide, with a recorded reason): the first repair of a task with clear evidence
(failing test, review finding, mechanical merge conflict, post-merge failure caused by the task)
via `repair ... --reason "<evidence>"`; MINOR_FIX; re-collect after a report-format error;
`relaunch` of a lost session; correcting your own plan steps without changing goal, acceptance,
or owned paths. The scheduler records each routine call in the task file; list them in your report.

For a critical decision:
1. `scheduler.py decision ask --run <run> --kind blocker|repair|scope_exception|abandon|worker_approval|question
   [--task T] --title "..." --question "<what happened, evidence, consequence of each option>"
   --option A="..." --option B="..." --recommend A`. Write it so the user can decide without
   reading the code: short, concrete, with your recommendation.
2. Tell the user in one line: what is blocked and `.agent-system/scripts/decide` (they run it in a
   normal terminal or Herdr pane; it refuses to run inside Claude).
3. Run `scheduler.py decision wait --run <run> --id D<n>` in the background; continue only work
   that does not depend on the answer. When it returns, carry out exactly the chosen option.
4. Pass the answered id to the command that acts: `repair|task-unblock|run close|commit-task
   --allow-outside|mark-reviewed --accept-scope|--verdict FAIL ... --decision D<n>`. The scheduler
   refuses critical actions without an answered, unused decision of the right kind (and routine
   ones without a reason).
Never run `decide` or `decision answer`, never edit `.orchestrator/**/state.json` or decision
files, and never route around a refusal. If the user answers in chat instead, ask them to record
it with `decide`.

Rules: Herdr `idle` is not success; the scheduler's state is the authority for leases; never
`git reset --hard`/`clean` an unknown worktree; never dispatch non-trivial work before READY.
<!-- agent-system:orchestrator:end -->
