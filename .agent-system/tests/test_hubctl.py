"""Offline tests for Agent Hub account and local service commands."""
import json
import os
import subprocess
import sys
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hubctl as HC  # noqa: E402
from test_scheduler import Base, REAL_CONFIG  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


class FakeProxy:
    def __init__(self):
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                pass

            def reply(self, value):
                raw = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                owner.requests.append({"method": "GET", "path": urlsplit(self.path).path})
                self.reply({"protocol": 2, "min_protocol": 2, "server_time": "2026-10-28T08:00:00Z",
                            "version": "2.0.0"})

            def do_POST(self):
                size = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(size) if size else b""
                body = json.loads(raw) if raw else None
                path = urlsplit(self.path).path
                owner.requests.append({"method": "POST", "path": path, "body": body,
                                       "authorization": self.headers.get("Authorization")})
                if path.endswith("/computers/register"):
                    self.reply({"computer_id": "c_abcdefghijklmnop", "computer_key": "c" * 40,
                                "proxy_public_key": "A" * 43, "username": body["username"]})
                else:
                    self.reply({"username": "alice", "password": "P" * 24})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class HubCtlTests(Base):
    def setUp(self):
        super().setUp()
        self.proxy = FakeProxy()
        self.addCleanup(self.proxy.close)
        self.config_dir = Path(self.tmp.name) / "hub-config"
        self.data_dir = Path(self.tmp.name) / "hub-data"
        self.config_dir.mkdir()
        patcher = mock.patch.dict(os.environ, {"AGENT_HUB_CONFIG": str(self.config_dir),
                                               "AGENT_HUB_DATA": str(self.data_dir)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def configure_admin(self):
        (self.config_dir / "admin.json").write_text(json.dumps({"proxy_url": self.proxy.url}))
        key = self.config_dir / "admin.key"
        key.write_text("fake-admin-key")
        key.chmod(0o600)
        return key

    def test_create_and_reset_user_use_admin_routes_and_print_password(self):
        self.configure_admin()
        for command in ("create-user", "reset-password"):
            output, error = StringIO(), StringIO()
            with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1",
                                               "http_proxy": "http://127.0.0.1:1"}), \
                    redirect_stdout(output), redirect_stderr(error):
                code = HC.main([command, "--name=alice"])
            self.assertEqual(code, 0, error.getvalue())
            self.assertIn("username: alice", output.getvalue())
            self.assertIn("password: " + "P" * 24, output.getvalue())
        requests = self.proxy.requests
        self.assertEqual(requests[0]["path"], "/api/v1/admin/users")
        self.assertEqual(requests[0]["body"], {"username": "alice"})
        self.assertEqual(requests[0]["authorization"], "Bearer fake-admin-key")
        self.assertEqual(requests[1]["path"], "/api/v1/admin/users/alice/reset-password")

    def test_admin_key_permissions_and_missing_key(self):
        key = self.configure_admin()
        key.chmod(0o644)
        error = StringIO()
        with redirect_stderr(error):
            self.assertEqual(HC.main(["create-user", "--name=alice"]), 1)
        self.assertIn("admin.key must have mode 0600", error.getvalue())
        self.assertEqual(self.proxy.requests, [])
        key.unlink()
        error = StringIO()
        with redirect_stderr(error):
            self.assertEqual(HC.main(["create-user", "--name=alice"]), 1)
        self.assertIn("run this on the admin computer (agent-kit proxy-setup creates the key)", error.getvalue())

    def test_hub_login_writes_private_config_and_enables_workspace(self):
        (self.config_dir / "connector.key").write_text("fake-connector-key")
        system = self.repo / ".agent-system"
        system.mkdir()
        cfg = json.loads(json.dumps(REAL_CONFIG))
        cfg.pop("project", None)
        cfg["pool"]["worktree_root"] = str(Path(self.tmp.name) / "wt")
        cfg["hub"] = {"enabled": False, "url": self.proxy.url, "workspace_id": None,
                      "upload": {"documents": True, "diffs": True, "orchestrator_screen": True}}
        config_path = system / "config.json"
        config_path.write_text(json.dumps(cfg))
        destination = self.config_dir / "computer.json"
        destination.write_text('{"old": true}\n')
        output = StringIO()
        with mock.patch.object(HC.getpass, "getpass", return_value="temporary-password") as password_prompt, \
                mock.patch.object(HC, "hub_start", return_value=0), \
                mock.patch.object(HC.agentctl, "_orchestrator_alive", return_value=False), redirect_stdout(output):
            self.assertEqual(HC.hub_login("alice", self.proxy.url, "Test computer", self.repo), 0)
        password_prompt.assert_called_once()
        saved = json.loads(destination.read_text())
        self.assertEqual(saved["computer_id"], "c_abcdefghijklmnop")
        self.assertEqual(saved["proxy_url"], self.proxy.url)
        self.assertEqual(saved["name"], "Test computer")
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        self.assertTrue(json.loads(config_path.read_text())["hub"]["enabled"])
        registration = next(item for item in self.proxy.requests if item["path"].endswith("/computers/register"))
        self.assertEqual(registration["body"], {"username": "alice", "password": "temporary-password",
                                                 "name": "Test computer"})

    def test_hub_login_starts_backend_waits_for_key_enables_then_starts_watcher(self):
        system = self.repo / ".agent-system"
        system.mkdir()
        cfg = json.loads(json.dumps(REAL_CONFIG))
        cfg.pop("project", None)
        cfg["pool"]["worktree_root"] = str(Path(self.tmp.name) / "wt")
        cfg["hub"] = {"enabled": False, "url": self.proxy.url, "workspace_id": None,
                      "upload": {"documents": True, "diffs": True, "orchestrator_screen": True}}
        config_path = system / "config.json"
        config_path.write_text(json.dumps(cfg))
        destination = self.config_dir / "computer.json"
        key_path = self.config_dir / "connector.key"
        events, original_main = [], HC.agentctl.main

        def start_backend(source, workspace, start_connector=True):
            self.assertTrue(destination.is_file())
            events.append("backend-start")
            key_path.write_text("fake-connector-key")
            return 0

        def enable(argv=None, **kwargs):
            events.append("enable")
            self.assertTrue(key_path.is_file())
            return original_main(argv, **kwargs)

        def live(_name):
            events.append("live-check")
            return True

        with mock.patch.object(HC.getpass, "getpass", return_value="temporary-password"), \
                mock.patch.object(HC, "hub_start", side_effect=start_backend), \
                mock.patch.object(HC.agentctl, "main", side_effect=enable), \
                mock.patch.object(HC.agentctl, "_orchestrator_alive", side_effect=live), \
                mock.patch.object(HC.agentctl.kitstart, "start_connector", side_effect=lambda *_: events.append("watch")), \
                redirect_stdout(StringIO()):
            self.assertEqual(HC.hub_login("alice", self.proxy.url, "Test computer", self.repo), 0)
        self.assertEqual(events, ["backend-start", "enable", "live-check", "watch"])
        self.assertTrue(json.loads(config_path.read_text())["hub"]["enabled"])

    def test_hub_start_launches_backend_and_live_workspace_watcher(self):
        system = self.repo / ".agent-system"
        system.mkdir()
        cfg = json.loads(json.dumps(REAL_CONFIG))
        cfg.pop("project", None)
        cfg["pool"]["worktree_root"] = str(Path(self.tmp.name) / "wt")
        cfg["hub"] = {"enabled": True, "url": self.proxy.url, "workspace_id": "ws_abcdefghijklmnop"}
        (system / "config.json").write_text(json.dumps(cfg))
        calls = []

        def popen(args, **kwargs):
            calls.append((args, kwargs))
            return type("Process", (), {"pid": 500 + len(calls)})()

        with mock.patch.object(HC.Path, "cwd", return_value=self.repo), \
                mock.patch.object(HC, "node24", return_value=Path("/usr/bin/node")), \
                mock.patch.object(HC.subprocess, "Popen", side_effect=popen), \
                mock.patch.object(HC.agentctl, "_orchestrator_alive", return_value=True), \
                redirect_stdout(StringIO()):
            self.assertEqual(HC.main(["hub", "start"]), 0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0][1:], [str(Path(HC.agentctl.__file__).resolve()), "watch"])
        self.assertEqual(calls[1][1]["cwd"], str(self.repo))
        self.assertTrue(calls[1][1]["start_new_session"])

    def test_hub_stop_waits_for_pid_exit(self):
        self.data_dir.mkdir()
        (self.data_dir / "hub.pid").write_text("456\n")
        alive = iter([True, True, False, False])
        sleeps, output = [], StringIO()
        with mock.patch.object(HC.agentctl, "pid_alive", side_effect=lambda _pid: next(alive)), \
                mock.patch.object(HC.os, "kill") as kill, redirect_stdout(output):
            self.assertEqual(HC.hub_stop(sleep=sleeps.append, clock=lambda: 0), 0)
        kill.assert_called_once_with(456, HC.signal.SIGTERM)
        self.assertTrue(sleeps)
        self.assertEqual(output.getvalue().strip(), "stopped")

    def test_hub_stop_reports_still_running_after_ten_seconds(self):
        self.data_dir.mkdir()
        (self.data_dir / "hub.pid").write_text("789\n")
        now, sleeps, output = {"value": 0.0}, [], StringIO()

        def sleep(seconds):
            sleeps.append(seconds)
            now["value"] = 10.0

        with mock.patch.object(HC.agentctl, "pid_alive", return_value=True), \
                mock.patch.object(HC.os, "kill"), redirect_stdout(output):
            self.assertEqual(HC.hub_stop(sleep=sleep, clock=lambda: now["value"]), 0)
        self.assertEqual(sum(sleeps), 0.1)
        self.assertEqual(output.getvalue().strip(), "still running (pid 789)")

    def test_install_script_dispatches_new_commands_in_dry_run(self):
        installer = ROOT / ".agent-system" / "scripts" / "install.sh"
        commands = (("create-user", "--name=alice"), ("reset-password", "--name=alice"),
                    ("hub-login", "--name=alice", "--url=http://127.0.0.1:9999"),
                    ("hub", "start"), ("hub", "stop"), ("hub", "status"),
                    ("proxy-setup", "--rotate-admin-key", "--origins=https://example.invalid"))
        for args in commands:
            result = subprocess.run(["bash", str(installer), *args, "--dry-run"], cwd=self.repo,
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("[dry-run]", result.stdout)
            self.assertIn("hubctl.py", result.stdout)
            self.assertIn(args[0], result.stdout)


if __name__ == "__main__":
    unittest.main()
