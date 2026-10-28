---
title: Agent Hub v2: shared login proxy, data stays on each computer
status: planned
branch: hub/plan
supersedes: plans/261028-1511-agent-hub-build (steps M2-M4, A2, C1, C2)
inputs: plans/reports/review-261028-1652-hub-ui-vs-backend.md, docs/agent-hub-web/ (UI design)
---

# Agent Hub v2

## 1. Decisions (user, 2026-10-28)

| # | Decision |
|---|---|
| D-1 | One website for everyone (Vercel). One shared **proxy** on Cloudflare (Workers + Durable Objects + D1) holds accounts and relays requests. **All workspace data stays on each person's computer** (local backend + SQLite). |
| D-2 | Proxy = relay: each local backend keeps one outbound WebSocket to the proxy. No tunnel, account or open port per user. Only the proxy owner needs Cloudflare. |
| D-3 | Accounts only via CLI on the admin computer (holds the admin key): `agent-kit create-user --name=<u>`, `agent-kit reset-password --name=<u>`; both print a random password. Users change it in the app. No web registration. |
| D-4 | `agent-kit hub-login --name=<u>` on the user's computer, once per computer: password prompt (not a flag), registers the computer, links all its workspaces to the user. One user may have several computers. |
| D-5 | One command family: everything is `agent-kit ...` (incl. `agent-kit hub start/stop/status`). |
| D-6 | Portable: no account id, subdomain or database id in the repo. `agent-kit proxy-setup` provisions any Cloudflare account it is logged into (personal now: `ltdsword.workers.dev`; company later). |
| D-7 | Runs: upsert, never deleted by a snapshot; finished runs deleted 60 days after they finish. Workspaces listed if ONLINE or seen within 15 days. Prompts in History behind a filter. |
| D-8 | Run gets `title` + `goal`; run id rule. Task ids `T1, T2, ...`, `title` (short, imperative), `summary` (1-2 sentences). |
| D-9 | For subagents the hub gets state + task id/title/summary only: **no worker screens, no `task_file` documents**. Orchestrator screen, decisions, research, final report and diff still go. Task content stays local (task file, reports, commits). |
| D-10 | UI: the React design in `docs/agent-hub-web/` becomes `hub/web/`. |
| D-11 | Relay: WebSocket first, automatic HTTPS long-poll fallback (company proxy intercepts TLS and drops upgrades). |
| D-12 | Passwords: PBKDF2-SHA256, **20,000** iterations (fits the free plan's 10 ms CPU); `pw_iter` stored per user, re-hash on login if the default rises. |

## 2. Architecture

```
Browser (Vercel site) --HTTPS--> Proxy  agent-hub.<subdomain>.workers.dev
                                  Worker: auth, routing, admin API
                                  D1: users, sessions, computers, workspace_index
                                  Durable Object per computer: holds its WebSocket
                                        ^ wss (outbound, via HTTPS_PROXY if set)
User's computer ------------------------+
  local backend (hub/server, 127.0.0.1:7420, SQLite: all data)
     ^ connector (agentctl, per workspace, unchanged transport)
  agent-kit / Herdr / orchestrator / workers
```

- Browser → proxy: `/api/v1/auth/*` handled by the proxy. `/api/v1/workspaces` = proxy fans out to the
  user's online computers and merges. Any `/api/v1/workspaces/:ws/...` route → proxy looks up
  `workspace_index` (ws → computer, owner-checked) → relays to that computer's DO → WebSocket → backend.
- Live updates: one stream per online computer (`/api/v1/computers/:c/stream`), read with `fetch`
  streaming (Authorization header), not `EventSource` (no token in URLs).
- Relay frames (JSON over WS): `req {id, method, path, query, body, assertion}` → `res {id, status, body}`;
  streams: `res-start` / `chunk` / `end`. Bodies > 900 KB chunked (DO WS message limit 1 MiB).
- Assertion: proxy signs `{user, computer, exp(60 s), req id}` with Ed25519 (private key = Worker
  secret). Backend pins the proxy public key at `hub-login` and serves only requests whose assertion
  verifies and whose user is the computer's owner. The connector routes (`/api/v1/agent/*`) stay
  loopback-only and are never relayed.
- Independence (unchanged rule): proxy down or backend down never affects agents; the backend
  reconnects with backoff 1→60 s; the website shows "computer offline".

## 3. Proxy (`hub/proxy/`, TypeScript Worker, wrangler 4)

D1 tables:
- `users(id, username UNIQUE, pw_hash, pw_salt, pw_iter, must_change, created_at, updated_at)`
- `sessions(token_hash PK, user_id, created_at, expires_at, last_used_at, user_agent)` (12 h, 30 d with remember)
- `computers(id PK c_<16>, user_id, name, key_hash, created_at, last_seen_at)`
- `workspace_index(workspace_id PK, computer_id, name, status, last_seen_at)` (pushed by backends; no data)
- `login_attempts(key, window_start, count)` (5 / min per username+IP)

Routes:
- `POST /api/v1/auth/login {username,password,remember}` → `{token, expires_at, username, must_change}`;
  `POST /auth/logout`; `POST /auth/password {current,new}` (min 10 chars).
- `POST /api/v1/admin/users {username}` / `POST /admin/users/:u/reset` → `{username, password}`
  (random 20 chars); auth `Authorization: Bearer <admin key>` checked against the `ADMIN_KEY_HASH` secret.
- `POST /api/v1/computers/register {username, password, name}` → `{computer_id, computer_key, proxy_public_key}` (hub-login).
- `GET /api/v1/computers/:c/connect` (WebSocket upgrade, `Bearer <computer key>`) → DO.
- `GET /api/v1/workspaces`, `/api/v1/workspaces/:ws/**`, `/api/v1/computers/:c/stream` (session token).
- Passwords: PBKDF2-SHA256 via WebCrypto, 20,000 iterations (D-12), 16-byte salt; login rate limit 5/min.

Portability (`agent-kit proxy-setup`, runs `hub/proxy/scripts/setup.ts` with wrangler):
create/find D1 `agent-hub`, write the gitignored `wrangler.local.jsonc` with its id, apply migrations,
generate admin key (saved to `~/.config/agent-hub/admin.key`, 0600) + Ed25519 keypair, `wrangler secret put`
both, deploy, print the URL. Re-runnable (idempotent; `--rotate-admin-key`).

## 4. Local backend changes (`hub/server/`)

- One backend per computer, one owner. Remove devices, pair codes, `/pair`, user-route device auth.
- Relay client: outbound WebSocket to the proxy (`computer_key`), honours `HTTPS_PROXY` for non-loopback
  (undici `EnvHttpProxyAgent`), backoff, heartbeat 30 s, pushes `workspace_index` updates.
- User routes accept only relayed requests with a valid assertion (dispatched in-process, never over TCP).
- Runs: upsert per (workspace, run_id); delete finished runs 60 d after they finish; daily sweep.
- `GET /workspaces`: ONLINE or `last_seen_at` within 15 d (`AGENT_HUB_RECENT_DAYS`).
- Contract fixes from the review: `internal_error` code.

## 5. Protocol v2 (`hub/protocol/`, lead)

- `Run`: + `title` (≤ 80), `goal` (≤ 500); `run_id` `^[a-z0-9][a-z0-9-]{1,39}$`.
- `Task`: `id` `^T[1-9][0-9]{0,2}$`; + `summary` (20-300); drop `packet`, `owned_paths` from the upload.
- `Worker`: drop `screen`. `Document.kind`: drop `task_file`, `review`.
- `Decision`: + `evidence[] {code, note, bad}`, `Option.consequence`, `note` (Opus's rationale),
  `approval {command, cwd, why[]}`; `hub_status` + `REPLY_SENT`.
- `HelloRequest`/`WorkspaceSummary`: + `upload` settings, `orchestrator_last_activity_at`.
- Auth/relay defs: `LoginRequest/Response`, `PasswordChange`, `AdminUserResponse`, `ComputerRegister*`,
  `RelayFrame`, `Assertion`. Remove `Device`, `Pair*`.
- `PROTOCOL` → 2; connector/backend refuse 1 with a clear "update agent-kit" message.

## 6. Kit changes (`.agent-system/`)

- `run create` input `{"title", "goal", "tasks": [...]}`; validate run id, task ids, title (≤ 60, no
  trailing period, starts with a capital), summary (20-300 chars). Old runs without them stay valid.
- `decision ask`: `--evidence "code :: note"` (repeat, `!` prefix = bad), `--option "A=label :: consequence"`,
  `--note`. Worker approvals carry `approval`.
- Connector: no worker screens, no `task_file` docs, protocol 2, run title/goal + task summary.
- Commands: `create-user`, `reset-password`, `hub-login`, `hub start/stop/status`, `proxy-setup`
  in `scripts/install.sh` → small Python helpers (stdlib; uses the system proxy for the proxy URL).
- Deny rule: `Read(~/.config/.wrangler/**)`; `admin.key` already under `~/.config/agent-hub/**`.

## 7. Web (`hub/web/`)

Move `docs/agent-hub-web/agent-hub-web` → `hub/web` (keep mock mode). Replace the HTTP clients with an
adapter for protocol v2 (List pages, snake_case/ISO → UI model, error object, named stream events,
`fetch` streaming). Add: forced change-password screen (`must_change`), "Change password" in
AccountMenu, computer-offline states, History "Prompts" filter, run title/goal, task summary; remove
worker screens, pairing text, `review` docs. Deploy to Vercel with `VITE_HUB_URL=<proxy URL>`.

## 8. Schedule

| Step | Owner | Depends on | Status |
|---|---|---|---|
| P0 proxy spike: Worker + DO relay echo + D1 + PBKDF2 timing, local tests | codex | none | done 2026-10-28 (run hub2, PASS) |
| P0-deploy: `wrangler deploy` to ltdsword, measure CPU, pick iterations, WS through HTTPS_PROXY | lead + user OK | P0 | done 2026-10-28 (see 10) |
| P1 protocol v2 + `docs/hub-api.md` v2 | lead | P0-deploy | todo |
| P2a proxy full (auth, admin, register, routing, relay, setup script) | codex | P1 | todo |
| P2b backend: relay client, assertion, remove pairing, runs upsert/retention, 15 d | codex | P1 | todo |
| P2c kit: run/task rules, decision extras, connector v2, agent-kit commands | codex | P1 | todo |
| P3 web: move design to `hub/web`, v2 adapter, password screens | codex | P1 | todo |
| P4 end to end: two backends via the deployed proxy, Vercel deploy | lead + user | P2*, P3 | todo |

P2a, P2b, P2c, P3 run in parallel (disjoint paths). Old step A2 (command delivery) folds into P2c.

## 9. Risks

| Risk | Mitigation |
|---|---|
| PBKDF2 over 10 ms CPU on free plan | P0 measures; lower iterations + rate limit + random passwords; or $5 plan |
| Durable Objects / D1 not on the free plan | P0 deploy fails loudly → decide before P1 |
| Corporate proxy blocks outbound WebSocket | P0-deploy test from this machine through `HTTPS_PROXY`; fallback: long-poll relay over HTTPS |
| Proxy compromise exposes traffic in transit | accepted (proxy owner trusted); no bodies logged; assertion + owner check limit blast radius |
| Free-plan request budget (100k/day) | stream instead of polling; adapter refetches only what changed |

## 10. P0-deploy results (2026-10-28, https://agent-hub.ltdsword.workers.dev)

| Check | Result |
|---|---|
| Durable Object (SQLite class) + D1 on the free plan | accepted at deploy; D1 insert works (2 ms CPU) |
| PBKDF2-SHA256 CPU per request | 10k: 4 ms; 20k: 12 ms; 50k: 23 ms; 100k: 20-58 ms. All `ok` (free plan didn't kill > 10 ms, but that's not guaranteed) |
| Relay round trip, direct internet | WebSocket connects, 4/4 relays 200, 0.4-1.1 s from this machine |
| Relay through the company proxy | **fails**: the proxy intercepts TLS (cert issuer "ZaloGroup Proxy EC CA") and drops the WebSocket upgrade (Worker sees no Upgrade → 426). Plain HTTPS through it works. |

Consequences for P1/P2:
- Relay client: WebSocket first; automatic fallback to an **HTTPS long-poll relay** (`GET /computers/:c/poll` held ≤ 25 s, `POST /computers/:c/reply`) when the upgrade fails. Works through TLS-intercepting proxies. ~3.5k requests/day per idle computer.
- Password hash: store iterations per user (`pw_iter`); default per the user's choice, re-hash on login when the default rises.
- Note: traffic sent through a TLS-intercepting proxy is readable by its operator; prefer direct or WebSocket when available.
