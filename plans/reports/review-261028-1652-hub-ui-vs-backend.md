# Hub UI (docs/agent-hub-web) vs backend/protocol v1: gaps and feasibility

Date 2026-10-28. UI: React 19 + Vite + react-router 7, ~8.2k lines, mock + HTTP clients behind
`HubClient`/`AuthClient` interfaces. Backend: `hub/server` (run hub1). Verdict: **all doable**; one
infra item (internet reach) needs a choice.

## 1. Runs: what exists today

| Question | Today | Change |
|---|---|---|
| Does 1 prompt = 1 run? | No. A run exists only when Opus calls `run create` for non-trivial work handed to workers. Trivial prompts are done by Opus directly, so no run. Prompt shows only as a `prompt` history item / command. | Keep. Optionally hide `prompt` items from History by default (filter). |
| Does backend save runs? | Partly. `runs` table, but each snapshot **deletes all runs of the workspace and re-inserts** the snapshot's runs (db.ts:202). Local run deleted / past 200 / trimmed by 256 KB cap → gone from hub. | Upsert by (workspace, run_id), never delete on snapshot. Runs + tasks kept permanently (retention later). |
| Tasks saved per run? | Yes, inside run `body` JSON (id, title, status, worker, deps, repairs, owned_paths, packet). | Promote to a `tasks` table only if we need queries; JSON is fine for now. |
| Run name / description | None. `run_id` free text (e.g. `hub1`), no title, no goal. | Add `title` (≤ 80) + `goal` (the user's request, ≤ 500) to `run create` input and state; validate run id `^[a-z0-9][a-z0-9-]{1,39}$`. |
| Task name / description | `title` only, free form. | Enforce title format (imperative, ≤ 60, no trailing period) and add required `summary` (1-2 sentences, ≤ 300) in `validate_tasks`. Snapshot `Task` gains `summary`. |

## 2. Workspace list: 15 days

Backend lists all workspaces. Change `GET /workspaces`: show ONLINE always, others only when
`last_seen_at` ≥ now − 15 d (env `AGENT_HUB_RECENT_DAYS`, default 15). Older ones hidden, not deleted
(they reappear when started). UI drops its own `archived` filter or keeps it as-is.

## 3. Authentication (replaces device pairing)

| Item | Plan |
|---|---|
| Users | `users(id, username, password_hash, must_change, created_at)`. Hash with `node:crypto` scrypt (no deps; argon2/bcrypt would add native deps). |
| Create | Only on the computer: `agent-hub user add <name>` (prints a default password once, `must_change=1`), `agent-hub user passwd <name>` (local reset). No register route. |
| Sessions | `POST /api/v1/auth/login {username,password,remember}` → `{token, expires_at, username, must_change}`; `POST /auth/logout`; `POST /auth/password {current,new}`. Token 32 B random, stored as sha256, 30 d with remember else 12 h. Login rate limit (5/min per IP+user). |
| Workspace ↔ user | `workspaces.user_id`. Each user gets a connector key (`agent-hub user add` writes `~/.config/agent-hub/connector-<user>.key`, or one key per user selected in kit config `hub.user`). Hello binds the workspace to the key's user. Every user route filters by `user_id`. |
| Removed | `devices`, `pair_codes`, `/pair`, `agent-hub pair`, PairRequest/Response, Device in history (`device` field → `null` or the session's user agent label). |
| UI | Login page exists. Add: forced "change password" screen when `must_change`, and a "Change password" item in AccountMenu. Update login text (no pairing). |

## 4. Hosting on Vercel: the real blocker to plan for

Vercel serves only static files; the browser calls the backend directly. The backend runs on your
computer at 127.0.0.1, so from a phone / another network it must be reachable over **public HTTPS**
(an https page cannot call http on another host: mixed content). Options:

- **Cloudflare Tunnel** (`cloudflared`, free, stable hostname with own domain): recommended.
- **Tailscale Funnel**: public https on `*.ts.net`, simple, free.
- ngrok: URL changes on free plan.

Backend keeps binding 127.0.0.1 (the tunnel connects locally). Needs: CORS for the Vercel origin
(`AGENT_HUB_ORIGINS`, already there), `VITE_HUB_URL` = tunnel URL at build. Once exposed: login rate
limit, generic 401s, no token in logs (SSE `?token=` → use a short-lived stream ticket instead).
Alternative without Vercel: backend serves the built UI itself (plan option), same tunnel need for phone.

## 5. Field and behavior mismatches (UI expects vs backend sends)

Fix in an adapter inside `HttpHubClient` (UI design keeps its own model) unless marked **protocol**.

| Area | UI | Backend | Fix |
|---|---|---|---|
| Responses | bare arrays, camelCase, epoch ms | `List{items,next}`, snake_case, ISO | adapter |
| Errors | `{error:"code"}` | `{error:{code,message}}` | adapter |
| SSE | `onmessage` (unnamed events) | named events (`event: decision`) → onmessage never fires | adapter: `addEventListener` per type |
| Workspace status | RUNNING | ONLINE | adapter |
| Workspace | `run` (active) + `pastRuns{outcome,date}` | `snapshot.runs[]` + `active_run` | adapter; outcome from `finish` |
| Workspace | `uploads` settings, `orchestrator.program`, `lastActivityAt` | not sent | **protocol**: add `upload` to hello/summary; program from `kind`; lastActivity = newest event `at` |
| Run status | MERGED | DONE + finish.result | adapter |
| Gate | NOT_RUN/PASSED/FAILED | `{status: PASS/FAIL/null}` | adapter |
| Agent state | `off` | `absent`, `done` | adapter |
| Scout rounds | `name`, `questions`, `docId` | rounds with evidence_path | adapter (docId = document path) |
| Problem | `text`, `severity` | `type`, `note`, `since` | adapter (severity from type) |
| Decision | `evidence[]{code,note,bad}`, option `consequence`, `opusNote` | not in protocol nor in `decision ask` | **protocol + kit**: `decision ask --evidence`, `--option "A=label :: consequence"`, `--note` |
| Decision | `approval{command,cwd,why,screen}` | none | **protocol + kit** (worker_approval decisions, phase A2) |
| Decision status | REPLY_SENT, WAITING, SUPERSEDED | not in hub_status | **protocol**: add REPLY_SENT, WAITING (offline queue = SENT while OFFLINE, can derive), SUPERSEDED (needs kit link) |
| Channel | `hub_reply`, `terminal` | `chat`, `hub`, `opus` | adapter (chat→terminal) |
| Documents | `id`, `name`, `review` kind, format md/diff | `path`, kinds without review, `text` format | adapter; UI must render `text`; drop `review` |
| History | `routine` with reason + docId | `routine` with text | adapter |
| Device | laptop/phone icon | device name | gone with users; drop or derive from user agent |

## 6. Feasibility

| Item | Effort | Owner |
|---|---|---|
| Run persistence (upsert) + 15-day filter | small | backend |
| Run title/goal, task summary + format checks | small | kit scheduler + connector + protocol |
| Auth: users, scrypt, sessions, CLI, per-user workspaces, remove pairing | medium | backend + protocol + docs |
| Decision evidence/consequence/note/approval | medium | kit + protocol + backend |
| Web app in `hub/web` from the design + HTTP adapter + change-password screens | medium | web |
| Tunnel + Vercel deploy | small, but your infra choice | you + lead |

Order: protocol v2 changes (one batch) → backend + kit in parallel → web adapter → tunnel/Vercel.

## Unresolved questions

1. Tunnel: Cloudflare Tunnel (own domain) or Tailscale Funnel?
2. Users: just you, or several people on this computer (decides per-user connector keys)?
3. Runs kept forever, or a retention (e.g. 90 days) for finished runs?
4. Hide `prompt` items from History, or show them under a filter?
