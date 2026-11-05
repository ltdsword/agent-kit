# hcpid: PID checks must confirm the process is ours (05/11/26)

## Goal
A PID file whose number was reused by another process (after a reboot) is treated as stale: the connector
starts, `stop` never signals a stranger, status says not running. Seen live: agent-kit's
`.orchestrator/hub-connector.pid` held 2640, which after the reboot belonged to another workspace's connector;
`agent-hub.service` skipped agent-kit (hub offline all afternoon) and `agentctl stop` would have killed it.

## Facts (Opus, verified 05/11/26 on Linux)
- Connector argv (kitstart.start_connector): `[python, <ws>/.agent-system/agentctl.py | <kit>/agentctl.py,
  "watch", ("--no-orchestrator")]`, cwd = ws. `/proc/<pid>/cmdline` (NUL-separated) and `/proc/<pid>/cwd`
  are readable for own processes. Example other workspace: cmdline `.../BanCaZagooMW.workspace/.agent-system/
  agentctl.py watch --no-orchestrator`, cwd that workspace.
- Backend argv (hubctl start): `[node, <src>/hub/server/src/cli.ts, "serve"]`, cwd `<src>/hub`.
- macOS has no /proc: there use `ps -o command= -p <pid>` for the command line; cwd is unknown.

## Read first
- `.agent-system/agentctl.py`: `pid_alive` (~1099), `command_watch` pidfile check (~1488), status (~1743),
  `command_stop` (~1748).
- `.agent-system/hubctl.py`: connector restart loop (~196), backend start (~349), stop (~384), status (~486).
- `.agent-system/kitstart.py`: `start_connector` (~248).
- tests: `test_agentctl.py`, `test_hubctl.py`, and the start_connector tests in `test_scheduler.py`.

## Steps
1. agentctl.py: add `process_command(pid, runner=subprocess.run) -> str | None` (Linux: `/proc/<pid>/cmdline`
   with NULs -> spaces; else `ps -o command= -p <pid>`; None when unknown) and
   `process_cwd(pid) -> Path | None` (`/proc/<pid>/cwd` readlink; else None).
2. agentctl.py: `connector_alive(pid, ws) -> bool`: `pid_alive(pid)` and, when the command is known, it
   contains `agentctl` and `watch` and (str(ws.resolve()) is in the command, or process_cwd == ws.resolve());
   command unknown -> fall back to `pid_alive`. `backend_alive(pid) -> bool`: same idea, command contains
   `cli.ts` and `serve`.
3. Use them: every check of `hub-connector.pid` (agentctl watch/status/stop, hubctl connector loop,
   kitstart.start_connector) -> `connector_alive`; every check of `hub.pid` (hubctl start/stop/status) ->
   `backend_alive`. agentctl imports kitstart (line 24), so kitstart must not import agentctl at module
   level: give kitstart the same small connector check locally (or a lazy import inside the function). A non-matching PID is "stale": start
   overwrites the PID file, stop prints the stale message and sends no signal.
4. Tests (fakes; monkeypatch the /proc readers or pass a fake runner): reused PID with another workspace's
   command -> watch starts, stop sends no signal, kitstart starts the connector, hubctl loop starts it;
   matching command -> treated as running; command unknown -> pid_alive fallback; backend: reused pid with a
   non-node command -> stale (no SIGTERM).

## Boundaries
**You may edit:** `.agent-system/agentctl.py`, `.agent-system/hubctl.py`, `.agent-system/kitstart.py`,
`.agent-system/tests/test_agentctl.py`, `.agent-system/tests/test_hubctl.py`,
`.agent-system/tests/test_scheduler.py` (only its start_connector tests).
**You must not edit:** scheduler.py, hub/**, docs, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `hc`, `herdr*`, `agentctl.py watch|stop|enable`, `hubctl.py hub ...`, systemctl, kill;
git push/merge/rebase/reset/checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Do not
- Signal any real process in tests; change the PID file locations or formats; print secrets.

## Done when
- [ ] All five call-site groups use the owned check; tests listed pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
