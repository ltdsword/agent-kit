"""Offline contract and lifecycle tests for the Agent Hub connector."""
import hashlib
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
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agentctl as AC  # noqa: E402
import hubschema  # noqa: E402
import scheduler as S  # noqa: E402
from test_scheduler import Base  # noqa: E402


class FakeBackend:
    """Loopback v2 backend that validates and records every connector message."""

    def __init__(self, offline=False, restore_after=None, duplicate=False, commands=None):
        self.requests, self.invalid = [], []
        self.offline, self.restore_after, self.duplicate = offline, restore_after, duplicate
        self.commands, self.acks = list(commands or []), []
        self.event_cursors, self.decision_hashes, self.document_hashes = {}, {}, {}
        self.snapshot_hash = None
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                pass

            def do_GET(self): self.route()
            def do_POST(self): self.route()
            def do_PUT(self): self.route()
            def do_DELETE(self): self.route()

            def reply(self, status, body=None):
                self.send_response(status)
                if body is None:
                    self.end_headers()
                    return
                raw = json.dumps(body).encode()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def route(self):
                parsed = urlsplit(self.path)
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length else b""
                body = json.loads(raw) if raw else None
                path, definition = parsed.path, None
                if path.endswith("/agent/hello"): definition = "HelloRequest"
                elif path.endswith("/snapshot"): definition = "Snapshot"
                elif path.endswith("/decisions"): definition = "DecisionsBatch"
                elif path.endswith("/events"): definition = "EventsBatch"
                elif path.endswith("/documents") and self.command == "PUT": definition = "DocumentsBatch"
                elif path.endswith("/goodbye"): definition = "GoodbyeRequest"
                elif path.endswith("/ack") and "/commands/" in path and self.command == "POST": definition = "AckRequest"
                if definition:
                    try: hubschema.validate(definition, body)
                    except ValueError as error: owner.invalid.append((definition, str(error)))
                owner.requests.append({"method": self.command, "path": path, "query": parsed.query,
                                       "body": body, "protocol": self.headers.get("X-Agent-Hub-Protocol"),
                                       "authorized": self.headers.get("Authorization") == "Bearer test-connector-key"})
                if owner.offline:
                    self.reply(503, {"error": {"code": "backend_down", "message": "offline"}})
                    if owner.restore_after is not None:
                        owner.restore_after -= 1
                        if owner.restore_after <= 0: owner.offline = False
                    return
                if path.endswith("/agent/ping"):
                    self.reply(200, {"protocol": 2, "min_protocol": 2,
                                     "server_time": "2026-10-28T08:00:00Z", "version": "0.1.0"})
                elif path.endswith("/agent/hello"):
                    if owner.duplicate:
                        owner.duplicate = False
                        self.reply(409, {"error": {"code": "duplicate_workspace", "message": "already online"}})
                        return
                    self.reply(200, {"known": bool(owner.snapshot_hash), "server_time": "2026-10-28T08:00:00Z",
                                    "event_cursors": owner.event_cursors, "decision_hashes": owner.decision_hashes,
                                    "document_hashes": owner.document_hashes, "snapshot_hash": owner.snapshot_hash})
                elif path.endswith("/snapshot"):
                    owner.snapshot_hash = AC.snapshot_digest(body)
                    self.reply(204)
                elif path.endswith("/decisions"):
                    for decision in body["decisions"]:
                        key = f"{decision['run_id']}/{decision['decision_id']}"
                        owner.decision_hashes[key] = hashlib.sha256(AC.canonical_bytes(decision)).hexdigest()
                    self.reply(204)
                elif path.endswith("/events"):
                    run_id = body["run_id"]
                    cursor = max([owner.event_cursors.get(run_id, 0)] + [item["n"] for item in body["events"]])
                    owner.event_cursors[run_id] = cursor
                    self.reply(200, {"run_id": run_id, "cursor": cursor})
                elif path.endswith("/documents") and self.command == "PUT":
                    for doc in body["documents"]: owner.document_hashes[doc["path"]] = doc["sha256"]
                    self.reply(204)
                elif path.endswith("/documents") and self.command == "DELETE":
                    for name in parse_qs(parsed.query).get("path", []): owner.document_hashes.pop(name, None)
                    self.reply(204)
                elif path.endswith("/commands") and self.command == "GET":
                    response = {"commands": owner.commands}
                    try: hubschema.validate("CommandsResponse", response)
                    except ValueError as error: owner.invalid.append(("CommandsResponse", str(error)))
                    self.reply(200, response)
                elif path.endswith("/ack") and "/commands/" in path and self.command == "POST":
                    owner.acks.append({"path": path, "body": body})
                    self.reply(204)
                elif path.endswith("/heartbeat") or path.endswith("/goodbye"):
                    self.reply(204)
                else:
                    self.reply(404, {"error": {"code": "not_found", "message": "not found"}})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        if self.invalid:
            raise AssertionError(self.invalid)

    def __enter__(self): return self
    def __exit__(self, *args): self.close()


