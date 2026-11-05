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

## Collect - attempt 1: ambiguous (05/11/26 16:58)

Report and git disagree; not accepted for review:
- report base_sha does not match the leased base SHA

## Collect - attempt 1: ambiguous (05/11/26 16:58)

Report and git disagree; not accepted for review:
- report base_sha does not match the leased base SHA

## Worker result - attempt 1 (05/11/26 17:00)

- Status: **done** (worker worker-1, branch `agent/hcpid-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/agentctl.py`, `.agent-system/hubctl.py`, `.agent-system/kitstart.py`, `.agent-system/tests/test_agentctl.py`, `.agent-system/tests/test_hubctl.py`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py .agent-system/tests/test_hubctl.py .agent-system/tests/test_scheduler.py -k 'process_command or process_cwd or connector_alive or backend_alive or belongs_to_another_workspace or keeps_a_matching_connector_pid or status_reports_foreign_connector_pid or stop_does_not_signal_foreign or restarts_connector_pid_from_another_workspace or replaces_foreign_backend_pid or stop_does_not_signal_foreign_backend_pid or status_reports_foreign_backend_pid or connector_start_restarts'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py .agent-system/tests/test_hubctl.py .agent-system/tests/test_scheduler.py -k 'process_command or process_cwd or connector_alive or backend_alive or belongs_to_another_workspace or keeps_a_matching_connector_pid or status_reports_foreign_connector_pid or stop_does_not_signal_foreign or restarts_connector_pid_from_another_workspace or replaces_foreign_backend_pid or stop_does_not_signal_foreign_backend_pid or status_reports_foreign_backend_pid or connector_start_restarts'` -> exit 0
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k backend_alive` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_agentctl.py -k backend_alive` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
  - `git diff --check` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/hcpid/reports/T1.diff`

````text
 .agent-system/agentctl.py             |  59 ++++++++++++++++-
 .agent-system/hubctl.py               |  12 ++--
 .agent-system/kitstart.py             |  11 +---
 .agent-system/tests/test_agentctl.py  | 116 ++++++++++++++++++++++++++++++++++
 .agent-system/tests/test_hubctl.py    |  60 ++++++++++++++++++
 .agent-system/tests/test_scheduler.py |  18 ++++++
 6 files changed, 259 insertions(+), 17 deletions(-)
````

````diff
diff --git a/.agent-system/agentctl.py b/.agent-system/agentctl.py
index 41ba904..7eb19a3 100644
--- a/.agent-system/agentctl.py
+++ b/.agent-system/agentctl.py
@@ -1110,6 +1110,58 @@ def pid_alive(pid: int) -> bool:
         return False
 
 
+def process_command(pid: int, runner=subprocess.run) -> str | None:
+    if sys.platform.startswith("linux"):
+        try:
+            command = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(
+                "utf-8", errors="replace").strip()
+        except OSError:
+            return None
+        return command or None
+    try:
+        result = runner(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True,
+                        check=False)
+    except OSError:
+        return None
+    if result.returncode != 0:
+        return None
+    command = result.stdout.strip()
+    return command or None
+
+
+def process_cwd(pid: int) -> Path | None:
+    if not sys.platform.startswith("linux"):
+        return None
+    try:
+        return Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
+    except OSError:
+        return None
+
+
+def connector_alive(pid: int, ws: Path) -> bool:
+    if not pid_alive(pid):
+        return False
+    command = process_command(pid)
+    if command is None:
+        return True
+    if "agentctl" not in command or "watch" not in command:
+        return False
+    ws = ws.resolve()
+    # The workspace's own script path, or (kit copy started with cwd=ws) the exact working folder;
+    # a bare `str(ws) in command` would also match a sibling folder such as `<ws>-2`.
+    return str(ws / ".agent-system" / "agentctl.py") in command or process_cwd(pid) == ws
+
+
+def backend_alive(pid: int) -> bool:
+    if not pid_alive(pid):
+        return False
+    command = process_command(pid)
+    if command is None:
+        return True
+    executable = Path(command.split(maxsplit=1)[0]).name
+    return executable in {"node", "nodejs"} and "cli.ts" in command and "serve" in command
+
+
 def write_hint(ws: Path, online: bool) -> None:
     atomic_write(ws / ".orchestrator" / "hub.json", json.dumps(
         {"connector_pid": os.getpid(), "backend": "online" if online else "offline", "heartbeat_at": now()},
@@ -1488,7 +1540,7 @@ def watch(ws: Path, interval=5, no_orchestrator=False, runner=subprocess.run, sl
         existing = int(pidfile.read_text().strip())
     except (OSError, ValueError):
         existing = None
-    if existing and existing != os.getpid() and pid_alive(existing):
+    if existing and existing != os.getpid() and connector_alive(existing, ws):
         print(f"hub connector already running as pid {existing}", file=sys.stderr)
         return 1
     atomic_write(pidfile, f"{os.getpid()}\n")
@@ -1740,7 +1792,8 @@ def command_status(ws: Path) -> int:
         tail = []
     print(json.dumps({"enabled": bool(hub.get("enabled")), "url": display_url(hub.get("url", "")),
                       "workspace_id": hub.get("workspace_id"), "backend": backend,
-                      "pid": pid, "pid_alive": bool(pid and pid_alive(pid)), "last_hint": hint, "log_tail": tail},
+                      "pid": pid, "pid_alive": bool(pid and connector_alive(pid, ws)),
+                      "last_hint": hint, "log_tail": tail},
                      ensure_ascii=False, indent=2))
     return 0
 
@@ -1752,7 +1805,7 @@ def command_stop(ws: Path) -> int:
     except (OSError, ValueError):
         print("hub connector is not running")
         return 0
-    if not pid_alive(pid):
+    if not connector_alive(pid, ws):
         print("hub connector pid is stale")
         return 0
     try:
diff --git a/.agent-system/hubctl.py b/.agent-system/hubctl.py
index 9defb91..8c0c85c 100644
--- a/.agent-system/hubctl.py
+++ b/.agent-system/hubctl.py
@@ -199,7 +199,7 @@ def _start_registered_connectors() -> None:
                 pid = int(pidfile.read_text(encoding="ascii").strip())
             except (OSError, ValueError):
                 pid = None
-            if pid and pid > 0 and agentctl.pid_alive(pid):
+            if pid and pid > 0 and agentctl.connector_alive(pid, workspace):
                 continue
             agentctl.kitstart.start_connector(workspace, cfg, no_orchestrator=True)
         except Exception as error:
@@ -352,7 +352,7 @@ def hub_start(source: Path, workspace: Path | None = None, start_connector=True)
             pid = int(pidfile.read_text().strip())
         except (OSError, ValueError):
             pid = 0
-        if agentctl.pid_alive(pid):
+        if agentctl.backend_alive(pid):
             print(f"Agent Hub backend is already running (pid {pid})")
             if start_connector:
                 _start_registered_connectors()
@@ -387,7 +387,7 @@ def hub_stop(sleep=time.sleep, clock=time.monotonic) -> int:
     except (OSError, ValueError):
         print("Agent Hub backend is not running")
         return connector_status
-    if not agentctl.pid_alive(pid):
+    if not agentctl.backend_alive(pid):
         pidfile.unlink(missing_ok=True)
         print("Agent Hub backend pid is stale")
         return connector_status
@@ -396,12 +396,12 @@ def hub_stop(sleep=time.sleep, clock=time.monotonic) -> int:
     except OSError as error:
         raise HubCtlError(f"could not stop Agent Hub backend pid {pid}: {error}") from error
     deadline = clock() + 10
-    while agentctl.pid_alive(pid):
+    while agentctl.backend_alive(pid):
         remaining = deadline - clock()
         if remaining <= 0:
             break
         sleep(min(0.1, remaining))
-    if agentctl.pid_alive(pid):
+    if agentctl.backend_alive(pid):
         print(f"still running (pid {pid})")
     else:
         print("stopped")
@@ -489,7 +489,7 @@ def hub_status() -> int:
         pid = int((directory / "hub.pid").read_text(encoding="ascii").strip())
     except (OSError, ValueError):
         pid = None
-    if pid is not None and not agentctl.pid_alive(pid):
+    if pid is not None and not agentctl.backend_alive(pid):
         pid = None
     try:
         response = agentctl.ping("http://127.0.0.1:7420", agentctl.read_key())
diff --git a/.agent-system/kitstart.py b/.agent-system/kitstart.py
index c308253..7813869 100644
--- a/.agent-system/kitstart.py
+++ b/.agent-system/kitstart.py
@@ -250,19 +250,14 @@ def start_connector(ws: Path, cfg: dict, popen=None, log=None, no_orchestrator=F
     if not (cfg.get("hub") or {}).get("enabled"):
         return
     log = log or print
+    import agentctl
+
     pidfile = ws / ".orchestrator" / "hub-connector.pid"
     try:
         pid = int(pidfile.read_text().strip())
-        if pid <= 0:
-            pid = None
-            raise ProcessLookupError
-        try:
-            os.kill(pid, 0)
-        except PermissionError:
-            pass
     except (OSError, ValueError):
         pid = None
-    if pid is not None:
+    if pid is not None and agentctl.connector_alive(pid, ws):
         log("hub connector already running")
         return
     popen = popen or subprocess.Popen
diff --git a/.agent-system/tests/test_agentctl.py b/.agent-system/tests/test_agentctl.py
index 188de85..dbd88e6 100644
--- a/.agent-system/tests/test_agentctl.py
+++ b/.agent-system/tests/test_agentctl.py
@@ -1226,6 +1226,122 @@ class AgentCtlTests(Base):
         goodbye = [r["body"] for r in backend.requests if r["path"].endswith("/goodbye")]
         self.assertEqual(goodbye[0]["reason"], "orchestrator_gone")
 
+    def test_process_command_reads_linux_proc_cmdline(self):
+        with mock.patch.object(AC.sys, "platform", "linux"), \
+                mock.patch.object(AC.Path, "read_bytes", return_value=b"python\0/workspace/agentctl.py\0watch\0"):
+            self.assertEqual(AC.process_command(41), "python /workspace/agentctl.py watch")
+
+    def test_process_command_uses_ps_off_linux(self):
+        runner = mock.Mock(return_value=subprocess.CompletedProcess([], 0, "node cli.ts serve\n", ""))
+        with mock.patch.object(AC.sys, "platform", "darwin"):
+            self.assertEqual(AC.process_command(41, runner=runner), "node cli.ts serve")
+        runner.assert_called_once_with(["ps", "-o", "command=", "-p", "41"],
+                                       capture_output=True, text=True, check=False)
+
+    def test_process_cwd_reads_linux_proc_link(self):
+        with mock.patch.object(AC.sys, "platform", "linux"), \
+                mock.patch.object(AC.os, "readlink", return_value=str(self.ws)):
+            self.assertEqual(AC.process_cwd(41), self.ws.resolve())
+
+    def test_connector_alive_rejects_another_workspace(self):
+        other = Path(self.tmp.name) / "other-workspace"
+        command = f"python {other}/.agent-system/agentctl.py watch --no-orchestrator"
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=command), \
+                mock.patch.object(AC, "process_cwd", return_value=other.resolve()):
+            self.assertFalse(AC.connector_alive(41, self.ws))
+        sibling = Path(f"{self.ws.resolve()}-2")
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command",
+                                  return_value=f"python {sibling}/.agent-system/agentctl.py watch"), \
+                mock.patch.object(AC, "process_cwd", return_value=sibling):
+            self.assertFalse(AC.connector_alive(41, self.ws))
+
+    def test_connector_alive_accepts_matching_command_or_cwd_and_unknown_falls_back(self):
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=f"python {self.ws}/.agent-system/agentctl.py watch"), \
+                mock.patch.object(AC, "process_cwd", return_value=None):
+            self.assertTrue(AC.connector_alive(41, self.ws))
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value="python agentctl.py watch"), \
+                mock.patch.object(AC, "process_cwd", return_value=self.ws.resolve()):
+            self.assertTrue(AC.connector_alive(41, self.ws))
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=None):
+            self.assertTrue(AC.connector_alive(41, self.ws))
+
+    def test_backend_alive_requires_cli_serve_command_and_unknown_falls_back(self):
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value="python unrelated"):
+            self.assertFalse(AC.backend_alive(41))
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value="python /hub/server/src/cli.ts serve"):
+            self.assertFalse(AC.backend_alive(41))
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value="node /hub/server/src/cli.ts serve"):
+            self.assertTrue(AC.backend_alive(41))
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=None):
+            self.assertTrue(AC.backend_alive(41))
+
+    def test_watch_starts_when_pid_belongs_to_another_workspace(self):
+        pidfile = self.ws / ".orchestrator" / "hub-connector.pid"
+        pidfile.parent.mkdir(parents=True, exist_ok=True)
+        pidfile.write_text("999\n")
+        other = Path(self.tmp.name) / "other-workspace"
+        command = f"python {other}/.agent-system/agentctl.py watch --no-orchestrator"
+        with FakeBackend() as backend:
+            self.set_backend(backend)
+            with mock.patch.object(AC, "pid_alive", return_value=True), \
+                    mock.patch.object(AC, "process_command", return_value=command), \
+                    mock.patch.object(AC, "process_cwd", return_value=other.resolve()), \
+                    redirect_stdout(StringIO()), redirect_stderr(StringIO()):
+                code = AC.watch(self.ws, runner=self.fake_herdr(), no_orchestrator=True, max_loops=1)
+        self.assertEqual(code, 0)
+        self.assertTrue(any(r["path"].endswith("/agent/hello") for r in backend.requests))
+
+    def test_watch_keeps_a_matching_connector_pid(self):
+        pidfile = self.ws / ".orchestrator" / "hub-connector.pid"
+        pidfile.parent.mkdir(parents=True, exist_ok=True)
+        pidfile.write_text("999\n")
+        command = f"python {self.ws}/.agent-system/agentctl.py watch --no-orchestrator"
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=command), \
+                redirect_stdout(StringIO()), redirect_stderr(StringIO()):
+            code = AC.watch(self.ws, runner=self.fake_herdr(), no_orchestrator=True, max_loops=1)
+        self.assertEqual(code, 1)
+        self.assertEqual(pidfile.read_text(), "999\n")
+
+    def test_status_reports_foreign_connector_pid_not_alive(self):
+        pidfile = self.ws / ".orchestrator" / "hub-connector.pid"
+        pidfile.parent.mkdir(parents=True, exist_ok=True)
+        pidfile.write_text("999\n")
+        other = Path(self.tmp.name) / "other-workspace"
+        command = f"python {other}/.agent-system/agentctl.py watch"
+        output = StringIO()
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=command), \
+                mock.patch.object(AC, "process_cwd", return_value=other.resolve()), \
+                mock.patch.object(AC, "ping", return_value={}), mock.patch.object(AC, "read_key", return_value="key"), \
+                redirect_stdout(output):
+            self.assertEqual(AC.command_status(self.ws), 0)
+        self.assertFalse(json.loads(output.getvalue())["pid_alive"])
+
+    def test_stop_does_not_signal_foreign_connector_pid(self):
+        pidfile = self.ws / ".orchestrator" / "hub-connector.pid"
+        pidfile.parent.mkdir(parents=True, exist_ok=True)
+        pidfile.write_text("999\n")
+        other = Path(self.tmp.name) / "other-workspace"
+        command = f"python {other}/.agent-system/agentctl.py watch"
+        output = StringIO()
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=command), \
+                mock.patch.object(AC, "process_cwd", return_value=other.resolve()), \
+                mock.patch.object(AC.os, "kill") as kill, redirect_stdout(output):
+            self.assertEqual(AC.command_stop(self.ws), 0)
+        kill.assert_not_called()
+        self.assertIn("hub connector pid is stale", output.getvalue())
+
     def test_loopback_requests_ignore_proxy_environment(self):
         with FakeBackend() as backend:
             with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1",
