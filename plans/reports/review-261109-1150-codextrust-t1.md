# Review codextrust T1 (code) - PASS
- codex_args: one `-c projects={...}` inline table, paths via json.dumps (valid TOML basic strings), deduped; dotted form gone.
- resume: live+launch_error -> "live but has not reported (launch timed out ...)", no relaunch; missing, or unobservable+launch_error -> relaunch; live w/o launch_error -> unchanged "running on". Matches D1 clarification.
- Tests: tomllib parse of the value, dedupe, quote in path; three resume cases. Suite in worktree: 272 passed.
- Live (Opus): Codex 0.165 `--profile worker`, never-trusted repo + outside worktree, dotted dir names -> no trust question, goes to Hooks review; ~/.codex config.toml and worker.config.toml unchanged.
- Note (pre-existing, not in scope): hc "unreachable" also maps to "missing" -> relaunch advice.
