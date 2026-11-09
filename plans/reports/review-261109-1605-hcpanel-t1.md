# Review hcpanel T1 (mirror module) - PASS with Opus fix
- herdr_tasks.py: enabled/sync/show_panel per packet; never raises; atomic map file; fingerprint skip; dependency order + --after; adopt via Herdr Store (lock), backup "skipped" marker, hc label.
- Opus fix: `_agent_address` required a reported agent state, so a worker stuck on a startup screen (no status yet) was never attached. Now: any `hc get` record with state "live" and an address.
- Live (Opus, real herdr-task/hc, scratch folder): T1 RUNNING -> HPLI-1 running, agent t2s attached, label herdr.task set, status Working; T2 PENDING -> todo waiting_for [1]. T1 MERGED -> done, T2 waiting cleared; T2 REVIEW -> running + status. Cleaned up (tasks, store file, label).
- Tests: 14 module tests pass.