diff --git a/.agent-system/tests/test_hubctl.py b/.agent-system/tests/test_hubctl.py
index 9b0a7ef..dbf1294 100644
--- a/.agent-system/tests/test_hubctl.py
+++ b/.agent-system/tests/test_hubctl.py
@@ -228,6 +228,66 @@ class HubCtlTests(Base):
         self.assertEqual(connector_calls[0][2], {"no_orchestrator": True})
         self.assertIn(f"hub workspace skipped (missing folder): {missing}", output.getvalue())
 
+    def test_hub_start_restarts_connector_pid_from_another_workspace(self):
+        self.configure_workspace(self.repo)
+        (self.repo / ".orchestrator").mkdir(exist_ok=True)
+        (self.repo / ".orchestrator" / "hub-connector.pid").write_text("999\n")
+        (self.config_dir / "workspaces.json").write_text(json.dumps({"workspaces": [str(self.repo)]}))
+        other = Path(self.tmp.name) / "other-workspace"
+        command = f"python {other}/.agent-system/agentctl.py watch --no-orchestrator"
+        backend_calls, connector_calls = [], []
+        with mock.patch.object(HC, "node24", return_value=Path("/usr/bin/node")), \
+                mock.patch.object(HC.subprocess, "Popen", side_effect=lambda *a, **k:
+                                  backend_calls.append((a, k)) or type("Process", (), {"pid": 501})()), \
+                mock.patch.object(HC.agentctl, "pid_alive", return_value=True), \
+                mock.patch.object(HC.agentctl, "process_command", return_value=command), \
+                mock.patch.object(HC.agentctl, "process_cwd", return_value=other.resolve()), \
+                mock.patch.object(HC.agentctl.kitstart, "start_connector",
+                                  side_effect=lambda *a, **k: connector_calls.append((a, k))), \
+                redirect_stdout(StringIO()):
+            self.assertEqual(HC.hub_start(ROOT, self.repo), 0)
+        self.assertEqual(len(backend_calls), 1)
+        self.assertEqual(connector_calls[0][0][0], self.repo.resolve())
+
+    def test_hub_start_replaces_foreign_backend_pid(self):
+        self.data_dir.mkdir()
+        (self.data_dir / "hub.pid").write_text("456\n")
+        calls = []
+        with mock.patch.object(HC, "node24", return_value=Path("/usr/bin/node")), \
+                mock.patch.object(HC.subprocess, "Popen", side_effect=lambda *a, **k:
+                                  calls.append((a, k)) or type("Process", (), {"pid": 501})()), \
+                mock.patch.object(HC.agentctl, "pid_alive", return_value=True), \
+                mock.patch.object(HC.agentctl, "process_command", return_value="python unrelated.py"), \
+                redirect_stdout(StringIO()):
+            self.assertEqual(HC.hub_start(ROOT, start_connector=False), 0)
+        self.assertEqual(len(calls), 1)
+        self.assertEqual((self.data_dir / "hub.pid").read_text(), "501\n")
+
+    def test_hub_stop_does_not_signal_foreign_backend_pid(self):
+        self.data_dir.mkdir()
+        pidfile = self.data_dir / "hub.pid"
+        pidfile.write_text("456\n")
+        output = StringIO()
+        with mock.patch.object(HC, "_stop_registered_connectors", return_value=0), \
+                mock.patch.object(HC.agentctl, "pid_alive", return_value=True), \
+                mock.patch.object(HC.agentctl, "process_command", return_value="python unrelated.py"), \
+                mock.patch.object(HC.os, "kill") as kill, redirect_stdout(output):
+            self.assertEqual(HC.hub_stop(), 0)
+        kill.assert_not_called()
+        self.assertIn("Agent Hub backend pid is stale", output.getvalue())
+        self.assertFalse(pidfile.exists())
+
+    def test_hub_status_reports_foreign_backend_pid_stopped(self):
+        self.data_dir.mkdir()
+        (self.data_dir / "hub.pid").write_text("456\n")
+        output = StringIO()
+        with mock.patch.object(HC.agentctl, "pid_alive", return_value=True), \
+                mock.patch.object(HC.agentctl, "process_command", return_value="python unrelated.py"), \
+                mock.patch.object(HC.agentctl, "ping", return_value={"protocol": 2}), \
+                mock.patch.object(HC.agentctl, "read_key", return_value="key"), redirect_stdout(output):
+            self.assertEqual(HC.hub_status(), 0)
+        self.assertIn("pid: stopped", output.getvalue())
+
     def test_hub_stop_stops_registered_connectors_before_backend(self):
         first, second = Path(self.tmp.name) / "first", Path(self.tmp.name) / "second"
         self.configure_workspace(first)
