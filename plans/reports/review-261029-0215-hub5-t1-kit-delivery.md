# Review: hub5 T1, command delivery + setup order (`.agent-system`)

Verdict: **PASS**, with one lead fix.

## Checked
- `python3 -m unittest discover -s .agent-system/tests`: 143 OK (re-run by lead).
- **Answer:** `scheduler.decision_answer(channel="hub", by=command.by, quote=note or label)`. A `SchedulerError` is acked `REJECTED` with its scrubbed message.
- **Notice texts** follow the contract (`[hub] D3 answered by …`, reply, prompt) and are scrubbed.
- **Acks:** orchestrator blocked or not live → `HELD`; other errors → `FAILED`.
- **No double typing:** `hub-log.jsonl` is written before acking and is checked on restart.
- **Network:** loopback with no proxy (`ProxyHandler({})`).
- The orchestrator template gets the `[hub]` rules. `hubctl` covers the setup order, `hub stop` waiting, and `enable` keeping the config formatting.

## Lead fix
- Commands were long-polled with `wait=25` in the same loop as the 5 s sync. Each idle loop then took about 30 s, which would have delayed decisions and screen updates on the website. Changed to `wait = sync interval` (5 s, capped at 25) and updated the test that pinned `25`.
