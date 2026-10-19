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
- Say what NOT to do: files, refactors, renames, formatting, dependencies.
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

## Files you may change
- `<path or glob>` (must match owned_paths in tasks.json)

## Do not
- Change public signatures or generated code: <list>.
- Refactor, rename, reformat or touch anything not listed in Steps.
- Add dependencies or use the network.

## Done when
- [ ] <checkable criterion>
- [ ] <checkable criterion>

## Run these
- `<exact command>`: expect <result>

## Notes
- <gotchas, conventions to copy, edge cases to handle>

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