diff --git a/.agent-system/tests/test_scheduler.py b/.agent-system/tests/test_scheduler.py
index ab188dd..d287cd3 100644
--- a/.agent-system/tests/test_scheduler.py
+++ b/.agent-system/tests/test_scheduler.py
@@ -2099,6 +2099,24 @@ class TestStart(WorkspaceBase):
         self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
         self.assertIs(kwargs["stdout"], kwargs["stderr"])
 
+    def test_connector_start_restarts_pid_from_another_workspace(self):
+        self.cfg["hub"] = {"enabled": True}
+        pidfile = self.ws / ".orchestrator" / "hub-connector.pid"
+        pidfile.parent.mkdir(parents=True, exist_ok=True)
+        pidfile.write_text("999\n")
+        other = Path(self.tmp.name) / "other-workspace"
+        command = f"python {other}/.agent-system/agentctl.py watch --no-orchestrator"
+        calls = []
+        with mock.patch.object(AC, "pid_alive", return_value=True), \
+                mock.patch.object(AC, "process_command", return_value=command), \
+                mock.patch.object(AC, "process_cwd", return_value=other.resolve()), \
+                mock.patch.object(KS.subprocess, "Popen",
+                                  side_effect=lambda *a, **k: calls.append((a, k))), \
+                mock.patch("builtins.print"):
+            KS.start_connector(self.ws, self.cfg)
+        self.assertEqual(len(calls), 1)
+        self.assertEqual(calls[0][1]["cwd"], str(self.ws))
+
 
 class TestInstall(Base):
     """scripts/install.sh (agent-kit) run for real against temp repos."""
