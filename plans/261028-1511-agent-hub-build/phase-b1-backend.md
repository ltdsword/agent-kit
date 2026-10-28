# Phase B1: backend (`hub/server`)

Goal: `agent-hub serve` implements the whole API in `docs/hub-api.md` (connector routes, user
routes, commands queue, pairing, SSE) on Node 24 with the built-in `node:sqlite`. There's no UI
yet: serve `hub/web/dist` if it exists, else a one-line placeholder page.

Read first:
- `docs/hub-api.md`: all of it; this is the spec.
- `hub/protocol/src/{index,api}.ts`: types, `validate`, routes, `LIMITS`, `ERRORS`; import them,
  don't redefine them.
- `hub/protocol/fixtures/` (example bodies).
- Plan sections 5, 7.4, 11, 13 and 14 (`.agent-system/docs/DECISION-HUB-PLAN.md`).

## Files you own

`hub/server/**`, and adding `"server"` to the `workspaces` array of `hub/package.json`. Never edit
`hub/protocol/**`, `hub/web/**`, `.agent-system/**` or `docs/**`. If the contract seems wrong or
incomplete, stop and report it instead of working around it.

## Stack (decided)

- Node 24, ESM, **TypeScript run directly by Node** (type stripping: no build step; `.ts` import
  extensions, no enums, no parameter properties). `tsc --noEmit` for typechecking.
- Hono + `@hono/node-server`. SQLite: `node:sqlite` (`DatabaseSync`), WAL mode, plain SQL
  migrations in `hub/server/migrations/NNN-name.sql`, applied in order and tracked in a
  `schema_migrations` table.
- One data-access module (`src/db.ts`) owns all SQL; routes never write SQL themselves.
- Tests: vitest, with a temp data dir per test and the app called in-process
  (`app.request(...)`). One real-socket test for long-poll and SSE.
- Install: `cd hub && source ~/.nvm/nvm.sh && nvm use 24 && env -u HTTPS_PROXY -u https_proxy npm install`.
  Minimal dependencies: `hono`, `@hono/node-server`, `@agent-hub/protocol` (workspace); dev:
  `typescript ~5.9`, `vitest`, `@types/node`.

## Layout

```text
hub/server/
├── package.json        # name @agent-hub/server, bin agent-hub -> src/cli.ts, scripts: start, test, typecheck
├── tsconfig.json       # like hub/protocol/tsconfig.json
├── migrations/001-init.sql   # plan section 11.1 tables, adapted (TEXT ISO timestamps)
├── src/cli.ts          # agent-hub serve | pair --name N | devices [revoke ID] | install-service
├── src/app.ts          # builds the Hono app (deps injected: db, clock, config) — used by tests
├── src/config.ts       # env vars (api doc section 8), dirs, connector key create/load (0600)
├── src/db.ts           # migrations + every query
├── src/auth.ts         # bearer middleware (connector vs device), pairing codes, token hashing
├── src/connector-api.ts
├── src/user-api.ts
├── src/status.ts       # hub_status derivation (api doc section 5), history building
├── src/stream.ts       # SSE hub (in-process pub/sub)
└── test/*.test.ts
```

## Requirements (all from `docs/hub-api.md`, summarized)

1. Protocol header handling (426), JSON errors with `ERRORS` codes, schema validation of every
   body with `validate()` (400 with the first error), size limits (413).
2. Auth: connector key and device tokens (sha256 stored); 401/403 matrix; `/pair` with single-use,
   10-minute codes and 5 failures per minute per IP → 429; `/stream?token=`.
   - `agent-hub pair --name` writes the code hash straight into the DB (same machine) and prints
     the code plus `http://127.0.0.1:7420/#pair=<code>`.
   - `install-service` writes a systemd user unit (`~/.config/systemd/user/agent-hub.service`,
     `Restart=always`) and prints the `systemctl --user enable --now` line; it doesn't run it.
3. Connector routes:
   - hello (create/update workspace, session, duplicate rule, hashes);
   - goodbye;
   - liveness and the OFFLINE timer (90 s, checked every 10 s, injectable clock);
   - snapshot (workspace id must match; derive `runs`);
   - decisions upsert + `hub_status` recompute + stream events;
   - events (dedupe, cursor);
   - documents (sha256 check, soft delete);
   - commands long poll (wait ≤ 25 s, early wake on new command, HELD retry after 5 s, never
     expired ones) and ack (status table, idempotent).
4. User routes as in api doc section 6, including:
   - the answer checks (OPEN/REJECTED only, option/followup/value rules → 409/422);
   - reply and prompt ONLINE-only rules;
   - prompt expiry 30 min (an expiry sweep marks EXPIRED);
   - history building (types, stable ids);
   - lists with `{items, next}` cursors;
   - archive.
5. SSE: one event per change (workspace status, snapshot, decision, command, document, history) to
   all streams, `: ping` every 15 s.
6. CORS for `AGENT_HUB_ORIGINS`; bind to 127.0.0.1 unless `--i-know`.
7. Static: serve `hub/web/dist` at `/` if present (SPA fallback to `index.html`), else a placeholder.
8. Every response body for a route with a `$def` validates against it (assert in tests).

## Tests (minimum)

- One test per route: happy path, plus auth (no token / wrong kind / revoked).
- Fixtures replay: send every connector fixture (`HelloRequest`, `Snapshot.*`, `DecisionsBatch`,
  `EventsBatch`, `DocumentsBatch`) and check the user views (`WorkspaceDetail`, `List<HistoryItem>`,
  `DocumentContent`) validate and contain them.
- The `hub_status` table: one case per row.
- Command lifecycle:
  - answer → poll → ack DELIVERED, then a decision sync → DELIVERED/APPLIED;
  - REJECTED → answerable again;
  - HELD → re-polled after 5 s;
  - prompt expiry;
  - long poll wakes early.
- Workspace lifecycle: ONLINE → OFFLINE after 90 s (fake clock) → ONLINE on a request; goodbye →
  STOPPED; duplicate session 409; a wiped DB → `known: false`.
- Isolation: workspace A's data is never visible through workspace B's routes.
- SSE: a decision upsert emits a `decision` event to a connected stream.

## Done when

- `cd hub && npm test` and `npm run typecheck` pass (protocol + server).
- `node hub/server/src/cli.ts serve` starts with a temp `AGENT_HUB_DATA`/`AGENT_HUB_CONFIG`, and a
  curl of `/api/v1/agent/ping` with the created key returns a valid `PingResponse`.
- Your report lists: files, the design choices not dictated by the spec, contract gaps found (don't
  change the contract), and open questions.
