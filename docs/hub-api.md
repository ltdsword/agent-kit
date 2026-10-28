# Agent Hub API v1 (contract)

The contract between the **connector** (`.agent-system/agentctl.py`, Python), the **backend**
(`hub/server`, Node 24) and the **web UI** (`hub/web`). Design and reasons are in
`.agent-system/docs/DECISION-HUB-PLAN.md`; this file defines behavior.

The sources of truth, in order:
1. `hub/protocol/schemas/protocol.schema.json`: every message body (`$defs`). TS types are
   generated from it (`hub/protocol/src/types.gen.ts`). The kit keeps a byte copy,
   `.agent-system/hub-protocol.schema.json`, for the connector.
2. `hub/protocol/src/api.ts`: routes, headers, limits, error codes.
3. `hub/protocol/fixtures/*.json`: canonical examples. `<Def>.<case>.json` must validate against
   `$defs.<Def>`, and everything in `invalid/` must be rejected. Both validators run them: vitest
   (`npm test -w @agent-hub/protocol`) and unittest (`.agent-system/tests/test_hubschema.py`).
4. This document: the semantics the schema can't express.

**Changing the contract**:
1. Edit the schema and fixtures, then run `npm run gen -w @agent-hub/protocol` (regenerates the
   types and the kit copy).
2. Update this file.
3. Both test suites must pass.

Breaking changes bump `PROTOCOL`. Only the lead edits `hub/protocol/**`; tracks request changes.

## 1. Common rules

- Base URL: `http://127.0.0.1:7420` (`DEFAULT_PORT`), all routes under `/api/v1`. In local mode the
  backend serves the built UI at `/`.
- JSON only (`Content-Type: application/json`), UTF-8. Timestamps: ISO 8601 UTC with `Z`.
- Every request carries `X-Agent-Hub-Protocol: 1`. Below `MIN_PROTOCOL` → `426 protocol_unsupported`.
  A missing header counts as 1.
- Errors: `ApiError` `{"error": {"code", "message"}}`, with the codes and HTTP statuses in
  `ERRORS`. `bad_request` messages name the first schema error (`/decisions/0/decision_id must match
  pattern ...`).
- The backend validates every request body against its `$def` and rejects extra properties. The
  connector validates what it sends in tests, and responses at runtime.
- Lists use `List` `{items, next}`. `next` is an opaque cursor (pass it as `cursor=`), or `null`
  when there are no more. Default page 50, newest first unless stated.
- Ids:
  - `workspace_id` `ws_` + 16 base32 (a-z, 2-7), made by the connector;
  - `session_id` `ses_` + 16, made per connector start;
  - command `cmd_` + 16, made by the backend.
- Size limits are in `LIMITS`; over them → `413 payload_too_large`.

## 2. Auth

| Credential | Format | Created by | Stored | Used on |
|---|---|---|---|---|
| Connector key | 32 random bytes, base64url | backend on first start | plaintext in `~/.config/agent-hub/connector.key` (0600); backend keeps a sha256 | connector routes |
| Device token | 32 random bytes, base64url | `POST /pair` | browser `localStorage`; backend keeps a sha256 | user routes, `/stream?token=` |
| Pairing code | 8 chars `[A-Z2-9]`, single use, 10 min | `agent-hub pair --name <device>` on the computer | backend keeps a sha256 + expiry | `POST /pair` |

- `Authorization: Bearer <secret>`. A wrong secret gets `401 unauthorized`; a connector key on a
  user route, or a device token on a connector route, gets `403 forbidden`. `/pair` needs no token.
- `EventSource` can't set headers, so `/stream` takes the device token as `?token=`.
- CORS: allowed origins are the backend's own origin plus `AGENT_HUB_ORIGINS` (comma-separated, e.g.
  the Vercel URL). No cookies are used, so there is no CSRF surface.
- The backend binds `127.0.0.1` only (`AGENT_HUB_HOST` can't be set to `0.0.0.0` without
  `--i-know`).

## 3. Connector routes

### 3.1 Session

- `GET /agent/ping` → `PingResponse`. Used by `agentctl enable/status` and for clock skew.
- `POST /agent/hello` (`HelloRequest` → `HelloResponse`):
  - Creates the workspace if new (`known: false`) and updates name, path and kit version if known.
  - Opens a `workspace_sessions` row and sets the status to ONLINE.
  - `409 duplicate_workspace` when a *different* `session_id` for this workspace made a request in
    the last 90 s (a copied workspace).
  - The response tells the connector what the backend already has: `event_cursors`,
    `decision_hashes` (sha256 of the canonical Decision JSON: keys sorted, no spaces, UTF-8),
    `document_hashes`, `snapshot_hash`. On a wiped DB all are empty, and the connector sends
    everything.
