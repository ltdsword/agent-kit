# Phase P3: web app (`hub/web`) on protocol 2

Goal: the React design (already imported unchanged into `hub/web/`) runs as the `@agent-hub/web` npm
workspace, keeps its mock mode, and talks to the v2 proxy through one adapter: login, change password,
workspaces across computers, decisions, prompts, documents, history, live updates. Vercel-ready.

Read first: `hub/web/README.md` (how the app is organised; follow its rules), `hub/web/src/api/types.ts`,
`client.ts`, `index.ts`, `http/HttpHubClient.ts`, `auth/HttpAuthClient.ts`; `docs/hub-api.md` (v2);
`hub/protocol/src/api.ts`; the schema; `plan.md` sections 1, 7.

## Files you own
`hub/web/**`, `hub/package.json` (only add `"web"` to `workspaces`), `hub/package-lock.json`.

## Work

1. **Workspace**: package name `@agent-hub/web`; add `"web"` to `hub/package.json` workspaces; remove
   `hub/web/package-lock.json` (the root lockfile owns deps); `npm test`, `npm run typecheck`,
   `npm run build` work from `hub/` with `-w @agent-hub/web`. Depend on `@agent-hub/protocol` (workspace)
   for types/routes/LIMITS/ERRORS — import, never redefine. Keep the existing deps; add none beyond
   what's already in its package.json unless required by the workspace move.
2. **Domain model changes** (`src/api/types.ts`, then follow TypeScript errors):
   - Workspace: `computerId`, `computerOnline`; uploads = `{documents, diffs, orchestratorScreen}`.
   - Run: `title`, `goal`. Task: `summary`; ids `T1..`. Worker: **no `screen`**.
   - Decision: keep `evidence`, `consequence`, `opusNote`, `approval` (now real fields), status
     `REPLY_SENT`; drop `WAITING`/`SUPERSEDED` unless derivable (WAITING = SENT while the workspace is
     OFFLINE: derive in the adapter).
   - Documents: kinds `final_report | final_diff | decision | research`; format adds `text` (render as
     preformatted). Drop `review`.
   - History/answers: `device` → `by` (username); channel mapping chat→terminal, hub, opus→routine.
3. **Auth** (`HttpAuthClient`): v2 routes (`/auth/login`, `/auth/logout`, `/auth/password`, `/me`),
   `expires_at` ISO → ms, error object `{error:{code,message}}` → the existing AUTH_ERRORS codes.
   Add `changePassword(current, next)` to `AuthClient` (mock too) and a **Change password** page reachable
   from AccountMenu (current, new, repeat; min `LIMITS.passwordMinChars`; errors `invalid_credentials`,
   `weak_password`). Login page text: no pairing; "Forgot it? Ask the admin to run
   `agent-kit reset-password --name=<you>`".
4. **Data adapter** (`HttpHubClient` → map v2 → UI model in a separate `src/api/http/adapter.ts` with unit
   tests): List envelopes (follow `next` cursors), snake_case/ISO → camelCase/ms, status mapping
   (ONLINE→RUNNING, RunStatus DONE+finish→MERGED/DONE per finish result, gate PASS/FAIL/null →
   PASSED/FAILED/NOT_RUN, `absent`/`done` → `off`/`idle`), scout rounds (docId = document path),
   problems (severity from type), past runs from runs with `finish`, run outcome text from `finish.result`.
   Requests: `Authorization: Bearer <session>`, `X-Agent-Hub-Protocol: 2`; 401 → sign out ("expired");
   503 `computer_offline` → mark that workspace's computer offline instead of "connection lost".
5. **Live updates**: per online computer, open `GET /api/v1/computers/:c/stream` with `fetch` streaming
   (parse SSE `event:`/`data:` lines; named events). On an event refetch only the named resource
   (workspace detail / decisions / commands / documents / history of that workspace). Reconnect with
   backoff; fall back to 10 s polling of the affected workspace while a stream is down. No `EventSource`,
   no token in URLs.
6. **UI changes**: run title + goal on RunCard (id small, title big); task summary under the title in the
   task graph and lists; remove worker screen blocks (keep the orchestrator screen); "computer offline"
   state on workspace cards and pages (data may be stale or unavailable, answers disabled with a short
   reason); History filter chip **Prompts** (off by default: prompt items hidden unless enabled); render
   `text` documents; remove pairing/device wording and `review` documents. Overview shows workspaces as
   the proxy returns them (it already applies the 15-day rule).
7. **Mock mode** keeps working with the new model (update `seed.ts`, `MockHubClient`, `MockAuthClient`
   incl. changePassword) so `npm run dev` without `VITE_HUB_URL` still demos everything.
8. **Vercel**: `hub/web/vercel.json` (SPA rewrite to `/index.html`); README section: build command,
   output dir, `VITE_HUB_URL=https://agent-hub.<subdomain>.workers.dev`, and that the proxy's
   `ALLOWED_ORIGINS` must include the Vercel URL.

## Tests
Adapter unit tests from v2 fixtures in `hub/protocol/fixtures` (workspace list with an offline computer,
detail with runs/tasks/summary, decisions incl. worker approval and REPLY_SENT, documents incl. text,
history with Prompts filter); SSE parser (split chunks, multiple events, named events); auth client
(login ok/401/429, expiry → expired, change password errors); Change password page; History Prompts
filter; existing tests updated and passing.

## Done when
`cd hub && npm test -w @agent-hub/web && npm run typecheck -w @agent-hub/web && npm run build -w @agent-hub/web` pass.
