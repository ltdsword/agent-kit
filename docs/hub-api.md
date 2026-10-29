# Agent Hub API v2 (contract)

The browser talks to the shared proxy. The proxy relays workspace requests to the local backend on
the selected computer. The connector continues to talk directly to that backend over loopback; its
routes are loopback-only and are never relayed.

The sources of truth, in order:
1. `hub/protocol/schemas/protocol.schema.json`: every message body (`$defs`). TS types are
   generated from it (`hub/protocol/src/types.gen.ts`). The kit keeps a byte copy at
   `.agent-system/hub-protocol.schema.json` for the connector.
2. `hub/protocol/src/api.ts`: routes, headers, limits and error codes.
3. `hub/protocol/fixtures/*.json`: canonical examples. `<Def>.<case>.json` validates against
   `$defs.<Def>`; every fixture in `invalid/` is rejected by both the Vitest and Python validators.
4. This document: the semantics the schema cannot express.

Breaking changes bump `PROTOCOL`. Protocol 2 is required by the connector and relay.

## 1. Common rules

- The local backend base URL is `http://127.0.0.1:7420` (`DEFAULT_PORT`). Routes use `/api/v1`.
  The browser uses the proxy base URL; workspace paths under `/api/v1` are relayed to the backend unchanged.
- JSON bodies use UTF-8 and `Content-Type: application/json`. Timestamps are ISO 8601 with a UTC
  `Z` suffix.
- Connector requests carry `X-Agent-Hub-Protocol: 2`. `MIN_PROTOCOL` is 2; a lower or missing
  version gets `426 protocol_unsupported`.
- Errors use `ApiError`: `{"error":{"code","message"}}`. Statuses are in `ERRORS`; schema
  failures use `bad_request` and identify the first validation error.
- Request bodies are validated against their `$def`; extra properties are rejected. Lists use
  `List` (`items`, `next`), where `next` is an opaque cursor or `null`.
- IDs: `workspace_id` is `ws_` plus 16 lowercase base32 characters; `session_id` is `ses_` plus
  16 base32 characters; command IDs are `cmd_` plus 16 base32 characters. Run IDs match
  `^[a-z0-9][a-z0-9-]{1,39}$`; task IDs match `^T[1-9][0-9]{0,2}$`.
- Size and time limits are in `LIMITS`. Oversized backend payloads get `413 payload_too_large`.

## 2. Auth

| Credential | Created by | Stored / used by | Used between |
|---|---|---|---|
| Session token | Proxy login | Browser stores it; proxy validates it | Browser → proxy user routes |
| Admin key | Proxy setup | Admin computer keeps `~/.config/agent-hub/admin.key` | Admin CLI → proxy |
| Computer key | Computer registration | Backend keeps it in `computer.json`; proxy stores its hash | Proxy ↔ local backend relay |
| Connector key | Local backend on first start | `~/.config/agent-hub/connector.key`; backend stores its hash | Connector → local backend |
| Assertion | Proxy signs per relayed request | Backend verifies with the pinned proxy public key | Proxy → backend request |

Session and computer credentials use `Authorization: Bearer <secret>`. The browser also sends its
session token in `Authorization` when opening the computer event stream; the stream is read with
`fetch` streaming, not `EventSource`. The proxy validates ownership before routing. Connector
routes remain bound to loopback and use the connector key; the browser never calls them.

The proxy hashes passwords with PBKDF2-SHA256, a 16-byte salt, and 20,000 iterations. Each user's
iteration count is stored so it can be raised and passwords re-hashed at login. Login is limited to
5 attempts per minute per username and IP; excess attempts return `429 rate_limited`. Sessions last
12 hours, or 30 days when `remember` is true. New passwords must be 12–256 characters.

## 3. Connector routes

Connector routes are local to the backend and are never exposed through the proxy.

### 3.1 Session

- `GET /api/v1/agent/ping` → `PingResponse`.
- `POST /api/v1/agent/hello` (`HelloRequest` → `HelloResponse`) creates or updates the workspace,
  opens a session, and sets it ONLINE. `upload` declares whether documents, diffs and the
  orchestrator screen are uploaded. A different session ID making a request within 90 seconds gets
  `409 duplicate_workspace`. The response reports event cursors, decision hashes (SHA-256 of
  canonical Decision JSON), document hashes and the snapshot hash so the connector can send only
  changes.
