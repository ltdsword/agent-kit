# Review hcpanel T2 (wiring) - PASS
- Store(on_save=None); save calls on_save after write_board, exception -> one stderr line. Scheduler sets store.on_save = _sync_herdr_tasks (enabled check, then herdr_tasks.sync(self, state)) per D1.
- run_create: tasks enabled -> herdr_tasks.show_panel, no run board; else board path unchanged. Config herdr.tasks bool. README row.
- Tests: base setup patches herdr_tasks; save/sync, raising sync, run create both paths, config. Suite 292 passed with HC_TERMINAL_ID set; ~/.herdr/tasks gained no task list (only Herdr's own periodic files changed).
