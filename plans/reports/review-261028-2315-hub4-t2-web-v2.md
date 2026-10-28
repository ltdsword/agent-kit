# Review: hub4 T2, web app on protocol v2 (`hub/web`)

Verdict: **PASS**

## Checked (re-run by lead)
- `npm test -w @agent-hub/web` passed 40 tests; typecheck had 0 errors; build OK (only Vite's chunk-size warning).
- The API constants and generated types are re-exported from `@agent-hub/protocol` (`src/api/protocol.ts`), not redefined. The worker re-exports the files directly because the validator barrel (AJV) doesn't typecheck under the web compiler settings.
- Requests send `Authorization: Bearer` and the protocol header (`PROTOCOL_HEADER` = 2). A 401 signs the user out, and `computer_offline` marks that workspace's computer offline.
- Live updates use a fetch-based SSE parser (`sse.ts`, with tests). There's no `EventSource` and no token in URLs.
- The History **Prompts** chip is off by default (`prompt: false`).
- The Change password page is tested. The login page has no pairing text.
- v2 → UI mapping lives in `adapter.ts`, with tests built from the protocol fixtures. Mock mode is kept.
- `vercel.json` (SPA rewrite) and a README section are added.
- The worker's out-of-scope `hub/server/src/cli.ts` change was only the npm file mode; restored.

## Notes
- No forced password change on first login: by design (the user decided "no `must_change`"; the P2a spec says no `must_change` column).
