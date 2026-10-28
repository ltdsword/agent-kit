# Review: hub1 T1, kit connector sync (phase A1)

Verdict: **PASS**

## Checked
- Scheduler diff: `log_event` `n` counter + trim kept; `decision_ask` hub hint (online needs backend online,
  heartbeat < 90 s, live pid; any error → offline); `doctor` hub checks only when enabled, ping lazily
  imported from agentctl, backend down = warn.
- agentctl: ProxyHandler({}) on every request; canonical hash matches contract; scrubber applied to
  snapshot, hello, documents, log lines; key never printed; 409 duplicate → exit 2; goodbye + pidfile
  cleanup + offline hint in `finally`; backoff 1→60 s; resync by hello hashes after reconnect.
- kitstart: connector start is best-effort, never fails start.
- Tests: 120 OK (`python3 -m unittest discover -s .agent-system/tests`).
- Real-data dry run (hub1 state copied to a temp workspace with an id): hello, snapshot, 2 decisions,
  3 documents all validate. 0 events because hub1 events predate `n` (expected per spec).

## Minor (follow-up, not blocking)
- Idle loop wakes every 0.5 s and runs `herdr agent get` for the orchestrator on every wake (~2 subprocess
  calls/s). Check liveness only when `due`. Fix in A2.
- Snapshot hash excludes `taken_at`; if the backend hashes differently, the first post-hello snapshot is
  resent once. Harmless; confirm at M1.
- Backend integration unverified until M1 (real `watch` against T2 server).
