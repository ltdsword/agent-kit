"""Artifact board and decision card tests."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import artifacts as A  # noqa: E402
import scheduler as S  # noqa: E402


def sample_state():
    return {
        "schema_version": 1,
        "run_id": "run-one",
        "title": "Artifact board",
        "status": "RUNNING",
        "created_at": "2026-11-05T00:00:00+00:00",
        "events": [{"at": "2026-11-05T00:01:00+00:00", "private": "event body must not appear"}],
        "tasks": {
            "T1": {"id": "T1", "title": "Build board", "status": "REVIEW", "worker": "worker-1",
                   "packet": "packet body must not appear", "reviews": [{"verdict": "PASS", "notes": "private"}]},
        },
        "decisions": {
            "D1": {"id": "D1", "kind": "scope_exception", "title": "Choose scope",
                   "question": "Which scope?", "options": [{"key": "A", "label": "Small", "consequence": "private"},
                                                               {"key": "B", "label": "Large"}],
                   "recommend": "A", "followup": {"question": "Where?", "when": ["B"],
                       "options": [{"key": "branch", "label": "Use branch", "value": "main"},
                                   {"key": "other", "label": "Enter a name", "input": True}]},
                   "answer": {"choice": "B", "quote": "private answer quote", "note": "private note",
                              "followup": {"choice": "branch", "value": "main"}}},
        },
        "packet": "packet body must not appear",
        "project_root": "/private/path must not appear",
    }


def minimal_run_state():
    return {"schema_version": 1, "run_id": "run-one", "title": "Title", "goal": "Goal",
            "status": "RUNNING", "tasks": {"T1": {"id": "T1", "title": "Task",
                "summary": "A sufficiently long task summary.", "depends_on": [], "owned_paths": [],
                "acceptance": ["done"], "packet": "task.md", "status": "PENDING", "worker": None}},
            "workers": {}, "decisions": {}, "events": [],
            "research": {"scout_rounds_used": 0, "max_scout_rounds": 0}}


class ArtifactBoardTests(unittest.TestCase):
    def test_board_data_has_only_the_safe_contract_fields(self):
        board = A.board_data(sample_state())
        self.assertEqual(set(board), {"run_id", "title", "goal", "status", "integration_branch",
                                      "gate", "updated_at", "tasks", "problems", "decisions"})
        self.assertEqual(set(board["tasks"][0]), {"id", "title", "summary", "status", "worker", "verdict",
                                                   "depends_on", "fix_rounds"})
        self.assertEqual(board["tasks"][0]["verdict"], "PASS")
        self.assertEqual(board["tasks"][0]["depends_on"], [])
        self.assertEqual(board["tasks"][0]["fix_rounds"], 0)
        self.assertEqual(board["problems"], [])
        self.assertEqual(set(board["decisions"][0]),
                         {"id", "kind", "title", "question", "options", "recommend", "followup", "answer"})
        self.assertEqual(board["decisions"][0]["options"], [{"key": "A", "label": "Small"},
                                                              {"key": "B", "label": "Large"}])
        self.assertEqual(board["decisions"][0]["answer"], {"choice": "B", "followup": "main"})
        serialized = json.dumps(board)
        for private in ("packet body", "private answer quote", "private note", "/private/path", "event body"):
            self.assertNotIn(private, serialized)

    def test_board_data_includes_graph_gate_and_safe_problems(self):
        state = sample_state()
        state["goal"] = "Ship the run board"
        state["integration_branch"] = "agent/integration"
        state["verify"] = {"exit_code": 0}
        state["status"] = "BLOCKED"
        state["close_reason"] = "Integration stopped"
        state["tasks"]["T1"].update(summary="Root summary", depends_on=[], major_repairs=2)
        long_note = "problem note " * 30
        state["tasks"]["T2"] = {
            "id": "T2", "title": "Dependent task", "summary": "Needs T1", "status": "FIX_REQUIRED",
            "worker": "worker-2", "depends_on": ["T1"], "major_repairs": 3,
            "status_reason": long_note, "packet": "private packet", "prompt": "private prompt",
        }
        state["decisions"]["D2"] = {"id": "D2", "task": "T2", "status": "PENDING"}

        board = A.board_data(state)

        self.assertEqual(board["goal"], "Ship the run board")
        self.assertEqual(board["integration_branch"], "agent/integration")
        self.assertEqual(board["gate"], "PASS")
        self.assertEqual(board["tasks"][0]["summary"], "Root summary")
        self.assertEqual(board["tasks"][0]["fix_rounds"], 2)
        self.assertEqual(board["tasks"][1]["depends_on"], ["T1"])
        self.assertEqual(board["tasks"][1]["fix_rounds"], 3)
        self.assertEqual(board["problems"], [
            {"task_id": "T2", "type": "FIX_REQUIRED", "decision_id": "D2", "note": long_note[:200]},
            {"task_id": None, "type": "BLOCKED", "decision_id": None, "note": "Integration stopped"},
        ])
        serialized = json.dumps(board)
        self.assertNotIn("private packet", serialized)
        self.assertNotIn("private prompt", serialized)

        state["verify"]["exit_code"] = 1
        self.assertEqual(A.board_data(state)["gate"], "FAIL")
        state["verify"]["exit_code"] = None
        self.assertIsNone(A.board_data(state)["gate"])

    def test_write_board_is_atomic_and_ignores_write_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "runs" / "run-one"
            A.write_board(run_dir, sample_state())
            board_path = run_dir / "board.json"
            self.assertEqual(json.loads(board_path.read_text()), A.board_data(sample_state()))
            self.assertEqual(list(run_dir.glob(".*.tmp")), [])

            blocked_parent = Path(tmp) / "not-a-directory"
            blocked_parent.write_text("occupied")
            A.write_board(blocked_parent / "run-one", sample_state())
            self.assertEqual(blocked_parent.read_text(), "occupied")

    def test_enabled_requires_config_terminal_and_binary(self):
        with mock.patch.object(A.shutil, "which", return_value="/bin/herdr-artifact") as which:
            self.assertTrue(A.enabled({"herdr": {}}, {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}))
            which.assert_called_with("herdr-artifact", path="/bin")
            self.assertFalse(A.enabled({"herdr": {"artifacts": False}},
                                       {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}))
            self.assertFalse(A.enabled({"herdr": {}}, {"PATH": "/bin"}))
            which.return_value = None
            self.assertFalse(A.enabled({"herdr": {}}, {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}))

    def test_publish_board_uses_cli_contract_and_writes_data_module(self):
        calls = []

        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, json.dumps({"id": "board-artifact"}), "")

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(A.shutil, "which", return_value="/bin/herdr-artifact"):
            run_dir = Path(tmp) / "run-one"
            state = sample_state()
            artifact_id = A.publish_board(Path(tmp), run_dir, state, {"herdr": {}},
                                          {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}, runner)
            self.assertEqual(artifact_id, "board-artifact")
            self.assertEqual(state["artifacts"]["board"], artifact_id)
            argv, kwargs = calls[0]
            self.assertEqual(argv, ["herdr-artifact", "publish", str(run_dir / "artifacts" / "board"),
                                    "--title", "run-one: board", "--folder", str(Path(tmp)), "--json"])
            self.assertEqual(kwargs["shell"], False)
            data_module = (run_dir / "artifacts" / "board" / "data.js").read_text()
            self.assertIn(f'export const DATA = {json.dumps(str(run_dir / "board.json"))};', data_module)
            self.assertIn('export const DECISION = "";', data_module)
            self.assertIn('export const RUN = "run-one";', data_module)

    def test_publish_decision_uses_id_and_failure_returns_none(self):
        state = sample_state()
        calls = []

        def success(argv, **kwargs):
            calls.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps({"id": "decision-artifact"}), "")

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(A.shutil, "which", return_value="/bin/herdr-artifact"):
            run_dir = Path(tmp) / "run-one"
            result = A.publish_decision(Path(tmp), run_dir, state, {"herdr": {}},
                                        "D1", {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}, success)
            self.assertEqual(result, "decision-artifact")
            self.assertEqual(state["decisions"]["D1"]["artifact_id"], result)
            self.assertEqual(calls[0][3:5], ["--title", "run-one D1: Choose scope"])
            data_module = (run_dir / "artifacts" / "D1" / "data.js").read_text()
            self.assertIn('export const DECISION = "D1";', data_module)

            failed = lambda argv, **kwargs: subprocess.CompletedProcess(argv, 1, "", "failed")
            self.assertIsNone(A.publish_board(Path(tmp), run_dir, sample_state(), {"herdr": {}},
                                               {"HC_TERMINAL_ID": "t1", "PATH": "/bin"}, failed))

    def test_remove_keeps_cards_shown_in_layouts_and_ignores_broken_layouts(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            layouts = home / "layouts"
            layouts.mkdir()
            (layouts / "main.json").write_text(json.dumps({
                "blocks": [{"id": "artifacts-view-body", "content": {"mod": "art-kept"}}],
            }))
            (layouts / "other.json").write_text(json.dumps({
                "nested": [{"content": {"mod": "art-second"}}],
            }))
            (layouts / "broken.json").write_text("{")
            env = {"HERDR_APP_HOME": str(home)}
            calls = []

            def runner(argv, **kwargs):
                calls.append(argv)
                return subprocess.CompletedProcess(argv, 0, "", "")

            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                A.remove(["kept", "other", "second"], runner, env=env)

            self.assertEqual(calls, [["herdr-artifact", "rm", "other"]])
            self.assertEqual(stderr.getvalue(),
                             "kept artifact kept: shown in a Herdr layout\n"
                             "kept artifact second: shown in a Herdr layout\n")

    def test_remove_calls_cli_for_each_id_when_layouts_dir_is_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"HERDR_APP_HOME": tmp}
            calls = []

            def runner(argv, **kwargs):
                calls.append(argv)
                return subprocess.CompletedProcess(argv, 0, "", "")

            A.remove(["d1", "d2"], runner, env=env)
            self.assertEqual(calls, [["herdr-artifact", "rm", "d1"],
                                     ["herdr-artifact", "rm", "d2"]])

        def failed_runner(argv, **kwargs):
            raise OSError("unavailable")

        A.remove(["d1", "d2"], failed_runner, env=env)

    def test_state_validation_accepts_artifact_ids(self):
        state = minimal_run_state()
        state.update(artifacts={"board": "board-id"}, decisions={"D1": {"artifact_id": "decision-id"}})
        S.validate_state(state)

    def test_scheduler_decision_command_succeeds_when_card_publish_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            scheduler = S.Scheduler.__new__(S.Scheduler)
            scheduler.workspace_root = workspace
            scheduler.project_root = workspace
            scheduler.cfg = {"herdr": {"alerts": False, "artifacts": True}}
            scheduler.store = S.Store(workspace)
            scheduler.store.save(minimal_run_state())
            with mock.patch.object(A, "enabled", return_value=True), \
                    mock.patch.object(A, "publish_decision", return_value=None) as publish:
                result = scheduler.decision_ask("run-one", "question", "Question", "Pick one?", ["A=One", "B=Two"])
            self.assertEqual(result["status"], "PENDING")
            publish.assert_called_once()

    def test_answered_decision_is_present_in_board(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            scheduler = S.Scheduler.__new__(S.Scheduler)
            scheduler.workspace_root = workspace
            scheduler.project_root = workspace
            scheduler.cfg = {"herdr": {"alerts": False, "artifacts": False}}
            scheduler.store = S.Store(workspace)
            scheduler.store.save(minimal_run_state())
            with mock.patch.object(A, "enabled", return_value=False):
                opened = scheduler.decision_ask("run-one", "question", "Choose", "Pick one?", ["A=One", "B=Two"])
            scheduler.decision_answer("run-one", opened["decision"], "A", quote="A")
            board = json.loads((scheduler.store.run_dir("run-one") / "board.json").read_text())
            answer = board["decisions"][0]["answer"]
            self.assertEqual(answer, {"choice": "A", "followup": None})
            self.assertNotIn('"quote"', json.dumps(board))

    @unittest.skipUnless(shutil.which("herdr-app"), "herdr-app is not on PATH")
    def test_herdr_app_check_accepts_both_shipped_panels(self):
        sample = {
            "run_id": "run-one", "title": "Sample", "goal": "Check the task graph",
            "status": "RUNNING", "integration_branch": "agent/integration", "gate": "PASS",
            "updated_at": None,
            "tasks": [
                {"id": "T1", "title": "Root task", "summary": "Starts the graph", "status": "PASSED",
                 "worker": "worker-1", "verdict": "PASS", "depends_on": [], "fix_rounds": 0},
                {"id": "T2", "title": "Dependent task", "summary": "Needs T1", "status": "FIX_REQUIRED",
                 "worker": "worker-2", "verdict": None, "depends_on": ["T1"], "fix_rounds": 1},
            ],
            "problems": [{"task_id": "T2", "type": "FIX_REQUIRED", "decision_id": "D1",
                          "note": "Needs a repair decision"}],
            "decisions": [{"id": "D1", "kind": "repair", "title": "Repair task",
                           "question": "Choose a repair", "options": [{"key": "A", "label": "Retry"}],
                           "recommend": "A", "followup": None, "answer": None}],
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            board_path = root / "board.json"
            board_path.write_text(json.dumps(sample))
            for name in ("board", "decision"):
                copied = root / name
                shutil.copytree(A.PANELS_DIR / name, copied)
                (copied / "data.js").write_text(
                    f"export const DATA = {json.dumps(str(board_path))};\n"
                    f"export const DECISION = {json.dumps('D1' if name == 'decision' else '')};\n"
                    "export const RUN = \"run-one\";\n")
                (copied / "artifact.js").write_text(
                    'export const title = "Sample"; export const version = 1; export const id = "test"; '
                    'export function reply(_text) {}\n')
                env = os.environ.copy()
                env["XDG_DATA_HOME"] = str(root / "data")
                env["XDG_CONFIG_HOME"] = str(root / "config")
                env["XDG_CACHE_HOME"] = str(root / "cache")
                result = subprocess.run(["herdr-app", "check", str(copied)], capture_output=True, text=True, env=env)
                self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
