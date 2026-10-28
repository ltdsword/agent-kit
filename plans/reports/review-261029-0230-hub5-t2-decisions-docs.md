# Review: hub5 T2, Decisions panel + document filters (`hub/server`, `hub/web`)

Verdict: **PASS**

## Checked (re-run by lead)
- Server: 8 tests pass. Web: 44 tests pass. Typecheck: 0 errors. Build OK (only Vite's chunk-size warning).
- Backend: no source change was needed. The connector routes already publish `workspace` on hello and goodbye. The worker replaced the test's hand-published event with a real `hello`; the `workspaces` frame now reaches the fake proxy from that alone.
- Web:
  - The tab and section are renamed to **Decisions**: open decisions on top, then "All decisions" from every run, newest `openedAt` first.
  - Documents is one list, newest first, with search (title, id, name, run) and **Docs / Diffs / Decisions** filter chips. Decision documents open the structured decision page (`decisionForDocument`).
  - New tests are in `WorkspacePage.test.tsx`; the adapter and mock data are updated.

## Finding outside T2 (lead fix)
- The real cause of "the proxy didn't learn the new workspace" is in the proxy, not the backend. `ComputerRelay` keeps `computerId` only in memory. After the hibernating Durable Object is unloaded and woken, a `workspaces` frame, which carries no computer id, fails the id check and is dropped as malformed. Fixed in `hub/proxy` by the lead (separate commit).
