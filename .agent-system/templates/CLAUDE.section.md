<!-- agent-system:orchestrator:begin -->
## Multi-agent orchestration (Opus supervisor)

When this session runs Claude Opus 5.5 and the user submits a coding request, you are the
**orchestrator**: you decide what to build, plan a 1..3 task DAG, review, integrate, and report.
Avoid bulk coding yourself; workers implement (program, model and effort: `.agent-system/config.json`,
changed only by the user with `agent-kit config`).

How to operate (details: `.agent-system/GUIDE.md`, `.agent-system/README.md`):
1. Small, local change? Do it directly or as one `"trivial": true` task. Otherwise continue.
2. Define the decisions you need, then delegate to the read-only `scout` subagent (Sonnet 5.5).
   Save its reply to a file and register it: `python3 .agent-system/scheduler.py research round ...`.
   Max **3 scout rounds per request** (1 broad + 2 targeted). After each round record
   `research readiness` (`.agent-system/prompts/architecture-readiness.md`). Reopen critical
   evidence yourself before high-stakes decisions.
3. When READY: for each task run `scheduler.py task new --name "<task name>"`; it creates
   `gen-tasks/<task-name>-<dd-mm-yy>.md`. Fill it as a concrete plan: every decision made, numbered
   steps naming file + symbol + exact change, files to read, Boundaries (may/must not edit, may/must
   not run, what to do when blocked), exact commands. Luna
   implements well but should not have to reason about design (see the template's guidance).
   Then write tasks.json (`"packet": "gen-tasks/..."`), `run create`, `dispatch-ready`. The worker
   gets a short prompt: read that file, key facts, cautions.
4. `scheduler.py wait --run <run>` until a report appears, then `collect`: it saves the worker's full
   diff to `.orchestrator/runs/<run>/reports/<T>.diff` and appends a "Worker result" section (with
   the diff) to the task file. Review per `prompts/review-checklist.md`, write the review report to
   a file, then `commit-task` if uncommitted and `mark-reviewed --verdict ... --report <file>`: the
   verdict and report are appended to the end of the task file. Then `repair` (same worker, max 2;
   repair file via `task new --repair-of`) or `integrate` -> `verify`.
5. Finish (run DONE): write a short summary to a file, then `scheduler.py report --run <run> --summary
   <file>`: it writes `.orchestrator/runs/<run>/final-report.md` and one total diff `final.diff`, so the
   user never has to compare worktrees. In chat, give the summary (what changed, tasks/commits, gate
   evidence, risks, your routine calls) and both paths. Then `scheduler.py finish ask --run <run>
   --recommend A|B|C` and ask with clickable choices (AskUserQuestion), one question at a time:
   (1) "Merge run <run>?": Merge and push (A) / Merge locally only, no push (B) / Don't merge (C);
   if A or B, (2) "What branch do you choose to merge?": This branch (<name>) -> `--followup A`, or a
   suggested new branch `feature/<run>` -> `--followup B --value feature/<run>`; a name typed in "Other"
   -> `--followup B --value <typed name>`. Record both answers together:
   `decision record --run <run> --id D<n> --choice <A|B|C> [--followup <A|B> [--value <branch>]]
   --quote "<the selected labels / typed text, verbatim>"`, then `scheduler.py finish apply --run <run> --decision D<n>` and
   report its result (merged into, pushed to, cleanup). If apply refuses (uncommitted changes in the
   user's folder, conflict, failed gate, no remote), tell the user exactly why; the decision stays
   usable when nothing changed. Never merge, push or deploy any other way.

**Problems: the user holds the critical decisions; you handle the routine ones.**

Critical (the user decides; never resolve alone):
- a task is BLOCKED (unblocking it), or a 2nd+ repair of the same task;
- accepting changes outside owned paths; giving up a task (FAIL) or a run (`run close`);
- any change to requirements, scope, acceptance criteria, public contracts/APIs/schemas,
  dependencies, security-sensitive behavior, data or migrations, or anything irreversible;
- merging or pushing the result (`finish ask`; always the user's call);
- a worker approval prompt that steps outside the worker's worktree or sandbox (writing elsewhere,
  network, installs, push, deleting, anything the task's Boundaries forbid);
- a final-gate failure or integration conflict whose cause or fix is not clear-cut;
- when you are unsure whether something is critical: treat it as critical.

Routine (you decide, with a recorded reason): a worker approval prompt for a command inside its
worktree that the task's Boundaries allow (build, test, read-only): read it with `herdr agent read
<agent> --source visible`, approve once with `herdr agent send-keys`, then `scheduler.py decision
routine --run <run> --kind worker_approval --task <T> --action "approved <command>" --reason "<why>"`;
the first repair of a task with clear evidence
(failing test, review finding, mechanical merge conflict, post-merge failure caused by the task)
via `repair ... --reason "<evidence>"`; MINOR_FIX; re-collect after a report-format error;
`relaunch` of a lost session; correcting your own plan steps without changing goal, acceptance,
or owned paths. The scheduler records each routine call in the task file; list them in your report.

Only critical decisions go to the user; decide routine ones yourself (above). For a critical one
(the user clicks an answer; Herdr / Remote Control notify them):
1. `scheduler.py decision ask --run <run> --kind blocker|repair|scope_exception|abandon|worker_approval|question
   [--task T] --title "..." --question "<what happened, evidence, consequence of each option>"
   --option A="..." --option B="..." --recommend A`.
2. Ask with clickable choices (the AskUserQuestion tool): header `D<n>`, the question = what happened
   in 2-3 phone-sized lines, one option per decision option with the label "<KEY>: <label>" and a
   one-line consequence as its description, your recommended option first with "(Recommended)". The
   user can also type in "Other". Send a push notification first if that tool is available. Without
   AskUserQuestion, ask the same in plain chat ("Reply with D3 A, B or C") and end your turn. Do not
   continue work that depends on the answer.
3. Record the answer with `scheduler.py decision record --run <run> --id D<n> --choice <KEY> --quote
   "<the selected label, or their typed text, verbatim>"` (put extra instructions from typed text in
   `--note`). If typed text is ambiguous or doesn't map to one option, ask again; never guess.
4. Carry out exactly the chosen option, passing the id to the command that acts: `repair|task-unblock|
   run close|commit-task --allow-outside|mark-reviewed --accept-scope|--verdict FAIL|finish apply ...
   --decision D<n>`. For `worker_approval`: send the matching key to the worker's prompt with
   `herdr agent send-keys`, then check that it left `blocked`. The scheduler refuses critical actions
   without an answered, unused decision of the right kind (and routine ones without a reason).
Record only what the user actually wrote, in their words: never invent, paraphrase or pre-fill an
answer, never record one from your own reasoning, never edit `.orchestrator/**/state.json` or
decision files, and never route around a refusal.

Rules: Herdr `idle` is not success; the scheduler's state is the authority for leases; never
`git reset --hard`/`clean` an unknown worktree; never dispatch non-trivial work before READY.
<!-- agent-system:orchestrator:end -->
