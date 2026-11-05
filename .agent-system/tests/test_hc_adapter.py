"""Tests for the hc adapter, using only replayed CLI output."""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scheduler as S  # noqa: E402
import models as M  # noqa: E402


def completed(argv, stdout="", returncode=0):
    return subprocess.CompletedProcess(argv, returncode, stdout, "")


class FakeTime:
    def __init__(self):
        self.value = 0.0

    def clock(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class HcRecordTests(unittest.TestCase):
    def test_legacy_adapter_normalizes_records_and_exposes_auxiliary_methods(self):
        calls = []
        agent = {"name": "worker", "agent": "codex", "agent_status": "working", "cwd": "/work",
                 "agent_session": {"agent": "codex"}}

        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[1:3] == ["agent", "get"]:
                return completed(argv, json.dumps({"result": {"agent": agent}}))
            if argv[1:3] == ["agent", "list"]:
                return completed(argv, json.dumps({"result": {"agents": [agent]}}))
            if argv[1:3] == ["agent", "read"]:
                return completed(argv, "screen\n")
            if argv[1:3] == ["status", "server"]:
                return completed(argv, "status: running\n")
            return completed(argv)

        legacy = S.Herdr(runner=runner)
        rec, state = legacy.agent_record("worker")
        self.assertEqual(state, "working")
        self.assertEqual(rec["agent_status"], "working")
        self.assertEqual(rec["backend"], "legacy")
        self.assertEqual(rec["kind"], "codex")
        self.assertIn("agent_session", rec)
        self.assertEqual(legacy.agent_list()[0]["agent_status"], "working")
        self.assertEqual(legacy.agent_read("worker", 1), ["screen"])
        legacy.focus("worker")
        self.assertTrue(legacy.server_running())
        self.assertIn(["herdr", "agent", "read", "worker", "--source", "visible", "--lines", "1"], calls)
        self.assertIn(["herdr", "agent", "focus", "worker"], calls)
        self.assertIn(["herdr", "status", "server"], calls)

    def test_agent_record_normalizes_status_kind_and_failures(self):
        samples = [
            ({"address": "t1", "name": "one", "cwd": "/work", "state": "live",
              "status": {"app": "claude-code", "state": "working"}, "reported": True,
              "labels": {"herdr.space": "space-1"}, "foreground": {"name": "claude"}}, "working", "claude"),
            ({"address": "t2", "name": "two", "cwd": "/work", "state": "live",
              "status": {"app": "codex", "state": "done"}, "reported": True, "labels": {}}, "done", "codex"),
            ({"address": "t3", "state": "live", "status": {"app": "other", "state": "error"},
              "foreground": {"name": "python"}}, "unknown", "python"),
            ({"address": "t4", "state": "live", "status": None, "reported": False,
              "foreground": {}, "agent": "bash"}, "unknown", "bash"),
            ({"address": "t5", "state": "finished", "status": None}, "absent", "agent"),
        ]
        for raw, expected_state, expected_kind in samples:
            with self.subTest(expected_state=expected_state, expected_kind=expected_kind):
                hc = S.Hc(runner=lambda argv, **kwargs: completed(argv, json.dumps(raw)))
                rec, state = hc.agent_record(raw.get("address"))
                self.assertEqual(state, expected_state)
                if expected_state == "absent":
                    self.assertIsNone(rec)
                    continue
                self.assertEqual(rec["agent_status"], expected_state)
                self.assertEqual(rec["kind"], expected_kind)
                self.assertEqual(rec["backend"], "hc")
                self.assertEqual(rec["pane_id"], raw["address"])
                self.assertEqual(rec["workspace_id"], raw.get("labels", {}).get("herdr.space"))
        missing = {"error": {"kind": "not_found", "message": 'no terminal "missing"'}}
        # Real hc 0.1.17 writes the error object to stderr, not stdout.
        hc = S.Hc(runner=lambda argv, **kwargs: subprocess.CompletedProcess(argv, 3, "", json.dumps(missing)))
        self.assertEqual(hc.agent_record("missing"), (None, "absent"))
        hc = S.Hc(runner=lambda argv, **kwargs: (_ for _ in ()).throw(FileNotFoundError()))
        self.assertEqual(hc.agent_record("offline"), (None, "unknown"))

    def test_agent_start_uses_isolated_argv_renames_and_waits_for_reported_idle(self):
        time = FakeTime()
        calls = []
        polls = iter([
            {"address": "t1", "name": "worker", "cwd": "/work", "state": "live",
             "status": None, "reported": False, "labels": {"herdr.space": "ak0123456789abcdef"}},
            {"address": "t1", "name": "worker", "cwd": "/work", "state": "live",
             "status": {"app": "codex", "state": "idle"}, "reported": True,
             "labels": {"herdr.space": "ak0123456789abcdef"}},
        ])

        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            if argv[1:3] == ["run", "--bg"]:
                return completed(argv, '{"address":"t1","agent":"codex","cwd":"/work","name":"worker",'
                                       '"state":"live","turn":0}')
            if argv[:3] == ["herdr-app", "do", "space.rename"]:
                return completed(argv)
            if argv[1:2] == ["get"]:
                return completed(argv, json.dumps(next(polls)))
            if argv[1:2] == ["read"]:
                return completed(argv)
            raise AssertionError(argv)

        hc = S.Hc(runner=runner, sleep=time.sleep, clock=time.clock)
        workspace, pane = hc.workspace_create("/work", "run-worker")
        self.assertRegex(workspace, r"^ak[0-9a-f]{16}$")
        self.assertEqual(pane, workspace)
        hc.agent_start("worker", pane, ["--model", "test"], 2000, kind="codex",
                       labels={"agentkit.run": "r1", "agentkit.slot": "worker-1"})
        self.assertEqual(calls[0][0], ["hc", "run", "--bg", "--no-parent", "--no-notify", "--keep",
                                       "--name", "worker", "--cwd", "/work", "--label",
                                       f"herdr.space={pane}", "--label", "agentkit.kind=codex", "--label",
                                       "agentkit.run=r1", "--label", "agentkit.slot=worker-1", "--",
                                       M.binary("codex"), "--model", "test"])
        self.assertEqual(calls[1][0], ["herdr-app", "do", "space.rename", "--id", pane, "--name", "run-worker"])

    def test_agent_start_answers_only_the_safe_startup_dialogs(self):
        dialogs = [
            ("  Hooks need review\n› 1. Review hooks\n  2. Trust all and continue\n"
             "  3. Continue without trusting (hooks won't run)\n", ["down", "down", "enter"], "hooks_review"),
            ("Update available · 0.165.0 → 0.166.0\n› 1. Update now\n  2. Skip\n", ["esc"], "update"),
        ]
        for screen, expected_keys, answered in dialogs:
            with self.subTest(answered=answered):
                clock = FakeTime()
                calls = []
                reads = []
                gets = 0

                def runner(argv, **kwargs):
                    nonlocal gets
                    calls.append(argv)
                    if argv[1:3] == ["run", "--bg"] or argv[:3] == ["herdr-app", "do", "space.rename"]:
                        return completed(argv)
                    if argv[1:2] == ["get"]:
                        gets += 1
                        raw = {"address": "t1", "name": "worker", "state": "live",
                               "reported": gets > 1, "status": {"app": "codex", "state": "idle"}
                               if gets > 1 else None, "labels": {}}
                        return completed(argv, json.dumps(raw))
                    if argv[1:2] == ["read"]:
                        reads.append(argv)
                        return completed(argv, screen)
                    return completed(argv)

                hc = S.Hc(runner=runner, sleep=clock.sleep, clock=clock.clock)
                _, pane = hc.workspace_create("/work", "worker")
                rec = hc.agent_start("worker", pane, [], 2000)["result"]["agent"]
                self.assertEqual(rec["auto_answered"], [answered])
                self.assertEqual([call[2:] for call in calls if call[1:2] == ["keys"]],
                                 [["worker", *expected_keys]])
                self.assertTrue(reads)

    def test_agent_start_never_answers_trust_dialog(self):
        time = FakeTime()
        calls = []

        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[1:2] == ["run"]:
                return completed(argv, '{"address":"t1"}')
            if argv[1:2] == ["get"]:
                raw = {"address": "t1", "name": "worker", "state": "live",
                       "status": None, "reported": False, "labels": {}}
                return completed(argv, json.dumps(raw))
            if argv[1:2] == ["read"]:
                return completed(argv, "› 1. Trust this folder?\n  2. Continue\n")
            return completed(argv)

        hc = S.Hc(runner=runner, sleep=time.sleep, clock=time.clock)
        _, pane = hc.workspace_create("/work", "worker")
        with self.assertRaisesRegex(S.SchedulerError, "agent_not_ready"):
            hc.agent_start("worker", pane, [], 1000)
        self.assertFalse(any(call[1:2] == ["keys"] for call in calls))

    def test_agent_start_times_out_when_never_reported(self):
        time = FakeTime()

        def runner(argv, **kwargs):
            if argv[1:2] == ["run"]:
                return completed(argv, '{"address":"t1"}')
            if argv[1:2] == ["get"]:
                return completed(argv, json.dumps({"address": "t1", "name": "worker", "state": "live",
                                                   "status": None, "reported": False, "labels": {}}))
            return completed(argv)

        hc = S.Hc(runner=runner, sleep=time.sleep, clock=time.clock)
        _, pane = hc.workspace_create("/work", "worker")
        with self.assertRaisesRegex(S.SchedulerError, "agent_not_ready"):
            hc.agent_start("worker", pane, [], 1000)

    def test_agent_start_rejects_unknown_workspace(self):
        hc = S.Hc(runner=lambda argv, **kwargs: completed(argv))
        with self.assertRaisesRegex(S.SchedulerError, "unknown pane"):
            hc.agent_start("worker", "unknown", [], 1000)

    def test_agent_prompt_refuses_working_or_blocked(self):
        for state in ("working", "blocked"):
            calls = []
            raw = {"address": "t1", "name": "worker", "state": "live",
                   "status": {"app": "codex", "state": state}, "reported": True}

            def runner(argv, **kwargs):
                calls.append(argv)
                return completed(argv, json.dumps(raw))

            with self.subTest(state=state), self.assertRaises(S.SchedulerError):
                S.Hc(runner=runner).agent_prompt("worker", "text", 1000)
            self.assertFalse(any(argv[1:2] == ["send"] for argv in calls))

    def test_agent_prompt_returns_when_working_is_observed(self):
        calls = []
        time = FakeTime()

        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[1:2] == ["send"]:
                return completed(argv)
            state = "idle" if sum(call[1:2] == ["get"] for call in calls) == 1 else "working"
            raw = {"address": "t1", "name": "worker", "state": "live",
                   "status": {"app": "codex", "state": state}, "reported": True}
            return completed(argv, json.dumps(raw))

        result = S.Hc(runner=runner, sleep=time.sleep, clock=time.clock).agent_prompt("worker", "text", 1000)
        self.assertEqual(result["result"]["agent"]["agent_status"], "working")
        self.assertIn(["hc", "send", "worker", "text"], calls)

    def test_agent_prompt_times_out_without_acknowledgement(self):
        time = FakeTime()

        def runner(argv, **kwargs):
            raw = {"address": "t1", "name": "worker", "state": "live",
                   "status": {"app": "codex", "state": "idle"}, "reported": True}
            return completed(argv, json.dumps(raw))

        with self.assertRaisesRegex(S.SchedulerError, "prompt not acknowledged"):
            S.Hc(runner=runner, sleep=time.sleep, clock=time.clock).agent_prompt("worker", "text", 1000)

    def test_workspace_close_kills_and_removes_only_matching_space(self):
        calls = []
        terminals = {"t1": "wanted", "t2": "other"}

        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[1:3] == ["ls", "--json"]:
                raw = {"terminals": [{"address": name, "state": "live"} for name in terminals]}
                return completed(argv, json.dumps(raw))
            if argv[1:2] == ["get"]:
                name = argv[2]
                raw = {"address": name, "name": name, "cwd": "/work", "state": "live",
                       "status": {"app": "codex", "state": "idle"}, "reported": True,
                       "labels": {"herdr.space": terminals[name]}}
                return completed(argv, json.dumps(raw))
            return completed(argv)

        S.Hc(runner=runner).workspace_close("wanted")
        self.assertIn(["hc", "kill", "t1"], calls)
        self.assertIn(["hc", "rm", "t1"], calls)
        self.assertNotIn(["hc", "kill", "t2"], calls)
        self.assertNotIn(["hc", "rm", "t2"], calls)
        self.assertIn(["herdr-app", "do", "space.close", "--id", "wanted", "--confirmed", "true"], calls)

    def test_agent_read_drops_hc_lines_and_keeps_last_n(self):
        calls = []

        def runner(argv, **kwargs):
            calls.append(argv)
            return completed(argv, "first\n[hc] incomplete: older output may be missing\nsecond\nthird\n")

        self.assertEqual(S.Hc(runner=runner).agent_read("t1", 2), ["second", "third"])
        self.assertEqual(calls, [["hc", "read", "--lines", "2", "t1"]])

    def test_wait_change_skips_snapshot_and_unwatched_terminal(self):
        class FakeProcess:
            def __init__(self, content):
                self.read_fd, self.write_fd = os.pipe()
                self.stdout = os.fdopen(self.read_fd, "rb", buffering=0)
                os.write(self.write_fd, content)
                os.close(self.write_fd)
                self.write_fd = None
                self.terminated = False

            def terminate(self):
                self.terminated = True
                if self.write_fd is not None:
                    os.close(self.write_fd)
                    self.write_fd = None

            def wait(self, timeout=None):
                return 0

        snapshot = {"channel": None, "seq": 1, "terminals": [{"address": "ours"}]}
        other = {"jsonrpc": "2.0", "method": "event", "params":
                 {"data": {}, "seq": 2, "terminal": "other", "type": "foreground"}}
        mine = {"jsonrpc": "2.0", "method": "event", "params":
                {"data": {}, "seq": 3, "terminal": "ours", "type": "foreground"}}
        mine_by_data = {"jsonrpc": "2.0", "method": "event", "params":
                        {"data": {"address": "ours"}, "seq": 4, "type": "created"}}
        for lines, expected in (([snapshot, other], False), ([snapshot, mine], True),
                                ([snapshot, mine_by_data], True)):
            proc = FakeProcess(("\n".join(json.dumps(line) for line in lines) + "\n").encode())
            calls = []

            def popen(argv, **kwargs):
                calls.append((argv, kwargs))
                return proc

            result = S.Hc(popen=popen).wait_change({"ours"}, 1)
            self.assertEqual(result, expected)
            self.assertTrue(proc.terminated)
            self.assertEqual(calls[0][0], ["hc", "events", "--json"])
            self.assertIs(calls[0][1]["stdout"], subprocess.PIPE)

    def test_wait_change_timeout_and_popen_error(self):
        class FakeProcess:
            def __init__(self):
                self.read_fd, self.write_fd = os.pipe()
                self.stdout = os.fdopen(self.read_fd, "rb", buffering=0)
                self.terminated = False

            def terminate(self):
                self.terminated = True
                os.close(self.write_fd)
                self.write_fd = None

            def wait(self, timeout=None):
                return 0

        proc = FakeProcess()
        time = FakeTime()
        with mock.patch.object(S.select, "select", return_value=([], [], [])) as select_mock:
            self.assertFalse(S.Hc(popen=lambda *a, **k: proc, clock=time.clock).wait_change({"ours"}, 2))
        self.assertTrue(proc.terminated)
        self.assertEqual(select_mock.call_args.args[3], 2)

        sleeps = []

        def failed_popen(*args, **kwargs):
            raise OSError("unavailable")

        self.assertFalse(S.Hc(popen=failed_popen, sleep=sleeps.append).wait_change({"ours"}, 3))
        self.assertEqual(sleeps, [3])

    def test_make_herdr_backend_selection_matrix(self):
        server_output = json.dumps({"core": {"id": "451e123", "name": "host"}, "finished": 1,
                                    "holder": {}, "live": 2, "pid": 8640, "uptime_ms": 445636,
                                    "version": "0.1.17"})
        for backend in ("hc", "legacy", "auto"):
            for session in ("hc", "herdr", "none"):
                for hc_on_path, server in ((False, False), (False, True), (True, False), (True, True)):
                    env = {}
                    if session == "hc":
                        env["HC_TERMINAL_ID"] = "t1"
                    elif session == "herdr":
                        env["HERDR_ENV"] = "1"
                    calls = []

                    def runner(argv, **kwargs):
                        calls.append(argv)
                        return completed(argv, server_output if server else "{}", 0 if server else 1)

                    with self.subTest(backend=backend, session=session, hc_on_path=hc_on_path, server=server), \
                            mock.patch.object(S.shutil, "which",
                                              side_effect=lambda name: "/bin/hc" if name == "hc" and hc_on_path
                                              else None):
                        adapter = S.make_herdr({"herdr": {"backend": backend}}, env=env, runner=runner)
                        if backend == "hc":
                            expected = S.Hc
                        elif backend == "legacy":
                            expected = S.Herdr
                        elif session == "hc" and hc_on_path:
                            expected = S.Hc
                        elif session == "herdr":
                            expected = S.Herdr
                        elif hc_on_path and server:
                            expected = S.Hc
                        else:
                            expected = S.Herdr
                        self.assertIsInstance(adapter, expected)
                        self.assertEqual([c for c in calls if c[1:3] == ["server", "status"]],
                                         [["hc", "server", "status"]] if backend == "auto" and session != "hc"
                                         and session != "herdr" and hc_on_path else [])

    def test_server_running_matches_hc_pid_sample(self):
        sample = '{"core":{"id":"451e123","name":"host"},"finished":1,"holder":{},' \
                 '"live":2,"pid":8640,"uptime_ms":445636,"version":"0.1.17"}'
        hc = S.Hc(runner=lambda argv, **kwargs: completed(argv, sample))
        self.assertTrue(hc.server_running())
        self.assertEqual(S.HUB_STATES, ("idle", "working", "blocked", "done", "unknown", "absent"))

    def test_hc_available_uses_path_and_terminal_or_running_server(self):
        with mock.patch.object(S.shutil, "which", return_value="/bin/hc"), \
                mock.patch.dict("os.environ", {"HC_TERMINAL_ID": "t1"}, clear=False):
            self.assertTrue(S.Hc(runner=lambda *args, **kwargs: self.fail("terminal id should skip probe")).available())
        with mock.patch.object(S.shutil, "which", return_value="/bin/hc"), \
                mock.patch.dict("os.environ", {"HC_TERMINAL_ID": ""}, clear=False):
            hc = S.Hc(runner=lambda argv, **kwargs: completed(argv,
                      '{"core":{"id":"451e123","name":"host"},"finished":1,"holder":{},'
                      '"live":2,"pid":8640,"uptime_ms":445636,"version":"0.1.17"}'))
            self.assertTrue(hc.available())
        with mock.patch.object(S.shutil, "which", return_value=None):
            self.assertFalse(S.Hc(runner=lambda *args, **kwargs: self.fail("missing hc should skip probe")).available())


if __name__ == "__main__":
    unittest.main()
