# Agent Hub: web dashboard and remote decisions for the multi-agent workflow

Status: **not planned** (decided 2026-10-19). For a single user, Claude Code Remote Control covers
what this hub was for: notifications reach your phone, and you answer decisions in the Claude chat,
which Opus records with your exact words (`decision record --quote`). The `scripts/decide` terminal
tool this plan builds on has been removed. Kept for reference, e.g. if a team ever needs a shared
dashboard. A review on 2026-10-19 found it would need changes first: asymmetric answer signatures
(the HMAC key in 12.3 would sit on the same machine as the agent), the `finish` decision and its
branch question, long `decision wait` timeouts, and polling only while a decision is pending.

Contents
1. Summary and feasibility
2. Goals, non-goals, constraints
3. Architecture
4. The decision loop (core flow)
5. Problems and blockers: escalation policy
6. Live status: agents, tasks, blockers
7. Multi-project framework
8. Data model
9. API
10. Connector (`agentctl`) and kit integration
11. Dashboard UI
12. Security, privacy and enforcement
13. Notifications
14. Failure modes
15. Cost
16. Implementation phases
17. Testing
18. Open questions
19. Appendix: payload examples, CLAUDE.md rule text

---

## 1. Summary and feasibility

**Yes, the flow works.** When Opus needs your decision, it posts the question to a backend. You
open a web app (phone or laptop), see the question with options and Opus's recommendation, and
answer. The backend marks it answered, a small local process picks the answer up, and Claude
continues. The same app shows the worker pool, what each worker is doing, and every blocker.

How Claude receives the answer (the key mechanism):

1. Opus runs `agentctl ask ...`. That creates the decision locally (`scheduler.py decision ask`,
   as today) and pushes it to the hub.
2. Opus runs `scheduler.py decision wait --id D3` **in the background** (Claude Code's
   background Bash). Waiting costs no tokens: it is a local poll of the state file.
3. You answer in the web app. A local process, `agentctl watch` (running in a Herdr pane), polls
   the hub, sees the answer, verifies it, and records it with `decision answer --channel hub`.
4. The state file changes, so `decision wait` exits. Claude Code wakes Claude when a background
   command finishes, and Claude acts on the answer. Nothing is typed into Claude's terminal.

Why this shape: the hub never needs to reach into your machine (no inbound connections, no
tunnels). Everything is outbound HTTPS from your laptop. If the hub is down, `scripts/decide` in
a terminal still works, because the local decision system is the source of truth.

Limits to accept:
- Claude must be running (a live session in Herdr) to act on an answer. If the session ended, the
  answer waits in state, and `scheduler.py resume` shows "user answered D3: B; carry it out".
- Vercel serverless functions are short-lived, so the design uses short polling (every 5-10 s),
  not long-lived connections. For one user that is negligible load.
- A work project's details would leave your machine. Check company policy first (section 12).
  The design minimizes what is sent and can run self-hosted instead of on Vercel.

## 2. Goals, non-goals, constraints

Goals
- G1 Answer every decision (blockers, repairs, scope exceptions, abandon, worker approvals,
  questions) from a web UI. Answers flow back to the running workflow without touching the terminal.
- G2 See the live state per project: runs, tasks, the 3 worker slots, Herdr agent states, open
  problems, pending decisions.
- G3 Strict per-project separation, and one framework that every project plugs into the same way.
- G4 You stay the only one who can decide. Agents can ask but can never answer (section 12.3).
- G5 It must work offline: the workflow keeps working without the hub (terminal `decide`).

Non-goals (for now)
- Starting runs or writing task plans from the web.
- Showing source code or diffs by default (opt-in only, section 12).
- Multi-user teams and roles. Single owner first; the schema leaves room for more.
- Controlling Herdr panes from the web beyond answering worker approval prompts (phase 4).

