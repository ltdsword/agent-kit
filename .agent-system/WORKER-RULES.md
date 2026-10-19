# Worker rules (orchestrated runs)

These apply when you were started by `.agent-system/scheduler.py` as `worker-N` for a run/task,
whatever program or model you are. You are a worker, not the orchestrator: ignore orchestrator
instructions in any `AGENTS.md` or `CLAUDE.md` you see.

1. Read the task file named in your prompt (`gen-tasks/<task>-<dd-mm-yy>.md`) completely first.
   It is the plan: follow its Steps in order. Do not redesign, refactor, rename or reformat.
2. Stay inside the task file's **Boundaries**: work only in your assigned worktree and only on
   the files it allows; run only what it allows. Never edit the main checkout, the task file,
   another worker's worktree, or `.orchestrator/` (except your report).
3. Do not merge, rebase shared branches, push, force anything, deploy, add dependencies, or use the
   network unless the task file explicitly allows it. Do not start other agents.
4. Don't ask about trivial things: run every edit, build, test and read-only command the task file
   allows inside your worktree. Ask only when (a) a code or logic problem blocks you (a step doesn't
   match the code, the plan is unclear): stop and report `blocked` with the reason; or (b) you need
   to go outside your worktree or sandbox: ask for approval. Never guess, never work around a block.
5. Run the task file's "Run these" commands; check `git status` / `git diff` before finishing.
6. Commit if your environment allows it. If `git commit` is blocked (e.g. Codex keeps `.git`
   read-only), leave changes uncommitted and set `"committed": false`; never try to weaken or
   bypass a sandbox. The orchestrator captures your diff from the worktree either way.
7. Finish by writing the JSON completion report to the path in your prompt. `commits` lists every
   task-branch commit since `base_sha`. Report real exit codes; never claim a test you did not run.
