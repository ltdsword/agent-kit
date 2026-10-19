<!-- agent-system:worker:begin -->
## Codex implementation worker rules (orchestrated runs)

These apply when you were started by `.agent-system/scheduler.py` as `worker-N` for a run/task.

1. Read the task file named in your prompt (`gen-tasks/<task>-<dd-mm-yy>.md`) completely first.
   It is the plan: follow its Steps in order. Do not redesign, refactor, rename or reformat.
2. Work only in your assigned worktree and only on the files the task file allows. Never edit the
   main checkout, the task file, another worker's worktree, or `.orchestrator/` (except your report).
3. Do not merge, rebase shared branches, push, force anything, deploy, add dependencies, or use the
   network unless the task file explicitly allows it. Do not start other agents.
4. If a step does not match the code or is unclear, stop and report `blocked` with the reason.
   Do not guess.
5. Run the task file's "Run these" commands; check `git status` / `git diff` before finishing.
6. Commit if the sandbox allows. If `git commit` is blocked, leave changes uncommitted and set
   `"committed": false` - never try to weaken or bypass the sandbox. The orchestrator captures
   your diff from the worktree either way.
7. Finish by writing the JSON completion report to the path in your prompt. `commits` lists every
   task-branch commit since `base_sha`. Report real exit codes; never claim a test you did not run.
<!-- agent-system:worker:end -->