Constraints
- Hosting: Vercel (as suggested). **Vercel's Hobby plan is for personal, non-commercial use, so
  work use needs a Pro plan, or self-hosting** (check Vercel's current terms).
- Local side: Python stdlib only (like `scheduler.py`), no daemon outside Herdr.
- The scheduler stays offline and deterministic. All network code lives in the connector.

## 3. Architecture

```text
 your laptop (per project workspace)                         cloud (one hub for all projects)
┌───────────────────────────────────────────────┐          ┌──────────────────────────────────┐
│ Herdr session                                 │          │ Agent Hub (Next.js on Vercel)    │
│  ├─ pane: Claude Opus (orchestrator)          │          │  ├─ Web UI (you, logged in)      │
│  │    asks: scheduler.py decision ask  ───┐   │          │  ├─ API /api/v1/...              │
│  │    waits: decision wait (background)   │   │          │  │   agent routes: project token │
│  ├─ panes: Codex worker-1..3              │   │          │  │   user routes: login session  │
│  └─ pane: agentctl watch  ◄───────────────┘   │  HTTPS   │  └─ Postgres (Neon via Vercel)   │
│        ├─ reads .orchestrator/ state + outbox ├────────► │      projects, snapshots,        │
│        ├─ reads herdr agent list              │  (out-   │      decisions, answers, audit   │
│        ├─ pushes snapshots / decisions        │  bound   │                                  │
│        └─ pulls answers -> decision answer    │  only)   │  optional: web push / email /    │
│             --channel hub (verified)          │ ◄─────── │  Slack notification              │
└───────────────────────────────────────────────┘          └──────────────────────────────────┘
                                                                 ▲
                                                 you, any browser│ (approve / choose / note)
```

Components
| Component | Where | Responsibility |
|---|---|---|
| `scheduler.py` decisions | kit (exists) | Source of truth: create, record answer, gate commands |
| `scheduler.py` outbox | kit (new) | Append-only `.orchestrator/outbox.jsonl` of events; no network |
| `agentctl` | kit (new, `.agent-system/agentctl.py`) | Register project, push events/snapshots, pull answers, verify, record |
| `agentctl watch` | a Herdr pane per workspace | Loop: push every ~10 s or on change, pull answers every 5 s |
| Agent Hub | Vercel | Store, show, notify, collect answers |
| Protocol package | hub repo | Versioned JSON Schemas shared by hub and connector |

## 4. The decision loop (core flow)

### 4.1 Sequence

```text
Opus            scheduler.py         agentctl watch           Hub API              You (web)
 │ decision ask      │                     │                     │                     │
 ├──────────────────►│ D3 PENDING          │                     │                     │
 │                   ├─ outbox: decision.opened                  │                     │
 │ decision wait (bg)│                     │                     │                     │
 ├──────────────────►│ polls state         │ reads outbox        │                     │
 │                   │                     ├── POST /decisions ─►│ store, notify ─────►│
 │   (Claude idle,   │                     │                     │                     │ opens app
 │    no tokens)     │                     │                     │◄── POST answer ─────┤ picks B + note
 │                   │                     ├── GET answers ─────►│                     │
 │                   │                     │◄── D3: B (signed) ──┤                     │
 │                   │◄ decision answer    │ verify signature,   │                     │
 │                   │  --channel hub      │ project, decision   │                     │
 │                   │ D3 ANSWERED         ├── POST ack ────────►│ status DELIVERED    │
 │◄ wait exits ──────┤                     │                     │                     │
 │ carries out B,    │                     │                     │                     │
 │ e.g. repair --decision D3               │                     │                     │
 │                   ├─ outbox: decision.used ─► push ──────────►│ status APPLIED ────►│ sees "applied"
```

### 4.2 Decision states

Local (scheduler, exists): `PENDING -> ANSWERED -> (consumed_by set)` or `PENDING -> CANCELLED`.

Hub: `OPEN -> ANSWERED -> DELIVERED -> APPLIED`, plus `CANCELLED` and `EXPIRED`.

| Hub state | Meaning | Set by |
|---|---|---|
| OPEN | waiting for you | connector push of `decision.opened` |
| ANSWERED | you answered in the web app | user route |
| DELIVERED | the local scheduler recorded it | connector ack |
| APPLIED | a gated command used it (`consumed_by`) | connector push of `decision.used` |
| CANCELLED | Opus withdrew it, or it was answered in the terminal first | connector |
| EXPIRED | optional deadline passed (default none) | hub job |

Rules:
- **First answer wins.** Locally, `decision answer` only accepts PENDING. If you answer in the
  terminal first, the connector sends `decision.answered(channel=terminal)` and the hub shows it as
  answered elsewhere, read-only. If both race, the local scheduler decides. The hub answer is then
  reported as rejected ("already answered in terminal") and shown in the UI.
- **Idempotent everywhere.** Decision identity = `(project_id, run_id, decision_id)`. Pushes are
  upserts, the answer endpoint uses a conditional update `WHERE status='OPEN'`, and acks are
  repeatable.
- **The answer is immutable once delivered.** To change your mind, Opus opens a new decision.

### 4.3 Decision kinds and their answers

| Kind | Typical trigger | Options | Gated command |
|---|---|---|---|
| `blocker` | task BLOCKED, ambiguous collect, failed final gate | e.g. A narrow scope / B provide info (note) / C stop task | `task-unblock` |
| `repair` | review MAJOR_FIX, integration conflict, post-merge failure | A repair as proposed / B different fix (note) / C stop | `repair` |
| `scope_exception` | changes outside owned paths | A accept / B reject and repair | `commit-task --allow-outside`, `mark-reviewed --accept-scope` |
| `abandon` | Opus proposes giving up a task or run | A stop / B keep trying (note) | `mark-reviewed FAIL`, `run close` |
| `worker_approval` | Codex shows an approval prompt (Herdr `blocked`) | A approve once / B deny | policy now; phase 4 sends the keys |
| `question` | ambiguous requirement, plan change | free options | policy only |

Every option has `key` (A, B, ...) and `label`. The answer always allows a free-text `note`,
which Opus must read and follow.

### 4.4 What Opus writes in a decision (quality bar)

The UI must make a decision answerable in about 30 seconds without opening code:
- **title**: one line, the decision itself ("T2 hit a merge conflict in UserHandler.java").
- **question**: what happened (2-3 lines), the evidence (command + exit code, file:line), and
  what each option leads to.
- **options**: 2-4, mutually exclusive, concrete. One marked `recommend`.
- Optional **context links**: task file, diff stat, logs. Uploaded only if allowed (section 12.2).

## 5. Problems and blockers: escalation policy

Already enforced locally (2026-10-16), and the hub only adds a channel. **Only critical
decisions reach you.** Routine ones (both fix rounds with clear evidence, minor fixes, relaunches,
plan-step corrections) are Opus's call, recorded as `DECIDED_BY_OPUS` with a reason. The hub shows
them in the activity feed for audit, but they never wait for you. The split is described in
`templates/ORCHESTRATOR.section.md` and configured by `decisions.require_user_for` +
`decisions.routine_repairs`.

1. **Detection** (scheduler, deterministic): a task enters BLOCKED or FIX_REQUIRED; `collect`
   returns ambiguous; `integrate` hits a conflict or post-merge failure; `verify` fails; `wait`
   sees a Herdr agent `blocked`. `resume`/`status` list each one as an open problem.
2. **Escalation** (Opus, by rule in `CLAUDE.md`): open a decision of the right kind with options
   and a recommendation. Never resolve it alone.
3. **Hold** (scheduler, enforced): critical actions (`task-unblock`, `run close`,
   `commit-task --allow-outside`, `mark-reviewed --accept-scope|FAIL`) refuse to run without an
   answered, unused decision of the matching kind for that task. Routine ones need Opus's reason.
4. **Answer** (you): `scripts/decide` in a terminal today. Later also the web app.
5. **Act** (Opus): carry out exactly the chosen option, passing `--decision D<n>`.
6. **Record**: question, answer and use are appended to the task file in `gen-tasks/`, written to
   `.orchestrator/runs/<run>/decisions/D<n>.md`, and logged in state events.

Configurable per project: `config.json` -> `decisions.require_user_for` (critical kinds; default
all four) and `decisions.routine_repairs` (default 2; 0 sends every fix round to you).

The hub shows problems even before Opus opens a decision (from snapshots), so a stalled run is
visible ("T2 BLOCKED for 14 min, no decision opened").

## 6. Live status: agents, tasks, blockers

`agentctl watch` builds a **snapshot** every ~10 s (and immediately on outbox events) from:
- `.orchestrator/runs/*/state.json`: runs, tasks (status, worker, attempts, repairs), workers
  (IDLE/BUSY/BLOCKED/BROKEN), decisions, verify result;
- `herdr agent list` (JSON): live agent state per worker (`idle|working|blocked|done|unknown`);
- optional: last 20 lines of a blocked agent's screen (`herdr agent read`), only if allowed.

It sends a snapshot only when it differs from the last one (hash), plus a heartbeat every 60 s.
If no heartbeat arrives for 3 minutes, the hub marks the project "connector offline".

The snapshot is the whole truth for the dashboard: the hub overwrites the previous snapshot rather
than replaying events, so missed events never leave the UI wrong. Events are for the activity feed
and notifications.

## 7. Multi-project framework

### 7.1 Identity and isolation

- **Project** = one workspace (`<repo>.workspace`, see `WORKSPACE-SETUP.md`). Hub `project.slug`
  defaults to the repo name, so the 3 slots of project A and project B never mix.
- **One project token per project**, created at registration, shown once, stored on your machine
  in `~/.config/agent-hub/credentials.json` (mode 600) keyed by project id. Never in the workspace,
  never in git.
- A project token can only: push snapshots/events for its project, read answers for its project,
  ack them. **It cannot answer decisions.** Answering requires your logged-in browser session.
- Every DB row carries `project_id`. Every query is scoped by it, enforced in one data-access layer
  (and optionally Postgres row-level security).

### 7.2 Onboarding a project (3 commands)

```bash
cd ~/Code/thrift-demo.workspace
python3 .agent-system/agentctl.py login https://agent-hub.example.com   # once per machine (device code)
python3 .agent-system/agentctl.py project register --name thrift-demo   # creates project + token
python3 .agent-system/agentctl.py doctor                                # connectivity, token, clock skew
```

`project register` writes, into the workspace's `.agent-system/config.json`:
```json
"hub": {"url": "https://agent-hub.example.com", "project_id": "prj_7f3c...", "enabled": true,
        "upload": {"task_files": false, "diffs": false, "agent_screens": false}}
```
No secret goes in the config, only the project id. The token is looked up from the credentials file.

`login` uses an OAuth-style device flow: the CLI shows a code, you approve it in the browser, and
the CLI gets a short-lived machine credential that is allowed to register projects. Then run
`agentctl watch` in a Herdr pane, or let `install.sh` add it to a Herdr layout.

### 7.3 Keeping every project in sync with the framework

- The connector and protocol are **part of the kit**. `install.sh` updates them in every
  workspace like the rest of the kit, so all projects run the same code.
- **Protocol versioning**: every request carries `X-Agent-Hub-Protocol: 1`. The hub supports the
  current and previous major versions and answers `426 Upgrade Required` with a message for
  anything older. `agentctl doctor` shows the version gap.
- **Schemas live in one place**: `agent-hub/packages/protocol/schemas/*.json` (JSON Schema).
  The hub validates with zod generated from them. The Python connector validates minimally and
  has contract tests against the same files.
- **Kit version** is reported in every snapshot (`kit_version`, the kit's git commit), so the
  dashboard shows which projects run an outdated kit.

### 7.4 Hub repository layout

```text
agent-hub/
├── apps/web/                      # Next.js (App Router, TypeScript), deployed to Vercel
│   ├── app/(auth)/login/
│   ├── app/(dash)/page.tsx                         # all projects overview
│   ├── app/(dash)/p/[slug]/page.tsx                # project: pool, runs, problems
│   ├── app/(dash)/p/[slug]/decisions/[id]/page.tsx # one decision, answer form
│   ├── app/(dash)/p/[slug]/runs/[runId]/page.tsx   # run detail: tasks DAG, timeline
│   ├── app/api/v1/agent/...                        # project-token routes (connector)
│   ├── app/api/v1/user/...                         # session routes (UI)
│   ├── app/api/v1/device/...                       # device login flow
│   └── lib/{db,auth,authz,schema,sign,notify}.ts
├── packages/protocol/schemas/     # snapshot.json, event.json, decision.json, answer.json
├── db/migrations/                 # SQL migrations (drizzle-kit or plain SQL)
└── docs/
```

Stack choices (all current stable versions at build time): Next.js on Vercel; Postgres via the
Vercel Marketplace (Neon); Auth.js with GitHub or Google sign-in **restricted to an allowlist
of your email**; zod; drizzle ORM. Swap Postgres for Upstash Redis only if you want fewer moving
parts, but relational data (decisions, audit) fits Postgres better.

## 8. Data model

```sql
create table users (
  id text primary key, email text unique not null, created_at timestamptz default now());

create table projects (
  id text primary key,                 -- prj_<random>
  owner_id text not null references users(id),
  slug text not null, name text not null,
  created_at timestamptz default now(), archived_at timestamptz,
  unique (owner_id, slug));

create table project_tokens (
  id text primary key, project_id text not null references projects(id),
  token_hash text not null,            -- sha256 of the token; plaintext shown once
  created_at timestamptz default now(), last_used_at timestamptz, revoked_at timestamptz);

create table snapshots (               -- latest per project; history optional
  project_id text primary key references projects(id),
  protocol int not null, kit_version text, body jsonb not null,  -- validated snapshot.json
  received_at timestamptz default now());

create table events (                  -- activity feed + notifications; idempotent by (project, seq)
  project_id text not null references projects(id),
  seq bigint not null,                 -- connector's outbox sequence
  type text not null, run_id text, task_id text, body jsonb not null,
  occurred_at timestamptz not null, received_at timestamptz default now(),
  primary key (project_id, seq));

create table decisions (
  project_id text not null references projects(id),
  run_id text not null, decision_id text not null,     -- D3 (scheduler id)
  kind text not null, task_id text,
  title text not null, question text not null,
  options jsonb not null,             -- [{key,label}]
  recommend text,
  status text not null check (status in ('OPEN','ANSWERED','DELIVERED','APPLIED','CANCELLED','EXPIRED')),
  opened_at timestamptz not null, expires_at timestamptz,
  answer_choice text, answer_note text, answered_by text references users(id), answered_at timestamptz,
  answer_sig text,                    -- HMAC, see 12.3
  delivered_at timestamptz, applied_at timestamptz, applied_by_action text,
  closed_reason text,
  primary key (project_id, run_id, decision_id));

create table attachments (            -- opt-in uploads: task files, diffs, screen captures
  id text primary key, project_id text not null references projects(id),
  run_id text, task_id text, decision_id text,
  kind text not null check (kind in ('task_file','diff','agent_screen','log')),
  content text not null, sha256 text not null, bytes int not null,
  created_at timestamptz default now(), expires_at timestamptz not null);   -- default 14 days

create table audit_log (
  id bigserial primary key, project_id text, actor text not null,     -- user:<id> | token:<id>
  action text not null, target text, detail jsonb, at timestamptz default now(), ip inet);
```

Indexes: `decisions (project_id, status)`, `events (project_id, received_at desc)`.

## 9. API

Base `https://<hub>/api/v1`. JSON only. Errors: `{"error": {"code": "...", "message": "..."}}`.
Every request carries `X-Agent-Hub-Protocol: 1`.

### 9.1 Connector routes (header `Authorization: Bearer <project token>`)

| Method & path | Body | Returns | Notes |
|---|---|---|---|
| `POST /agent/snapshot` | snapshot.json | `204` | upsert latest; `409` if `project_id` mismatches token |
| `POST /agent/events` | `{"events": [event, ...]}` (max 100) | `{"acked_seq": n}` | idempotent by `seq` |
| `PUT /agent/decisions/{run}/{id}` | decision.json | `200` + hub status | upsert; never overwrites an answer |
| `POST /agent/decisions/{run}/{id}/cancel` | `{"reason": "..."}` | `200` | only from OPEN |
| `GET /agent/answers?since=<cursor>` | none | `{"answers": [answer...], "cursor": "..."}` | ANSWERED, not yet DELIVERED |
| `POST /agent/decisions/{run}/{id}/ack` | `{"status": "DELIVERED"\|"REJECTED", "reason"?}` | `200` | REJECTED if already answered locally |
| `POST /agent/decisions/{run}/{id}/applied` | `{"action": "repair"}` | `200` | from `decision.used` event |
| `POST /agent/attachments` | `{kind, run_id, task_id, decision_id, content}` | `{"id"}` | only if enabled in project upload settings; max 256 KB |
| `GET /agent/ping` | none | `{"project_id", "server_time"}` | doctor, clock skew |

Rate limits per token: 60 requests/min (burst 20). The connector backs off on `429`.

### 9.2 User routes (browser session cookie; CSRF token on writes)

| Method & path | Purpose |
|---|---|
| `GET /user/projects` | list projects with health (last heartbeat, open decisions, problems) |
| `GET /user/projects/{slug}` | latest snapshot + open decisions + recent events |
| `GET /user/projects/{slug}/decisions?status=OPEN` | inbox |
| `POST /user/projects/{slug}/decisions/{run}/{id}/answer` | `{"choice": "B", "note": "..."}` -> ANSWERED (conditional on OPEN) |
| `POST /user/projects` / `POST .../tokens` / `DELETE .../tokens/{id}` | manage projects and tokens |
| `PATCH /user/projects/{slug}/settings` | upload switches, notification prefs |

### 9.3 Device login (`agentctl login`)
`POST /device/code` -> `{device_code, user_code, verification_url}`; you open the URL and confirm
the code; the CLI polls `POST /device/token` -> machine credential (30-day expiry), used only
for `project register`.

## 10. Connector (`agentctl`) and kit integration

### 10.1 Scheduler outbox (new, offline)
`log_event` (already called on every state change) also appends hub-relevant events to
`.orchestrator/outbox.jsonl` with a monotonically increasing `seq` (stored in
`.orchestrator/outbox.seq`, written under the existing scheduler lock):
`run.created, run.closed, task.transition, worker.transition, decision.opened,
decision.answered, decision.cancelled, decision.used, integrate.result, verify.result`.
The scheduler never makes network calls, and tests stay offline.

### 10.2 `agentctl` commands
| Command | Does |
|---|---|
| `login <url>` | device flow, stores machine credential |
| `project register --name N` | creates project + token, writes `hub` block into config |
| `watch [--interval 5]` | the loop below; meant for a Herdr pane |
| `push` / `pull` | one iteration each (debugging) |
| `doctor` | URL, token, protocol version, clock skew, outbox backlog |
| `token rotate` | new token, revoke old |

`watch` loop:
1. Read new outbox lines since the last acked `seq` and `POST /agent/events`. For each
   `decision.opened` also `PUT` the decision; for `decision.cancelled|used|answered(terminal)`
   update the hub.
2. Every 10 s or on change: build the snapshot, and `POST` it if its hash changed. Heartbeat every 60 s.
3. Every 5 s: `GET /agent/answers`. For each answer:
   a. verify `answer_sig` (12.3) and that `project_id`, `run_id`, `decision_id`, `choice` match a
      local PENDING decision with that option;
   b. call `Scheduler.decision_answer(run, id, choice, note, channel="hub", by=answered_by)` in-process;
   c. ack DELIVERED, or REJECTED with reason (already answered, unknown option, bad signature).
4. On network errors: exponential backoff up to 60 s. The outbox keeps everything, so nothing is lost.

### 10.3 Claude's side
Nothing new for Claude to learn: it still uses `decision ask` and `decision wait`. The hub is
invisible to Opus, and answers simply arrive. Opus's one-line message to you becomes "Decision D3
waiting (web or `decide`)".

## 11. Dashboard UI

Pages (mobile-first, decisions reachable in two taps from a notification):

```text
┌ Projects ───────────────────────────────────────────┐
│ thrift-demo      ● online   run r4 RUNNING   2 open │  <- red badge = open decisions
│ billing-api      ○ offline 3h  no active run        │
└─────────────────────────────────────────────────────┘

┌ thrift-demo ─────────────────────────────── r4 RUNNING ┐
│ NEEDS YOU (2)                                           │
│  D3 repair   T2: merge conflict in UserHandler.java  >  │
│  D4 approval worker-3 wants to run `./gradlew build` >  │
│ WORKER POOL                                             │
│  worker-1  BUSY  T1  working   12m                      │
│  worker-2  BUSY  T2  idle      FIX_REQUIRED             │
│  worker-3  BUSY  T3  blocked   approval prompt          │
│ TASKS  T1 RUNNING → T2 FIX_REQUIRED → T3 RUNNING (DAG)  │
│ PROBLEMS  T2 FIX_REQUIRED 6m (decision D3 open)         │
│ ACTIVITY  12:04 T1 collected · 11:58 D2 answered (B) …  │
└─────────────────────────────────────────────────────────┘

┌ D3 · repair · task T2 ─────────────────────────────────┐
│ T2: merge conflict in UserHandler.java                  │
│ What happened: cherry-pick of a1b2c3 conflicted with    │
│ T1's change at UserHandler.java:42 (both edit the name  │
│ check). Post-merge tests not run.                       │
│ ( ) A  Repair: rebase T2 on T1's version  ★ recommended │
│ ( ) B  Drop T2's name change, keep only the email part  │
│ ( ) C  Stop T2, I'll handle it                          │
│ Note for Opus: [________________________]               │
│ [ Submit decision ]       Task file ▸  Diff stat ▸      │
└─────────────────────────────────────────────────────────┘
```

Behaviors: poll every 5 s while visible (SWR `refreshInterval`). After submitting, the decision
shows "answered: waiting for your machine", then "delivered", then "applied". A
"connector offline" banner explains that the answer will be delivered when the laptop is back.

## 12. Security, privacy and enforcement

### 12.1 Company policy first
Before any work project connects: confirm the hub (Vercel + Neon, US/EU region) is allowed to hold
project names, task titles and decision text. If not, self-host the same Next.js app on an
internal server (it runs anywhere Node runs), or keep using terminal `decide` only.

### 12.2 Data minimization
- Default upload: run/task ids, statuses, titles, worker states, decision title/question/options,
  timestamps. **No code, diffs, task files or agent screens** unless enabled per project
  (`hub.upload.*`), and then capped (256 KB) and expired (14 days).
- The connector runs a **secret scrubber** on every string before upload (same patterns as
  Codex's redaction: `sk-...`, `AKIA...`, `Bearer ...`, `password=...`, PEM blocks), and refuses
  attachments from paths matching `SECRET_PATTERNS`.
- Opus's rule: never put secrets or customer data in decision text.

### 12.3 Only you can decide (enforcement)
Local today (layered guardrails, honest about limits):
1. Claude Code deny rules (`.claude/settings.json`) block `scripts/decide` / `decision answer`
   and edits to `state.json` and decision files.
2. `decision answer` refuses when `CLAUDECODE` is set or stdin is not a terminal.
3. The `CLAUDE.md` rule forbids answering or routing around a refusal; every answer is logged
   with channel, user and time and appended to the task file.
A determined agent with shell access could still bypass local guardrails (e.g. rewrite the
state file with an unusual command). These layers stop accidents and make misuse visible.

With the hub (real enforcement):
4. The hub signs each answer: `answer_sig = HMAC-SHA256(answer_key, project_id|run_id|decision_id|choice|note|answered_at)`.
   `answer_key` is a per-project secret given to the connector at registration and stored only
   in `~/.config/agent-hub/credentials.json`.
5. With `decisions.channel: "hub"` in config, `decision answer --channel hub` requires a valid
   signature, and the scheduler stores it with the answer. The gate (`_require_decision`)
   re-verifies it before allowing a command. Claude has no browser session, so it cannot create a
   signed answer. Keep `credentials.json` out of Claude's reach: add
   `Read(~/.config/agent-hub/**)` to the deny rules.
6. The terminal channel stays available as a fallback, logged as `channel=terminal`.

### 12.4 Web security
Auth.js with an email allowlist; HTTP-only secure cookies; CSRF tokens on POST; tokens stored
hashed; per-token rate limits; full audit log; HSTS; no third-party scripts on decision pages.
Project tokens are revocable instantly from the UI.

## 13. Notifications
Phase 2+: when a decision opens, notify via one of: Web Push (PWA, no third party), email
(Resend/SES), Slack/Telegram webhook. The notification holds only the title and a deep link, never
the question body. Quiet hours and per-project mute.

## 14. Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Laptop offline / connector stopped | No updates; answers wait in hub | Banner "connector offline"; delivered on reconnect; terminal `decide` still works |
| Hub down | No dashboard | Outbox buffers; terminal `decide`; Opus unaffected |
| Answer in terminal and web at once | Race | Local first-answer wins; hub answer REJECTED and shown |
| Claude session ended | Answer recorded, not acted on | `resume` lists "user answered D3: B; carry it out" |
| Duplicate push/answer/ack | none | Idempotent keys and conditional updates |
| Token leaked | Attacker can read status and push fake status, but cannot answer | Revoke + rotate; signature check stops forged answers |
| Clock skew | Signature timestamps off | Server time from `/agent/ping`; tolerance 10 min |
| Snapshot too big | `413` | Cap at 256 KB; drop optional fields first |
| Protocol mismatch | `426` | `agentctl doctor` explains; update the kit with `install.sh` |

## 15. Cost
- Tokens: none for waiting. Background `decision wait` and `agentctl watch` are plain local and
  HTTP loops. Claude only spends tokens when it wakes up to act on an answer, which it would do
  anyway.
- Hosting: Vercel Pro (required for work use) plus the Neon free/low tier. Polling at 5 s from one
  connector is about 17k requests/day per active project, small but worth knowing. Adaptive polling
  (5 s while a decision is open, 30 s otherwise) cuts that by about 80%.

## 16. Implementation phases

Each phase is shippable and can be run through the multi-agent workflow itself.

**Phase 0: local foundation (DONE 2026-10-16).** Decisions, gates, `decide`, deny rules,
task-file records, `resume` problems.

**Phase 1: outbox + connector skeleton (local only).**
- Scheduler outbox (10.1) with tests (sequence, lock, no network).
- `agentctl push --dry-run` prints snapshot/events. Snapshot builder from state + `herdr agent list`.
- Acceptance: the snapshot validates against `snapshot.json`; offline tests pass; no network calls in the scheduler.

**Phase 2: hub MVP (read-only dashboard).**
- Next.js app, Auth.js allowlist, Postgres schema, project + token management, `POST snapshot`, `POST events`.
- Pages: projects, project detail (pool, tasks, problems, activity).
- `agentctl login`, `project register`, `watch` (push only), `doctor`.
- Acceptance: two projects shown separately; killing the connector shows offline within 3 min.

**Phase 3: decisions from the web.**
- Decision upsert/cancel/answers/ack/applied routes; answer form; signature (12.3) and
  `channel: hub` verification in the scheduler gate.
- Acceptance: end to end with a fake worker: Opus opens a repair decision -> you answer on phone
  -> `decision wait` exits -> `repair --decision` succeeds -> hub shows APPLIED. A forged answer
  (bad signature) is rejected and audited. A terminal answer first means the web shows "answered
  elsewhere".

**Phase 4: worker approvals and notifications.**
- Blocked Codex agent -> `worker_approval` decision with the last screen lines (opt-in) ->
  on answer, Opus (or the connector, behind a flag) sends the exact keystroke via
  `herdr agent send-keys`, then confirms the agent left `blocked`. Needs careful prompt-to-key
  mapping per Codex version; start with "approve once / deny" only.
- Web push or Slack notifications; adaptive polling.

**Phase 5 (optional).** Attachments (task files, diff viewer); history and metrics (time blocked
per task, decisions per run); multi-user read-only sharing.

## 17. Testing
- Scheduler: unit tests for outbox and signed-answer gate (offline, temp git repos, like today).
- Connector: tests against a fake hub (local `http.server`) covering retries, idempotency, races,
  signature failures, and scrubbing.
- Protocol: contract tests. The same JSON fixtures are validated by zod (hub) and Python (connector).
- Hub: route tests with a test database; authz tests that a project token can never answer and
  cannot read another project's data.
- End to end: `--launch none` run in a throwaway repo (as used to validate the kit), with a scripted
  browser answering via the user API.

## 18. Open questions
1. Is Vercel allowed for work data, or should the hub be self-hosted?
2. Which notification channel do you actually look at (phone push, Slack, email)?
3. Should `worker_approval` ever be auto-answerable for an allowlist (e.g. `./gradlew test`)? The
   default is no.
4. Keep decision history forever, or expire after N days?
5. One hub for personal and work projects, or two separate deployments?

## 19. Appendix

### 19.1 snapshot.json (example)
```json
{"protocol": 1, "project_id": "prj_7f3c", "kit_version": "ef4c516", "taken_at": "2026-10-16T12:04:05Z",
 "runs": [{"run_id": "r4", "status": "RUNNING", "integration_branch": "agent/integration-r4",
   "tasks": [{"id": "T1", "title": "Limit name length", "status": "RUNNING", "worker": "worker-1",
              "attempts": 1, "major_repairs": 0, "depends_on": []}],
   "problems": [{"task": "T2", "type": "FIX_REQUIRED", "since": "2026-10-16T11:58:00Z", "decision": "D3"}]}],
 "workers": [{"slot": "worker-1", "status": "BUSY", "task": "T1", "run": "r4",
              "herdr": {"agent": "worker-1-r4", "state": "working"}}],
 "decisions_open": ["r4/D3"]}
```

### 19.2 decision.json / answer.json
```json
{"run_id": "r4", "decision_id": "D3", "kind": "repair", "task_id": "T2",
 "title": "T2: merge conflict in UserHandler.java",
 "question": "Cherry-pick of a1b2c3 conflicted with T1 at UserHandler.java:42 ...",
 "options": [{"key": "A", "label": "Repair: rebase T2 on T1's version"},
             {"key": "B", "label": "Drop T2's name change"}, {"key": "C", "label": "Stop T2"}],
 "recommend": "A", "opened_at": "2026-10-16T12:00:00Z"}
```
```json
{"run_id": "r4", "decision_id": "D3", "choice": "A", "note": "keep T1's message text",
 "answered_by": "usr_1", "answered_at": "2026-10-16T12:03:10Z", "answer_sig": "hmac-sha256:..."}
```

### 19.3 CLAUDE.md rule text (already installed; hub adds nothing for Opus)
See `templates/ORCHESTRATOR.section.md`, section "The user holds every decision about problems".
