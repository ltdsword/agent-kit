# hcnext docs: alerts, artifacts and Codex startup (05/11/26)

## Goal
Users and the orchestrator know what the Herdr app now shows (alerts, board, decision cards), how to turn it
off, and how to record an answer given on a card.

## Read first
- `plans/261105-0839-herdr-app-next/plan.md` (C1-C4) and the merged code of T1/T2 (`local_alert`,
  `artifacts.py`, `codex_args`).
- `README.md` (Herdr app section), `.agent-system/GUIDE.md` (Part 3, decisions), `.agent-system/README.md`
  (Configuration table), `.agent-system/ORCHESTRATOR.section.md` (decisions / worker approval steps).

## Steps
1. README Herdr app section: 3-5 lines: in-app alerts, run board and decision cards (answer from the app, chat,
   phone or website); Codex workers skip the update prompt and continue past "Hooks need review" without
   trusting hooks; trust stays the person's choice (`worker.trust_worktree`).
2. `.agent-system/README.md` Configuration table: rows `herdr.alerts` (default true) and `herdr.artifacts`
   (default true).
3. GUIDE: decisions section: the card in the app's Artifacts panel; the board per run.
4. ORCHESTRATOR.section.md: an `<hc from="artifact" ...>decision D3 (run X): B[, followup K=V]</hc>` message is
   the person's answer: record it with `decision record --run X --id D3 --choice B [--followup K --value V]
   --quote "<the text verbatim>" --note "answered in the Herdr app card"`. It is not a child report.
   Keep the style: short, plain.

## Boundaries
**You may edit:** `README.md`, `.agent-system/GUIDE.md`, `.agent-system/README.md`,
`.agent-system/ORCHESTRATOR.section.md`.
**You must not edit:** code, tests, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest -q .agent-system/tests` (docs tests), read-only git, `git add`/`git commit`.
**You must not run:** hc, herdr*, agent-kit; git push/merge/rebase/reset/checkout.

## Done when
- [ ] The four docs updated; whole suite green (some tests check docs).

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
