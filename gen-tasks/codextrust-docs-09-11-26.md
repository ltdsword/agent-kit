# codextrust docs: orchestrator rules name the Herdr app commands (09/11/26)

## Goal
The orchestrator rules and the guide tell Opus how to read and answer a worker's screen in the Herdr app
(`hc`), so it never runs the old Herdr TUI CLI and wrongly concludes "Herdr server not running".

## Evidence (Opus)
- BanCaZagooMW orchestrator followed `CLAUDE.md` text "read it with `herdr agent read <agent> --source visible`,
  approve once with `herdr agent send-keys`", ran `herdr agent ...`, got server_not_running, and told the person
  to start the old Herdr - while the scheduler was correctly on the hc backend (Herdr app).
- Mentions: `.agent-system/templates/ORCHESTRATOR.section.md:83-84,114`, `.agent-system/GUIDE.md:154,323`.
- hc commands (check exact flags with `hc --help`, `hc read --help`, `hc send --help`; read-only help is allowed):
  read a worker screen `hc read <address-or-name>`, list `hc ls --all`, send keys/text `hc send ...`.
  Never `hc send --force`.

## Read first
- `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/GUIDE.md` (lines above and the backend part
  around line 46), `.agent-system/README.md` (`herdr.backend` row).

## Steps
1. Template: where it says `herdr agent read` / `herdr agent send-keys`, say the Herdr app way first (`hc read`,
   `hc send`, exact syntax from `--help`), and the old CLI only "with `herdr.backend: legacy`". Add one line: a
   worker started but not reporting may be stuck on a startup screen (trust, hooks, update): read its screen
   before relaunching; never relaunch while its agent is live; the old `herdr` CLI saying "server not running"
   says nothing about the Herdr app.
2. GUIDE.md lines 154 and 323: same switch (app command first, legacy in brackets).
3. Keep wording short; do not restructure other sections.

## Boundaries
**You may edit:** `.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/GUIDE.md`.
**You must not edit:** scheduler.py, tests, README, agentctl.py, hub/**, plans/**, gen-tasks/**, .orchestrator/**, CLAUDE.md, AGENTS.md.
**You may run:** `hc --help` and `hc <cmd> --help` only; `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** any other `hc`/`herdr*`/`herdr-app` command; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] No `herdr agent` instruction is left without the hc equivalent first; suite green (template tests).

## Run these
- `grep -n "herdr agent" .agent-system/templates/ORCHESTRATOR.section.md .agent-system/GUIDE.md`
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
