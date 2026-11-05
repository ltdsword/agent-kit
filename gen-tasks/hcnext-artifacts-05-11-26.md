# hcnext artifacts: run board and decision cards in the Herdr app (05/11/26)

## Goal
Inside the Herdr app, each run has a live board panel, and each decision gets a card whose buttons send the
person's answer to the orchestrator, alongside the existing chat, phone and website paths.

## Read first
- `plans/261105-0839-herdr-app-next/plan.md`: "Verified facts" and **C4 (your spec)**.
- `herdr-artifact guide` output is summarised in the plan; the API truth is `~/.config/herdr-app/AGENTS.md`
  (sections Mods, UI, the `herdr` module), `~/.config/herdr-app/gpui-kit.d.ts`, `~/.config/herdr-app/herdr.d.ts`.
  Read them before writing JS (reading is fine).
- `.agent-system/scheduler.py`: `RunStore.save` (~626), `run_create`, `decision_ask` (~2211), decision state
  shape (`state["decisions"]`), `local_alert` (merged by T1).

## Steps
1. New `.agent-system/artifacts.py` (stdlib only): `board_data(state)`, `write_board(store_or_run_dir, state)`
   (atomic write; never raises), `enabled(cfg, env=None)`, `publish_board(project_root, run_dir, state, cfg,
   env=None, runner=subprocess.run) -> str|None`, `publish_decision(..., decision_id) -> str|None`,
   `remove(ids, runner)`. Exactly per C4. `herdr-artifact ... --json` output parsed for the id; any failure ->
   None (caller logs one line).
2. Shipped panels: `.agent-system/artifacts/board/main.js`, `.agent-system/artifacts/decision/main.js`, both
   importing `./data.js` (generated) and `./artifact.js` (written by publish). Follow the guide's rules: theme
   colors only, text 12-15 px, `size_full`, scroll long content, work at 320 px, no title repeated, no emojis,
   no setTimeout, never keep `cx`. Decision reply text exactly
   `decision <id> (run <run>): <choice>` plus `, followup <key>=<value>` when a followup was chosen.
3. scheduler.py call sites (small): `RunStore.save` -> `artifacts.write_board` (best effort); `run_create` ->
   `publish_board` when `artifacts.enabled`; `decision_ask` -> `publish_decision`; store ids as in C4
   (make sure `validate_state` accepts the new keys). `cleanup` removes decision cards of that run (keep the
   board).
4. Tests `.agent-system/tests/test_artifacts.py`: board_data shape and no extra fields (no packet text);
   write_board atomic + survives an unwritable dir; enabled matrix; publish argv (`--title`, `--folder`,
   `--json`) and generated `data.js` content with a fake runner; failure returns None and the scheduler command
   still succeeds; decision answered -> board shows answer; a test that runs `herdr-app check <copy>` on both
   panels with a sample board.json, **skipped when `herdr-app` is not on PATH**.

