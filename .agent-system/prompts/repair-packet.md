<!-- guidance:begin -->
<!--
Fix round for the SAME worker, branch and worktree. Create with:
  python3 .agent-system/scheduler.py task new --repair-of gen-tasks/<task-file>.md
then send it with: scheduler.py repair --run <RUN> --task <T> --packet <this file> --reason "<evidence>"
Max 2 fix rounds per task; after round 2 there is no further review round (PASS with --known-issues).
`repair` copies "Errors found" and "Proposed fix" into the task file, so the user sees them there.
Name each error exactly and say how to fix it; never "make it work".
-->
<!-- guidance:end -->
# <TITLE>

## Errors found
1. `<path:line>`: <what is wrong>. Evidence: <failing command + exit code, or review finding>.

## Proposed fix
1. In `<path>`, <exact change>.

## Boundaries
- Same as the original task file's Boundaries, except: <changes, or "none">.

## Do not
- Rewrite earlier work or touch files not listed in Proposed fix.

## Run these
- `<exact command>`: expect <result>

## Deliver
- Same branch, keep earlier changes. Overwrite the report JSON at the same path;
  `commits` lists ALL task commits since base_sha (or [] if commits are blocked).
