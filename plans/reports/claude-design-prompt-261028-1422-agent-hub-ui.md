Design the UI for **Agent Hub**, a web dashboard where one developer watches the AI coding workspaces running on their computer. From it they answer the decisions the AI escalates (multiple choice), send prompts to the AI, read job reports, and look back at their past choices.

## Context

I run a multi-agent coding kit. Each code repository gets a **workspace**, started on my computer with `agent-kit start`. Each workspace has:
- an **orchestrator** (Claude Opus) that plans work as a small task graph (1-10 tasks), reviews results and asks me the important questions;
- **subagents**:
  - **workers** (Codex or Claude, in slots "worker-1..3") that each implement one task in their own git checkout;
  - a read-only **scout** that researches the codebase before planning (up to 3 research rounds).

A job is a **run**: tasks go to workers, Opus reviews each result, sends up to 2 fix rounds back to the same worker, merges the passed tasks and runs a quality gate. At the end it writes a **final report** and asks me whether to merge.

Opus makes routine calls itself and logs a reason for each. **Critical calls are mine:**
- unblocking a stuck task;
- accepting changes outside a task's files;
- giving up a task or run;
- worker commands that leave the sandbox;
- the final merge/push.

A small local backend stores everything per workspace, so a workspace's documents and history are still there after it stops or restarts.

**Hard rules the UI must make obvious:**
- The hub **cannot start a workspace**. A workspace is "Running" only while I've started it on my computer. Stopped or offline workspaces stay visible and readable (documents, history), but you can't prompt or answer in them.
- An answer is final once delivered to my computer. To change it, the AI opens a new decision.

The main job: **a decision appears, I understand it and answer in about 30 seconds without reading code.** Next jobs: glance at what every agent is doing, send a prompt, read the job report, check my history.

## Users and constraints

- One owner, on a laptop browser first and on a phone too (375 px). Short visits, often in the middle of other work.
- Developer audience. Dense but calm, not a marketing site. Light and dark themes. Monospace only for ids, branches, commands, file:line and terminal output.
- Accessible: never use color alone for status (add a label or icon), 44 px tap targets.
- Live data (pushed updates). Design the loading, stale, disconnected and empty states too.

## Screens to design

1. **Workspaces overview** (home). One card per workspace, Running ones first:
   - name, status (Running / Offline, last seen 4 min ago / Stopped yesterday 18:20);
   - the active run and its status;
   - an **open-decisions badge** (the most prominent element);
   - problem count, the orchestrator's current state;
   - a "kit outdated" hint.

   Stopped workspaces are dimmed but open.

2. **Workspace page**, sections in priority order (tabs or anchors on a phone, columns on a laptop):
   - **Needs you**: open decisions (id, kind chip, one-line title, which agent it concerns, age).
   - **Orchestrator card**: program and model (e.g. Claude Opus 5.5, high effort), live state (idle / working / blocked on a terminal prompt / unknown), last activity, an expandable terminal-style tail of its screen, its open decisions inline, and the **prompt composer** (8).
   - **Subagents**:
     - worker cards: slot, state (Idle / Busy / Blocked / Broken), task id and title, task status, "fix 1/2", live state, time in state, screen tail, and decisions about its task shown inline on the card;
     - a scout card: research rounds "2/3", the questions of each round, Ready / Not ready, links to its research documents.
   - **Runs**:
     - the active run: status, integration branch, gate result, and a small task graph with dependencies;
     - task states: PENDING, READY, RUNNING, REVIEW, FIX_REQUIRED, PASSED, MERGED, BLOCKED, FAILED;
     - problems with no decision yet ("T2 blocked 14 min, no decision opened");
     - past runs collapsed, each with its outcome ("merged into main, pushed").
   - **Documents**: grouped by run (final report, total diff, task plans, decision records, research dossiers, review reports), with type icons, size and updated time.
   - **History**: see screen 7.

3. **Decision (multiple choice)**, the most important screen. It opens from the inbox or inline on an agent card.
   - Header: kind chip (blocker / repair / scope_exception / abandon / worker_approval / question / finish), the agent and task it concerns, age.
   - Title (one line), then "what happened" (2-3 lines of evidence: command + exit code, file:line).
   - 2-4 options as large radio cards, each with key (A/B/C), label and a one-line consequence. Opus's recommendation comes first, marked ★ Recommended.
   - An optional note for Opus, attached to the chosen option.
   - **"Chat something…"**: instead of choosing, I type my own reply. It goes to Opus as my words; Opus then records it or asks again. The decision stays open and shows "reply sent".
   - Submit opens a confirmation sheet that repeats the choice, since the answer is final once delivered.
   - Status after submit (a visible stepper): Sent → Delivered to your computer → Applied. While the workspace is offline it shows "waiting for your computer". Also show the other end states:
     - Answered in the terminal (read-only, showing that answer and my quoted words);
     - Rejected, with the reason (e.g. "invalid branch name") and the form re-opened to fix it;
     - Cancelled by Opus;
     - Superseded by D5 (with a link).

4. **Finish (merge) decision**: screen 3 in two steps.
   - Above step 1: the run's **final report** (rendered document, screen 6, collapsible) and the diff stat (files, +/−).
   - Step 1, "Merge run r4?": A Merge and push / B Merge locally only, no push / C Don't merge.
   - Step 2 (only after A or B), "Which branch?": "This branch (main)", or type a branch name, with inline hints (no `agent/` branches; a new name creates the branch).
   - Make the irreversibility of "push" clear without being alarming.

