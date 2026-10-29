# Review: hub6 T1, reboot survival + legacy runs (`.agent-system`)

Verdict: **PASS**

## Checked (re-run by lead)
- Kit suite: 152 OK. No stray connector processes left by the tests.
- **Legacy runs:** `_legacy_run` maps old task ids to `T<n>`, cuts titles to 59 chars + `…`, writes a `(legacy task)` summary, and falls back to the run id for the title and `Legacy run <id>` for the goal. `_snapshot_runs` validates each run on its own; a run that is still invalid is skipped and logged once (`LEGACY_RUN_LOGGED`).
- **Orchestrator lookup:** if the name lookup fails, it uses a herdr agent of the configured kind whose resolved `cwd` equals the workspace, and targets its pane id.
- **Autostart:** a systemd user unit (`Type=oneshot`, `ExecStart`/`ExecStop` = `install.sh hub start|stop`, `WantedBy=default.target`), then `daemon-reload` and `enable --now`. `off` runs `disable --now` and removes the unit. A clear message is printed when `systemctl` is missing.
- The workspace registry, `hub start`/`hub stop` for every registered workspace, and README rows are covered by tests (fakes only).
