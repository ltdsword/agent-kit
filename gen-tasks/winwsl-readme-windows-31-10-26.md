# Docs: README Windows (WSL2) section (31/10/26)

## Goal
The README's Windows (WSL2) section tells a Windows 11 user where to keep repos and how to work with Windows files, how to keep the hub running, how to start from Windows, and what the new doctor checks mean.

## Read first
- `plans/261031-1819-windows-wsl2/plan.md`: sections **User decisions**, **Contract** and **T2**: **the full spec**. Follow it exactly; check names and messages come from the Contract table.
- `README.md`: the whole "Windows (WSL2)" section (~lines 152-182), the macOS section before it for tone, and the table of contents near line 45.

## Steps
1. Extend the Windows (WSL2) section with the subsections the spec lists, in the README's existing style (short sentences, numbered steps, code spans for commands and paths).
2. Keep every existing step; do not change other sections except the table of contents if you add a heading.
3. Run the command in "Run these".

## Boundaries
**You may edit** (must match owned_paths):
- `README.md`

**You must not edit:**
- Any other file; also `.agent-system/**`, `plans/**`, `gen-tasks/**`, `.orchestrator/**`.

**You may run:**
- read-only git, `grep`.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; any install or download; `wsl.exe`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the README) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Invent commands or settings beyond the spec. Claim native Windows works.

## Done when
- [ ] Every item in spec section T2 is in the README.
- [ ] `git diff --check` passes and only `README.md` changed.

## Run these
- `git diff --check && git diff --stat`: expect no whitespace errors, only README.md

## Notes
- Report: files changed, wording decisions, open questions.
