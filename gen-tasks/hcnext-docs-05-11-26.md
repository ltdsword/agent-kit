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

## Worker result - attempt 1 (05/11/26 09:50)

- Status: **blocked** (worker worker-1, branch `agent/hcnext-t3`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: none
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - Step 4 targets .agent-system/ORCHESTRATOR.section.md, which is absent; only .agent-system/templates/ORCHESTRATOR.section.md is tracked, and the task does not authorize editing that path.
- Not done:
  - Stopped before editing per the task's stop-on-mismatch instruction. Steps 1-4 remain unimplemented pending correction of the authorized path.
- Full diff: `.orchestrator/runs/hcnext/reports/T3.diff`

## Decision D6 needed (blocker) (05/11/26 09:50)

**Unblock T3 docs without step 4**

My T3 packet named a wrong path for the orchestrator instructions (the real file is .agent-system/templates/ORCHESTRATOR.section.md), so the worker stopped. Unblock T3 to do steps 1-3 (README, GUIDE, config table) inside its files; Opus adds the step-4 note to the template himself after the run, no extra approvals.

- `A`: Unblock T3 (steps 1-3; Opus does step 4 after) (recommended)
- `B`: Leave T3 blocked

Waiting for the user's answer in chat.

## Decision D6 answered by the user (05/11/26 10:17)

- Choice: **A**: Unblock T3 (steps 1-3; Opus does step 4 after)
- User's words (hub): "Unblock T3 (steps 1-3; Opus does step 4 after)"

## Worker result - attempt 2 (05/11/26 10:22)

- Status: **done** (worker worker-1, branch `agent/hcnext-t3-r2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/GUIDE.md`, `.agent-system/README.md`, `README.md`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done:
  - Step 4 skipped per lead note; the orchestrator will edit the template after the run.
- Full diff: `.orchestrator/runs/hcnext/reports/T3.diff`

````text
 .agent-system/GUIDE.md  | 2 ++
 .agent-system/README.md | 2 ++
 README.md               | 5 +++++
 3 files changed, 9 insertions(+)
````

````diff
diff --git a/.agent-system/GUIDE.md b/.agent-system/GUIDE.md
index 6ad9acc..396c91e 100644
--- a/.agent-system/GUIDE.md
+++ b/.agent-system/GUIDE.md
@@ -228,6 +228,8 @@ D2  T1 is blocked: the spec doesn't say whether to use contract X or Y.
     ( ) Other: B, use the 2024 contract
 ```
 
+The Herdr app shows a board for each run and puts decision cards in the Artifacts panel.
+
 Opus records your answer word for word (`decision record --run r1 --id D2 --choice B --quote "..."`) and
 carries it out. The scheduler refuses critical actions (`task-unblock`, `run close`,
 scope exceptions, FAIL, merge/push) without a recorded answer, and routine ones without Opus's reason.
diff --git a/.agent-system/README.md b/.agent-system/README.md
index b76cb1c..45b91ad 100644
--- a/.agent-system/README.md
+++ b/.agent-system/README.md
@@ -61,6 +61,8 @@ roots the same). Worktrees live in `pool.worktree_root`, outside the repo: `work
 | Key | Meaning |
 |---|---|
 | `herdr.backend` | `auto` (default): `hc` inside the Herdr app, `legacy` inside old Herdr, otherwise `hc` when its core runs; set `hc` or `legacy` to force one |
+| `herdr.alerts` | `true` (default): show in-app alerts for decisions, blocked workers and finished runs; set `false` to disable |
+| `herdr.artifacts` | `true` (default): publish a board for each run and decision cards in the Herdr app; set `false` to disable |
 
 ## Commands (all implemented; `python3 .agent-system/scheduler.py <cmd> --help`)
 
diff --git a/README.md b/README.md
index 251f869..318446e 100644
--- a/README.md
+++ b/README.md
@@ -71,6 +71,11 @@ CLI still works when `herdr.backend` is set to `legacy`. The setting accepts `au
 `auto` selects `hc` inside the app, `legacy` inside old Herdr, and otherwise `hc` when its core is
 running. The doctor checks `hc`, `herdr-app` and `herdr-session`.
 
+The app shows in-app alerts, a board for each run, and decision cards in the Artifacts panel. Answer a
+card in the app, in chat, by phone, or on the website. Codex workers skip the update prompt and
+continue past “Hooks need review” without trusting hooks; folder trust remains your choice:
+`worker.trust_worktree` controls it.
+
 **Models.** You choose the program, model and effort for each role with `agent-kit config` (section 4):
 Claude Code and Codex are verified; every other program Herdr can launch is listed as **unverified**.
 Workers always use exactly the configured model and effort; there is deliberately no automatic
````

## Review round 2: PASS (05/11/26 10:22)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: d3f0bc81a4f9, commits d3f0bc81a4f9
- Notes: docs steps 1-3; step 4 deferred to Opus per D6

# Review hcnext T3 - docs (Opus)

Verdict: PASS

- Steps 1-3 per packet (README Herdr app lines, GUIDE decisions, config rows herdr.alerts/herdr.artifacts);
  step 4 skipped per D6 (packet path error was Opus's; Opus edits templates/ORCHESTRATOR.section.md after the run).
- Accurate to the merged code; short, house style. Suite green (worker).

## Integration: merged (05/11/26 10:22)

- On `agent/integration-hcnext` at 9ab640e42edf; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcnext/logs/post-merge-T3-a2.log`)

## Final gate: PASS (05/11/26 10:27)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcnext at 9ab640e42edf (log `.orchestrator/runs/hcnext/logs/verify-1793848936.log`)
- Task MERGED; run DONE
