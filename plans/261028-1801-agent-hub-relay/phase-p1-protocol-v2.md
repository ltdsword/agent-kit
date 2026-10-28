# Phase P1: protocol v2 (contract only)

Goal: `hub/protocol` and `docs/hub-api.md` describe protocol 2 exactly as below. Every later task
(P2a proxy, P2b backend, P2c kit, P3 web) builds against this. **Change only the contract**: schema,
fixtures, generated types, `api.ts`, the kit's schema copy, the API doc. Do not touch `hub/server`,
`hub/proxy`, `.agent-system/*.py` (other tasks fix their code against v2).

Read first: `plan.md` (this folder) sections 1-5 and 10; current `hub/protocol/schemas/protocol.schema.json`,
`hub/protocol/src/api.ts`, `docs/hub-api.md`.

## 1. Schema changes (`hub/protocol/schemas/protocol.schema.json`)

Keep the documented JSON Schema subset (no oneOf/allOf/format). `$id` → `.../protocol/2`, title
"version 2". Every `"protocol": {"const": 1}` → `2`.

Ids:
- `RunId`: `^[a-z0-9][a-z0-9-]{1,39}$`.
- `TaskId`: `^T[1-9][0-9]{0,2}$`.
- New `Username`: `^[a-z][a-z0-9_-]{2,31}$`. New `ComputerId`: `^c_[a-z2-7]{16}$`.

Snapshot parts:
- `Agent.screen`: unchanged (orchestrator screen stays, still null when the upload is off).
- `Worker`: **remove `screen`**.
- `Task`: remove `owned_paths`, `packet`; add `summary` `["string","null"]` maxLength 300 (null only for
  runs created before v2). `title` maxLength 60.
- `Run`: add `title` `["string","null"]` max 80 and `goal` `["string","null"]` max 500 (null for old runs).
- `Snapshot.orchestrator_last_activity_at`: new required `NullableTimestamp`.