## Boundaries
**You may edit:** `.agent-system/artifacts.py` (new), `.agent-system/artifacts/**` (new),
`.agent-system/scheduler.py` (only the call sites above), `.agent-system/tests/test_artifacts.py` (new).
**You must not edit:** agentctl.py, kitstart.py, hubctl.py, config.json, hub/**, docs, plans/**, gen-tasks/**,
.orchestrator/**, anything in `~/.config/herdr-app`.
**You may run:** `python3 -m pytest`, `herdr-app check <dir>` on copies in a temp dir, read-only git,
`git add`/`git commit` on your branch.
**You must not run:** `herdr-artifact publish|update|rm`, `herdr-app do`, `hc`, `herdr-task`; git
push/merge/rebase/reset/checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Do not
- Put secrets, env values, packet bodies or file contents into board.json or the panels. Make any artifact
  failure fail a scheduler command. Change the hub protocol.

## Done when
- [ ] Both panels pass `herdr-app check`; artifacts.py per C4; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (05/11/26 09:31)

- Status: **blocked** (worker worker-1, branch `agent/hcnext-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/artifacts.py`, `.agent-system/artifacts/board/main.js`, `.agent-system/artifacts/decision/main.js`, `.agent-system/scheduler.py`, `.agent-system/tests/test_artifacts.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_artifacts.py` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 1
- Risks:
  - Workspaces created by the current installer fail to import scheduler.py after this change because artifacts.py and artifacts/ are not copied.
- Not done:
  - Installer packaging change is needed to ship artifacts.py and artifacts/, but the task boundaries forbid editing .agent-system/scripts/install.sh.
  - The full test suite is not green until that packaging gap is resolved.
- Full diff: `.orchestrator/runs/hcnext/reports/T2.diff`

````text
 .agent-system/artifacts.py               | 184 ++++++++++++++++++++++++++
 .agent-system/artifacts/board/main.js    |  65 ++++++++++
 .agent-system/artifacts/decision/main.js |  82 ++++++++++++
 .agent-system/scheduler.py               |  27 ++++
 .agent-system/tests/test_artifacts.py    | 215 +++++++++++++++++++++++++++++++
 5 files changed, 573 insertions(+)
````

(diff is 644 lines; read the full diff file)

## Decision D3 needed (scope_exception) (05/11/26 09:36)

**Commit install.sh line with T2?**

T2 adds artifacts.py and artifacts/ (the Herdr panels). install.sh copies a fixed file list into workspaces, so without adding them there every workspace's scheduler would break. Fix: one line in .agent-system/scripts/install.sh (outside T2's owned paths); the scheduler's import is also made optional as a safety net.

- `A`: Allow: commit the install.sh line with T2 (recommended)
- `B`: Don't

Waiting for the user's answer in chat.

## Decision D4 needed (scope_exception) (05/11/26 09:36)

**Accept install.sh line in T2's review (same change)**

T2 adds artifacts.py and artifacts/ (the Herdr panels). install.sh copies a fixed file list into workspaces, so without adding them there every workspace's scheduler would break. Fix: one line in .agent-system/scripts/install.sh (outside T2's owned paths); the scheduler's import is also made optional as a safety net. The kit needs this second answer to accept the same file at review.

- `A`: Accept it (same change) (recommended)
- `B`: Reject

Waiting for the user's answer in chat.

## Decision D3 answered by the user (05/11/26 09:39)

- Choice: **A**: Allow: commit the install.sh line with T2
- User's words (hub): "Allow: commit the install.sh line with T2"

## Decision D4 answered by the user (05/11/26 09:40)

- Choice: **A**: Accept it (same change)
- User's words (hub): "Accept it (same change)"

## Decision D5 needed (blocker) (05/11/26 09:41)

**Unblock T2 so its worker can confirm and hand in**

T2's worker stopped as blocked on the installer gap you approved in D3/D4. Opus already applied that fix and the review fixes in its worktree (243 tests pass). Unblocking keeps all that work; the worker only re-checks and reports done, then T2 is merged.

- `A`: Unblock T2 (keeps the work) (recommended)
- `B`: Leave T2 blocked

Waiting for the user's answer in chat.

## Decision D5 answered by the user (05/11/26 09:42)

- Choice: **A**: Unblock T2 (keeps the work)
- User's words (hub): "Unblock T2 (keeps the work)"

## Worker result - attempt 2 (05/11/26 09:46)

- Status: **done** (worker worker-1, branch `agent/hcnext-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/artifacts.py`, `.agent-system/artifacts/board/main.js`, `.agent-system/artifacts/decision/main.js`, `.agent-system/scheduler.py`, `.agent-system/scripts/install.sh`, `.agent-system/tests/test_artifacts.py`
- Scope: outside owned paths ['.agent-system/scripts/install.sh']; secret-like []
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hcnext/reports/T2.diff`

````text
 .agent-system/artifacts.py               | 184 ++++++++++++++++++++++++++
 .agent-system/artifacts/board/main.js    |  65 ++++++++++
 .agent-system/artifacts/decision/main.js |  84 ++++++++++++
 .agent-system/scheduler.py               |  32 +++++
 .agent-system/scripts/install.sh         |   2 +-
 .agent-system/tests/test_artifacts.py    | 215 +++++++++++++++++++++++++++++++
 6 files changed, 581 insertions(+), 1 deletion(-)
````

(diff is 664 lines; read the full diff file)

## Review round 2: PASS (05/11/26 09:46)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 3b3e6f2fa6ab, commits 3b3e6f2fa6ab
- Notes: C4 met; install.sh line (D3/D4), click ids and one-reply guard fixed in review; 243 tests pass

# Review hcnext T2 - artifacts: run board and decision cards (Opus)

Verdict: PASS (worker reported blocked correctly; Opus fixes applied before commit)

- C4 met: `artifacts.py` (board_data only titles/statuses/questions/options, atomic write_board from
  RunStore.save, enabled gate, publish board at run create and decision card at decision ask, ids in state,
  cleanup removes cards); two panels read board.json live (5 s timer), theme colors, scroll, 320 px.
- **Blocker resolved (D3/D4):** install.sh copies a fixed file list; added `artifacts.py artifacts`, else every
  workspace's scheduler fails to import. Safety net: `import artifacts` optional, every call site guarded.
- **Fixed (MAJOR):** buttons had no `.id()`; the app's guide requires `.id("unique")` before `.on_click`, so
  clicks could be dead. Added ids (options, followups, back, scroll lists).
- **Fixed (MINOR):** a card could send its answer twice; now one reply per card.
- `herdr-app check` passes for both panels with a sample board (Opus run). Whole suite 243 passed.
- Minor (accepted): an "input" followup (type a branch) replies without a value; Opus asks in chat.

## Integration: merged (05/11/26 09:46)

- On `agent/integration-hcnext` at 131e34a2c978; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcnext/logs/post-merge-T2-a2.log`)

## Final gate: PASS (05/11/26 10:27)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcnext at 9ab640e42edf (log `.orchestrator/runs/hcnext/logs/verify-1793848936.log`)
- Task MERGED; run DONE
