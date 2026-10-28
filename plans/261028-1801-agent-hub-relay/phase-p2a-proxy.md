# Phase P2a: proxy (Cloudflare Worker), full version

Goal: `hub/proxy` becomes the real shared proxy of protocol 2: accounts, sessions, admin API, computer
registration, request routing and the relay (WebSocket + HTTPS long-poll fallback), plus a setup script
that provisions any Cloudflare account. Replaces the `/spike/*` routes.

Read first: `docs/hub-api.md` (v2: the contract), `hub/protocol/src/api.ts` (routes, LIMITS, ERRORS),
`hub/protocol/schemas/protocol.schema.json`, `plan.md` sections 2, 3, 10; the current `hub/proxy` spike.

## Files you own
`hub/proxy/**` (deps are pre-installed by the lead; no package.json/lockfile edits).

## Work

1. **D1 migrations** (`hub/proxy/migrations/0002_v2.sql`; drop `spike_rows`): tables from plan section 3:
   `users`, `sessions`, `computers`, `workspace_index`, `login_attempts`. Indices on `sessions.user_id`,
   `computers.user_id`, `workspace_index.computer_id`. No `must_change` column.
2. **Crypto** (`src/crypto.ts`): PBKDF2-SHA256 `LIMITS.pbkdf2Iterations`, 16-byte salt, 32-byte hash,
   base64url; constant-time compare; tokens = 32 random bytes base64url, stored as sha256 hex; random
   passwords 20 chars from an unambiguous alphabet; Ed25519 sign with the `SIGNING_KEY` secret
   (PKCS8 base64url) → assertion per the contract.
3. **Auth routes**: `POST /api/v1/auth/login` (rate limit per username+IP via `login_attempts`,
   `CF-Connecting-IP`; generic `invalid_credentials`; re-hash when stored `pw_iter` < LIMITS),
   `/auth/logout`, `/auth/password` (current must match; new ≥ 12 → else 422 `weak_password`; revoke
   the user's other sessions), `GET /api/v1/me`.
4. **Admin routes**: `Authorization: Bearer <admin key>`, compared (sha256, constant time) with the
   `ADMIN_KEY_HASH` secret; `POST /admin/users` (409 `username_taken`), `POST /admin/users/:u/reset-password`
   (revokes that user's sessions). Responses carry the plain password once; never log it.
5. **Computer routes**: `POST /computers/register` (verify password like login, incl. rate limit; create a
   computer with a new key; return the public key derived from `SIGNING_KEY`); `GET /computers/:c/connect`
   (WebSocket, Bearer computer key) → DO `ComputerRelay` named by computer id; `GET /computers/:c/poll`,
   `POST /computers/:c/frames` (same key) → same DO.
6. **ComputerRelay DO** (evolve the spike):
   - Transport: WebSocket (hibernation API) **or** long-poll (poll waits ≤ `relayPollSeconds` for queued
     frames; frames POST delivers backend → proxy frames). A computer is online if its socket is open or
     it polled in the last 40 s.
   - `relay(request, user)`: frame `req` with a new id, signed assertion, `stream` flag; await `res`
     (30 s → 504 `computer_timeout`; offline → 503 `computer_offline`). Streams: return a `ReadableStream`
     fed by `chunk` frames until `end`; browser disconnect → send `cancel`.
   - `hello` / `workspaces` frames upsert `workspace_index` rows (D1) for that computer; update
     `computers.last_seen_at`.
   - Frames > `relayFrameBytes` rejected; malformed frames counted and ignored.
7. **Routing for the browser** (session token required): `GET /api/v1/workspaces` merges the
   `/api/v1/workspaces` List from each online computer of the user (parallel, 10 s each) and adds
   index-only entries (status OFFLINE, `computer_online: false`, nulls for live fields) for workspaces of
   offline computers seen within `recentWorkspaceDays`; sets `computer_id`/`computer_online` on all.
   `/api/v1/workspaces/:ws/**` → look up `workspace_index` (must belong to the user, else 404) → relay.
   `GET /api/v1/computers/:c/stream` → relay with `stream: true` to the backend's `/api/v1/stream`.
8. **CORS**: allow origins from the `ALLOWED_ORIGINS` var (comma list) plus `http://localhost:5173`;
   methods/headers needed by the web app; credentials not used (Bearer tokens).
9. **Setup script** `hub/proxy/scripts/setup.ts` (`npm run setup -w @agent-hub/proxy -- [--rotate-admin-key]
   [--origins <list>]`): uses the wrangler CLI of the logged-in account; creates/finds D1 `agent-hub`,
   writes gitignored `wrangler.local.jsonc` with its id, applies migrations `--remote`, generates the
   Ed25519 keypair (only if `SIGNING_KEY` isn't set yet) and the admin key, `wrangler secret put`
   `SIGNING_KEY`, `ADMIN_KEY_HASH`, sets `ALLOWED_ORIGINS`, deploys, writes
   `~/.config/agent-hub/admin.key` (0600) and `~/.config/agent-hub/admin.json` `{proxy_url}`, prints the
   URL. Idempotent. Never prints secrets. Tests cover its pure helpers only (config rewrite, arg parsing).
10. Update `hub/proxy/README.md` (setup, rotate, moving to another Cloudflare account).

## Tests (local, `wrangler dev --local` / the spike's harness; no account)

Login ok / wrong password / unknown user (same error) / rate limit; logout; password change (weak,
wrong current, revokes others); `/me`; admin create (dup 409, bad key 401) and reset; register;
relay over WebSocket and over long-poll (round trip, timeout 504, offline 503, stream chunks + end,
cancel on abort); assertion verifies with the returned public key and has the right sub/cid/rid/exp;
workspace merge with one online + one offline computer; foreign workspace → 404; CORS preflight;
every request/response body with a protocol def validates against it.

## Done when
`cd hub && npm test -w @agent-hub/proxy && npm run typecheck -w @agent-hub/proxy` pass; no `/spike` routes left.