````

## Review round 1: PASS (05/11/26 17:00)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 0bdb1d411234, commits 0bdb1d411234
- Notes: owned PID checks at all sites; sibling-folder match fixed; 262 tests pass

# Review hcpid T1 - owned PID checks (Opus)

Verdict: PASS (one Opus fix before commit)

- `process_command` (/proc cmdline, `ps` fallback off Linux), `process_cwd`, `connector_alive(pid, ws)`,
  `backend_alive(pid)` (node + cli.ts + serve); unknown command -> old pid_alive behaviour.
- All PID sites switched: agentctl watch/status/stop, hubctl connector loop and backend start/stop/status,
  kitstart.start_connector (lazy `import agentctl`, avoids the import cycle).
- **Fixed (MINOR):** `str(ws) in command` matched a sibling folder (`<ws>-2`); now the workspace's own
  `.agent-system/agentctl.py` path or exact cwd. Test added.
- Worker report had a short base_sha (collect ambiguous); worker rewrote it with the full SHA on request.
- Whole suite 262 passed (Opus rerun, Herdr env removed). Live check after merge.

## Integration: merged (05/11/26 17:00)

- On `agent/integration-hcpid` at 585e28029752; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcpid/logs/post-merge-T1-a1.log`)

## Final gate: PASS (05/11/26 17:01)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcpid at 585e28029752 (log `.orchestrator/runs/hcpid/logs/verify-1793872806.log`)
- Task MERGED; run DONE