- `POST /api/v1/agent/workspaces/:ws/goodbye` → `204`; the workspace becomes STOPPED.
- Connector activity refreshes `last_seen_at`; no activity for `offlineAfterSeconds` (90) makes a
  workspace OFFLINE. `POST .../heartbeat` is available for loops with nothing else to send; send
  one at least every `heartbeatSeconds` (30).

### 3.2 Sync

- Sync requests are idempotent; resending them is safe.
- `PUT .../snapshot` replaces the current snapshot. The workspace ID must match `:ws`. The backend
  derives its run rows from the snapshot. Worker
  screens and task file details are not uploaded; an orchestrator screen is `null` when its upload
  setting is off. Older runs can have null title/goal and older tasks can have a null summary.
- `PUT .../decisions` upserts by `(workspace, run_id, decision_id)` and emits decision events when
  content changes. The reserved `inbox` run contains ordinary `question` decisions; it is not an
  active or listed run, and its questions appear in the Questions panel. History labels its items
  as questions. For each workspace, the backend retains the newest 100 inbox decisions by their
  `opened_at` timestamp and keeps older pending decisions until they are closed; pruning also
  removes their decision documents. Each option may include its consequence; decisions include
  evidence, Opus's rationale in `note`, and optional worker approval.
- `POST .../events` inserts events by `(run_id, n)`, ignoring duplicates; event number gaps are
  allowed when old state logs have trimmed events.
- `PUT .../documents` upserts by path. The backend recomputes SHA-256 and rejects mismatches.
  Document kinds are `final_report`, `final_diff`, `decision`, `research`, `plan`, `review` and
  `other`. A plan is a `plans/*/plan.md` file, a review is a `plans/reports/review-*.md` file, and
  `other` covers any other published file. Documents carry the run ID that recorded the path, or
  `null` for workspace-level documents.
- `DELETE .../documents?path=` marks a document deleted while retaining its content.

### 3.3 Commands (hub → system)

- `GET .../commands?wait=25` returns queued commands and eligible held commands, up to 50, or holds
  the request open until a command arrives or the wait expires.
- `POST .../commands/:id/ack` records `DELIVERED`, `HELD`, `REJECTED` or `FAILED`. Acks are
  idempotent. `Command.by` is the username that sent the command.
- Commands are returned oldest first. `HELD` commands are retried after their last ack is more than
  five seconds old; expired commands are not returned.
- `DELIVERED` is final. `HELD` means the agent is blocked or not live yet and is retried later;
  `reason` is shown to the user. `REJECTED` is final when the scheduler refuses an answer, with its
  exact reason. `FAILED` is final for other delivery errors.
- If the scheduler records an answer but typing its notice fails, the connector still acknowledges
  the answer as delivered and retries the notice locally for up to 10 minutes.

## 4. Connector behavior per command

| Command | Connector action | Orchestrator receives |
|---|---|---|
| `answer` | Calls the scheduler with the selected choice, followup and username | `[hub] D3 answered by alice: <choice>. It is recorded; carry it out with --decision D3.` |
| `reply` | Records no scheduler answer | `[hub] reply to D3 from alice: "<text>"` |
| `prompt` | Records no scheduler answer | `[hub] <text>` |

Delivery uses `herdr agent prompt <orchestrator> <text>` only when the orchestrator is idle. A busy
or blocked agent is acknowledged as `HELD` while the connector retries after delays of 1, 2, 4, 8,
16, 16, 16 and 16 seconds; after those eight retries it retries every 32 seconds until 10 minutes
from the first attempt. An undelivered `prompt` or `reply` is then acknowledged as `FAILED` with
reason `Opus stayed busy for 10 minutes; not delivered`; `HELD` is non-final and `FAILED` is final.
Answer notices use the same retry schedule, but the answer itself remains delivered; an untyped
notice is logged and dropped after 10 minutes. Delivered commands are appended to local
`.orchestrator/hub-log.jsonl` with their username and body for recovery.

## 5. Decision status in the hub (`HubDecision.hub_status`)

The backend derives status from the synced decision and its latest answer or reply command:

| Condition | `hub_status` |
|---|---|
| `local_status = DECIDED_BY_OPUS` | `ROUTINE` |
| `local_status = CANCELLED` | `CANCELLED` (`cancel_reason`) |
| `local_status = ANSWERED` and `consumed_by` is set | `APPLIED` |
| `local_status = ANSWERED`, answer channel is `hub` | `DELIVERED` |
| `local_status = ANSWERED`, answer channel is `chat` | `ANSWERED_ELSEWHERE` |
| Pending answer command is queued, held or delivered | `SENT` |
| Latest reply was delivered and no answer is recorded | `REPLY_SENT` |
| Pending answer command was rejected | `REJECTED` (rejection reason) |
| Pending with no answer command or only an undelivered reply | `OPEN` |

`status_reason` carries the held or rejected reason when applicable. Replies do not answer a
decision; `pending_command` shows the latest reply. `decisions_open` includes `OPEN`, `SENT` and
`REJECTED` decisions.

## 6. Proxy and user routes

The proxy owns authentication, user and computer management, workspace routing and live streams.
Workspace routes under `/api/v1/workspaces/:ws/...` are relayed to the selected backend unchanged.

| Route | Request → response | Auth |
|---|---|---|
| `POST /api/v1/auth/login` | `LoginRequest` → `LoginResponse` | None |
| `POST /api/v1/auth/logout` | → `204` | Session token |
| `POST /api/v1/auth/password` | `PasswordChangeRequest` → `204` | Session token |
| `GET /api/v1/me` | → `Me` with the user's computers | Session token |
| `POST /api/v1/admin/users` | `AdminUserRequest` → `AdminUserResponse` | Admin key |
| `POST /api/v1/admin/users/:username/reset-password` | → `AdminUserResponse` | Admin key |
| `POST /api/v1/computers/register` | `ComputerRegisterRequest` → `ComputerRegisterResponse` | None |
| `GET /api/v1/computers/:c/connect` | WebSocket relay | Computer key |
| `GET /api/v1/computers/:c/poll?wait=:seconds` | → `RelayPollResponse` | Computer key |
| `POST /api/v1/computers/:c/frames` | `RelayFramesRequest` → `204` | Computer key |
| `GET /api/v1/computers/:c/stream` | `text/event-stream` of `StreamEvent` | Session token |

The browser's remaining workspace routes are `GET /workspaces`, `GET /workspaces/:ws`,
`PATCH /workspaces/:ws`, and the decisions, commands, documents and history routes under
`/workspaces/:ws`. `/workspaces` merges live lists from online computers. It also returns index-only
entries for workspaces on offline computers seen within 15 days, with status `OFFLINE` and
`computer_online: false`. The local backend sends `computer_id: null` and `computer_online: true`;
the proxy fills in the computer ID.

| Workspace route | Behavior |
|---|---|
| `GET /workspaces?archived=false` | `List<WorkspaceSummary>`, online first and then by `last_seen_at` descending. `kit_outdated` compares `kit_version` with `AGENT_HUB_KIT_VERSION` (false when unset). |
| `GET /workspaces/:ws` | `WorkspaceDetail`; snapshot is null until the first snapshot arrives. |
| `PATCH /workspaces/:ws` | `{"archived": boolean}` → `WorkspaceSummary`. Archived workspaces are hidden by default and return when the connector says hello. |
| `GET /workspaces/:ws/decisions?status=&run=` | `List<HubDecision>`, newest `opened_at` first. |
| `GET /workspaces/:ws/decisions/:run/:id` | `HubDecision`. |
| `POST .../decisions/:run/:id/answer` | `AnswerRequest` → `201 UserCommand`. The status must be OPEN or REJECTED. Choice and followup values must match the decision; a required input value is required and forbidden otherwise. Invalid choices return `422 invalid_option`; unanswerable decisions return `409 decision_not_answerable`, except that the same user repeating their current answer (same choice and followup) gets `200` with the existing `UserCommand`. Answers may queue while the workspace is offline. |
| `POST .../decisions/:run/:id/reply` | `TextRequest` → `201 UserCommand`. Decision must be OPEN, SENT or REJECTED and workspace ONLINE; otherwise `409 workspace_not_online`. |
| `POST /workspaces/:ws/prompts` | `TextRequest` → `201 UserCommand`, expiring after 30 minutes. Workspace must be ONLINE or gets `409 workspace_not_online`. |
| `GET /workspaces/:ws/commands` | `List<UserCommand>`, newest first. |
| `GET /workspaces/:ws/documents?run=` | `List<DocumentMeta>`, newest `updated_at` first. |
| `GET /workspaces/:ws/documents/content?path=` | `DocumentContent`. |
| `GET /workspaces/:ws/history?type=&run=` | `List<HistoryItem>`, newest first. |

