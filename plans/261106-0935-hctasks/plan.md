# hctasks: the run board looks like the website's run card (06/11/26)

User decision D15 = A (06/11/26): show run tasks in the app as a website-like run board in the Artifacts side
panel; Herdr's own Tasks panel untouched (a full mirror is unsafe: Herdr appends its brief to the worker argv,
parents it under the space Assistant, and its takeover/review automations act on running tasks).

## Verified facts (Opus)
- Website run card: `hub/web/src/features/workspace/RunCard.tsx` (title, run id, status chip, goal, Branch,
  Gate, task graph: roots column, "›", dependents column; node = id, title, worker, summary, status chip,
  "fix N/M", "needs T1, T2" when PENDING; Problems). Data from `agentctl._run_snapshot`.
- `artifacts.board_data` today: run_id, title, status, updated_at, tasks{id,title,status,worker,verdict}, decisions.
- Side panel from the CLI: `herdr-app do layout.select --stack panel-body --child artifacts`,
  `layout.select --stack artifacts --child artifacts-list`, `layout.show --id panel` (nodes exist in shepherdr
  and main-derived layouts; absent -> the command fails harmlessly). Setting the open artifact from outside
  leaves a stale header title (shared "artifacts.view" is app-internal), so we open the list, board on top.

## Tasks
- T1 board: data + panel like the website (artifacts.py board_data, artifacts/board/main.js, tests).
- T2 open: after the board is published at run create, show the Artifacts panel list (depends on T1).
