# Review: hub9 T1 kit questions, docs, delivery

Verdict: PASS (2 small hook fixes by Opus before commit)

## Checked
- Delivery: constants HUB_RETRY_DELAYS (1,2,4,8,16,16,16,16), 32 s interval, 10 min timeout; idle-only typing; prompts/replies ack HELD "waiting for Opus…", re-offered HELD keeps schedule, DELIVERED on success, FAILED "Opus stayed busy for 10 minutes; not delivered"; answer notices dropped with log after 10 min. Watch loop long-poll shrinks to 1 s while anything is scheduled.
- Inbox: `scheduler.py ask` / `agentctl ask`, inbox run excluded from newest/active run and runs list, decisions synced; pruning to 100 never drops OPEN.
- Documents: `run create --plan`, review report paths stored by mark-reviewed; `agentctl publish/unpublish` manifest with path/suffix/size/secret checks; kinds by path rule.
- Hooks: PreToolUse AskUserQuestion → inbox + deny with wait commands when connector alive; PostToolUse Write|Edit auto-publishes plans/ and docs/ .md; install.sh merges template hooks by command, idempotent.
- 178 kit tests + `bash -n install.sh` pass (rerun by Opus).

## Opus fixes
- Hub not connected: hook returns no output (was "allow"), test updated.
- Wait command in deny reason uses `python3 .agent-system/scheduler.py`.

## Notes
- Delivery schedule is in memory; a connector restart restarts the schedule for held prompts (backend re-offers HELD after 5 s).
