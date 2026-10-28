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

The browser signs in with a username and password. Session tokens are sent in the `Authorization` header;
workspace data stays on the computers connected to the proxy. The UI supports mock mode when
`VITE_HUB_URL` is unset.

For Vercel, set the project Root Directory to `hub`, Build Command to
`npm run build -w @agent-hub/web`, and Output Directory to `web/dist`. Set
`VITE_HUB_URL=https://agent-hub.<subdomain>.workers.dev`. Add the deployed Vercel URL to the proxy's
`ALLOWED_ORIGINS` setting. `vercel.json` rewrites app routes to `/index.html`.

## Where things are

```text
src/
├── auth/                     sign-in: AuthClient interface, mock + HTTP, LoginPage, AccountMenu
├── api/
│   ├── types.ts              UI domain model
│   ├── client.ts             HubClient interface: the ONLY way the UI talks to a backend
│   ├── index.ts              createClients(): mock or HTTP auth + data, picked by VITE_HUB_URL
│   ├── mock/                 MockHubClient (backend + connector + scheduler simulation) and seed data
│   └── http/                 protocol v2 adapter, REST client and fetch-stream SSE parser
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
| The real backend calls | `api/http/HttpHubClient.ts` and `api/http/adapter.ts` |
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