class AgentCtlTests(Base):
    def setUp(self):
        super().setUp()
        self.cfg["hub"] = {"enabled": True, "url": "http://127.0.0.1:7420",
                           "workspace_id": "ws_abcdefghijklmnop",
                           "upload": {"documents": True, "diffs": True, "orchestrator_screen": True}, "screen_lines": 40}
        self.ws = self.repo
        (self.ws / ".agent-system").mkdir(exist_ok=True)
        self.config_path = self.ws / ".agent-system" / "config.json"
        self.config_path.write_text(json.dumps(self.cfg))
        self.hub_dir = Path(self.tmp.name) / "hub-config"
        self.hub_dir.mkdir()
        (self.hub_dir / "connector.key").write_text("test-connector-key")
        patcher = mock.patch.dict(os.environ, {"AGENT_HUB_CONFIG": str(self.hub_dir)})
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake_herdr(self, status="idle"):
        def runner(args, **kwargs):
            if args[1:3] == ["agent", "get"]:
                body = {"result": {"agent": {"agent_status": status,
                                               "agent_session": {"kind": "id", "value": "herdr-session"}}}}
                return subprocess.CompletedProcess(args, 0, json.dumps(body), "")
            if args[1:3] == ["agent", "read"]:
                return subprocess.CompletedProcess(args, 0, "visible screen\n", "")
            if args[1:3] == ["agent", "prompt"]:
                return subprocess.CompletedProcess(args, 0, "{}", "")
            return subprocess.CompletedProcess(args, 1, "", "agent not found")
        return runner

    @staticmethod
    def command(command_id, kind, body, run_id="r1", decision_id="D3", by="alice", created_at="2026-10-29T00:00:00Z"):
        return {"id": command_id, "type": kind, "run_id": run_id, "decision_id": decision_id,
                "body": body, "by": by, "created_at": created_at, "expires_at": None}

    def set_backend(self, backend):
        self.cfg["hub"]["url"] = backend.url
        self.config_path.write_text(json.dumps(self.cfg))

    def sample_run(self):
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True)], title="Run title", goal="A test run goal.")
        self.s.dispatch_ready("r1", launch="none")
        did = self.s.decision_ask("r1", "question", "Pick", "Which option?",
                                  ["A=keep :: preserves current behavior", "B=change :: updates behavior"],
                                  task="T1", recommend="A", evidence=["!src/main.py:1 :: current call fails"],
                                  note="Keeping behavior avoids an unrelated change.")["decision"]
        self.s.decision_answer("r1", did, "A", quote=f"{did} A")
        followup = {"when": ["A", "B"], "question": "Which branch?", "options": [
            {"key": "A", "label": "This branch", "value": "main", "input": False},
            {"key": "B", "label": "Other branch", "value": None, "input": True}], "validate": "branch"}
        finish = self.s.decision_ask("r1", "finish", "Merge?", "Choose.", ["A=Merge", "B=Keep local"],
                                     recommend="A", followup=followup)["decision"]
        self.s.decision_answer("r1", finish, "A", followup="A", quote=f"{finish} A")
        self.s.decision_ask("r1", "worker_approval", "Run formatter?", "Worker requested formatting.",
                            ["A=Allow", "B=Decline"], task="T1", approval_command="python3 -m formatter",
                            approval_cwd="src", approval_why=["Formats the task files."])
        state = self.s.store.load("r1")
        evidence = self.ws / ".orchestrator" / "runs" / "r1" / "research" / "round-1.md"
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text("# Research notes\nEvidence\n")
        state["research"]["rounds"] = [{"round": 1, "questions": ["Check contract"],
                                         "evidence_path": ".orchestrator/runs/r1/research/round-1.md",
                                         "recorded_at": S.now()}]
        self.s.store.save(state)
        run_dir = self.ws / ".orchestrator" / "runs" / "r1"
        (run_dir / "final-report.md").write_text("# Run r1 report\n\nDone.\n")
        (run_dir / "final.diff").write_text("diff --git a/a b/a\n")
        return did, finish

    def test_enable_creates_valid_id(self):
        self.cfg["hub"].update(enabled=False, workspace_id=None)
        self.config_path.write_text(json.dumps(self.cfg))
        with mock.patch.object(AC, "ping", return_value={}), redirect_stdout(StringIO()):
            self.assertEqual(AC.main(["enable", "--url", "http://127.0.0.1:7420"], workspace_root=self.ws), 0)
        saved = json.loads(self.config_path.read_text())
        self.assertTrue(saved["hub"]["enabled"])
        self.assertRegex(saved["hub"]["workspace_id"], r"^ws_[a-z2-7]{16}$")
        self.assertEqual(S.validate_config(saved), [])

    def test_enable_and_disable_update_private_workspace_registry(self):
        with mock.patch.object(AC, "ping", return_value={}), redirect_stdout(StringIO()):
            self.assertEqual(AC.command_enable(self.ws, None), 0)
        registry = AC.workspace_registry_path()
        self.assertEqual(registry.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(registry.read_text())["workspaces"], [str(self.ws.resolve())])
        with redirect_stdout(StringIO()):
            self.assertEqual(AC.command_disable(self.ws), 0)
        self.assertFalse(json.loads(self.config_path.read_text())["hub"]["enabled"])
        self.assertEqual(json.loads(registry.read_text())["workspaces"], [])

    def _write_legacy_run(self, run_id, task_status="PENDING"):
        run_dir = self.ws / ".orchestrator" / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        state = {"run_id": run_id, "status": "RUNNING", "created_at": "2026-10-29T00:00:00Z",
                 "base_branch": "main", "integration_branch": f"agent/integration-{run_id}",
                 "tasks": {
                     "register-validation": {"id": "register-validation", "title": "L" * 70,
                                               "summary": None, "status": task_status, "worker": None,
                                               "depends_on": [], "major_repairs": 0, "known_issues": None},
                     "zadn-ui": {"id": "zadn-ui", "title": "Review UI", "summary": "tiny",
                                 "status": "PENDING", "worker": None,
                                 "depends_on": ["register-validation"], "major_repairs": 0,
                                 "known_issues": None}},
                 "decisions": {"D1": {"task": "register-validation", "status": "PENDING",
                                       "created_at": "2026-10-29T00:00:00Z"},
                               "D2": {"task": "zadn-ui", "status": "PENDING",
                                      "created_at": "2026-10-29T00:00:00Z"}},
                 "events": []}
        (run_dir / "state.json").write_text(json.dumps(state))
        return state

    def test_legacy_run_is_mapped_and_validated(self):
        self._write_legacy_run("legacy")
        data = AC.build_sync(self.ws, self.cfg, "ses_abcdefghijklmnop", self.fake_herdr())
        hubschema.validate("Snapshot", data["snapshot"])
        run = data["snapshot"]["runs"][0]
        hubschema.validate("Run", run)
        self.assertEqual((run["title"], run["goal"]), ("legacy", "Legacy run legacy"))
        tasks = {task["id"]: task for task in run["tasks"]}
        self.assertEqual(set(tasks), {"T1", "T2"})
        self.assertEqual(len(tasks["T1"]["title"]), 60)
        self.assertTrue(tasks["T1"]["title"].endswith("…"))
        self.assertGreaterEqual(len(tasks["T1"]["summary"]), 20)
        self.assertLessEqual(len(tasks["T1"]["summary"]), 300)
        self.assertTrue(tasks["T1"]["summary"].startswith("(legacy task)"))
        self.assertEqual(tasks["T2"]["depends_on"], ["T1"])
        decisions = {decision["decision_id"]: decision for batch in data["decisions"]
                     for decision in batch["decisions"]}
        self.assertEqual((decisions["D1"]["task_id"], decisions["D2"]["task_id"]), ("T1", "T2"))

    def test_unfixable_run_is_skipped_and_logged_once(self):
        self._write_legacy_run("legacy-invalid", task_status="NOT_A_STATUS")
        AC.LEGACY_RUN_LOGGED.discard("legacy-invalid")
        with mock.patch.object(AC, "log_action") as log_action:
            first = AC.make_snapshot(self.ws, self.cfg, "ses_abcdefghijklmnop", self.fake_herdr())
            second = AC.make_snapshot(self.ws, self.cfg, "ses_abcdefghijklmnop", self.fake_herdr())
        hubschema.validate("Snapshot", first)
        hubschema.validate("Snapshot", second)
        self.assertEqual(first["runs"], [])
        self.assertEqual(second["runs"], [])
        self.assertEqual(log_action.call_count, 1)
        self.assertIn("legacy-invalid", log_action.call_args.args[1])

    def test_orchestrator_falls_back_to_matching_workspace_agent(self):
        calls = []

        def runner(args, **kwargs):
            calls.append(args)
            if args[1:3] == ["agent", "get"]:
                return subprocess.CompletedProcess(args, 1, "", "agent not found")
            if args[1:3] == ["agent", "list"]:
                agents = {"result": {"agents": [{"agent": "claude", "agent_status": "idle",
                                                    "cwd": str(self.ws.resolve()), "pane_id": "w9:p1",
                                                    "agent_session": {"kind": "id", "value": "fallback-session"}}]}}
                return subprocess.CompletedProcess(args, 0, json.dumps(agents), "")
            if args[1:3] == ["agent", "read"]:
                return subprocess.CompletedProcess(args, 0, "fallback screen\n", "")
            return subprocess.CompletedProcess(args, 1, "", "agent not found")

        snapshot = AC.make_snapshot(self.ws, self.cfg, "ses_abcdefghijklmnop", runner)
        self.assertEqual(snapshot["orchestrator"]["herdr_state"], "idle")
        self.assertEqual(snapshot["orchestrator"]["session_id"], "fallback-session")
        self.assertEqual(snapshot["orchestrator"]["screen"], ["fallback screen"])
        self.assertIn(["herdr", "agent", "read", "w9:p1", "--source", "visible", "--lines", "40"], calls)
        self.assertTrue(AC._orchestrator_alive("orch-repo", runner, self.ws, "claude"))

    def test_enable_rewrites_only_hub_object_and_keeps_key_order(self):
        source = ('{\n  "first" : [1,  2],\n "hub" : {"enabled": false, "workspace_id": null},\n'
                  '\t"last":{"nested":true}\n}\n')
        self.config_path.write_text(source)
        cfg = {"first": [1, 2], "hub": {"enabled": False, "workspace_id": None},
               "last": {"nested": True}}
        with mock.patch.object(AC, "load_config", return_value=cfg), mock.patch.object(AC, "ping", return_value={}), \
                redirect_stdout(StringIO()):
            self.assertEqual(AC.command_enable(self.ws, None), 0)
        updated = self.config_path.read_text()
        self.assertIn('  "first" : [1,  2],', updated)
        self.assertIn(',\n\t"last":{"nested":true}', updated)
        saved = json.loads(updated)
        self.assertEqual(list(saved), ["first", "hub", "last"])
        self.assertEqual(list(saved["hub"]), ["enabled", "workspace_id", "url", "upload", "screen_lines"])

    def test_enable_inserts_hub_without_reformatting_existing_config(self):
        cfg = dict(self.cfg)
        cfg.pop("hub")
        source = json.dumps(cfg, indent=2) + "\n"
        self.config_path.write_text(source)
        with mock.patch.object(AC, "ping", return_value={}), redirect_stdout(StringIO()):
            self.assertEqual(AC.main(["enable"], workspace_root=self.ws), 0)
        updated = self.config_path.read_text()
        self.assertIn('"pool": {\n', updated)
        self.assertTrue(updated.startswith(source[:source.index('"pool"')]))
        saved = json.loads(updated)
        self.assertTrue(saved["hub"]["enabled"])
        self.assertEqual(S.validate_config(saved), [])

    def test_ping_rejects_unsupported_protocol(self):
        response = {"protocol": 1, "min_protocol": 1, "server_time": "2026-10-28T08:00:00Z", "version": "1.0.0"}
        with mock.patch.object(AC, "http_request", return_value=(200, response)):
            with self.assertRaisesRegex(RuntimeError, "protocol 2 is required; update agent-kit"):
                AC.ping("http://127.0.0.1:7420")

    def test_legacy_agent_screen_setting_migrates(self):
        self.cfg["hub"]["upload"] = {"documents": False, "diffs": True, "agent_screens": False}
        self.config_path.write_text(json.dumps(self.cfg))
        loaded = AC.load_config(self.ws)
        self.assertEqual(loaded["hub"]["upload"],
                         {"documents": False, "diffs": True, "orchestrator_screen": False})
        saved = json.loads(self.config_path.read_text())
        self.assertNotIn("agent_screens", saved["hub"]["upload"])

    def test_sync_dry_run_validates_messages_and_mappings(self):
        self.sample_run()
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(AC.main(["sync", "--dry-run", "--json"], workspace_root=self.ws,
                                     runner=self.fake_herdr()), 0)
        data = json.loads(output.getvalue())
        hubschema.validate("HelloRequest", data["hello"])
        hubschema.validate("Snapshot", data["snapshot"])
        for key, definition in (("decisions", "DecisionsBatch"), ("events", "EventsBatch"),
                                ("documents", "DocumentsBatch")):
            for message in data[key]: hubschema.validate(definition, message)
        decisions = {d["decision_id"]: d for batch in data["decisions"] for d in batch["decisions"]}
        self.assertEqual((decisions["D1"]["agent"], decisions["D2"]["agent"]), ("worker-1", "orchestrator"))
        self.assertEqual(decisions["D1"]["options"][0]["consequence"], "preserves current behavior")
        self.assertEqual(decisions["D1"]["evidence"][0]["bad"], True)
        self.assertIsNotNone(decisions["D1"]["note"])
        self.assertEqual(decisions["D3"]["approval"]["command"], "python3 -m formatter")
        self.assertIsNotNone(decisions["D2"]["followup"])
        state = self.s.store.load("r1")
        expected_since = next(e["at"] for e in reversed(state["events"])
                              if e.get("kind") == "worker" and e.get("worker") == "worker-1")
        worker = next(w for w in data["snapshot"]["workers"] if w["slot"] == "worker-1")
        self.assertEqual(worker["since"], expected_since)
        self.assertEqual(AC._newest_worker_since({}, "worker-1", {"session_started_at": "fallback"}), "fallback")
        docs = [doc for batch in data["documents"] for doc in batch["documents"]]
        paths = {doc["path"] for doc in docs}
        self.assertIn(".orchestrator/runs/r1/final-report.md", paths)
        self.assertIn(".orchestrator/runs/r1/final.diff", paths)
        self.assertFalse(any(path.startswith("packets/") for path in paths))
        self.assertEqual(data["snapshot"]["runs"][0]["title"], "Run title")
        self.assertEqual(data["snapshot"]["runs"][0]["goal"], "A test run goal.")
        self.assertIsNotNone(data["snapshot"]["runs"][0]["tasks"][0]["summary"])
        self.assertNotIn("owned_paths", data["snapshot"]["runs"][0]["tasks"][0])
        self.assertNotIn("packet", data["snapshot"]["runs"][0]["tasks"][0])
        self.assertTrue(all("screen" not in worker for worker in data["snapshot"]["workers"]))
        self.assertEqual(data["snapshot"]["orchestrator_last_activity_at"], state["events"][-1]["at"])
        self.assertIn(".orchestrator/runs/r1/research/round-1.md", paths)
        self.assertFalse(any(doc["kind"] == "review" for doc in docs))

    def test_document_truncation_and_secret_path_refusal(self):
        large = self.ws / "large.md"
        large.write_text("# Large file\n" + "z" * (AC.MAX_DOCUMENT_BYTES + 32))
        doc = AC.make_document(self.ws, "large.md", "r1", "research")
        self.assertTrue(doc["truncated"])
        self.assertLessEqual(doc["bytes"], AC.MAX_DOCUMENT_BYTES)
        self.assertIn("truncated: full file on your computer", doc["content"])
        self.assertEqual(doc["sha256"], hashlib.sha256(doc["content"].encode()).hexdigest())
        (self.ws / "credentials.json").write_text("private placeholder")
        self.assertIsNone(AC.make_document(self.ws, "credentials.json", "r1", "research"))
        self.assertIsNone(AC.make_document(self.ws, "../outside.md", "r1", "research"))

    def test_scrubber_covers_patterns_and_pem(self):
        raw = ("sk-abcdefghijklmnop AKIA1234567890ABCDEF Bearer abcdefghijklmnop== "
               "password=hunter2 passwd:secret secret = abc token:123 "
               "-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----")
        cleaned = AC.scrub(raw)
        for value in ("abcdefghijklmnop", "1234567890ABCDEF", "hunter2", "private material"):
            self.assertNotIn(value, cleaned)
        self.assertGreaterEqual(cleaned.count("[REDACTED]"), 6)

    def test_watch_hello_full_push_and_validates_every_request(self):
        self.sample_run()
        with FakeBackend() as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = AC.watch(self.ws, runner=self.fake_herdr(), sleep=lambda _: None,
                                no_orchestrator=True, max_loops=1)
        self.assertEqual(code, 0)
        paths = [request["path"] for request in backend.requests]
        for suffix in ("/agent/hello", "/snapshot", "/decisions", "/events", "/documents", "/goodbye"):
            self.assertTrue(any(path.endswith(suffix) for path in paths), suffix)
        self.assertTrue(any(path.endswith("/commands") for path in paths))
        command_request = next(r for r in backend.requests if r["path"].endswith("/commands"))
        self.assertEqual(parse_qs(command_request["query"]), {"wait": ["5"]})
        self.assertTrue(all(r["protocol"] == "2" and r["authorized"] for r in backend.requests))
        self.assertFalse(backend.invalid)

    def test_watch_retries_connect_when_key_appears_after_start(self):
        self.sample_run()
        reads = {"count": 0}
        original_read_key = AC.read_key

        def delayed_key(*args, **kwargs):
            reads["count"] += 1
            if reads["count"] < 3:
                raise RuntimeError("connector key is not ready")
            return original_read_key(*args, **kwargs)

        with FakeBackend() as backend:
            self.set_backend(backend)
            with mock.patch.object(AC, "read_key", side_effect=delayed_key), \
                    redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(AC.watch(self.ws, runner=self.fake_herdr(), sleep=lambda _: None,
                                          no_orchestrator=True, max_loops=1), 0)
        self.assertEqual(reads["count"], 3)
        self.assertTrue(any(request["path"].endswith("/agent/hello") for request in backend.requests))

    def test_watch_answer_records_hub_attribution_and_delivers_notice(self):
        self.sample_run()
        second = self.s.decision_ask("r1", "question", "Another choice", "Pick one.",
                                     ["A=Use current", "B=Change it"])["decision"]
        commands = [
            self.command("cmd_aaaaaaaaaaaaaaaa", "answer", {"choice": "A", "note": "Keep this choice"}),
            self.command("cmd_hhhhhhhhhhhhhhhh", "answer", {"choice": "A"}, decision_id=second,
                         created_at="2026-10-29T00:01:00Z"),
        ]
        prompts = []

        def runner(args, **kwargs):
            if args[1:3] == ["agent", "prompt"]:
                prompts.append(args[4])
                return subprocess.CompletedProcess(args, 0, "{}", "")
            return self.fake_herdr()(args, **kwargs)

        with FakeBackend(commands=commands) as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(AC.watch(self.ws, runner=runner, sleep=lambda _: None,
                                          no_orchestrator=True, max_loops=1), 0)
        answer = self.s.store.load("r1")["decisions"]["D3"]["answer"]
        self.assertEqual((answer["channel"], answer["by"], answer["quote"]), ("hub", "alice", "Keep this choice"))
        self.assertEqual(self.s.store.load("r1")["decisions"][second]["answer"]["quote"], "Use current")
        self.assertEqual([ack["body"] for ack in backend.acks], [
            {"status": "DELIVERED", "reason": None}, {"status": "DELIVERED", "reason": None}])
        self.assertEqual(prompts, [
            "[hub] D3 answered by alice: A (Allow). It is recorded; carry it out with --decision D3.",
            f"[hub] {second} answered by alice: A (Use current). It is recorded; carry it out with --decision {second}."])
        self.assertTrue(all(r["authorized"] for r in backend.requests))
        self.assertFalse(backend.invalid)

    def test_watch_scheduler_refusal_is_rejected_with_exact_message(self):
        self.sample_run()
        command = self.command("cmd_bbbbbbbbbbbbbbbb", "answer", {"choice": "Z"})
        with FakeBackend(commands=[command]) as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(AC.watch(self.ws, runner=self.fake_herdr(), sleep=lambda _: None,
                                          no_orchestrator=True, max_loops=1), 0)
        self.assertEqual(backend.acks[0]["body"], {
            "status": "REJECTED", "reason": "'Z' is not an option of D3: ['A', 'B']"})
        self.assertEqual(self.s.store.load("r1")["decisions"]["D3"]["status"], "PENDING")

    def test_watch_reply_and_prompt_texts_are_typed_oldest_first(self):
        self.sample_run()
        commands = [
            self.command("cmd_cccccccccccccccc", "prompt", {"text": "Check the result"}, run_id=None,
                         decision_id=None, created_at="2026-10-29T00:01:00Z"),
            self.command("cmd_dddddddddddddddd", "reply", {"text": "I prefer A"},
                         created_at="2026-10-29T00:00:00Z"),
        ]
        prompts = []

        def runner(args, **kwargs):
            if args[1:3] == ["agent", "prompt"]:
                prompts.append(args[4])
                return subprocess.CompletedProcess(args, 0, "{}", "")
            return self.fake_herdr()(args, **kwargs)

        with FakeBackend(commands=commands) as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(AC.watch(self.ws, runner=runner, sleep=lambda _: None,
                                          no_orchestrator=True, max_loops=1), 0)
        self.assertEqual(prompts, ['[hub] reply to D3 from alice: "I prefer A"', "[hub] Check the result"])
        self.assertEqual([ack["body"]["status"] for ack in backend.acks], ["DELIVERED", "DELIVERED"])
        self.assertFalse(backend.invalid)

    def test_watch_blocked_orchestrator_holds_reply(self):
        command = self.command("cmd_eeeeeeeeeeeeeeee", "reply", {"text": "Please continue"})
        with FakeBackend(commands=[command]) as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(AC.watch(self.ws, runner=self.fake_herdr("blocked"), sleep=lambda _: None,
                                          no_orchestrator=True, max_loops=1), 0)
        self.assertEqual(backend.acks[0]["body"], {"status": "HELD", "reason": "orchestrator is blocked"})
        self.assertFalse((self.ws / ".orchestrator" / "hub-log.jsonl").exists())

    def test_watch_retries_answer_notice_locally_after_typing_failure(self):
        self.sample_run()
        command = self.command("cmd_ffffffffffffffff", "answer", {"choice": "A"})
        prompts, attempts = [], {"count": 0}

        def runner(args, **kwargs):
            if args[1:3] == ["agent", "prompt"]:
                prompts.append(args[4])
                attempts["count"] += 1
                if attempts["count"] == 1:
                    return subprocess.CompletedProcess(args, 1, "", "temporary failure")
                return subprocess.CompletedProcess(args, 0, "{}", "")
            return self.fake_herdr()(args, **kwargs)

        with FakeBackend(commands=[command]) as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(AC.watch(self.ws, runner=runner, sleep=lambda _: None,
                                          no_orchestrator=True, max_loops=2), 0)
        self.assertEqual(len(prompts), 2)
        self.assertEqual(prompts[0], prompts[1])
        self.assertEqual([ack["body"]["status"] for ack in backend.acks], ["DELIVERED", "DELIVERED"])

    def test_watch_does_not_type_logged_command_after_restart(self):
        self.sample_run()
        command = self.command("cmd_gggggggggggggggg", "prompt", {"text": "Run the check"},
                               run_id=None, decision_id=None)
        prompts = []

        def runner(args, **kwargs):
            if args[1:3] == ["agent", "prompt"]:
                prompts.append(args[4])
                return subprocess.CompletedProcess(args, 0, "{}", "")
            return self.fake_herdr()(args, **kwargs)

        with FakeBackend(commands=[command]) as backend:
            self.set_backend(backend)
            for _ in range(2):
                with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                    self.assertEqual(AC.watch(self.ws, runner=runner, sleep=lambda _: None,
                                              no_orchestrator=True, max_loops=1), 0)
        self.assertEqual(prompts, ["[hub] Run the check"])
        entries = [json.loads(line) for line in (self.ws / ".orchestrator" / "hub-log.jsonl").read_text().splitlines()]
        self.assertEqual(sum(entry.get("type") == "prompt" and entry["id"] == command["id"] for entry in entries), 1)
        self.assertEqual(set(entries[0]), {"id", "type", "by", "body", "at"})
        self.assertFalse(backend.invalid)

    def test_watch_unchanged_sends_heartbeat_only(self):
        self.sample_run()
        with FakeBackend() as backend:
            self.set_backend(backend)
            ticks = iter([0, 0, 1, 1, 1, 31, 31, 31, 31])
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = AC.watch(self.ws, runner=self.fake_herdr(), sleep=lambda _: None,
                                no_orchestrator=True, max_loops=2, clock=lambda: next(ticks, 31))
        self.assertEqual(code, 0)
        paths = [r["path"] for r in backend.requests]
        self.assertTrue(any(p.endswith("/heartbeat") for p in paths))
        self.assertEqual(sum(p.endswith("/snapshot") for p in paths), 1)
        self.assertEqual(sum(p.endswith("/decisions") for p in paths), 1)
        self.assertEqual(sum(p.endswith("/events") for p in paths), 1)
        self.assertEqual(sum(p.endswith("/documents") for p in paths), 1)

    def test_watch_changed_decision_sends_only_that_decision(self):
        self.sample_run()
        with FakeBackend() as backend:
            self.set_backend(backend)
            def mutate_decision(_):
                state = self.s.store.load("r1")
                state["decisions"]["D1"]["question"] = "Updated question"
                self.s.store.save(state)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = AC.watch(self.ws, runner=self.fake_herdr(), sleep=mutate_decision,
                                no_orchestrator=True, max_loops=2)
        self.assertEqual(code, 0)
        batches = [r["body"] for r in backend.requests if r["path"].endswith("/decisions")]
        self.assertEqual([d["decision_id"] for d in batches[0]["decisions"]], ["D1", "D2", "D3"])
        self.assertEqual([d["decision_id"] for d in batches[1]["decisions"]], ["D1"])
        self.assertEqual(sum(r["path"].endswith("/snapshot") for r in backend.requests), 1)

    def test_watch_backend_down_backs_off_then_resyncs(self):
        self.sample_run()
        with FakeBackend(offline=True, restore_after=1) as backend:
            self.set_backend(backend)
            sleeps, hints = [], []
            real_write = AC.write_hint

            def record_hint(ws, online):
                hints.append(online)
                real_write(ws, online)

            with mock.patch.object(AC, "write_hint", side_effect=record_hint), redirect_stdout(StringIO()), \
                    redirect_stderr(StringIO()):
                code = AC.watch(self.ws, runner=self.fake_herdr(), sleep=sleeps.append,
                                no_orchestrator=True, max_loops=1)
        self.assertEqual(code, 0)
        self.assertEqual(sleeps[0], 1)
        self.assertIn(False, hints)
        self.assertIn(True, hints)
        self.assertTrue(any(r["path"].endswith("/snapshot") for r in backend.requests))

    def test_watch_duplicate_workspace_exits_two(self):
        with FakeBackend(duplicate=True) as backend:
            self.set_backend(backend)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = AC.watch(self.ws, runner=self.fake_herdr(), sleep=lambda _: None,
                                no_orchestrator=True, max_loops=1)
        self.assertEqual(code, 2)
        self.assertFalse((self.ws / ".orchestrator" / "hub-connector.pid").exists())

    def test_watch_orchestrator_gone_goodbye(self):
        self.sample_run()
        with FakeBackend() as backend:
            self.set_backend(backend)
            count = {"get": 0}

            def runner(args, **kwargs):
                if args[1:3] == ["agent", "get"]:
                    count["get"] += 1
                    if count["get"] > 1:
                        return subprocess.CompletedProcess(args, 1, "", "agent not found")
                return self.fake_herdr()(args, **kwargs)

            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = AC.watch(self.ws, runner=runner, sleep=lambda _: None, max_loops=4)
        self.assertEqual(code, 0)
        goodbye = [r["body"] for r in backend.requests if r["path"].endswith("/goodbye")]
        self.assertEqual(goodbye[0]["reason"], "orchestrator_gone")

    def test_loopback_requests_ignore_proxy_environment(self):
        with FakeBackend() as backend:
            with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1",
                                              "HTTPS_PROXY": "http://127.0.0.1:1", "no_proxy": ""}):
                response = AC.ping(backend.url, "test-connector-key", timeout=1)
        self.assertEqual(response["protocol"], 2)
        self.assertEqual(backend.requests[0]["protocol"], "2")


if __name__ == "__main__":
    unittest.main()
