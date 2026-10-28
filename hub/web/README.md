# Agent Hub · web UI

React + TypeScript (Vite) app for the Agent Hub: watch the agent workspaces running on your computer, answer
the decisions Opus escalates, send prompts, read job reports and look back at your choices.
It implements the UI part of `DECISION-HUB-PLAN.md` (section 12, phases H3–H5).

```bash
npm install
npm run dev        # http://localhost:5173, runs on the built-in mock backend
npm test           # unit + component tests (vitest)
npm run build      # typecheck + production build into dist/
```

Without `VITE_HUB_URL` it runs on in-memory mocks: sign in with **any username and the password `agenthub`**.
A **Simulate** button (bottom right) fires live events: Opus cancels a decision, terminal answer,
workspace offline, connection lost, held prompts, run finishes, session expires, and so on.

## Sign-in and Vercel

The UI is a static site: deploy it to Vercel with `VITE_HUB_URL=https://<your-backend>` and open it from
any computer or phone. Everyone signs in with **username + password**; signed-out visitors only ever see
the login page, and after sign-in they land on the page they first opened.

The browser only keeps a session token ("Keep me signed in" → 30 days in localStorage, otherwise until the
tab closes). **Security lives in the backend, not here.** It must:

- expose `POST /api/v1/auth/login {username, password, remember}` → `{token, expires_at, username}`
  (401 `invalid_credentials`, 429 `rate_limited`) and `POST /api/v1/auth/logout`;
- store passwords hashed (argon2id or bcrypt), rate-limit logins, and check the token on every API call
  (and on `/api/v1/stream?token=…`, since EventSource can't send headers);
- answer 401 when a token expires: the UI then signs out and shows "Your session expired";
- be reachable from wherever the browser is (Vercel only serves files; it never sees your data);
- offer a local reset, e.g. `agent-hub passwd` (the login page points to it).

The calls are in `src/auth/HttpAuthClient.ts` (draft until the backend exists).

## Where things are

```text
src/
├── auth/                     sign-in: AuthClient interface, mock + HTTP, LoginPage, AccountMenu
├── api/
│   ├── types.ts              domain model (mirrors the backend protocol). Change the schema here first.
│   ├── client.ts             HubClient interface: the ONLY way the UI talks to a backend
│   ├── index.ts              createClients(): mock or HTTP auth + data, picked by VITE_HUB_URL
│   ├── mock/                 MockHubClient (backend + connector + scheduler simulation) and seed data
│   └── http/HttpHubClient.ts real client: REST /api/v1 + SSE /api/v1/stream, 10 s polling fallback
├── state/
│   ├── HubProvider.tsx       useHub() (live snapshot), useClient(), useNow()
│   └── selectors.ts          pure functions over the snapshot (needsYou, inFlight, …)
├── lib/
│   ├── status.ts             every status → tone + icon + label, in one table
│   ├── time.ts               "4 min ago", byte sizes
│   └── theme.ts              light/dark
├── components/               shared UI: Icon, Chips, Banner, Stepper, TerminalTail, Layout, Toast, SimPanel
├── features/
│   ├── overview/             workspaces home
│   ├── workspace/            workspace page: Needs you, orchestrator, subagents, runs, documents
│   ├── decision/             decision screen: form hook, options, branch step, confirm sheet, status
│   ├── prompts/              prompt composer
│   ├── documents/            Markdown reader, diff parser + viewer
│   └── history/              timeline with filters and search
└── styles/hub.css            design tokens (named by meaning) + component classes
```

## Common changes

| To change… | Edit |
|---|---|
| A color, light or dark | the variables at the top of `styles/hub.css` (`--status-blocked`, `--needs-you`, …) |
| A status label or icon | `lib/status.ts` |
| An icon | `components/Icon.tsx` (add a path to `PATHS`) |
| What the backend sends | `api/types.ts`, then follow the TypeScript errors |
| The real backend calls | `api/http/HttpHubClient.ts` only |
| Decision form behaviour | `features/decision/useDecisionForm.ts` (state) / `DecisionForm.tsx` (markup) |
| Demo data | `api/mock/seed.ts` |
| Sign-in calls / session storage | `auth/HttpAuthClient.ts` |
| Login page text and fields | `auth/LoginPage.tsx` |

## Rules the UI keeps

- No "start workspace" or "run" action anywhere: the hub only watches. Offline/stopped workspaces stay readable.
- Prompts only when the workspace is Running. Answers to an offline workspace wait ("waiting for your computer").
- One primary action per screen. Every status has an icon and a label, never color alone. Tap targets ≥ 44 px.
- Markdown documents are rendered without raw HTML. Diffs scroll horizontally only inside the code block.
- An answer is final once delivered; the confirm sheet repeats it first.