History is built from hub/chat answers, Opus routine decisions, and reply/prompt commands. IDs are
stable (`h_<run>_<D>` or `h_<command id>`). The backend has no route to start, stop or run anything
in a workspace.

### 6.1 Relay frames

The proxy and local backend exchange JSON text frames over WebSocket. Each request has a unique ID;
the matching response or stream frames carry that ID. The browser-to-backend assertion is attached
to every `RelayRequest`.

| Frame | Direction | Meaning |
|---|---|---|
| `req` | Proxy → backend | Method, `/api/v1/` path, query without `?`, optional JSON body, assertion and stream flag |
| `res` | Backend → proxy | HTTP status and JSON body |
| `chunk` / `end` | Backend → proxy | Stream data followed by its final status; `stream: true` produces zero or more `chunk` frames and one `end` |
| `cancel` | Proxy → backend | Browser disconnected; backend can stop the active request |
| `hello` / `workspaces` | Backend → proxy | Protocol version, computer identity and workspace index |
| `ping` / `pong` | Both directions | Relay heartbeat |

The proxy returns `503 computer_offline` when no computer socket is available and `504
computer_timeout` when a request exceeds 30 seconds. Relay frames are capped at 900 KB. Backend
request bodies larger than that return `413 payload_too_large`. Documents can be up to 1 MB, so a
`DocumentContent` response is sent with `stream: true` and split into chunks.

The HTTPS long-poll fallback is used when a WebSocket upgrade fails. Polls are held for at most 25
seconds; `RelayPollResponse.frames` and posted `RelayFramesRequest.frames` batches contain at most
50 objects. Each frame is validated by its `type` as a request or cancel, or as a response, chunk,
end, hello, workspaces or pong frame respectively.

### 6.2 Assertion verification

The wire assertion is `base64url(JSON payload) + "." + base64url(signature)`. The Ed25519 signature
covers the ASCII bytes of the first part. Its payload is `Assertion` (`v`, `sub`, `cid`, `rid`,
`exp`). The backend verifies the signature with the proxy public key pinned during `hub-login`, requires `exp` to be
between now and 120 seconds from now, checks `cid` against its own computer ID, checks `sub` against
its owner, and checks `rid` against the relay frame ID.

Runs are stored by the backend and upserted by `(workspace, run_id)`. Finished runs are deleted 60
days after finishing.

## 7. Live updates

`GET /api/v1/computers/:c/stream` returns named Server-Sent Events through the proxy. The browser
uses `fetch` streaming so it can send the session token in the `Authorization` header. Event names
are `workspace`, `snapshot`, `decision`, `command`, `document` and `history`; the payload is a
`StreamEvent` reference. The UI refetches the named resource after an event and the current page
after reconnecting.

## 8. Backend configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_HUB_PORT` | 7420 | Local backend port |
| `AGENT_HUB_HOST` | 127.0.0.1 | Bind address; connector routes stay loopback-only |
| `AGENT_HUB_DATA` | `~/.local/share/agent-hub` | SQLite file `hub.db` |
| `AGENT_HUB_CONFIG` | `~/.config/agent-hub` | `connector.key` and default computer configuration directory |
| `AGENT_HUB_COMPUTER` | `$AGENT_HUB_CONFIG/computer.json` | Path to the registered computer configuration |
| `AGENT_HUB_RECENT_DAYS` | 15 | Keep offline workspace index entries visible this many days |
| `AGENT_HUB_RUN_RETENTION_DAYS` | 60 | Retain finished runs this many days |
| `AGENT_HUB_ORIGINS` | (empty) | Extra allowed origins |
| `AGENT_HUB_KIT_VERSION` | (unset) | Version used for `kit_outdated` |

The connector reads the backend URL from `config.json` `hub.url` and its key from
`$AGENT_HUB_CONFIG/connector.key`. It must bypass proxies for loopback URLs.
