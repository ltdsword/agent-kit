<!-- guidance:begin -->
<!--
Template for one Codex worker task. Create a copy with:
  python3 .agent-system/scheduler.py task new --name "<short task name>"
which writes gen-tasks/<task-name>-<dd-mm-yy>.md without this block. Fill every section, then put
the file's path in tasks.json as "packet".

How to write for Codex gpt-6-luna (strong at implementation, weak at open-ended reasoning):
- Make every decision yourself. The worker executes; it should never have to choose a design.
- One step = one concrete edit: file, symbol, what changes. Give exact signatures, names, error
  messages and constants. Show a short code shape when the structure matters.
- Point to an existing example to copy ("mirror UserHandler.getUser error handling").
- List only the files it must read. No "explore the codebase".
- Fill "Boundaries" completely: everything the worker needs must be allowed there, so it never has
  to ask about trivial commands, and anything it must not touch must be named. The sandbox enforces
  where it can write; the scheduler checks changed files against owned_paths at collect; everything
  else (commands, files inside the worktree) relies on this section.
- Give exact commands with the expected result.
- Keep it short: about 40-80 lines. If it needs more, split the task.
- Sections after the last line are appended by scheduler.py (worker result, review, outcome).
-->
<!-- guidance:end -->
# <TITLE>

## Goal
<One sentence: the observable behavior when this is done.>

## Read first
- `<path>`: <why; which symbol>

## Steps
1. In `<path>`, <exact change>.
2. In `<path>`, <exact change>.
3. Add test `<path>`: <cases, one line each>.

## Boundaries
**You may edit** (must match owned_paths in tasks.json):
- `<path or glob>`

**You must not edit:**
- Generated code: `<path>`. Public signatures / contracts: `<symbols>`.
- Build and dependency files (`<build file>`, lockfiles) unless listed above.
- Anything else in the repo, the task file, `.orchestrator/`, other worktrees.

**You may run:**
- The commands in "Run these"; read-only git (`git status`, `git diff`, `git log`); `git add` / `git commit`
  on your task branch; reading any file in the repo.

**You must not run:**
- Network access or package installs (`pip install`, `npm install`, `curl`, ...) unless allowed here: <none>.
- `git push`, `merge`, `rebase`, `reset --hard`, `checkout`/`switch` to another branch, `clean`, deleting
  files you were not told to delete; starting servers or other agents.

**When to ask** (approval prompt or "blocked" report), and only then:
- a code or logic blocker: a step doesn't match the code, the plan is ambiguous, a test fails for a
  reason the plan doesn't cover -> stop and report "blocked" with the exact reason;
- a command needs to go outside your worktree or sandbox (write elsewhere, network, install, a
  blocked permission) -> ask for approval, or report "blocked" with the command and the error.
Everything else allowed above (edits, builds, tests, read-only commands in your worktree): just do it,
don't ask. Never work around a block.

## Do not
- Refactor, rename, reformat or touch anything not listed in Steps.

## Done when
- [ ] <checkable criterion>
- [ ] <checkable criterion>

## Run these
- `<exact command>`: expect <result>

## Notes
- <gotchas, conventions to copy, edge cases to handle>

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
