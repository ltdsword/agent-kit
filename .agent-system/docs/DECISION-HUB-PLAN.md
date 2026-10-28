# Agent Hub: web dashboard, decisions and prompts for the multi-agent workflow

Status: **planned, revised 2026-10-28** (replaces the 2026-10-16 draft, which was marked "not planned"
on 2026-10-19 because Remote Control seemed to cover it; Remote Control is disabled on our Claude
Team plan, so the hub is back). H0 (Herdr + Claude Team check) passed on 2026-10-28; nothing else
is built yet. Build order: section 16.

Contents
1. Summary
2. Requirements (from the owner, 2026-10-28)
3. Architecture and hosting
4. Independence: the system and the backend never depend on each other
5. Workspaces: identity, lifecycle, persistence
6. What a workspace shows: orchestrator, subagents, documents, decisions, history
7. Decisions from the hub (multiple choice + "chat something...")
8. Prompts from the hub
9. Documents (the job report)
10. Connector (`agentctl`) and kit changes
11. Backend: data model and API
12. Web UI
13. Security
14. Failure modes
15. Claude Team plan, Remote Control and company policy
16. Implementation phases
17. Testing
18. Open questions
19. Appendix: protocol examples, orchestrator rule text

---

## 1. Summary

The **hub** is a web app where I see every workspace that is running on my computer, answer the
orchestrator's decisions as multiple choice (or type a reply), send it new prompts, and read the job
reports. It keeps each workspace's documents and decision history, so they are still there after the
workspace or the backend restarts.

Three parts:
- **Kit side (Python standard library only, in `.agent-system/`)**: a small change to the scheduler,
  plus a new **connector**, `agentctl`, that runs while a workspace is started. It pushes status,
  documents and decisions, and pulls my answers and prompts.
- **Backend (`agent-hub serve`)**: a separate long-running process on the same computer. For now it
  binds to `127.0.0.1:7420`. It stores everything in SQLite.
- **Web UI**: a static single-page app. The backend serves it locally, and the same build can be
  deployed to Vercel. The browser talks only to the backend.

The key mechanism: the connector delivers my answers and prompts by **typing them into the
orchestrator's Herdr pane** (`herdr agent prompt`), exactly as if I typed them in the terminal. Claude
needs no new tool and no background wait, and nothing in Claude Code is bypassed.

## 2. Requirements (from the owner, 2026-10-28)

| # | Requirement | Where |
|---|---|---|
| R1 | Critical decisions in multiple-choice format, like the CLI today, with the options shown on the card of the agent (orchestrator or worker) they concern, plus a "chat something..." free-text reply | 7, 12 |
| R2 | When a job completes, a report document is uploaded in a format the hub can display | 9 |
| R3 | Type prompts in the hub, sent through the backend to the system | 8 |
| R4 | The backend runs on the same computer as the system (for now) | 3 |
| R5 | Several workspaces at once in the hub | 5, 12 |
| R6 | The hub can't start a workspace. Only starting it on the computer (`agent-kit start`) makes it appear as running | 5.2, 13 |
| R7 | Each workspace has: orchestrator, subagents, documents, decisions, history (my choices) | 6 |
| R8 | The backend keeps a stable workspace id and reloads old documents and history when the workspace or the backend restarts | 5 |
| R9 | The system and the backend are independent: a failure of one never breaks the other | 4, 14 |
| R10 | Hosting: Vercel is preferred (for the UI) | 3.2 |

Non-goals for now: starting or stopping workspaces or runs from the web; editing task files from the
web; multi-user teams; a cloud backend (designed for in 3.3, not built).

## 3. Architecture and hosting

### 3.1 Picture

```text
 one computer                                                                  any browser
┌──────────────────────────────────────────────────────────────────────┐
│ workspace A (started with agent-kit start)                           │
│  Herdr: orchestrator pane (Claude) · worker-1..N panes               │
│  .orchestrator/ state.json, reports, decisions · gen-tasks/          │
│  agentctl watch  (connector, started by agent-kit start)  ───┐       │
│        reads files + `herdr agent get/read`                  │ HTTP  │
│        types answers/prompts: `herdr agent prompt`           │ local │
│                                                              ▼       │      ┌──────────────┐
│ workspace B ... agentctl watch ──────────────────────► agent-hub serve ◄────┤ Web UI (SPA) │
│                                                       127.0.0.1:7420 │ HTTPS│ phone/laptop │
│                                                       SQLite, docs   │      └──────────────┘
│                                                       (systemd user  │  via Tailscale (phase H5)
│                                                        service)      │
└──────────────────────────────────────────────────────────────────────┘
```

| Component | Lives in | Language | Responsibility |
|---|---|---|---|
| `scheduler.py` | kit | Python stdlib | Source of truth for runs, tasks, decisions. Barely changes (10.4) |
| `agentctl.py` (connector) | kit, `.agent-system/` | Python stdlib | One per running workspace: sync status, documents and decisions up; deliver answers and prompts down |
| `agent-hub` backend | `hub/server/` in this repo | TypeScript (Node 22), Hono, better-sqlite3, drizzle, zod | Store, serve the API and live updates, pair devices |
| Web UI | `hub/web/` | TypeScript, React (Vite SPA) | Screens in section 12 |
| Protocol | `hub/protocol/` | JSON Schema + generated zod | One schema set; contract tests on both sides |

### 3.2 Hosting

- **H2-H4 (laptop only):** the backend serves the UI itself at `http://127.0.0.1:7420`, same origin,
  nothing to configure.
- **H5 (phone):** `tailscale serve` publishes the backend on my tailnet as
  `https://<laptop>.<tailnet>.ts.net` (HTTPS, reachable only from my own devices; never Tailscale
  Funnel, never a public tunnel). The UI comes either from the backend (same origin) or from
  **Vercel**: the same static build, deployed with `VITE_HUB_URL` set. On Vercel it holds no data and
  no secrets; the browser fetches everything from the tailnet URL (CORS allows the Vercel origin).
  Each device stores the backend URL, so one UI deployment can later point at several backends.
