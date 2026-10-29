# hub9: questions inbox, every document on the website, reliable hub notices

Requested 30/10/26 00:41-01:01 from the phone. Applies to **every** agent-kit workspace (current and
future): hub/web/server features are shared; kit pieces reach workspaces via `agent-kit create`
(new) and `agent-kit update` (existing).

## User decisions (verbatim)
- "ok the next run will resolve the [hub] problem."
- Questions: "i want every question should come to me" … "i want it to be albe for every workspace,
  not only these three, but also for all future ones" … "last 100 for all workspaces. Also … just do
  like decision, but give another panel, like, "Questions". Add another label into History."
- Documents: "Plan and reviews are enough. Remember about our side artifacts … add another filter:
  plan, other (contain side docs + reviews). Moreover, apply paging for Document panel: show 30 for
  each page. In the Everything tab, only show first 15 documents, in the bottom will have a button
  "--> More..." and lead to Document tab. Do the same thing for Decision, and History."
- Delivery: "waiting will send periodically, 1s, 2s, 4s, 8s, 16s, 16s, 16s, 16s" … R1: "after the
  8th retry please repeat send after each 32s, during 10 mins."
- R2 (auto-publish side docs): "approve. push like the category that i have said."
- R3: "approve. also in the Run, should give option to toggle on/off each option. for example i
  choose Run -> final report and scout, Plan => should only show them and Plan documents."
- R4: "not only question. Documents, History and Decision also follow this. Each page is 30 rows."

## Contract (fixed by Opus before dispatch, commit bfd1d85)
- `DocumentKind` = `final_report | final_diff | decision | research | plan | review | other`
  (schema, `types.gen.ts`, kit schema copy, web `api/types.ts`, labels Plan / Review / Document).
- **Questions inbox** = a reserved run with id `inbox` per workspace. Its decisions are normal
  decisions (kind `question`), so answering, Delivered/Applied, `decision wait` all work unchanged.
  - Never the "active"/newest run; never shown in Runs; its decisions show only in the Questions panel.
  - History items with `run_id == "inbox"` are labelled **Question**.
  - Keep the newest 100 inbox decisions per workspace (kit side and backend side); never drop an
    OPEN one.
- Document categories: `plan` = `plans/*/plan.md`; `review` = `plans/reports/review-*.md`;
  `other` = any other published file. `run_id` set when the run recorded the path, else null
  (workspace-level).
- No API route change. Paging is client-side (lists are already fully loaded).

## T1 kit + connector (Python)
Owned: `.agent-system/agentctl.py`, `.agent-system/scheduler.py`, `.agent-system/scripts/install.sh`,
`.agent-system/scripts/hub-hooks.py` (new), `.agent-system/templates/claude-settings.json`,
`.agent-system/templates/ORCHESTRATOR.section.md`, `.agent-system/tests/test_agentctl.py`,
`.agent-system/tests/test_scheduler.py`, `.agent-system/tests/test_hub_hooks.py` (new).

1. **Idle-only delivery with retry schedule** (answer notices AND `prompt`/`reply` commands):
   - Type into the orchestrator only when its Herdr state is `idle`.
   - Attempt at t0, then retries after 1, 2, 4, 8, 16, 16, 16, 16 s (8 retries), then every 32 s
     until 10 min after t0. Each retry delivers if idle at that moment.
   - Prompt/reply while waiting: ack `HELD` with reason `waiting for Opus to finish its current
     step`; keep the command in a local schedule; when the backend re-offers a HELD command already
     scheduled, re-ack HELD without resetting its schedule. On delivery ack `DELIVERED`. After
     10 min undelivered ack `FAILED` with reason `Opus stayed busy for 10 minutes; not delivered`.
   - Answer notice: the answer is already recorded and acked DELIVERED as today; only the typed
     notice follows the schedule; after 10 min drop it with a log line.
   - Schedule constants in one place; the watch loop must wake often enough (≤1 s granularity
     while anything is scheduled) without busy-looping.
2. **Questions inbox**:
   - `scheduler.py ask --title T --question Q --option "A=label :: consequence" … --recommend A
     [--note N]` creates the `inbox` run on first use (no tasks, no worktrees, no workers, status
     that never counts as active) and opens a kind-`question` decision there. Prints the decision id
     and the wait command. `agentctl ask …` forwards to it.
   - `load_runs`/snapshot: `inbox` is excluded from "newest/active run" and from the run list sent
     as runs, but its decisions and decision documents are synced like any run's.
   - Pruning: after each `ask` and on each sync, keep the newest 100 inbox decisions (by created
     time); delete older non-OPEN ones (state entry + `decisions/Dn.md`) through scheduler code.
