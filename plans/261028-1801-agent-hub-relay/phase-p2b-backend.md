# Phase P2b: local backend for protocol 2 (relay client, owner auth, runs kept)

Goal: `hub/server` speaks protocol 2: one owner per computer, user routes reachable only with a valid
proxy assertion, an outbound relay client (WebSocket first, HTTPS long-poll fallback), runs upserted and
kept 60 days after finishing, workspaces listed for 15 days. Pairing and devices are gone.

Read first: `docs/hub-api.md` (v2), `hub/protocol/src/api.ts`, the schema, `plan.md` sections 2, 4, 10,
the current `hub/server/src/*` and its test.

## Files you own
`hub/server/**` (`undici` is already a dependency; no package.json/lockfile edits).

## Work

1. **Protocol 2**: all bodies per the v2 schema (Task summary, no worker screens, decision evidence /
   note / approval / option consequence, `REPLY_SENT`, `by` instead of `device`, hello `upload`,
   summary `upload`/`orchestrator_last_activity_at`/`computer_id: null`/`computer_online: true`/
   `active_run.title`). New SQL migration `002-v2.sql` (don't edit 001): drop devices/pair_codes tables,
   add columns needed. `REPLY_SENT` derivation: a reply command for the decision is DELIVERED and the
   decision has no answer and is still PENDING locally.
2. **Remove** devices, pair codes, `/pair`, `/devices`, `agent-hub pair`/`devices` CLI, device-token auth,
   `/stream?token=`.
3. **Computer config**: read `computer.json` (`AGENT_HUB_COMPUTER`, default `$AGENT_HUB_CONFIG/computer.json`):
   `{proxy_url, computer_id, computer_key, proxy_public_key, username}` (written by `agent-kit hub-login`).
   Missing → relay off, log one line, everything else works (connector routes still serve).
4. **User-route auth**: every user route requires header `X-Hub-Assertion`; verify per the doc (Ed25519
   with `proxy_public_key`, `exp` window, `cid`, `sub` = `username`, `rid` = relay frame id; for direct
   TCP calls with no frame the `rid` check is skipped only in tests via an injected verifier). Failure →
   401. Commands created from the hub get `by = sub`.
5. **Relay client** (`src/relay.ts`, started by `serve` when `computer.json` exists):
   - Transports, in order, remembering the last one that worked: (a) WebSocket direct to
     `<proxy_url>/api/v1/computers/<id>/connect`; (b) long-poll direct; (c) long-poll through
     `HTTPS_PROXY` (undici `EnvHttpProxyAgent`; Node uses the system CA store: run with
     `--use-system-ca` / `NODE_USE_SYSTEM_CA=1`, document it). WebSocket needs auth headers on the
     handshake: use `undici`'s `WebSocket` (add `undici` as a runtime dependency).
   - On connect send `hello` (`RelayHello` with the index of every workspace this backend knows);
     send `workspaces` whenever a workspace's name/status/last_seen changes (debounced 2 s).
   - For each `req` frame: dispatch **in process** to the Hono app (`app.fetch(new Request(...))` with
     `X-Hub-Assertion` from the frame), reply with `res`; `stream: true` → pipe the SSE response as `chunk`
     frames, then `end`; `cancel` aborts it. Responses over `LIMITS.relayFrameBytes` → for
     `DocumentContent` stream it in chunks (`stream: true` path), otherwise 413 `payload_too_large`.
   - Heartbeat (`ping`) every 30 s on WebSocket; backoff 1→60 s on failure; never crash the server.
6. **Runs**: snapshot handling upserts each run by (workspace, run_id), never deletes runs missing from a
   snapshot; a sweep (on start + hourly) deletes finished runs (DONE/FAILED with `finish.at`, or status
   DONE/FAILED older than 60 d by `created_at` when there's no finish) older than
   `AGENT_HUB_RUN_RETENTION_DAYS` (60), with their decisions/events/documents rows for that run.
   `WorkspaceDetail.snapshot.runs` = runs from the DB (newest first), not only the last snapshot.
7. **Workspace list**: `GET /workspaces` returns ONLINE ones plus others with `last_seen_at` within
   `AGENT_HUB_RECENT_DAYS` (15); `?all=true` returns all.
8. **CLI**: `serve` (unchanged flags) and `status` (prints relay transport, connected or not, owner;
   never secrets). Remove `install-service` only if it references pairing; else keep.

## Tests
Assertion verify (good, bad signature, expired, wrong cid/sub/rid); routes 401 without assertion;
`by` on commands; REPLY_SENT; run upsert keeps a run absent from a later snapshot; retention sweep with a
fake clock; 15-day list and `?all=true`; relay client against a fake proxy (WebSocket and long-poll
servers in the test): hello on connect, req → res round trip, stream chunks + end, cancel, 413 for an
oversized non-document body, document over 900 KB streamed, workspaces frame on change, reconnect with
backoff; every body with a def validates (v2).

## Done when
`cd hub && npm test -w @agent-hub/server && npm run typecheck -w @agent-hub/server` pass.