- Why not let Vercel reach the laptop directly: a public page calling `localhost` is blocked or
  prompts in modern browsers (Private/Local Network Access), and a phone can't reach `localhost` at
  all. A private tailnet URL avoids both without exposing the backend to the internet.
- The Vercel Hobby plan is for non-commercial use. It serves only static files here, but for work use
  check the terms or use the backend-served UI (section 15).

### 3.3 Later: a cloud backend (not built, kept possible)

Built so that moving the backend off the laptop is a configuration change, not a rewrite:
- Connector to backend is plain outbound HTTP (long polling), so it works through NAT.
- drizzle on SQLite now, Postgres later: same schema, same queries.
- When the backend leaves the computer: per-workspace tokens instead of the machine connector key
  (13.2); upload minimization defaults flip to "titles and statuses only"; answers signed by the
  backend with an Ed25519 key that never leaves it, verified locally with `ssh-keygen -Y verify`
  (13.4).

### 3.4 Repository layout (decision: one repo)

The hub lives in **this repo** under `hub/`, not in a separate repo:
- The connector (kit) and the backend share one protocol; contract tests need the same schema files
  on both sides, in one commit.
- One version tag covers kit + hub, so `agent-kit --version` and the hub's "kit outdated" warning
  compare the same numbers.
- It doesn't leak into workspaces or the `.deb`: `install.sh` copies only `.agent-system/`, and
  `packaging/build-deb.sh` archives only `.agent-system`, `scout.md`, `README.md`, `LICENSE`.
- CI: the existing Python tests, plus a `hub` job (typecheck, unit and contract tests). The hub is
  released separately (`npm` package or tarball with `agent-hub` bin), when needed.

```text
hub/
├── protocol/schemas/*.json        # hello, snapshot, decision, event, document, command, ack
├── protocol/fixtures/*.json       # shared by TS and Python contract tests
├── server/src/{index,db,auth,connector-api,user-api,stream,pair}.ts
├── server/migrations/             # drizzle, SQLite
└── web/src/{routes,components,api}/
```

## 4. Independence: the system and the backend never depend on each other

Rules that make R9 true:
1. **The scheduler never talks to the network** and never imports connector code. It reads one
   optional hint file (`.orchestrator/hub.json`, 10.4). A missing or stale file means "hub
   offline", nothing else.
2. **The connector is a separate process** from the orchestrator and from the backend. If it
   crashes, Claude and the workers keep running; decisions are answered in the terminal as today.
3. **The backend is a separate process** (systemd user service, `Restart=always`), not inside
   Herdr, so it outlives every workspace. If it's down, the connector retries with backoff (1 s to
   60 s) and keeps nothing important only in memory: everything it sends is re-read from workspace
   files on the next sync.
4. **Every sync is a full, idempotent reconcile** (snapshot overwrite, decision upsert, document
   manifest by hash). A restart of either side converges without replaying a log.
5. **Commands (answers, prompts) are durable on the backend** until acked. They are applied only
   through the scheduler's own checks (answers) or the orchestrator's input box (prompts), so a stale
   or duplicate command can't do harm: the scheduler rejects it and the connector reports why.
6. **The backend never executes anything on the computer.** It has no shell, no Herdr access and no
   workspace paths it acts on. The only path into a workspace is a connector that the workspace
   itself started.

## 5. Workspaces: identity, lifecycle, persistence

### 5.1 Identity

- `workspace_id` = `ws_` + 16 random base32 chars, created by the connector the first time it runs
  with the hub enabled, and written to the workspace's `.agent-system/config.json`:
  ```json
  "hub": {"enabled": true, "url": "http://127.0.0.1:7420", "workspace_id": "ws_k3m9...",
          "upload": {"documents": true, "diffs": true, "agent_screens": true}, "screen_lines": 40}
  ```
  `config.json` is kept by `agent-kit update`, and the id moves with the workspace folder. No secret
  goes in config.
- Display name = repo name (`project.path` basename); the hub also stores the workspace path, the
  last kit version and the orchestrator/worker models, for display only.
- **Copied workspace** (two folders, same id, both online): the backend refuses the second `hello`
  with `409 duplicate_workspace`; `agentctl reset-id` gives the copy a new id.

### 5.2 Lifecycle (R6: the computer starts it, the hub only watches)

```text
agent-kit start ──► launches orchestrator in Herdr (as today)
               └──► if hub.enabled: starts `agentctl watch` in the background
                     (pidfile .orchestrator/hub-connector.pid; a second start is a no-op)
agentctl watch ──► hello(workspace_id, session_id, kit_version, path)   => hub: ONLINE
               ──► loop (10.2) while the orchestrator Herdr agent exists
               ──► orchestrator agent gone (pane closed / Herdr quit) or SIGTERM:
                     sends goodbye, exits                               => hub: STOPPED
               ──► crash / laptop sleeps: no heartbeat for 90 s         => hub: OFFLINE (last seen ...)
```

- Hub states: `ONLINE`, `OFFLINE` (no heartbeat), `STOPPED` (clean goodbye). Only `ONLINE`
  workspaces accept prompts and answers in the UI; the others are read-only, showing their history and
  documents.
- `agent-kit continue` and a restarted Herdr use the same `workspace_id`, so it's the same hub
  workspace with a new **session** (a row in `workspace_sessions`).
- There is **no command from the hub that starts anything**: the protocol (11.3) has no such
  message, and the connector only exists after a local start.
- `agentctl watch` can be run by hand (debugging); it still refuses to run if the workspace's
  orchestrator agent isn't live, unless `--no-orchestrator` (status only, prompts disabled).

### 5.3 Persistence and reload (R8)

| Data | Source of truth | Backend copy | After a workspace restart | After a backend restart / DB loss |
|---|---|---|---|---|
| Status (agents, runs, tasks) | `state.json` + Herdr | latest snapshot | new snapshot on hello | new snapshot on hello |
| Decisions + my answers | `state.json` `decisions` (all runs) | `decisions` table | upserted on hello | rebuilt from all runs' `state.json` |
| Documents | workspace files | `documents` table (content stored) | manifest diff, upload changed | manifest diff, upload all |
| Prompts I sent | backend `commands` | `commands` table | kept | lost from DB, but also logged locally (`.orchestrator/hub-log.jsonl`) and re-imported on hello |
| Activity events | `state.json` `events` (last 500/run) | `events` table | missing ones sent | resent (older than 500 are gone; the UI says "N events not available") |