- `POST /agent/workspaces/:ws/goodbye` (`GoodbyeRequest`) → `204`: the status becomes STOPPED and
  the session is closed.
- Liveness: any connector request on `:ws` refreshes `last_seen_at` and sets ONLINE (unless it's
  `goodbye`). No request for `offlineAfterSeconds` (90) → OFFLINE (checked by a backend timer every
  10 s). `POST .../heartbeat` → `204` exists for loops with nothing else to send; send one at least
  every `heartbeatSeconds` (30).

### 3.2 Sync (all idempotent; resending is always safe)

- `PUT .../snapshot` (`Snapshot`) → `204`:
  - replaces the stored snapshot;
  - `snapshot.workspace_id` must equal `:ws` (`400` otherwise);
  - the backend derives `runs` rows from it.
- `PUT .../decisions` (`DecisionsBatch`) → `204`: upsert by `(ws, run_id, decision_id)`, then
  recompute `hub_status` (section 5) and emit `decision` stream events for the ones that changed.
- `POST .../events` (`EventsBatch`) → `EventsResponse`: insert, ignoring duplicate `(run_id, n)`;
  `cursor` = the highest `n` stored for the run. Gaps are allowed (the 500-event trim in
  `state.json`).
- `PUT .../documents` (`DocumentsBatch`) → `204`: upsert by `path`, clearing `deleted`. The
  backend recomputes sha256 and returns `400` if it differs from the one sent.
- `DELETE .../documents?path=` → `204`: marks `deleted=true` and keeps the content (history
  outlives the workspace).

### 3.3 Commands (hub → system)

- `GET .../commands?wait=25` → `CommandsResponse`:
  - Returns commands in `QUEUED`, plus `HELD` ones whose last ack is more than 5 s old, oldest
    first, max 50.
  - With none, the request is held open for up to `wait` seconds (long poll), returning early as
    soon as one is created.
  - Expired commands are never returned.
- `POST .../commands/:id/ack` (`AckRequest`) → `204`:

  | Ack | New command status | Meaning |
  |---|---|---|
  | `DELIVERED` | DELIVERED (final) | answer: recorded by the scheduler **and** the notice typed to the orchestrator. reply/prompt: typed to the orchestrator |
  | `HELD` | HELD | Herdr said `agent_blocked` (a dialog is open), or the orchestrator isn't live yet; retried later. `reason` is shown to the user |
  | `REJECTED` | REJECTED (final) | the scheduler refused the answer; `reason` is its exact message (e.g. `D3 is ANSWERED, not PENDING`, `'x y' is not a valid branch name`) |
  | `FAILED` | FAILED (final) | anything else (Herdr error text in `reason`) |

  Acks are idempotent; an ack after a final status is ignored with `204`.
- Answer special case: when the scheduler accepted the answer but typing the notice failed or was
  held, the connector acks `DELIVERED` anyway (the answer is recorded) and retries the notice
  locally. The user-visible truth is that the answer is in.

## 4. Connector behavior per command (what the system does)

| Command | Connector action | Orchestrator receives (typed into its pane) |
|---|---|---|
| `answer` | `Scheduler.decision_answer(run, id, choice, note, channel="hub", by=<device>, followup, value, quote="<KEY>: <label>[ / <branch>]")` | `[hub] D3 answered by the user: A (Repair: rebase T2 on T1's version). Note: keep T1's message text. It is recorded (channel hub); carry it out with --decision D3.` |
| `reply` | nothing recorded | `[hub] reply to D3 from the user: "<text>"` |
| `prompt` | nothing recorded | `[hub] <text>` |

Delivery goes through `herdr agent prompt <orchestrator> <text>` with `--wait --until working
--until blocked`. `agent_blocked` → ack HELD. Every delivered command is appended to
`.orchestrator/hub-log.jsonl` (`{"at", "id", "type", "run_id", "decision_id", "body", "device"}`),
so a wiped backend can re-import prompt history. The Opus rules for these messages are in the plan,
section 19.2.

## 5. Decision status in the hub (`HubDecision.hub_status`)

The backend derives it from the synced `Decision` and the decision's latest `answer`/`reply`
command, in this order:

| Condition | hub_status | status_reason |
|---|---|---|
| `local_status = DECIDED_BY_OPUS` | ROUTINE | null |
| `local_status = CANCELLED` | CANCELLED | `cancel_reason` |
| `local_status = ANSWERED` and `consumed_by` set | APPLIED | null |
| `local_status = ANSWERED`, `answer.channel = hub` | DELIVERED | null |
| `local_status = ANSWERED`, `answer.channel = chat` | ANSWERED_ELSEWHERE | null |
| `PENDING`, latest answer command QUEUED, HELD or DELIVERED | SENT | the HELD reason, if any |
| `PENDING`, latest answer command REJECTED | REJECTED | its reason |
| `PENDING` otherwise (no command, or only replies) | OPEN | null |

A reply doesn't change the status. The UI shows it through `pending_command` (type `reply`).
`decisions_open` in `WorkspaceDetail` = hub_status in OPEN, SENT, REJECTED.

## 6. User routes

| Route | Behavior |
|---|---|
| `POST /pair` | `PairRequest` → `PairResponse`; wrong or expired code → `401`; 5 failures per minute per IP → `429` |
| `GET /devices`, `DELETE /devices/:id` | `current` marks the caller; revoking yourself logs you out |
| `GET /workspaces?archived=false` | `List<WorkspaceSummary>`, ONLINE first, then by `last_seen_at` desc. `kit_outdated` = `kit_version` differs from `AGENT_HUB_KIT_VERSION` (false if unset) |
| `GET /workspaces/:ws` | `WorkspaceDetail`; `snapshot` null until the first one arrives |
| `PATCH /workspaces/:ws` | `{"archived": bool}` → `WorkspaceSummary` (archived workspaces are hidden by default and come back when the connector says hello) |
| `GET /workspaces/:ws/decisions?status=&run=` | `List<HubDecision>`, newest `opened_at` first |
| `GET /workspaces/:ws/decisions/:run/:id` | `HubDecision` |
| `POST .../decisions/:run/:id/answer` | `AnswerRequest` → `201 UserCommand` (type answer, `expires_at` null). Checks: hub_status OPEN or REJECTED, else `409 decision_not_answerable`; `choice` ∈ options; if `choice` ∈ `followup.when`, `followup` must be one of its keys, and `value` is required for an option with `input: true` (forbidden otherwise; the option's own value is used); else `422 invalid_option`. Allowed while the workspace is OFFLINE or STOPPED (it waits as SENT, "waiting for your computer") |
| `POST .../decisions/:run/:id/reply` | `TextRequest` → `201 UserCommand` (type reply). The decision must be OPEN, SENT or REJECTED, and the workspace ONLINE, else `409 workspace_not_online` |
| `POST /workspaces/:ws/prompts` | `TextRequest` → `201 UserCommand` (type prompt, `expires_at` = now + 30 min). ONLINE only, else `409 workspace_not_online` |
| `GET /workspaces/:ws/commands` | `List<UserCommand>`, newest first |
| `GET /workspaces/:ws/documents?run=` | `List<DocumentMeta>`, grouped by the UI; newest `updated_at` first |
| `GET /workspaces/:ws/documents/content?path=` | `DocumentContent` |
| `GET /workspaces/:ws/history?type=&run=` | `List<HistoryItem>`, newest first (below) |

**History** is built from synced decisions and from commands:
- `answer`: a decision with `answer.channel` `hub` or `chat`; `at` = `answer.at`, `status` = its
  hub_status.
- `routine`: `DECIDED_BY_OPUS`; `text` = the reason.
- `reply` / `prompt`: commands of those types; `status` = the command status.

`id` is stable (`h_<run>_<D>` or `h_<command id>`).

The backend never accepts a request that starts, stops or runs anything in a workspace; no such
route exists.

## 7. Live updates

`GET /stream?token=<device token>` is Server-Sent Events. Each event is
`event: <type>\ndata: <StreamEvent JSON>\n\n`, with types `workspace`, `snapshot`, `decision`,
`command`, `document`, `history`. A `: ping` comment comes every 15 s.

The UI refetches the named resource; events carry no payload beyond `ref`. On reconnect, the UI
refetches the current page. If the stream can't connect, it falls back to polling every 10 s.

## 8. Backend configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_HUB_PORT` | 7420 | port |
| `AGENT_HUB_HOST` | 127.0.0.1 | bind address |
| `AGENT_HUB_DATA` | `~/.local/share/agent-hub` | SQLite file `hub.db` |
| `AGENT_HUB_CONFIG` | `~/.config/agent-hub` | `connector.key` |
| `AGENT_HUB_ORIGINS` | (empty) | extra CORS origins |
| `AGENT_HUB_KIT_VERSION` | (unset) | for `kit_outdated` |

The connector reads its URL from `config.json` `hub.url`, and the key from
`$AGENT_HUB_CONFIG/connector.key`. It must not use a proxy for loopback URLs: Claude Code's org
settings set `HTTPS_PROXY`.