Decisions:
- `Option`: add `consequence` `["string","null"]` max 300.
- New `Evidence`: `{code: string ≤300, note: string ≤300, bad: boolean}`, all required.
- New `Approval`: `{command: string ≤2000, cwd: ["string","null"] ≤512, why: array of string ≤300, maxItems 10}`.
- `Decision`: add required `evidence` (array of Evidence, maxItems 20), `note` (`["string","null"]` ≤1000,
  Opus's rationale), `approval` (anyOf Approval / null).
- `HubDecisionStatus`: add `REPLY_SENT` (a reply was delivered and no answer recorded yet).

Documents: `DocumentKind` = `final_report, final_diff, decision, research` (remove `task_file`, `review`).

Hello / workspace:
- New `UploadSettings`: `{documents: boolean, diffs: boolean, orchestrator_screen: boolean}` all required.
- `HelloRequest`: add required `upload` (UploadSettings).
- `WorkspaceSummary`: add required `upload` (anyOf UploadSettings/null), `orchestrator_last_activity_at`
  (NullableTimestamp), `computer_id` (`["string","null"]`, pattern of ComputerId when a string; the local
  backend sends null, the proxy fills it), `computer_online` (boolean; local backend sends true).
  `active_run` gains `title` (`["string","null"]`).

Users instead of devices:
- `Command.device` → `by` (Username). `UserCommand.device` → `by` (`["string","null"]`).
  `HistoryItem.device` → `by` (`["string","null"]`).
- Remove `Device`, `PairRequest`, `PairResponse`.

Auth (browser ↔ proxy):
- `LoginRequest {username: Username, password: string 1..256, remember: boolean}`.
- `LoginResponse {token: string ≥32, expires_at: Timestamp, username: Username}`.
- `PasswordChangeRequest {current: string 1..256, new: string 12..256}`.
- `Me {username, computers: array of ComputerSummary}`;
  `ComputerSummary {id: ComputerId, name: string ≤64, online: boolean, last_seen_at: NullableTimestamp}`.

Admin (admin CLI ↔ proxy):
- `AdminUserRequest {username}`; `AdminUserResponse {username, password: string 20..64}`.

Computer registration (`agent-kit hub-login` ↔ proxy):
- `ComputerRegisterRequest {username, password, name: string 1..64}`.
- `ComputerRegisterResponse {computer_id, computer_key: string ≥32, proxy_public_key: string (base64url,
  43 chars, `^[A-Za-z0-9_-]{43}$`), username}`.

Relay frames (proxy ↔ local backend; JSON text frames over WebSocket, or batched over long-poll):
- `RelayRequest {type: const "req", id: string ≤64, method: enum GET/POST/PUT/PATCH/DELETE,
  path: string ≤1024 (starts with `/api/v1/`), query: string ≤2048 (without `?`, may be ""),
  body: any JSON or null, assertion: string ≤2048, stream: boolean}`.
- `RelayResponse {type: const "res", id, status: integer 100..599, body: any JSON or null}`.
- `RelayStreamChunk {type: const "chunk", id, data: string ≤ 900000}` (SSE text, as written by the backend).
- `RelayStreamEnd {type: const "end", id, status: integer}`.
- `RelayCancel {type: const "cancel", id}` (proxy → backend: browser went away).
- `RelayHello {type: const "hello", protocol: const 2, computer_id, backend_version: string ≤64,
  workspaces: array of WorkspaceIndexEntry ≤200}`.
- `RelayWorkspaces {type: const "workspaces", workspaces: array of WorkspaceIndexEntry ≤200}`.
- `WorkspaceIndexEntry {workspace_id, name ≤128, status: WorkspaceStatus, last_seen_at: NullableTimestamp}`.
- `RelayPing {type: const "ping"}`, `RelayPong {type: const "pong"}`.
- Long-poll fallback: `RelayPollResponse {frames: array ≤50 of RelayRequest or RelayCancel}` — since the
  subset has no oneOf, type `frames` items as `{"type":"object"}` and document that each item must validate
  as RelayRequest or RelayCancel by its `type`. `RelayFramesRequest {frames: array ≤50 (objects)}` likewise
  (RelayResponse / RelayStreamChunk / RelayStreamEnd / RelayHello / RelayWorkspaces / RelayPong).
- Assertion payload (documented, and a def for tests): `Assertion {v: const 1, sub: Username,
  cid: ComputerId, rid: string ≤64, exp: integer (unix seconds)}`. Wire form:
  `base64url(JSON payload) + "." + base64url(Ed25519 signature over the first part's ASCII bytes)`.

## 2. Fixtures (`hub/protocol/fixtures/`)

Update every existing fixture to v2 (protocol 2, Task summary/title, no worker screen, no `task_file`/
`review` docs, decisions with `evidence`/`note`/`approval` and option `consequence`, `by` instead of
`device`, hello `upload`, summary new fields). Delete `Device.json`, `PairRequest.json`,
`PairResponse.json`. Add at least: `Decision.worker-approval.json` (with approval + evidence),
`HubDecision.reply-sent.json`, `LoginRequest.json`, `LoginResponse.json`, `PasswordChangeRequest.json`,
`Me.json`, `AdminUserRequest.json`, `AdminUserResponse.json`, `ComputerRegisterRequest.json`,
`ComputerRegisterResponse.json`, `RelayRequest.json`, `RelayRequest.stream.json`, `RelayResponse.json`,
`RelayStreamChunk.json`, `RelayStreamEnd.json`, `RelayCancel.json`, `RelayHello.json`,
`RelayWorkspaces.json`, `RelayPollResponse.json`, `RelayFramesRequest.json`, `Assertion.json`,
`WorkspaceIndexEntry.json`. `invalid/`: keep the existing intent (update to v2) and add
`Task.bad-id.json` (id `task1`), `Worker.has-screen.json`, `LoginRequest.bad-username.json`
(`Dat`), `PasswordChangeRequest.short.json` (new = 11 chars). Use realistic values; ids must match
the patterns.

## 3. `hub/protocol/src/api.ts`

- `PROTOCOL = 2`, `MIN_PROTOCOL = 2`.
- `LIMITS`: remove `pairCodeSeconds`; add `passwordMinChars: 12`, `sessionHours: 12`,
  `sessionRememberDays: 30`, `loginAttemptsPerMinute: 5`, `pbkdf2Iterations: 20_000`,
  `relayFrameBytes: 900 * 1024`, `relayTimeoutSeconds: 30`, `relayPollSeconds: 25`,
  `recentWorkspaceDays: 15`, `runRetentionDays: 60`.
- `ERRORS`: add `internal_error: 500`, `invalid_credentials: 401`, `username_taken: 409`,
  `weak_password: 422`, `computer_offline: 503`, `computer_timeout: 504`.
- `CONNECTOR_ROUTES`: unchanged paths.
- `USER_ROUTES` (browser → proxy; the `/workspaces/:ws/...` ones are relayed to the backend unchanged):
  remove `pair`, `devices`, `revoke`, `stream`; add `login` POST `/auth/login` (LoginRequest →
  LoginResponse), `logout` POST `/auth/logout` (204), `password` POST `/auth/password`
  (PasswordChangeRequest → 204), `me` GET `/me` (Me), `computerStream` GET `/computers/:c/stream`
  (text/event-stream of StreamEvent; Authorization header, read with fetch streaming).
- New `ADMIN_ROUTES` (Bearer admin key): `createUser` POST `/admin/users` (AdminUserRequest →
  AdminUserResponse), `resetPassword` POST `/admin/users/:username/reset-password` (→ AdminUserResponse).
- New `COMPUTER_ROUTES`: `register` POST `/computers/register` (ComputerRegisterRequest →
  ComputerRegisterResponse, no auth), `connect` GET `/computers/:c/connect` (WebSocket, Bearer computer
  key), `poll` GET `/computers/:c/poll?wait=:seconds` (RelayPollResponse), `frames` POST
  `/computers/:c/frames` (RelayFramesRequest → 204).
- Export the new route maps from `src/index.ts`.

## 4. Generated types, kit copy, tests

- `npm run gen` (or the existing gen script) → `src/types.gen.ts`; `--check` must pass.
- `npm run sync-kit` (existing script) → `.agent-system/hub-protocol.schema.json` is a byte copy.
- `hub/protocol/test/contract.test.ts` keeps passing (every fixture valid, every `invalid/` fixture
  invalid, every route's body/res def exists). Add a test that every route map entry names existing defs.
- `.agent-system/tests/test_hubschema.py` must still pass against the new copy (update only fixture
  names it references if any were deleted).

## 5. `docs/hub-api.md` → v2

Rewrite for protocol 2, same structure, plus:
- Architecture paragraph (browser → proxy → relay → local backend; connector routes loopback-only).
- Auth table: session token (proxy), admin key (proxy), computer key (proxy ↔ backend), connector key
  (connector ↔ local backend), assertion (proxy → backend per request).
- Proxy routes (auth, me, admin, computers), relay semantics: frame types, request id, 30 s timeout →
  504 `computer_timeout`, no socket → 503 `computer_offline`, `cancel`, streams (`stream: true` →
  `chunk`* + `end`), 900 KB frame cap (bodies bigger than that: backend returns 413
  `payload_too_large`; documents are ≤ 1 MB, so the backend splits the `DocumentContent` response into
  chunks with `stream: true`), long-poll fallback (poll held ≤ 25 s, frames posted in batches ≤ 50).
- Assertion verification rules on the backend: signature with the pinned key, `exp` ≥ now − 0 and
  ≤ now + 120 s, `cid` = own id, `sub` = own owner, `rid` = frame id.
- Workspace list: proxy merges `/workspaces` from online computers and adds index-only entries
  (status OFFLINE, `computer_online: false`) for workspaces of offline computers seen within 15 days.
- Runs kept by the backend: upsert by (workspace, run_id); finished runs deleted 60 days after finishing.
- Passwords: PBKDF2-SHA256 20,000 iterations, 16-byte salt, per-user iteration count stored;
  login 5 attempts/min per username+IP → 429 `rate_limited`; sessions 12 h, 30 d with `remember`.
- Env vars for the backend: drop pairing ones; add `AGENT_HUB_COMPUTER` (path of `computer.json`,
  default `$AGENT_HUB_CONFIG/computer.json`), `AGENT_HUB_RECENT_DAYS` (15), `AGENT_HUB_RUN_RETENTION_DAYS` (60).

## Done when

- `cd hub && npm test -w @agent-hub/protocol` passes; `npm run typecheck -w @agent-hub/protocol` passes.
- `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py` passes.
- `hub/server` and `.agent-system` tests are **allowed to fail** after this task (other tasks fix them);
  list which fail in the report.