So each side can rebuild the other's view: the backend keeps history when a workspace is deleted, and
the workspace can repopulate a fresh backend.

## 6. What a workspace shows (R7)

| Section | Contents | Source |
|---|---|---|
| **Orchestrator** | program, model, effort; Herdr state (`idle/working/blocked/done/unknown`); last activity; the last `screen_lines` of its pane (opt-in); open decisions it asked; prompt composer (8) | config, `kitstart.agent_name(repo)`, `herdr agent get/read`, `.orchestrator/orchestrator.json` |
| **Subagents: workers** | per slot: IDLE/BUSY/BLOCKED/BROKEN, task + title, task status, fix round `n/2`, Herdr state, time in state, screen tail (opt-in), decisions about its task | `state.json` `workers`/`tasks`, Herdr |
| **Subagents: scout** | research rounds `n/3`, the questions of each round, READY/NOT_READY, link to each dossier | `state.json` `research` (the scout is a Claude subagent inside the orchestrator; it has no live pane to watch) |
| **Runs** | active run first: status, integration branch, task DAG, gate result, problems ("T2 BLOCKED 14 min, no decision"); past runs collapsed | `state.json` |
| **Documents** | final reports, total diffs, task files, decision files, research dossiers, grouped by run | section 9 |
| **Decisions** | open ones (answerable) and all past ones with their answers | section 7 |
| **History** | a timeline of my actions: every answer (choice, typed text, channel hub or terminal chat), every prompt, plus Opus's routine calls (`DECIDED_BY_OPUS`, with reason) in a separate, filterable style | decisions + commands |

## 7. Decisions from the hub (R1)

### 7.1 What changes, what doesn't

- Opus still opens every decision with `scheduler.py decision ask` (unchanged). The scheduler still
  gates every critical command on an answered, unused decision (unchanged).
- New: the answer can come from the hub. **The connector records it** (the user's exact choice, no
  paraphrase), then **types a short message into the orchestrator's pane** so Claude wakes up and
  acts. No background `decision wait` is needed.

### 7.2 The terminal question and the hub can't both be a dialog

While Claude Code shows an AskUserQuestion dialog, typing into the pane answers the dialog, not the
chat, so the hub can't deliver into it reliably. Rule (enforced by the text the scheduler returns, 10.4):
- **Hub online** (`.orchestrator/hub.json` heartbeat < 90 s): `decision ask` returns
  `"hub": "online"`, and Opus asks in **plain chat**: title, 2-3 lines, options `A: ...` / `B: ...`
  with the recommendation, "Answer on the hub or reply here (D3 A/B/C or your own words)". Then it
  ends its turn. The hub shows the real multiple choice; the terminal still accepts a typed answer.
- **Hub offline**: AskUserQuestion with clickable options, exactly as today.
- Rejected alternative: keep the dialog and have the connector press its keys. It depends on the
  dialog's key layout in each Claude Code version and fails silently. Revisit only if the H0 spike
  shows a stable way.

### 7.3 Flow

```text
Opus           scheduler            connector                    backend               me (web)
 │ decision ask  │ D3 PENDING          │                            │                     │
 │──────────────►│ (hub online hint)   │ sync: decision upsert ────►│ OPEN, notify ──────►│
 │ asks in chat, │                     │                            │                     │ picks B (+ note)
 │ ends turn     │                     │                            │◄── POST answer ─────┤ or "chat something..."
 │               │                     │◄── command: answer D3 B ───┤ ANSWERED (pending)  │
 │               │◄ decision_answer(channel=hub, quote="B: <label>", by=<device>)         │
 │               │ D3 ANSWERED         │ herdr agent prompt orch:                         │
 │◄──────────────────────────────────── "[hub] D3 answered: B ..." │                     │
 │               │                     │── ack DELIVERED ──────────►│ DELIVERED ─────────►│
 │ repair --decision D3                │                            │                     │
 │──────────────►│ consumed_by set     │ sync: decision used ──────►│ APPLIED ───────────►│
```

### 7.4 States

| Hub state | Meaning | Set by |
|---|---|---|
| OPEN | waiting for me | sync of a PENDING decision |
| SENT | I answered in the hub; the connector hasn't picked it up yet (shows "waiting for your computer" if the workspace is offline) | user API |
| DELIVERED | recorded by the scheduler and typed to Opus | connector ack |
| APPLIED | a gated command used it (`consumed_by`) | sync |
| ANSWERED_ELSEWHERE | answered in the terminal chat first; read-only, showing that answer and quote | sync (`channel=chat`) |
| REJECTED | the scheduler refused the hub answer (already answered, invalid branch name, ...), with its exact reason; the decision becomes answerable again if still PENDING | connector ack |
| CANCELLED | Opus withdrew it | sync |
| ROUTINE | `DECIDED_BY_OPUS` (audit only, never answerable) | sync |

First answer wins: the scheduler's lock plus "only PENDING can be answered" settles every race. The
hub only reports the result.

### 7.5 The form ("multiple choice + chat something...")

- One large card per option: key, label, one-line consequence; Opus's recommendation first, marked.
- **"Chat something..."**: free text instead of an option (like "Other" in the CLI). It is sent as a
  `reply` command: the connector types `[hub] reply to D3: "<text>"` to Opus and does **not** record
  an answer. Opus maps it to an option and records it with `decision record --quote "<text>"`
  (verbatim), or asks again, exactly as with typed "Other" text today. The hub shows "reply sent"; the
  decision stays OPEN until recorded.
- An optional **note** with a chosen option is passed as `--note` (recorded with the answer).
- **Finish (merge) decisions** have two steps, mirroring `finish ask`'s follow-up: (1) A Merge and
  push / B Merge locally only / C Don't merge; (2) only for A/B: "This branch (`<base>`)" or a typed
  branch name. The UI shows the run's final report and diff stat above step 1 (section 9). The branch
  name is validated by the scheduler (`git check-ref-format`, no `agent/` branches), so an invalid
  name comes back REJECTED with the reason, and I fix it in place.
