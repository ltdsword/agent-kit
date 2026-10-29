# Review: hub6 T2, scheduler fixes (`.agent-system/scheduler.py`)

Verdict: **PASS**

## Checked (re-run by lead)
- Kit suite in the worktree: 151 OK.
- **Stale reports:** on dispatch and relaunch, `_archive_report` moves `reports/<T>.json` to `<T>.attempt<N>.json` (with a suffix if that name is taken) and records a fresh `dispatched_at`. A report is accepted only if its task id matches and it is newer than `dispatched_at`; old state without `dispatched_at` still works.
- **Unblock notes:** `task-unblock --note` is stored as `lead_note` and shown as "Lead note: ..." in the dispatch/relaunch prompt and the packet header.
- **Partial work:** a re-dispatched BLOCKED/FIX_REQUIRED task with a dirty worktree reuses its own slot and branch when that slot is free. Otherwise it saves the changes as a `WIP: preserve <T> partial work` commit on the recorded branch, and refuses (with a clear error) if the worktree is on a different branch. Nothing is discarded.
- **`run create`:** refuses packets, and `plans/`/`gen-tasks/` files named under "Read first", that aren't tracked and unmodified at the base.
- **Test isolation:** `TestStart` uses the template config with the hub disabled.
