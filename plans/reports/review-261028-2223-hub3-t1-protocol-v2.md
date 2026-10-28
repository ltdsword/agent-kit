# Review: hub3 T1, protocol v2 contract (P1)

Verdict: **PASS**

- Scripted check of every spec item (ids, Worker no screen, Task summary, Run title/goal, Snapshot last activity,
  Option consequence, Decision evidence/note/approval, REPLY_SENT, DocumentKind, Hello/Summary upload + computer
  fields, by instead of device, Device/Pair removed, 27 new defs, password min 12): all OK.
- Kit schema copy byte-identical; api.ts PROTOCOL/MIN 2, LIMITS, ERRORS, USER/ADMIN/COMPUTER routes per spec.
- Protocol: 77 tests pass, typecheck clean, generated types --check clean; test_hubschema passes.
- docs/hub-api.md v2 has proxy/user routes, relay frames, assertion verification sections.
- Expected: server and kit suites fail against v2 until hub3 T2/T3.
