"""Tests for optional parallel review and test sessions, using a fake hc adapter."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import models as M  # noqa: E402
import scheduler as S  # noqa: E402


class FakeHc:
    backend = "hc"

    def __init__(self):
        self.calls = []
        self.live = {}
        self.workspace_of = {}
        self.start_calls = []
        self.prompts = []
        self.record_queries = []
        self.unknown_once = set()
        self.workspace_n = 0

    def require(self):
        return None

    def available(self):
        return True

    def workspace_create(self, cwd, label):
        self.workspace_n += 1
        ws = f"space-{self.workspace_n}"
        self.calls.append(("workspace_create", cwd, label, ws))
        return ws, ws

    def workspace_close(self, ws):
        self.calls.append(("workspace_close", ws))
        for name, current in list(self.workspace_of.items()):
            if current == ws:
                self.live.pop(name, None)

    def agent_start(self, name, pane, agent_args, timeout_ms, kind="claude", labels=None, argv_prefix=None):
        call = {"name": name, "pane": pane, "args": list(agent_args), "timeout_ms": timeout_ms,
                "kind": kind, "labels": labels, "argv_prefix": argv_prefix}
        self.calls.append(("agent_start", call))
        self.start_calls.append(call)
        self.live[name] = "idle"
        self.workspace_of[name] = pane
        return {}

    def agent_prompt(self, name, text, timeout_ms):
        self.calls.append(("agent_prompt", name))
        self.prompts.append((name, text, timeout_ms))
        self.live[name] = "working"
        return {}

    def agent_record(self, name):
        self.record_queries.append(name)
        if name in self.unknown_once:
            self.unknown_once.remove(name)
            return None, "unknown"
        if name not in self.live:
            return None, "absent"
        state = self.live[name]
        return {"name": name, "agent_status": state, "workspace_id": self.workspace_of[name],
                "pane_id": name, "backend": "hc", "kind": "claude"}, state

    def agent_list(self):
        return [self.agent_record(name)[0] for name in self.live]


class FakeLegacy(FakeHc):
    backend = "legacy"


class FakeTime:
    def __init__(self):
        self.value = 0.0

    def clock(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()
        self.git_env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
                        "GIT_AUTHOR_NAME": "tests", "GIT_AUTHOR_EMAIL": "tests@example.invalid",
                        "GIT_COMMITTER_NAME": "tests", "GIT_COMMITTER_EMAIL": "tests@example.invalid"}
        self.git("init", "-q", "-b", "main")
        (self.root / ".gitignore").write_text(".orchestrator/\n")
        (self.root / "app.txt").write_text("base\n")
        packet = self.root / "packets" / "T1.md"
        packet.parent.mkdir()
        packet.write_text("# T1\n\n## Run these\n- `python3 -m pytest -q .agent-system/tests/test_checks.py`\n")
        self.git("add", "-A")
        self.git("commit", "-qm", "base")
        self.base_sha = self.git("rev-parse", "HEAD").stdout.strip()

        self.cfg = {
            "schema_version": 1,
            "orchestrator": {"kind": "claude", "model": "claude-opus-5-5", "effort": "high"},
            "worker": {"kind": "codex", "model": "gpt-6-luna", "reasoning_effort": "xhigh",
                       "profile": "worker", "sandbox": "workspace-write", "approval_policy": "on-request",
                       "trust_worktree": True, "network_access": True, "web_search": True, "writable_dirs": []},
            "pool": {"size": 1, "slots": ["worker-1"], "worktree_root": str(Path(self.tmp.name) / "worktrees")},
            "limits": {"max_tasks_per_request": 1, "max_parallel": 1, "max_major_repairs": 2,
                       "max_scout_rounds": 3},
            "decisions": {"require_user_for": ["blocker", "repair", "scope_exception", "abandon"],
                          "routine_repairs": 2},
            "tasks": {"dir": "gen-tasks", "inline_diff_max_lines": 400},
            "herdr": {"backend": "hc", "agent_start_timeout_ms": 1000, "prompt_ack_timeout_ms": 1000},
            "gate": {"verify_cmd": ["python3", "-c", "print('verify')"],
                     "post_merge_check": ["python3", "-c", "print('gate')"], "timeout_seconds": 10},
        }
        self.hc = FakeHc()
        self.s = S.Scheduler(self.root, cfg=self.cfg, herdr=self.hc)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, env=self.git_env, check=True,
                              capture_output=True, text=True)

    def make_review(self, run_id="r1", with_diff=True):
        task = {"id": "T1", "title": "Task T1", "summary": "Review the changed task implementation carefully.",
                "depends_on": [],
                "owned_paths": ["app.txt"], "acceptance": ["app.txt exists"], "packet": "packets/T1.md",
                "trivial": True}
        self.s.create_run(run_id, [task])
        self.s.dispatch_ready(run_id, launch="none")
        state = self.s.store.load(run_id)
        state["tasks"]["T1"]["status"] = "REVIEW"
        self.s.store.save(state)
        diff = self.s.store.run_dir(run_id) / "reports" / "T1.diff"
        if with_diff:
            diff.write_text("diff --git a/app.txt b/app.txt\n")
        return self.s.store.load(run_id)["tasks"]["T1"]

    def start_checks(self, run_id="r1"):
        with mock.patch.object(S.shutil, "which", return_value="/usr/bin/claude"):
            return self.s.check_start(run_id, "T1")

    def write_report(self, kind, verdict, check_id=None, summary=None):
        state = self.s.store.load("r1")
        session = state["tasks"]["T1"]["checks"]["sessions"][kind]
        report_path = self.root / session["report_json"]
        report_path.write_text(json.dumps({"check_id": check_id or state["tasks"]["T1"]["checks"]["check_id"],
                                           "task_id": "T1", "check": kind, "verdict": verdict,
                                           "summary": summary or f"{kind} {verdict.lower()}.", "findings": [],
                                           "logs": []}))
        (self.root / session["report_md"]).write_text(f"{kind}: {verdict}\n")

    def test_claude_env_prefix_composes_path_and_code_mode(self):
        self.assertEqual(M.claude_env_prefix(False, None), [])
        self.assertEqual(M.claude_env_prefix(False, "/bin"), ["env", "PATH=/bin"])
        self.assertEqual(M.claude_env_prefix(True, None), ["env", "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1"])
        self.assertEqual(M.claude_env_prefix(True, "/bin"),
                         ["env", "PATH=/bin", "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1"])

    def test_hc_run_argv_prefix_follows_separator(self):
        calls = []

        def runner(argv, **kwargs):
            calls.append(argv)
            if argv[1:2] == ["get"]:
                return subprocess.CompletedProcess(argv, 0, json.dumps({"address": "agent-1", "name": "agent-1",
                    "cwd": "/work", "state": "live", "reported": True,
                    "status": {"app": "claude-code", "state": "idle"}, "labels": {}}), "")
            return subprocess.CompletedProcess(argv, 0, "", "")

        hc = S.Hc(runner=runner)
        _, pane = hc.workspace_create("/work", "checks")
        hc.agent_start("agent-1", pane, ["--model", "test"], 1000, kind="claude",
                       argv_prefix=["env", "PATH=/test/path", "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1"])
        run = next(argv for argv in calls if argv[1:3] == ["run", "--bg"])
        separator = run.index("--")
        self.assertEqual(run[separator + 1:], ["env", "PATH=/test/path",
                                               "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1",
                                               "claude", "--model", "test"])

    def test_checks_cfg_defaults_merge_roles_and_validate_claude_kind(self):
        cfg = self.s.checks_cfg()
        self.assertEqual(cfg, {"enabled": True, "timeout_seconds": 1800,
                               "review": {"kind": "claude", "model": "claude-opus-5-5", "effort": "high",
                                          "code_mode": False},
                               "test": {"kind": "claude", "model": "claude-opus-5-5", "effort": "high",
                                        "code_mode": True}})
        self.cfg["checks"] = {"review": {"model": "claude-sonnet-5-5", "code_mode": True},
                              "test": {"effort": "low"}}
        merged = self.s.checks_cfg()
        self.assertEqual(merged["review"], {"kind": "claude", "model": "claude-sonnet-5-5", "effort": "high",
                                           "code_mode": True})
        self.assertEqual(merged["test"]["effort"], "low")
        bad = copy.deepcopy(self.cfg)
        bad["checks"]["test"]["kind"] = "codex"
        self.assertTrue(any("checks.test.kind" in error for error in S.validate_config(bad)))

    def test_check_start_launches_review_and_code_mode_test_with_paths_and_reports(self):
        self.make_review()
        run_dir = self.s.store.run_dir("r1")
        old_json = run_dir / "reports" / "T1.check-review.json"
        old_md = run_dir / "reports" / "T1.check-review.md"
        old_json.write_text("old")
        old_md.write_text("old")
        path = f"/scheduler/bin{os.pathsep}{os.environ.get('PATH', '')}"
        with mock.patch.dict(os.environ, {"PATH": path}), \
                mock.patch.object(S.shutil, "which", return_value="/usr/bin/claude"):
            result = self.s.check_start("r1", "T1")

        self.assertEqual(set(result["sessions"]), {"review", "test"})
        self.assertEqual([call["kind"] for call in self.hc.start_calls], ["claude", "claude"])
        starts = {call["labels"]["agentkit.check"]: call for call in self.hc.start_calls}
        self.assertEqual(starts["review"]["argv_prefix"], ["env", f"PATH={path}"])
        self.assertEqual(starts["test"]["argv_prefix"],
                         ["env", f"PATH={path}", "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1"])
        self.assertNotIn("CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1", starts["review"]["argv_prefix"])
        self.assertEqual(starts["review"]["labels"], {"agentkit.run": "r1", "agentkit.check": "review"})
        self.assertEqual(starts["test"]["labels"], {"agentkit.run": "r1", "agentkit.check": "test"})
        self.assertFalse(old_json.exists())
        self.assertFalse(old_md.exists())
        state = self.s.store.load("r1")
        checks = state["tasks"]["T1"]["checks"]
        self.assertEqual(checks["status"], "running")
        self.assertEqual(checks["check_id"], result["check_id"])
        self.assertTrue(checks["snapshot"])
        self.assertEqual(checks["sessions"]["review"]["verdict"], None)
        self.assertTrue((self.root / checks["sessions"]["test"]["report_json"]).name.endswith("check-test.json"))
        self.assertEqual(len(self.hc.prompts), 2)
        self.assertIn(str(self.root / "packets" / "T1.md"), self.hc.prompts[0][1])
        self.assertIn("1. python3 -m pytest -q .agent-system/tests/test_checks.py", self.hc.prompts[1][1])
        self.assertIn("2. python3 -c print('gate')", self.hc.prompts[1][1])

    def test_long_run_id_produces_distinct_session_names_under_hc_limit(self):
        run_id = "a" * 40
        self.make_review(run_id)
        result = self.start_checks(run_id)
        names = list(result["sessions"].values())
        self.assertEqual(len(set(names)), 2)
        self.assertTrue(all(len(name) <= 32 for name in names))

    def test_check_start_refuses_live_previous_checks(self):
        self.make_review()
        state = self.s.store.load("r1")
        state["tasks"]["T1"]["checks"] = {"status": "running", "space": "previous-space",
                                             "sessions": {"review": {"agent": "previous-agent"}}}
        self.s.store.save(state)
        self.hc.live["previous-agent"] = "working"
        self.hc.workspace_of["previous-agent"] = "previous-space"
        with mock.patch.object(S.shutil, "which", return_value="/usr/bin/claude"), \
                self.assertRaisesRegex(S.SchedulerError, "checks.*running"):
            self.s.check_start("r1", "T1")
        self.assertFalse(any(call[0] == "workspace_create" for call in self.hc.calls))

    def test_check_start_refuses_disabled_or_missing_claude(self):
        self.make_review()
        self.cfg["checks"] = {"enabled": False}
        with self.assertRaisesRegex(S.SchedulerError, "disabled"):
            self.s.check_start("r1", "T1")
        self.cfg["checks"] = {"enabled": True}
        with mock.patch.object(S.shutil, "which", return_value=None), \
                self.assertRaisesRegex(S.SchedulerError, "claude"):
            self.s.check_start("r1", "T1")

    def test_both_pass_closes_space_and_status_returns_saved_checks(self):
        self.make_review()
        self.start_checks()
        self.write_report("review", "PASS")
        self.write_report("test", "PASS")
        clock = FakeTime()
        result = self.s.check_wait("r1", "T1", sleep=clock.sleep, clock=clock.clock)
        self.assertEqual(result["result"], "pass")
        self.assertEqual(set(result["reports"]), {"review", "test"})
        self.assertIn(("workspace_close", "space-1"), self.hc.calls)
        checks = self.s.check_status("r1", "T1")
        self.assertEqual(checks["status"], "passed")
        self.assertEqual(checks["sessions"]["review"]["verdict"], "PASS")

    def test_test_fail_returns_before_review_finishes_and_closes_both(self):
        self.make_review()
        self.start_checks()
        self.write_report("test", "FAIL", summary="test command failed")
        self.hc.record_queries.clear()
        clock = FakeTime()
        result = self.s.check_wait("r1", "T1", sleep=clock.sleep, clock=clock.clock)
        self.assertEqual(result["result"], "fail")
        self.assertEqual(result["failed"], ["test"])
        self.assertEqual(self.hc.record_queries, [])
        self.assertIn(("workspace_close", "space-1"), self.hc.calls)
        self.assertEqual(self.s.check_status("r1", "T1")["status"], "failed")
        self.assertEqual(self.s.check_status("r1", "T1")["failed"], ["test"])

    def test_stale_check_id_report_is_ignored_until_timeout(self):
        self.make_review()
        self.start_checks()
        self.write_report("review", "PASS", check_id="stale-check-id")
        clock = FakeTime()
        result = self.s.check_wait("r1", "T1", timeout_s=0, sleep=clock.sleep, clock=clock.clock)
        self.assertEqual(result["result"], "timeout")
        self.assertEqual(self.s.check_status("r1", "T1")["status"], "running")

    def test_worktree_change_after_both_passes_fails_with_worktree_reason(self):
        self.make_review()
        self.start_checks()
        worktree = Path(self.s.store.load("r1")["tasks"]["T1"]["worktree"])
        (worktree / "app.txt").write_text("checker changed this\n")
        self.write_report("review", "PASS")
        self.write_report("test", "PASS")
        clock = FakeTime()
        result = self.s.check_wait("r1", "T1", sleep=clock.sleep, clock=clock.clock)
        self.assertEqual(result["result"], "fail")
        self.assertEqual(result["failed"], ["worktree"])
        self.assertIn("a checker changed the worktree", result["reason"])
        self.assertIn("task new --repair-of packets/T1.md", result["next"][0])

    def test_blocked_agent_returns_without_closing_checks_space(self):
        self.make_review()
        self.start_checks()
        checks = self.s.check_status("r1", "T1")
        self.hc.live[checks["sessions"]["review"]["agent"]] = "blocked"
        clock = FakeTime()
        result = self.s.check_wait("r1", "T1", sleep=clock.sleep, clock=clock.clock)
        self.assertEqual(result["result"], "blocked")
        self.assertFalse(any(call[0] == "workspace_close" for call in self.hc.calls))

    def test_gone_agent_without_report_closes_space_and_marks_lost(self):
        self.make_review()
        self.start_checks()
        review = self.s.check_status("r1", "T1")["sessions"]["review"]["agent"]
        self.hc.live.pop(review)
        clock = FakeTime()
        result = self.s.check_wait("r1", "T1", sleep=clock.sleep, clock=clock.clock)
        self.assertEqual(result["result"], "lost")
        self.assertEqual(result["kinds"], ["review"])
        self.assertIn(("workspace_close", "space-1"), self.hc.calls)
        self.assertEqual(self.s.check_status("r1", "T1")["status"], "lost")
        self.assertEqual(self.s.check_status("r1", "T1")["failed"], ["review"])

    def test_unknown_hc_agent_state_keeps_waiting_for_reports(self):
        self.make_review()
        self.start_checks()
        sessions = self.s.check_status("r1", "T1")["sessions"]
        self.hc.unknown_once = {session["agent"] for session in sessions.values()}
        order = []
        close = self.hc.workspace_close

        def tracked_close(space):
            order.append("close")
            close(space)

        self.hc.workspace_close = tracked_close
        clock = FakeTime()
        reports_written = False

        def sleep(seconds):
            nonlocal reports_written
            clock.sleep(seconds)
            if not reports_written:
                self.write_report("review", "PASS")
                self.write_report("test", "PASS")
                reports_written = True
                order.append("reports")

        result = self.s.check_wait("r1", "T1", sleep=sleep, clock=clock.clock)
        self.assertEqual(result["result"], "pass")
        self.assertEqual(order, ["reports", "close"])

    def test_check_start_refuses_non_review_legacy_and_missing_diff(self):
        self.make_review()
        state = self.s.store.load("r1")
        state["tasks"]["T1"]["status"] = "RUNNING"
        self.s.store.save(state)
        with self.assertRaisesRegex(S.SchedulerError, "RUNNING"):
            self.start_checks()
        state = self.s.store.load("r1")
        state["tasks"]["T1"]["status"] = "REVIEW"
        self.s.store.save(state)
        self.s.herdr = FakeLegacy()
        with self.assertRaisesRegex(S.SchedulerError, "checks need hc"):
            self.start_checks()
        self.s.herdr = self.hc
        (self.s.store.run_dir("r1") / "reports" / "T1.diff").unlink()
        with self.assertRaisesRegex(S.SchedulerError, "collect first"):
            self.start_checks()

    def test_repair_closes_running_checks_and_marks_cancelled(self):
        self.make_review()
        self.start_checks()
        packet = self.root / "packets" / "repair.md"
        packet.write_text("# Repair\n\n## Errors found\n- test\n\n## Proposed fix\n- fix\n")
        state = self.s.store.load("r1")
        state["tasks"]["T1"]["status"] = "FIX_REQUIRED"
        state["tasks"]["T1"]["checks"]["status"] = "running"
        self.s.store.save(state)
        self.s.repair("r1", "T1", "packets/repair.md", launch="none", reason="test failure")
        self.assertIn(("workspace_close", "space-1"), self.hc.calls)
        self.assertEqual(self.s.check_status("r1", "T1")["status"], "cancelled")

    def test_claude_worker_launch_gets_path_prefix_and_codex_does_not(self):
        self.make_review()
        state = self.s.store.load("r1")
        state["tasks"]["T1"]["status"] = "RUNNING"
        self.s.store.save(state)
        with mock.patch.dict(os.environ, {"PATH": "/scheduler/bin"}), \
                mock.patch.object(S.shutil, "which", return_value="/usr/bin/claude"):
            self.cfg["worker"]["kind"] = "claude"
            self.s._launch_session(self.s.store.load("r1"), "worker-1", "T1", "worker prompt")
            self.assertEqual(self.hc.start_calls[-1]["argv_prefix"], ["env", "PATH=/scheduler/bin"])
            self.cfg["worker"]["kind"] = "codex"
            self.s._launch_session(self.s.store.load("r1"), "worker-1", "T1", "worker prompt")
            self.assertIsNone(self.hc.start_calls[-1]["argv_prefix"])

    def test_check_cli_parses_start_wait_and_status(self):
        parser = S.build_parser()
        self.assertEqual(parser.parse_args(["check", "start", "--run", "r1", "--task", "T1"]).action, "start")
        wait = parser.parse_args(["check", "wait", "--run", "r1", "--task", "T1", "--timeout", "2"])
        self.assertEqual((wait.action, wait.timeout), ("wait", 2.0))
        self.assertEqual(parser.parse_args(["check", "status", "--run", "r1", "--task", "T1"]).action,
                         "status")


if __name__ == "__main__":
    unittest.main()
