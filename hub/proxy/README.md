# Agent Hub proxy

The protocol-v2 proxy runs on Cloudflare Workers with D1 and one Durable Object per computer. It
handles login, account administration, computer registration, workspace routing, and WebSocket or
HTTPS long-poll relay. Workspace data stays on each computer.

## Provision a proxy

Log in to the Cloudflare account that will own the proxy, then run from the repository root:

```sh
npm run setup -w @agent-hub/proxy --
npm run setup -w @agent-hub/proxy -- --rotate-admin-key
npm run setup -w @agent-hub/proxy -- --origins https://app.example
```

Setup finds or creates the `agent-hub` D1 database, writes the ignored
`hub/proxy/wrangler.local.jsonc`, applies remote migrations, creates signing and admin secrets when
needed, and deploys. The admin key is saved with mode `0600` at
`~/.config/agent-hub/admin.key`; `admin.json` contains the proxy URL. Setup prints only the URL.
Pass `--origins` with a comma-separated list of browser origins. `http://localhost:5173` is always
allowed for local development.

Run setup again after logging in to another Cloudflare account to provision that account's D1,
secrets, and Worker. The account-neutral `wrangler.jsonc` stays unchanged. Existing signing keys are
kept. Use `--rotate-admin-key` to create and save a new admin key and update its hash.

## Local development

Dependencies are installed from `hub/`. Apply migrations and start the local Worker:

```sh
cd hub
npx wrangler d1 migrations apply agent-hub --local --config proxy/wrangler.jsonc
npm run dev -w @agent-hub/proxy
```

The development server listens on `http://127.0.0.1:8787`. Run the proxy suite and typecheck with:

```sh
npm test -w @agent-hub/proxy
npm run typecheck -w @agent-hub/proxy
```

The tests use Wrangler's local D1 and loopback sockets; they do not access a Cloudflare account.