3. **Documents**:
   - `scheduler.py run create … --plan <path>` stores `plan_path` in state; `mark-reviewed
     --report <path>` stores the path in that review entry. Connector `document_refs` adds those
     (kind `plan` / `review`, with the run id).
   - `agentctl publish <path> [--run R] [--title T]` / `agentctl unpublish <path>`: manifest
     `.orchestrator/published.json` (list of {path, run_id, title, kind}). Kind by path rule
     (contract) else `other`. Only files inside the workspace, `.md`/`.txt`/`.diff`, ≤512 KB,
     not `secret_path`. The connector uploads manifest entries like other documents (same hashing,
     changed-only) and deletes them remotely when unpublished or the file disappears.
4. **Hooks** (`scripts/hub-hooks.py`, registered in `templates/claude-settings.json`):
   - `PreToolUse` matcher `AskUserQuestion`: if the workspace hub connector is running (pid file
     alive) and hub is enabled, create one inbox question per asked question (options from the
     tool input, first option recommended unless one is marked "(Recommended)"), then deny the tool
     with a reason telling Claude the question ids and the exact `decision wait --run inbox --id Dn`
     command. If the hub is not connected, allow (terminal question as usual).
   - `PostToolUse` matcher `Write|Edit`: a `.md` file under `plans/` or `docs/` is auto-published
     (kind by path rule). Errors never block the tool (exit 0, log only).
   - `install.sh merge_settings`: merge every template hook by its command string (today it only
     checks `record-session.py`), idempotent on re-run.
5. `templates/ORCHESTRATOR.section.md`: rule: when the user is remote/hub-connected, ask every
   question via `agentctl ask` (never plain text), pair each ask with a background `decision wait`;
   publish documents written for the user.
6. Tests: retry schedule timings (fake clock) incl. HELD/FAILED acks and busy→idle delivery;
   `ask` creates inbox, ids increment, pruning keeps 100 and never OPEN ones; inbox excluded from
   newest run; publish/unpublish manifest + safety refusals + kinds; `plan_path`/review report refs;
   hook script deny/allow paths and auto-publish; `merge_settings` idempotent.

## T2 backend (server)
Owned: `hub/server/src/db.ts`, `hub/server/src/connector-api.ts`, `hub/server/test/server.test.ts`,
`docs/hub-api.md`.
1. On decision upsert for run `inbox`, keep the newest 100 per workspace (by `created_at`); delete
   older non-OPEN rows and their decision documents (`.orchestrator/runs/inbox/decisions/Dn.md`);
   publish the usual `decision`/`document` events.
2. `docs/hub-api.md`: document kinds plan/review/other, the inbox run convention, and the HELD →
   FAILED prompt delivery semantics (10 min).
3. Tests: 105 inbox decisions → 100 remain, OPEN ones kept even if old; other runs untouched;
   documents of pruned decisions removed.

## T3 website
Owned: `hub/web/src/features/**`, `hub/web/src/components/**`, `hub/web/src/lib/**`,
`hub/web/src/state/**`, `hub/web/src/api/mock/**`, `hub/web/src/api/http/adapter.ts`.
1. **Questions panel + tab**: decisions with `runId === 'inbox'` (shown with ids `Q<n>`) leave the
   Decisions panel/NeedsYou and appear in a new "Questions" tab/panel; open ones still count in
   "needs you". Runs list hides `inbox`. History rows with `runId === 'inbox'` get label
   **Question**.
2. **Document filters**: chips **Run · Plan · Other** (multi-select, OR). Selecting Run reveals
   toggles **Final report · Diff · Decisions · Scout** (all on by default) that limit which run kinds
   count. Plan = `plan`; Other = `review` + `other`. No chip selected = everything. Example: Run with
   only Final report + Scout on, plus Plan → final reports, scout dossiers and plans only.
3. **Paging**: Documents, Decisions, Questions, History: 30 rows per page with prev/next and
   "page X of Y" (one shared pager component). On the Everything tab each panel shows its first 15
   and a "→ More…" button that switches to that panel's tab (History: to the History page/tab).
4. Prompt status `HELD` label: "Waiting for Opus"; `FAILED` shows its reason.
5. Tests: filter combinations (incl. the example), pager boundaries (0, 30, 31 rows), Everything
   shows 15 + More navigates, inbox decisions only in Questions, History label.

## Rollout (each step a hub decision)
Merge locally → restart backend → deploy website → `agent-kit update` in the 3 workspaces +
restart their connectors (future workspaces get it via `agent-kit create`).
