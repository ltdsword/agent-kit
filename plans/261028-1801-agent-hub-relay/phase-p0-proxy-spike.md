# Phase P0: proxy spike (Cloudflare Worker + Durable Object relay + D1)

Goal: prove the three platform pieces the v2 proxy needs, locally first, so the lead can deploy it to
the free plan and measure. This is a spike: small, tested, but not the final proxy (P2a replaces the
`/spike/*` routes; keep the structure reusable).

Read first: `plan.md` sections 2, 3, 9 (this folder).

## Files you own

`hub/proxy/**`, `hub/package.json` (only add `"proxy"` to `workspaces`), `hub/package-lock.json`.

## Work

1. **Package** `hub/proxy/` (`@agent-hub/proxy`, private, `type: module`). Scripts: `dev`
   (`wrangler dev --local`), `test`, `typecheck`. Dev deps only: `wrangler@^4`, `typescript@~5.9`,
   `vitest`, `@cloudflare/workers-types` (or `wrangler types` output committed), and
   `@cloudflare/vitest-pool-workers` **only if** it supports a vitest version you can use in this
   workspace; otherwise test by starting `wrangler dev --local` (or `unstable_startWorker`) from
   vitest in Node and calling it over 127.0.0.1.
2. **`wrangler.jsonc`** (committed, account-neutral): `name: "agent-hub"`, `main: "src/index.ts"`,
   a recent `compatibility_date`, `compatibility_flags: ["nodejs_compat"]` only if needed;
   Durable Object binding `RELAY` → class `ComputerRelay` with a `migrations` entry using
   `new_sqlite_classes`; D1 binding `DB` with `database_name: "agent-hub"` and
   `database_id: "00000000-0000-0000-0000-000000000000"` (placeholder; the lead deploys with a local
   override). **No `account_id`, no routes, no custom domain.** `migrations/0001_spike.sql` creates
   `spike_rows(id INTEGER PRIMARY KEY, note TEXT, at TEXT)`.
3. **Worker routes** (`src/index.ts`; small modules, no framework needed):
   - `GET /health` → `{ok: true, version}` (public).
   - Every `/spike/*` route requires `Authorization: Bearer <SPIKE_KEY>` (Worker secret / `.dev.vars`
     locally); else 401 `{error:{code:"unauthorized",message}}`. Constant-time compare.
   - `POST /spike/hash {iterations}` → runs PBKDF2-SHA256 (WebCrypto, 16-byte random salt, 32-byte
     key) on a fixed test password; returns `{iterations, wall_ms}`. `iterations` 1000..100000
     (Workers' maximum), else 400.
   - `POST /spike/d1 {note}` → insert into `spike_rows`, return the row and the row count.
   - `GET /spike/computers/:id/connect` → WebSocket upgrade forwarded to the DO named `:id`
     (`idFromName`). Same Bearer check.
   - `POST /spike/computers/:id/relay` (JSON body) → DO sends `{"type":"req","id":<uuid>,"body":<body>}`
     to the connected socket and waits for `{"type":"res","id":<same>,"body":...}`; returns `body`
     (200). No socket → 503 `computer_offline`. No answer in 10 s → 504 `computer_timeout`.
     Bodies over 900 KB → 413 (chunking comes in P2a).
4. **`ComputerRelay` DO**: WebSocket Hibernation API (`ctx.acceptWebSocket`, `webSocketMessage`,
   `webSocketClose`); one socket per DO (a new connect closes the old with code 4000); pending
   requests in memory keyed by id; reply frames route back; malformed frames ignored and counted.
   Answer `{"type":"ping"}` with `{"type":"pong"}`.
5. **Echo client** `hub/proxy/scripts/echo-client.ts` (Node 24, run with
   `node scripts/echo-client.ts --url <base> --id <name>`; key from env `SPIKE_KEY`): connects with the
   built-in `WebSocket`; when `HTTPS_PROXY`/`https_proxy` is set and the host is not loopback, connect
   through it (undici `EnvHttpProxyAgent` / `ProxyAgent` as the `dispatcher`; undici is bundled in
   Node: use it only if importable without installing, else document the gap); replies to every
   `req` with `{"type":"res","id","body":{"echo": <body>, "at": <iso>}}`; reconnects with backoff
   1→30 s; logs one line per event, never the key.
6. **README** `hub/proxy/README.md`: what the spike proves, local run, and the exact lead deploy steps
   (create D1, apply migration with `--remote`, `wrangler secret put SPIKE_KEY`, deploy with a local
   config override for the real `database_id`), and how to run the timing/relay checks against the
   deployed URL. Add `wrangler.local.jsonc`, `.dev.vars`, `.wrangler/` to a `hub/proxy/.gitignore`.

## Tests (local, no Cloudflare account)

- `/health`; 401 on every `/spike/*` without/with a wrong key.
- `/spike/hash` 400 out of range; ok at 1000 and 100000 (records wall_ms only; no CPU assertion).
- `/spike/d1` insert + count (local D1 with the migration applied).
- Relay: test WebSocket client connects → relay round trip returns the echo; second connect replaces
  the first; no client → 503; client that never answers → 504 (make the timeout injectable for tests);
  413 on an oversized body; ping/pong.

## Done when

- `cd hub && npm test` passes for protocol, server and proxy; `npm run typecheck` passes.
- `npm run dev -w @agent-hub/proxy` serves locally and the echo client round-trips against it.
- Report: dependency versions chosen, the test approach, and anything the deploy might hit
  (free-plan DO/D1 config, compatibility date) as risks.
