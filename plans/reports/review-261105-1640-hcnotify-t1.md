# Review hcnotify T1 - connector delivers notices while working (Opus)

Verdict: PASS

- `_deliverable`: READY_STATES, or hc backend + `working`; blocked/absent/unknown still hold; legacy unchanged.
- `_send_notice`: ready -> `agent_prompt` as before; hc+working -> `hc send <target> <text>` (no `--force`),
  OSError/timeout/non-zero -> SchedulerError, so existing retry/FAILED paths apply.
- Used at all three hold points (`_type_hub_notice`, `_deliver_command`, `_retry_hub_commands`); scrub kept.
- Tests: the 5 packet cases; one old assertion (no send while working) updated to the new behaviour, as intended.
- Whole suite 247 passed (Opus rerun, Herdr env removed). Live check after integrate.