5. **Worker approval decision**: the exact command the worker wants to run, which worker and task, why it's outside the sandbox, and the worker's last screen lines as a terminal block. The options are Approve once / Deny (+ chat something…).

6. **Document reader**:
   - Markdown rendering: headings, tables, code blocks, checklists.
   - A diff viewer for `.diff` documents: a file list with +/− counts, collapsed hunks, and a "truncated, full diff on your computer" notice for big ones.
   - Breadcrumb: workspace › run › document.
   - Works on a phone (horizontal scroll only inside code and diff blocks).

7. **History timeline** per workspace:
   - Rows (each type with a distinct style): my answers (choice, typed words, channel: hub or terminal, device), my prompts (with delivery status), and Opus's routine calls ("approved `./gradlew test`, reason: build inside worktree").
   - Filters: my answers / prompts / Opus routine calls / run; search.
   - Each row links to the decision or document.

8. **Prompt composer** (on the orchestrator card, also reachable as a sheet on a phone):
   - A multi-line input with an 8 KB limit counter and Send.
   - Disabled with an explanation when the workspace isn't running ("Start it on your computer with `agent-kit start`").
   - Each sent prompt shows its status: Queued → Delivered, or Held ("the orchestrator has a prompt open in the terminal; it will be sent when that closes"), Expired (with Resend), or Failed (with the error).
   - Recent prompts are listed under the input.

9. **Global states and settings**:
   - Banners: workspace offline/stopped; hub connection lost (live updates paused, last updated 2 min ago).
   - Empty states: "nothing needs you", no workspaces yet (how to connect one).
   - Device pairing: enter the 8-character code shown on my computer, or scan its QR code.
   - Device list with revoke.
   - Per-workspace settings: upload switches (documents, diffs, agent screens), archive workspace.

## Sample data (realistic, use it)

```json
{"workspaces": [
  {"id": "ws_k3m9q2", "name": "thrift-demo", "status": "RUNNING", "open_decisions": 2,
   "orchestrator": {"kind": "claude", "model": "Claude Opus 5.5", "effort": "high", "state": "idle"},
   "run": {"run_id": "r4", "status": "RUNNING", "integration_branch": "agent/integration-r4",
    "tasks": [
     {"id": "T1", "title": "Limit name length", "status": "RUNNING", "worker": "worker-1", "depends_on": []},
     {"id": "T2", "title": "Validate email format", "status": "FIX_REQUIRED", "worker": "worker-2", "fix_round": "1/2", "depends_on": []},
     {"id": "T3", "title": "Update user API docs", "status": "PENDING", "depends_on": ["T1", "T2"]}]},
   "workers": [
    {"slot": "worker-1", "status": "BUSY", "task": "T1", "model": "gpt-6-luna xhigh", "state": "working", "for": "12m"},
    {"slot": "worker-2", "status": "BUSY", "task": "T2", "state": "idle"},
    {"slot": "worker-3", "status": "BLOCKED", "task": "T4", "state": "blocked", "reason": "approval prompt: npm install zod"}],
   "scout": {"rounds": "2/3", "readiness": "READY"}},
  {"id": "ws_p8x1d0", "name": "billing-api", "status": "STOPPED", "last_seen": "yesterday 18:20", "open_decisions": 0,
   "last_run": {"run_id": "r2", "status": "DONE", "finish": "merged into main, pushed to origin/main"}}],
 "decision": {"id": "D3", "kind": "repair", "agent": "worker-2", "task": "T2",
  "title": "T2: merge conflict in UserHandler.java",
  "question": "Cherry-pick of a1b2c3 conflicted with T1's change at UserHandler.java:42 (both edit the name check). Post-merge tests not run.",
  "options": [{"key": "A", "label": "Repair: rebase T2 on T1's version"},
              {"key": "B", "label": "Drop T2's name change, keep only the email part"},
              {"key": "C", "label": "Stop T2, I'll handle it"}],
  "recommend": "A", "status": "OPEN", "opened": "4 min ago"},
 "history": [
  {"at": "11:58", "type": "answer", "decision": "D2", "choice": "B", "label": "Narrow T4 to the API layer", "channel": "hub", "device": "phone"},
  {"at": "11:40", "type": "prompt", "text": "Also add a test for empty emails", "status": "DELIVERED"},
  {"at": "11:31", "type": "routine", "text": "Opus approved `./gradlew test` for worker-1", "reason": "build inside worktree"},
  {"at": "10:05", "type": "answer", "decision": "D1", "choice": "A", "channel": "terminal", "quote": "A, go ahead"}]}
```

## Deliverables

- High-fidelity designs for every screen above:
  - laptop (1280 px) for 1, 2, 6, 7;
  - phone (375 px) for 1, 2, 3, 4, 5, 8.
- A component sheet:
  - status chips for every workspace, run, task, worker, agent and decision state;
  - kind chips, option card (normal / recommended / selected), "chat something…" field, status stepper;
  - prompt status pills, agent card, terminal-tail block, document list row, history rows (answer / prompt / routine), banners.
- Light and dark themes with color tokens named by meaning (`status-blocked`, `status-running`, `needs-you`, `routine`, ...).
- Short interaction notes:
  - live updates and the staleness indicator;
  - what happens when a decision changes state while I'm reading it (Opus cancels it, I answer it in the terminal);
  - submit confirmation;
  - a Held prompt becoming Delivered.

## Avoid

- Any "start workspace" or "run" button: the hub can't start things.
- Charts and analytics, marketing hero sections, showing source code outside documents and terminal tails.
- More than one primary action per screen, emoji as status indicators.
