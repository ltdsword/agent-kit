"""Tests for the best-effort Herdr Tasks mirror."""
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import herdr_tasks as H  # noqa: E402


def task(tid, status="PENDING", **fields):
    return {"id": tid, "title": f"Title {tid}", "summary": f"Summary {tid}",
            "status": status, "worker": None, "attempts": 0, "major_repairs": 0,
            "depends_on": [], "packet": f"{tid}.md", **fields}


class FakeScheduler:
    def __init__(self, root, run_id="run-one"):
        self.workspace_root = Path(root)
        self.store = SimpleNamespace(run_dir=lambda rid: self.workspace_root / "runs" / rid)
        self.run_id = run_id


class HerdrTasksTests(unittest.TestCase):
    def enabled_env(self):
        return {"HC_TERMINAL_ID": "terminal-1", "PATH": "/bin"}

    def test_enabled_requires_config_binaries_and_terminal_or_hc_backend(self):
        available = {"yes": True}

        def which(name, path=None):
            return f"/bin/{name}" if available["yes"] else None

        with mock.patch.object(H.shutil, "which", side_effect=which) as which_mock:
            self.assertTrue(H.enabled({"herdr": {}}, self.enabled_env()))
            self.assertEqual([call.args[0] for call in which_mock.call_args_list], ["herdr-task", "hc"])
            self.assertFalse(H.enabled({"herdr": {"tasks": False}}, self.enabled_env()))
            self.assertTrue(H.enabled({"herdr": {"backend": "hc"}}, {"PATH": "/bin"}))
            self.assertFalse(H.enabled({"herdr": {}}, {"PATH": "/bin"}))
            available["yes"] = False
            self.assertFalse(H.enabled({"herdr": {}}, self.enabled_env()))

    def test_creates_in_dependency_order_with_prompt_title_and_after_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {}, "tasks": {
                "T2": task("T2", depends_on=["T1"]),
                "T1": task("T1", title="Root", summary="Do root", packet="root.md"),
            }}
            calls = []

            def runner(argv, **kwargs):
                calls.append((argv, kwargs))
                tid = "1" if "Root" in argv[-1] else "2"
                return subprocess.CompletedProcess(argv, 0, json.dumps({"id": int(tid), "key": f"run#{tid}"}), "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)

            self.assertEqual(calls[0][0], ["herdr-task", "add", "--folder", str(scheduler.workspace_root),
                                          "--json", "--here", "--prompt", "Do root\n\nTask file: root.md",
                                          "run-one T1: Root"])
            self.assertEqual(calls[1][0], ["herdr-task", "add", "--folder", str(scheduler.workspace_root),
                                          "--json", "--here", "--prompt", "Summary T2\n\nTask file: T2.md",
                                          "--after", "1", "run-one T2: Title T2"])
            self.assertTrue(all(kwargs == {"capture_output": True, "text": True, "shell": False,
                                           "timeout": 10} for _, kwargs in calls))

    def test_title_is_cut_to_eighty_characters(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {}, "tasks": {
                "T1": task("T1", title="x" * 100),
            }}
            calls = []
            H.sync(scheduler, state, runner=lambda argv, **kwargs: (
                calls.append(argv) or subprocess.CompletedProcess(argv, 0, '{"id":1,"key":"k"}', "")),
                adopt=lambda *args: True)
            self.assertEqual(len(calls[0][-1]), 80)

    def test_unchanged_fingerprint_skips_commands_and_map_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {}, "tasks": {"T1": task("T1")}}
            calls = []

            def runner(argv, **kwargs):
                calls.append(argv)
                return subprocess.CompletedProcess(argv, 0, '{"id":7,"key":"run#7"}', "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)
            map_path = scheduler.store.run_dir("run-one") / "herdr-tasks.json"
            mapping = json.loads(map_path.read_text())
            self.assertEqual(mapping["tasks"]["T1"]["id"], 7)
            self.assertEqual(mapping["tasks"]["T1"]["key"], "run#7")
            first_calls = list(calls)
            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)
            self.assertEqual(calls, first_calls)
            self.assertEqual(json.loads(map_path.read_text()), mapping)

    def test_running_resolves_address_adopts_once_and_sets_working(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {"W1": {"agent_name": "w1-run"}},
                     "tasks": {"T1": task("T1", "RUNNING", worker="W1")}}
            calls, adopted = [], []

            def runner(argv, **kwargs):
                calls.append(argv)
                if argv[:2] == ["hc", "get"]:
                    return subprocess.CompletedProcess(argv, 0,
                        '{"address":"pane-1","state":"live","status":{"state":"working"}}', "")
                if argv[1] == "add":
                    return subprocess.CompletedProcess(argv, 0, '{"id":1,"key":"run#1"}', "")
                return subprocess.CompletedProcess(argv, 0, "", "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: adopted.append(args) or True)
            self.assertEqual(calls[0], ["herdr-task", "add", "--folder", str(scheduler.workspace_root),
                                        "--json", "--here", "--prompt", "Summary T1\n\nTask file: T1.md",
                                        "run-one T1: Title T1"])
            self.assertEqual(calls[1], ["hc", "get", "w1-run", "--json"])
            self.assertEqual(calls[2], ["herdr-task", "status", "--folder", str(scheduler.workspace_root),
                                        "1", "Working"])
            self.assertEqual(adopted, [(str(scheduler.workspace_root), 1, "pane-1", "codex")])

    def test_running_agent_not_started_yet_is_attached_on_next_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {"W1": {"agent_name": "w1-run"}},
                     "tasks": {"T1": task("T1", "RUNNING", worker="W1")}}
            live = {"on": False}
            adopted = []

            def runner(argv, **kwargs):
                if argv[:2] == ["hc", "get"]:
                    if not live["on"]:
                        return subprocess.CompletedProcess(argv, 1, "", "no such terminal")
                    return subprocess.CompletedProcess(argv, 0, '{"address":"pane-1","state":"live"}', "")
                if argv[1] == "add":
                    return subprocess.CompletedProcess(argv, 0, '{"id":1,"key":"run#1"}', "")
                return subprocess.CompletedProcess(argv, 0, "", "")

            adopt = lambda *args: adopted.append(args) or True
            H.sync(scheduler, state, runner=runner, adopt=adopt)
            live["on"] = True
            H.sync(scheduler, state, runner=runner, adopt=adopt)
            self.assertEqual(adopted[-1], (str(scheduler.workspace_root), 1, "pane-1", "codex"))
            adopted.clear()
            H.sync(scheduler, state, runner=runner, adopt=adopt)
            self.assertEqual(adopted, [])

    def test_repair_status_uses_round_number(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            task_state = task("T1", "RUNNING", worker="W1", attempts=2, major_repairs=1)
            scheduler.store.run_dir("run-one").mkdir(parents=True)
            (scheduler.store.run_dir("run-one") / "herdr-tasks.json").write_text(
                '{"tasks":{"T1":{"id":1,"key":"run#1","seen":"old","address":"pane-1"}}}')
            state = {"run_id": "run-one", "workers": {"W1": {"agent_name": "w1-run"}},
                     "tasks": {"T1": task_state}}
            calls = []

            def runner(argv, **kwargs):
                calls.append(argv)
                if argv[:2] == ["hc", "get"]:
                    return subprocess.CompletedProcess(argv, 0,
                        '{"address":"pane-1","state":"live","status":{"state":"working"}}', "")
                return subprocess.CompletedProcess(argv, 0, "", "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: self.fail("same address re-adopted"))
            self.assertEqual(calls[-1][-1], "Fix round 1")

    def test_review_adopts_without_address_and_reports_waiting_for_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {}, "tasks": {"T1": task("T1", "REVIEW")}}
            calls, adopted = [], []

            def runner(argv, **kwargs):
                calls.append(argv)
                if argv[1] == "add":
                    return subprocess.CompletedProcess(argv, 0, '{"id":1,"key":"run#1"}', "")
                return subprocess.CompletedProcess(argv, 0, "", "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: adopted.append(args) or True)
            self.assertEqual(adopted, [(str(scheduler.workspace_root), 1, None, "codex")])
            self.assertEqual(calls[-1], ["herdr-task", "status", "--folder", str(scheduler.workspace_root),
                                          "1", "Waiting for review"])

    def test_report_present_before_review_shows_waiting_for_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            report = scheduler.store.run_dir("run-one") / "reports" / "T1.json"
            report.parent.mkdir(parents=True)
            report.write_text("{}")
            task_state = task("T1", "RUNNING", worker="W1")
            state = {"run_id": "run-one", "workers": {"W1": {"agent_name": "w1-run"}},
                     "tasks": {"T1": task_state}}
            scheduler.store.run_dir("run-one").mkdir(parents=True, exist_ok=True)
            (scheduler.store.run_dir("run-one") / "herdr-tasks.json").write_text(
                '{"tasks":{"T1":{"id":1,"key":"run#1","seen":"old","address":null}}}')
            calls = []

            def runner(argv, **kwargs):
                calls.append(argv)
                if argv[:2] == ["hc", "get"]:
                    return subprocess.CompletedProcess(argv, 0,
                        '{"address":"pane-1","state":"live","status":{"state":"working"}}', "")
                return subprocess.CompletedProcess(argv, 0, "", "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)
            self.assertEqual(calls[-1][-1], "Waiting for review")

    def test_merged_task_is_marked_done(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {}, "tasks": {"T1": task("T1", "MERGED")}}
            calls = []

            def runner(argv, **kwargs):
                calls.append(argv)
                if argv[1] == "add":
                    return subprocess.CompletedProcess(argv, 0, '{"id":1,"key":"run#1"}', "")
                return subprocess.CompletedProcess(argv, 0, "", "")

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)
            self.assertEqual(calls[-1], ["herdr-task", "done", "--folder", str(scheduler.workspace_root), "1"])

    def test_terminal_statuses_are_mirrored(self):
        expected = {
            "PASSED": "Reviewed, waiting to merge",
            "FIX_REQUIRED": "Fix needed",
            "BLOCKED": "Blocked: needs you",
            "FAILED": "Failed",
        }
        for status, message in expected.items():
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                scheduler = FakeScheduler(tmp)
                run_dir = scheduler.store.run_dir("run-one")
                run_dir.mkdir(parents=True)
                (run_dir / "herdr-tasks.json").write_text(
                    '{"tasks":{"T1":{"id":1,"key":"run#1","seen":"old","address":null}}}')
                state = {"run_id": "run-one", "workers": {}, "tasks": {"T1": task("T1", status)}}
                calls = []
                runner = lambda argv, **kwargs: (calls.append(argv)
                    or subprocess.CompletedProcess(argv, 0, "", ""))

                H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)

                self.assertEqual(calls[-1], ["herdr-task", "status", "--folder",
                                             str(scheduler.workspace_root), "1", message])

    def test_closed_run_finishes_unmerged_tasks(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            run_dir = scheduler.store.run_dir("run-one")
            run_dir.mkdir(parents=True)
            (run_dir / "herdr-tasks.json").write_text(
                '{"tasks":{"T1":{"id":1,"key":"run#1","seen":"old","address":null},'
                '"T2":{"id":2,"key":"run#2","seen":"old","address":null}}}')
            state = {"run_id": "run-one", "status": "BLOCKED", "workers": {},
                     "tasks": {"T1": task("T1", "BLOCKED"), "T2": task("T2", "PENDING")}}
            calls = []
            runner = lambda argv, **kwargs: (calls.append(argv)
                or subprocess.CompletedProcess(argv, 0, "", ""))
            folder = str(scheduler.workspace_root)

            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)

            self.assertIn(["herdr-task", "status", "--folder", folder, "1", "Run closed (blocked)"], calls)
            self.assertIn(["herdr-task", "done", "--folder", folder, "1"], calls)
            self.assertIn(["herdr-task", "done", "--folder", folder, "2"], calls)
            calls.clear()
            H.sync(scheduler, state, runner=runner, adopt=lambda *args: True)
            self.assertEqual(calls, [])

    def test_runner_exception_never_escapes(self):
        with tempfile.TemporaryDirectory() as tmp:
            scheduler = FakeScheduler(tmp)
            state = {"run_id": "run-one", "workers": {}, "tasks": {"T1": task("T1")}}
            H.sync(scheduler, state, runner=lambda *args, **kwargs: (_ for _ in ()).throw(OSError("offline")))

    def test_disabled_panel_and_sync_make_no_calls(self):
        calls = []
        runner = lambda *args, **kwargs: calls.append(args)
        with mock.patch.object(H, "enabled", return_value=False):
            self.assertFalse(H.show_panel({"herdr": {}}, {}, runner))
        self.assertEqual(calls, [])

    def test_show_panel_commands_run_in_order_and_stop_on_failure(self):
        calls = []

        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            code = 1 if len(calls) == 2 else 0
            return subprocess.CompletedProcess(argv, code, "", "")

        with mock.patch.object(H, "enabled", return_value=True):
            self.assertFalse(H.show_panel({"herdr": {}}, self.enabled_env(), runner))
        self.assertEqual([argv for argv, _ in calls], [
            ["herdr-app", "do", "layout.select", "--stack", "panel-body", "--child", "tasks"],
            ["herdr-app", "do", "layout.show", "--id", "panel"],
        ])
        self.assertEqual([kwargs for _, kwargs in calls], [
            {"capture_output": True, "text": True, "shell": False, "timeout": 10},
        ] * 2)

    def test_adopt_store_updates_task_and_labels_live_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "herdr_task"
            package.mkdir()
            (package / "__init__.py").write_text("")
            (package / "base.py").write_text("def now(): return 123\n")
            (package / "store.py").write_text("\n".join([
                "import fake_state",
                "class Store:",
                '    task = {"id": 4, "state": "todo", "agents": []}',
                "    dirty = False",
                "    def __init__(self, loc): self.loc = loc",
                "    def __enter__(self): return self",
                "    def __exit__(self, *args): fake_state.saved = self.task; fake_state.dirty = self.dirty",
                "    def find(self, ref): assert ref == '4'; return self.task",
                "    def key(self, task): return 'herdr#' + str(task['id'])",
                'def locate(folder): return {"folder": folder}',
                "",
            ]))
            binary = root / "herdr-task"
            binary.write_text("")
            calls = []
            capture = types.ModuleType("fake_state")
            sys.modules["fake_state"] = capture

            def runner(argv, **kwargs):
                calls.append((argv, kwargs))
                return subprocess.CompletedProcess(argv, 0, "", "")

            try:
                with mock.patch.object(H.shutil, "which", return_value=str(binary)):
                    self.assertTrue(H._adopt_store("/workspace", 4, "pane-4", "codex", runner=runner))
                saved = capture.saved
                self.assertEqual(saved["state"], "running")
                self.assertEqual(saved["started"], 123)
                self.assertEqual(saved["backup"], {"state": "skipped", "why": "agent-kit scheduler owns this task",
                                                    "at": 123})
                self.assertEqual(saved["agents"], [{"address": "pane-4", "agent": "codex", "at": 123}])
                self.assertTrue(capture.dirty)
                self.assertEqual(calls[0][0], ["hc", "label", "pane-4", "herdr.task=herdr#4"])
                self.assertEqual(calls[0][1], {"capture_output": True, "text": True, "shell": False,
                                               "timeout": 10})
            finally:
                sys.modules.pop("fake_state", None)


if __name__ == "__main__":
    unittest.main()