- **Where it shows**: in the workspace's "Needs you" inbox, and on the card of the agent it concerns:
  the worker holding the decision's task (blocker, repair, scope_exception, worker_approval), else the
  orchestrator (question, abandon of a run, finish).
- Answers are final once DELIVERED (as in the CLI); a change of mind is a new decision opened by Opus.
- Before sending, a confirmation sheet repeats the choice (and branch, for finish).

### 7.6 Worker approval prompts

There's no new mechanism. A worker blocked on an approval prompt becomes a `worker_approval` decision
(Opus opens it, as today). Its card shows the command, plus the worker's screen tail if uploads allow.
After my answer arrives, Opus types the key with `herdr agent send-keys` (today's rule). The hub
never sends keys to workers.

## 8. Prompts from the hub (R3)

- A composer on the orchestrator card, enabled only when the workspace is ONLINE. Max 8 KB per
  prompt. Text only, no attachments for now.
- Backend: `commands` row `{type: "prompt", text, status: QUEUED}`. Connector pulls it and delivers
  it with `herdr agent prompt <orchestrator> "[hub] <text>"`. The prefix tells Opus where it came from,
  and the rule (19.2) says a `[hub]` prompt is a normal request from me.
- **Delivery rules**:
  - orchestrator `idle`: deliver.
  - `working`: deliver. H0 test T4 (2026-10-28) showed that Claude Code queues input typed during
    a turn and answers it afterwards.
  - `blocked` (a dialog or permission prompt is open): Herdr itself refuses the submission with
    `agent_blocked` before typing anything (herdr 0.9.5 `agent prompt --help`), so nothing can leak
    into a dialog. The connector marks the prompt HELD, shows "waiting: the orchestrator has a prompt
    open in the terminal", and retries every 5 s.
  - not live: the workspace isn't ONLINE (5.2). The UI disables sending.
  - Queued for more than 30 min: EXPIRED, never delivered late by surprise. I can resend it.
- Status shown in the UI: QUEUED → DELIVERED (typed into the pane) or HELD (with the reason) /
  EXPIRED / FAILED (Herdr error text).
- Prompts go **only to the orchestrator**. Workers receive work only through the orchestrator's task
  files, so the scheduler stays the authority over what workers do.
- Every delivered prompt is appended to `.orchestrator/hub-log.jsonl` (5.3).

## 9. Documents (R2)

- **Format: GitHub-flavored Markdown**, rendered by the UI (tables, code blocks, task lists),
  sanitized (no raw HTML, no scripts, links open in a new tab). Diffs (`.diff`) use a diff viewer
  with a per-file list and a size guard. That is the format every kit document already has:
  `final-report.md` (summary, result, tasks table, commits, `--stat`, risks, known issues,
  decisions), task files in `gen-tasks/`, decision files `D<n>.md`, research dossiers.
- **The job report** (R2): when `scheduler.py report` writes `final-report.md` and `final.diff`, the
  next sync uploads both, tagged `kind=final_report` / `final_diff`. The UI shows the report at the
  top of the run, and above the finish decision.
- Uploaded set (connector scan, each with `sha256`, only changed files sent):

  | kind | path | default |
  |---|---|---|
  | `final_report` | `.orchestrator/runs/<run>/final-report.md` | on |
  | `final_diff` | `.orchestrator/runs/<run>/final.diff` | `upload.diffs` |
  | `task_file` | `gen-tasks/*.md` referenced by the run's tasks | `upload.documents` |
  | `decision` | `.orchestrator/runs/<run>/decisions/D*.md` | `upload.documents` |
  | `research` | evidence files of `research` rounds | `upload.documents` |
  | `review` | review reports passed to `mark-reviewed --report` | `upload.documents` |

- Limits: 1 MB per document; a bigger diff is truncated with a marker and its `--stat`, and the full
  file stays local. The connector refuses any path matching the scheduler's `SECRET_PATTERNS` and
  runs a secret scrubber (`sk-...`, `AKIA...`, `Bearer ...`, `password=...`, PEM blocks) on every
  uploaded text and screen tail.
- Defaults are "on" because the backend is on the same computer (nothing leaves it except to my own
  devices over the tailnet). With a cloud backend (3.3) the defaults flip to off.

## 10. Connector (`agentctl`) and kit changes

### 10.1 Commands

| Command | Does |
|---|---|
| `agentctl enable [--url URL]` | Sets `hub.enabled`, creates `workspace_id`, checks the backend (`/agent/ping`) and the connector key |
| `agentctl watch` | The loop below. Started by `agent-kit start` when enabled |
| `agentctl sync --dry-run` | Prints hello, snapshot, decisions and the document manifest; no network (tests, debugging) |
| `agentctl status` | Backend reachable, last sync, pending commands, pidfile |
| `agentctl stop` | Stops this workspace's connector |
| `agentctl reset-id` | New `workspace_id` (copied workspaces) |

### 10.2 `watch` loop

1. `hello` → backend returns the last state it knows (event cursors per run, document hashes). On
   `unknown_workspace` (fresh DB), register and do a full sync.
2. Every 5 s, or immediately when a `state.json` mtime changes:
   - Snapshot (agents, runs, tasks, problems), sent only if its hash changed. Heartbeat every 30 s
     regardless.
   - Upsert all decisions of all runs whose content hash changed.
   - Send new events per run (by event number `n`, 10.4).
   - Upload the document manifest diff.
3. Long-poll `GET /agent/commands?wait=25` and handle each command in order:
   - `answer`: `Scheduler.decision_answer(run, id, choice, note, channel="hub", by=<device name>,
     followup, value, quote="<KEY>: <label>" [+ " / <branch>"])`, in-process, under the scheduler
     lock. On success, type `[hub] D3 answered by the user: B (<label>)...` to the orchestrator and ack
     DELIVERED. On `SchedulerError`, ack REJECTED with its message.
   - `reply` / `prompt`: deliver per section 8, ack DELIVERED / HELD / FAILED.
4. Write `.orchestrator/hub.json` `{"connector_pid", "backend": "online"|"offline", "heartbeat_at"}`
   after each loop.
5. Exit when the orchestrator Herdr agent no longer exists (5.2).

Errors: backend unreachable → exponential backoff, keep looping on the local side (hub.json says
offline); Herdr unavailable → no agent states and prompts HELD, status still synced.

### 10.3 Snapshot builder

It reads only what already exists:
- `state.json` of every run under `.orchestrator/runs/`;
- `config.json` for programs and models;
- `herdr agent get <name>` for the orchestrator (`kitstart.agent_name`) and each worker
  (`workers[w].agent_name`);
- `herdr agent read <name> --source visible --lines N` when `upload.agent_screens` is on.

The snapshot is capped at 256 KB, dropping screen tails first.

### 10.4 Kit changes (small, all offline)

| File | Change |
|---|---|
| `scheduler.py` `log_event` | Each event gets a per-run increasing `n` (`state["event_n"]`), so the connector can resume after the 500-event trim |
| `scheduler.py` `decision_ask` | Reads `.orchestrator/hub.json`; adds `"hub": "online"|"offline"` and the matching `next` text (7.2) |
| `scheduler.py` `decision_answer` | Accepts `channel="hub"` (already a parameter); nothing else |
| `scheduler.py` `doctor` | `hub` check: enabled → backend reachable, connector key readable, id present |
| `templates/ORCHESTRATOR.section.md` | Rule text in 19.2 |
| `templates/claude-settings.json` | Deny `Read`/`Edit` of `~/.config/agent-hub/**` and `~/.local/share/agent-hub/**` (13.3) |
| `kitstart.py` | Start/stop the connector when `hub.enabled` |
| `config.json` template | `hub` block (5.1), `enabled: false` |
| `install.sh` | `agent-kit hub enable` → `agentctl enable` (convenience) |

## 11. Backend: data model and API

### 11.1 Data model (SQLite via drizzle; Postgres-compatible)

```sql
create table devices (            -- paired browsers/phones (13.1)
  id text primary key, name text not null, token_hash text not null,
  created_at text not null, last_used_at text, revoked_at text);

create table workspaces (
  id text primary key,            -- ws_... from config.json
  name text not null, path text, kit_version text,
  status text not null check (status in ('ONLINE','OFFLINE','STOPPED')),
  first_seen_at text not null, last_seen_at text, archived_at text);

create table workspace_sessions ( -- one per agent-kit start / connector run
  id text primary key, workspace_id text not null references workspaces(id),
  started_at text not null, ended_at text, end_reason text);  -- goodbye | timeout

create table snapshots (          -- latest only; overwritten
  workspace_id text primary key references workspaces(id),
  body text not null, hash text not null, received_at text not null);

create table runs (               -- denormalized from snapshots for history lists
  workspace_id text not null, run_id text not null,
  status text not null, created_at text, finished_at text, finish_result text,
  primary key (workspace_id, run_id));

create table events (
  workspace_id text not null, run_id text not null, n integer not null,
  kind text not null, body text not null, at text not null,
  primary key (workspace_id, run_id, n));

create table decisions (
  workspace_id text not null, run_id text not null, decision_id text not null,
  kind text not null, task_id text, agent text,          -- worker slot or 'orchestrator' (7.5)
  title text not null, question text not null,
  options text not null, followup text, recommend text,  -- JSON
  local_status text not null,       -- PENDING|ANSWERED|CANCELLED|DECIDED_BY_OPUS (scheduler's)
  hub_status text not null,         -- 7.4
  answer text,                      -- JSON from state: choice,label,note,channel,by,at,quote,followup
  consumed_by text, opened_at text not null, updated_at text not null, content_hash text not null,
  primary key (workspace_id, run_id, decision_id));

create table commands (            -- hub -> system queue
  id text primary key, workspace_id text not null references workspaces(id),
  type text not null check (type in ('answer','reply','prompt')),
  run_id text, decision_id text, body text not null,    -- JSON
  status text not null check (status in ('QUEUED','HELD','DELIVERED','REJECTED','FAILED','EXPIRED')),
  status_reason text, device_id text references devices(id),
  created_at text not null, delivered_at text, expires_at text not null);

create table documents (
  workspace_id text not null, path text not null,       -- workspace-relative
  run_id text, kind text not null, title text not null, format text not null,  -- markdown|diff
  content text not null, sha256 text not null, bytes integer not null, truncated integer not null,
  updated_at text not null, primary key (workspace_id, path));

create table audit_log (
  id integer primary key, workspace_id text, actor text not null,  -- device:<id> | connector | system
  action text not null, target text, detail text, at text not null);
```

The **history view** is `decisions` (answers with channel, quote and device) unioned with `commands`
(prompts, replies) and ordered by time. Indexes: `decisions(workspace_id, hub_status)`,
`commands(workspace_id, status)`, `events(workspace_id, at desc)`.

### 11.2 Connector API (header `Authorization: Bearer <connector key>`, `X-Agent-Hub-Protocol: 1`)

| Method & path | Body → result |
|---|---|
| `GET /api/v1/agent/ping` | → `{server_time, protocol}` |
| `POST /agent/hello` | `{workspace_id, name, path, kit_version, session_id}` → `{known, cursors: {run: n}, doc_hashes: {path: sha}}`; `409 duplicate_workspace` |
| `POST /agent/goodbye` | `{session_id, reason}` → `204` |
| `PUT /agent/workspaces/{ws}/snapshot` | snapshot.json → `204` (also heartbeat) |
| `POST /agent/workspaces/{ws}/heartbeat` | → `204` |
| `PUT /agent/workspaces/{ws}/decisions` | `{decisions: [...]}` (upsert by key; never overwrites a hub-side SENT unless the local status moved) → `204` |
| `POST /agent/workspaces/{ws}/events` | `{run_id, events: [...]}` (max 200) → `{cursor}` |
| `PUT /agent/workspaces/{ws}/documents` | `{documents: [{path, kind, title, format, sha256, content, truncated}]}` (max 5 MB per call) → `204` |
| `DELETE /agent/workspaces/{ws}/documents?path=` | file gone locally → kept in hub, marked deleted |
| `GET /agent/workspaces/{ws}/commands?wait=25` | → `{commands: [...]}`, `QUEUED`/`HELD` only, oldest first |
| `POST /agent/workspaces/{ws}/commands/{id}/ack` | `{status: DELIVERED|HELD|REJECTED|FAILED, reason?}` → `204` (repeatable) |

The connector key can't call user routes, so it can't create commands; it can only ack them.

### 11.3 User API (header `Authorization: Bearer <device token>`)

| Method & path | Purpose |
|---|---|
| `GET /api/v1/workspaces` | list: status, last seen, active run, open-decision count, problems |
| `GET /workspaces/{ws}` | snapshot + open decisions + recent history |
| `GET /workspaces/{ws}/decisions?status=&run=` | decisions |
| `POST /workspaces/{ws}/decisions/{run}/{id}/answer` | `{choice, note?, followup?, value?}` → command `answer`; `409` unless the decision is OPEN or REJECTED and the workspace ONLINE (offline: allowed, shown as "waiting for your computer"; see 18.4) |
| `POST /workspaces/{ws}/decisions/{run}/{id}/reply` | `{text}` → command `reply` |
| `POST /workspaces/{ws}/prompts` | `{text}` → command `prompt`; `409 workspace_not_online` |
| `GET /workspaces/{ws}/commands` | prompt/reply/answer statuses |
| `GET /workspaces/{ws}/documents` / `.../documents/content?path=` | list / one document |
| `GET /workspaces/{ws}/history?before=` | the history view, paged |
| `PATCH /workspaces/{ws}` | archive / rename display name |
| `GET /devices` / `DELETE /devices/{id}` | list / revoke paired devices |
| `GET /api/v1/stream` | Server-Sent Events: `workspace`, `snapshot`, `decision`, `command`, `document` changes; the UI refetches the affected piece |

There is deliberately no route to start, stop or run anything (R6).

### 11.4 Pairing (no passwords, no third-party login)

`agent-hub pair --name "phone"` on the computer prints a one-time 8-character code (and a QR code
encoding `<url>/#pair=<code>`), valid for 10 min. Entering it on a device returns a random 32-byte
device token (stored hashed; kept in the browser's local storage). Only someone at the computer can
pair a device, which matches R6's "the computer is in charge". Revoke from the UI or with
`agent-hub devices revoke <id>`.

## 12. Web UI

- **Workspaces overview**: one card per workspace (ONLINE first): name, status with "last seen",
  active run + status, **open decisions badge**, problems, kit outdated. STOPPED/OFFLINE cards are
  dimmed but open.
- **Workspace page**, in this order: Needs you (open decisions) · Orchestrator card (state, model,
  screen tail, prompt composer) · Workers (cards with their decisions inline) · Scout rounds · Runs
  (DAG, problems, final report) · Documents · History.
- **Decision screen** (7.5), **finish two-step**, **document reader** (Markdown + diff viewer),
  **history timeline** (filters: my answers / prompts / Opus routine calls).
- Global: offline/stopped banner ("This workspace isn't running. Start it on your computer with
  `agent-kit start`."), backend unreachable, empty states, device pairing, device list.
- Live: one SSE stream; falls back to polling every 10 s if SSE drops. Mobile-first (375 px), light
  and dark themes.
- Design brief for Claude Design: `plans/reports/claude-design-prompt-261028-1422-agent-hub-ui.md`
  (update it for workspaces, prompts and history before use).

## 13. Security

### 13.1 Network

- The backend binds `127.0.0.1` only. Phone access only through `tailscale serve` (tailnet-only
  HTTPS). Never a public tunnel or Funnel.
- CORS allowlist: the backend's own origin + the configured Vercel origin.
- Device tokens are sent as Bearer headers, not cookies. This works across origins without
  third-party cookies, and needs no CSRF tokens.
- Strict CSP on the UI. Markdown is sanitized and never rendered as raw HTML (a document is text a
  model wrote).

### 13.2 Two kinds of credentials

| Credential | Where | Can | Can't |
|---|---|---|---|
| Device token | browser storage of a paired device | read everything, answer, reply, prompt | push status |
| Connector key | `~/.config/agent-hub/connector.key` (0600), created by the backend on first start | hello, push status/decisions/documents, pull and ack commands | answer, reply, prompt, read other routes |

### 13.3 "Only I decide": honest limits

- The hub adds a real separation: an answer created in the hub needs a device token, which no
  process on the computer holds (only its hash is stored).
- But the backend runs on the same computer as the agents, so a determined agent with shell access
  could edit the SQLite file or the workspace state. Guardrails:
  - deny rules for the hub's directories (10.4);
  - the scheduler records the channel and device of every answer;
  - full audit log.
  
  These stop accidents and make misuse visible; they aren't cryptographic enforcement. That comes
  with a cloud backend and signed answers (3.3).
- The terminal chat stays a valid channel (`channel=chat`, with the user's quoted words), as today.
- A hub prompt has the same power as typing in the orchestrator's terminal. That is why only paired
  devices can send one, and why every prompt is logged with its device.

### 13.4 Later (cloud backend)

Ed25519-signed answers, verified by the connector with `ssh-keygen -Y verify` (standard library
stays enough), plus an opt-in `decisions.require_signed_for` that refuses `channel=chat` for chosen
kinds.

## 14. Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Backend down | No dashboard | Connector backs off; hub.json → offline; Opus uses AskUserQuestion; nothing lost (5.3) |
| Backend DB lost | Empty hub | Next hello of each workspace re-imports decisions, documents, prompt log |
| Connector crashes | Workspace shows OFFLINE after 90 s | Orchestrator and workers unaffected; restart with `agentctl watch` or `agent-kit continue`; answers wait as SENT |
| Workspace stopped | STOPPED, read-only | History and documents stay; prompts disabled; pending commands expire (prompts) or wait (answers) |
| Laptop sleeps | OFFLINE | Same as connector crash; resumes on wake |
| Answer in terminal and hub at once | Race | Scheduler lock; first wins; the other → ANSWERED_ELSEWHERE / REJECTED |
| Orchestrator has a dialog open | Prompt or answer notice can't be typed | HELD with reason; delivered when the dialog closes. Answers are already recorded; only the wake-up message waits |
| Claude session ended | Answer recorded, nobody acts | `resume` lists answered decisions; `agent-kit continue` |
| Invalid follow-up branch | REJECTED with the scheduler's reason | Fix it in the form, send again |
| Duplicate commands/acks | none | Command ids; the scheduler rejects a second answer |
| Copied workspace | duplicate id | `409`; `agentctl reset-id` |
| Huge diff / snapshot | Too large | Truncated with marker (1 MB doc, 256 KB snapshot) |
| Protocol mismatch | `426` | Update kit (`agent-kit update`) or hub; `agentctl status` shows both versions |

## 15. Claude Team plan, Remote Control and company policy

The phone and the web UI only ever talk to our own backend; they never touch Claude. So the only
link that matters for the Team plan is **connector → Herdr → the local Claude Code session**. That
is what H0 checks (section 16).

What the org pushes to this machine (checked 2026-10-28, `~/.claude/policy-limits.json` and
`remote-settings.json`):

| Setting | Value | Effect on the hub |
|---|---|---|
| `restrictions.allow_remote_control` | `false` | None: the hub doesn't use Remote Control or any Anthropic service |
| `allow_quick_web_setup`, `enforce_web_search_mcp_isolation` | `false` | None |
| hooks, permissions, Bash | not restricted (no managed-hooks-only, no deny rules) | The kit's hook and Herdr typing work |
| org hooks | `UserPromptSubmit` (prints project), `PreToolUse(Read)` running `.claude/hooks/scan-secrets.sh` | They run for hub-typed prompts too; harmless. The Read hook expects that script in each project |
| `env.HTTPS_PROXY` | corporate proxy, set for Claude Code | The connector only talks to `http://127.0.0.1`; it must bypass any proxy for loopback (`ProxyHandler({})`) |

- Technically nothing blocks the hub: Claude Code runs as a normal local session, and typing
  into its terminal through Herdr is what I do by hand. The H0 script proves it on this machine.
- If a later policy adds managed-hooks-only or Bash deny rules, the kit itself breaks first, and
  `doctor` should report it.
- **Policy is the real question.** If the admin turned Remote Control off on purpose, "control a
  Claude session from my phone" may be exactly what they meant to prevent. The hub doing it over a
  private tailnet doesn't change the intent. **Ask the admin before using the hub on work projects**,
  and before enabling phone access (H5). Laptop-only use (H2-H4, `127.0.0.1`, nothing leaves the
  computer) is the least likely to conflict.
- The workspace rules still apply (`WORKSPACE-SETUP.md` rule 7): check team policy before sending
  work code or text to any external service. With a local backend and tailnet-only access, no
  workspace data goes to Vercel, Tailscale's servers or Anthropic beyond what Claude Code already
  sends.

## 16. Implementation phases

Each phase ships on its own and can be run through the kit's own workflow. Names H0-H6 avoid clashing
with the kit's "phase 2/3" roadmap (phase 2 = this hub, phase 3 = codebase context and performance).

**H0: Herdr + Claude Team check (an hour, no code kept).** Only the link the Team plan could
affect: can a separate local process see and drive a Claude Code session through Herdr? Phone,
Tailscale and Vercel don't touch Claude, so they're checked in H5, not here.

Script: `plans/261028-1456-agent-hub-h0/h0-herdr-check.sh`, run from a terminal inside Herdr. It
starts its own throwaway Haiku session in a new Herdr workspace `hub-h0`, never touches other
agents, and closes the workspace at the end (`--keep` leaves it open to look at).

| Test | Checks | Pass means |
|---|---|---|
| T0 | Herdr server, `claude` binary, org policy, proxy | environment ready |
| T1 | `herdr workspace create` + `agent start --kind claude` | a Claude session starts under the Team login, outside Remote Control |
| T2 | `agent get` state + `agent read` screen | the connector can build snapshots |
| T3 | `agent prompt` into an idle session | hub prompts and answer notices are delivered and answered |
| T4 | `agent prompt` while it is working | whether typed input is queued (decides the `working` rule in section 8) |
| T5 | permission dialog → state `blocked` → `agent prompt` rejected with `agent_blocked` → `send-keys esc` | dialogs are detected, and nothing is typed into them (HELD rule) |

Already confirmed on 2026-10-28 without the script: herdr 0.9.5 lists live Claude agents with
`agent_status`; `agent get` returns `result.agent.agent_status`; `agent prompt` documents the
`agent_blocked` rejection.

**Result (2026-10-28, herdr 0.9.5, Claude Code 2.1.312, Claude Team with
`allow_remote_control=false`): 11 passed, 0 failed.**
- T1: a Claude session starts through Herdr under the Team login.
- T2: state and screen are readable.
- T3: a prompt into an idle session is delivered and answered.
- T4: a prompt typed while the session is working is queued and answered after the turn.
- T5: a permission dialog shows as `blocked`, Herdr rejects the prompt with `agent_blocked`, and
  `send-keys esc` closes the dialog (back to `idle`).

The Team policy doesn't block the hub's path into Claude Code. Section 8 delivers while working.

**H1: kit side, offline.**
- `log_event` `n`; `hub.json` hint in `decision ask`; `hub` config block; `agentctl enable`,
  `sync --dry-run`, the snapshot builder, the document scanner, the scrubber.
- JSON Schemas + fixtures in `hub/protocol/`.
- Acceptance: `sync --dry-run` output validates against the schemas; offline tests pass; the
  scheduler has no network code.

**H2: backend.**
- `agent-hub serve`, SQLite + migrations, connector API, pairing, user API, SSE, systemd user unit
  (`agent-hub install-service`).
- `agentctl watch` with status, decisions, documents and events (no commands yet).
- Acceptance: two workspaces show separately; kill a connector → OFFLINE in 90 s; restart the
  backend with an empty DB → everything comes back from the workspaces; stop the backend → workflow
  unaffected.

**H3: web UI, read-only.** Workspaces overview, workspace page (orchestrator, workers, scout, runs,
documents incl. final report rendering, history). Served by the backend on `127.0.0.1`.

**H4: decisions and prompts.**
- Answer / reply / prompt commands, connector delivery, the finish two-step, orchestrator rule
  changes (19.2), HELD handling.
- Acceptance, end to end with a fake worker:
  - a repair decision answered in the hub → recorded `channel=hub` → Opus is woken by `[hub]` →
    `repair --decision` → APPLIED;
  - "chat something..." text → Opus records it with the quote;
  - terminal answer first → ANSWERED_ELSEWHERE;
  - invalid branch → REJECTED → corrected → merged;
  - a prompt to a STOPPED workspace is refused.

**H5: phone access.** First check: `tailscale serve` on the work laptop (allowed, and working
through the corporate network?), a Vercel-hosted static page calling the tailnet URL from a phone
(CORS), and SSE through `tailscale serve`. Then: `tailscale serve` docs and doctor check, Vercel deploy of the UI
(`VITE_HUB_URL`), device pairing by QR, mobile polish, Web Push notifications for new decisions (title
and deep link only).

**H6 (optional).** Worker screen streaming, search across documents, metrics (time blocked,
decisions per run), cloud backend (3.3).

Rough size: kit/connector ~1,200 lines of Python + tests; backend ~1,500 lines of TS; UI ~2,500 lines
of TS.

## 17. Testing

- **Scheduler**: unit tests for event `n`, the `hub.json` hint, `channel=hub` answers (offline, temp
  git repos, as today).
- **Connector**: tests against a fake backend (`http.server`) and a fake Herdr covering:
  - hello/resync after DB loss;
  - backoff;
  - command ordering, HELD on `blocked`, REJECTED paths;
  - the scrubber, the secret-path refusal, truncation;
  - exit when the orchestrator agent disappears.
- **Protocol**: the same fixtures validated by zod (hub) and by the connector's minimal validator.
- **Backend**: route tests on a temp SQLite file covering:
  - a connector key can't answer or read user routes;
  - a device token can't push;
  - workspaces are isolated;
  - commands expire;
  - duplicate workspace ids are refused.
- **Web**: component tests for the decision form (options, recommendation, "chat something...",
  finish follow-up, REJECTED re-edit).
- **End to end**: `--launch none` run in a throwaway repo, a fake orchestrator pane, a scripted
  browser (agent-browser) answering through the UI.

## 18. Open questions

1. Is the hub allowed on work projects at all, given Remote Control is disabled by the admin
   (section 15)? Laptop-only first?
2. Tailscale allowed on the work laptop? If not, phone access needs another private network or waits.
3. Web Push vs. another notification channel (Slack/Telegram webhook) for H5.
4. Should an answer given while the workspace is OFFLINE be queued (delivered on next start), or
   refused? Default here: queued and visible as "waiting for your computer"; prompts are refused.
5. History retention: keep forever (default) or archive after N days?

## 19. Appendix

### 19.1 Protocol examples

```json
{"protocol": 1, "workspace_id": "ws_k3m9q2", "taken_at": "2026-10-28T08:04:05Z",
 "orchestrator": {"name": "orch-thrift-demo", "kind": "claude", "model": "claude-opus-5-5",
                  "effort": "high", "herdr_state": "idle", "screen": ["..."]},
 "workers": [{"slot": "worker-1", "status": "BUSY", "task": "T1", "run": "r4", "agent": "r4-worker-1",
              "herdr_state": "working", "since": "2026-10-28T07:52:00Z"}],
 "scout": {"rounds_used": 2, "max": 3, "readiness": "READY"},
 "runs": [{"run_id": "r4", "status": "RUNNING", "integration_branch": "agent/integration-r4",
           "tasks": [{"id": "T1", "title": "Limit name length", "status": "RUNNING", "worker": "worker-1",
                      "major_repairs": 0, "depends_on": []}],
           "problems": [{"task": "T2", "type": "FIX_REQUIRED", "since": "2026-10-28T07:58:00Z", "decision": "D3"}],
           "report": null}]}
```

```json
{"run_id": "r4", "decision_id": "D3", "kind": "repair", "task_id": "T2", "agent": "worker-2",
 "title": "T2: merge conflict in UserHandler.java",
 "question": "Cherry-pick of a1b2c3 conflicted with T1 at UserHandler.java:42 ...",
 "options": [{"key": "A", "label": "Repair: rebase T2 on T1's version"},
             {"key": "B", "label": "Drop T2's name change"}, {"key": "C", "label": "Stop T2"}],
 "recommend": "A", "followup": null, "local_status": "PENDING", "answer": null,
 "opened_at": "2026-10-28T08:00:00Z"}
```

```json
{"id": "cmd_7h2", "type": "answer", "run_id": "r4", "decision_id": "D3",
 "body": {"choice": "A", "note": "keep T1's message text"}, "device": "phone",
 "created_at": "2026-10-28T08:03:10Z"}
```

### 19.2 Orchestrator rule text (added to `templates/ORCHESTRATOR.section.md`)

> **Hub.** If `decision ask` returns `"hub": "online"`, ask in plain chat instead of a dialog: the
> title, what happened in 2-3 lines, the options as `A: ...` lines with your recommendation, and
> "Answer on the hub or reply here". Then end your turn. Messages that start with `[hub]` are typed by
> the hub connector on the user's behalf:
> - `[hub] D<n> answered by the user: ...`: the answer is already recorded (channel hub); don't
>   record it again; carry it out with `--decision D<n>`.
> - `[hub] reply to D<n>: "..."`: the user's own words; treat them like typed "Other" text (map
>   them to one option and record with `--quote` verbatim, or ask again).
> - `[hub] <anything else>`: a normal request from the user.
>
> Never send `[hub]` messages yourself, and never call the hub's API.
