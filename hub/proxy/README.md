# Agent Hub proxy spike

This spike checks local Cloudflare Worker routing, PBKDF2 timing, D1 writes, and a Durable Object
WebSocket relay. `/spike/*` endpoints are temporary and will be replaced by the v2 API in P2a.

## Local run

From `hub/`, install the workspace dependencies with the repository's local cache settings, then
apply the local migration and start the Worker:

```sh
env -u HTTPS_PROXY -u https_proxy npm install --cache ./.npm-cache --no-audit --no-fund
npx wrangler d1 migrations apply agent-hub --local --config proxy/wrangler.jsonc
```

Create `hub/proxy/.dev.vars` with a local value such as `SPIKE_KEY=test-key`, then run:

```sh
npm run dev -w @agent-hub/proxy
```

The development server listens on `http://127.0.0.1:8787`. In another terminal, start the echo
client with the same key:

```sh
cd hub/proxy
SPIKE_KEY=test-key node scripts/echo-client.ts --url http://127.0.0.1:8787 --id local
```

The client uses `undici` when it is importable without installing a package. If `undici` cannot be
resolved in the Node runtime, it exits with a clear error because the standard global WebSocket API
cannot set the required authorization header. For non-loopback URLs, it uses `EnvHttpProxyAgent` or
`ProxyAgent` when the importable `undici` module provides one; it does not proxy loopback traffic.

Run the suite and typecheck from `hub/`:

```sh
npm test
npm run typecheck
```

The proxy tests start Wrangler locally, apply the D1 migration, and use only `127.0.0.1`. They cover
authorization, both PBKDF2 limits, D1 insertion/count, relay round-trip, replacement, offline and
timeout responses, oversized bodies, ping/pong, and the echo client.

## Deploy and check

1. Create D1 in the Cloudflare account that will own the proxy:

   ```sh
   npx wrangler d1 create agent-hub
   ```

2. Copy `wrangler.jsonc` to the ignored `wrangler.local.jsonc` and replace the placeholder
   `database_id` with the id returned by the command. Keep `wrangler.jsonc` account-neutral.
3. Apply the migration, set the spike key, and deploy using that local config:

   ```sh
   npx wrangler d1 migrations apply agent-hub --remote --config wrangler.local.jsonc
   npx wrangler secret put SPIKE_KEY --config wrangler.local.jsonc
   npx wrangler deploy --config wrangler.local.jsonc
   ```

   Enter the same random spike key when prompted for the secret. These commands are lead deploy
   steps; they are not part of the local test workflow.
4. Set `SPIKE_KEY` in the shell and run the echo client against the deployed URL. In another
   terminal, measure PBKDF2 and relay the same JSON body through the connected echo client:

   ```sh
   cd hub/proxy
   SPIKE_KEY=<spike-key> node scripts/echo-client.ts --url https://<worker-url> --id measurement
   curl -H "Authorization: Bearer $SPIKE_KEY" -H 'content-type: application/json' \
     --data '{"iterations":100000}' https://<worker-url>/spike/hash
   curl -H "Authorization: Bearer $SPIKE_KEY" -H 'content-type: application/json' \
     --data '{"message":"relay check"}' https://<worker-url>/spike/computers/measurement/relay
   ```

## Deploy risks

- Confirm the account's free plan supports both Durable Objects and D1 before P1.
- Recheck the compatibility date when deploying; the committed value is `2026-10-28`.
- Measure the returned `wall_ms` on the target plan. Local timing does not measure Workers CPU time.
- The echo client's proxy support depends on `undici` being importable without adding a dependency.
