"""Tests for the Agent Hub Claude Code hooks."""
import importlib.util
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "hub-hooks.py"
SPEC = importlib.util.spec_from_file_location("hub_hooks", SCRIPT)
HOOKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOOKS)


class HubHookTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ws = Path(self.tmp.name) / "workspace"
        (self.ws / ".agent-system").mkdir(parents=True)
        (self.ws / ".orchestrator").mkdir()
        self.config_path = self.ws / ".agent-system" / "config.json"
        self.config_path.write_text(json.dumps({"hub": {"enabled": True}}))
        (self.ws / ".orchestrator" / "hub-connector.pid").write_text(f"{os.getpid()}\n")

    def event(self, event_name, tool_name, tool_input):
        return {"cwd": str(self.ws), "hook_event_name": event_name,
                "tool_name": tool_name, "tool_input": tool_input}

    def test_pretool_allows_questions_when_connector_is_not_running(self):
        (self.ws / ".orchestrator" / "hub-connector.pid").write_text("2147483647\n")
        result = HOOKS.handle_event(self.event("PreToolUse", "AskUserQuestion", {"questions": []}))
        self.assertIsNone(result)

    def test_pretool_routes_each_question_and_denies_terminal_prompt(self):
        asks = []

        class FakeScheduler:
            def __init__(self, workspace):
                self.workspace = workspace

            def inbox_ask(self, title, question, options, recommend):
                asks.append((title, question, options, recommend))
                return {"decision": f"D{len(asks)}"}

        payload = {"questions": [
            {"header": "Choice one", "question": "Keep or change?", "options": [
                {"label": "Keep", "description": "preserve current behavior"},
                {"label": "Change (Recommended)", "description": "update behavior"}]},
            {"question": "Continue?", "options": ["Yes", "No"]},
        ]}
        with mock.patch.object(HOOKS.S, "Scheduler", FakeScheduler):
            result = HOOKS.handle_event(self.event("PreToolUse", "AskUserQuestion", payload))
        output = result["hookSpecificOutput"]
        self.assertEqual(output["permissionDecision"], "deny")
        self.assertIn("D1, D2", output["permissionDecisionReason"])
        self.assertIn("scheduler.py decision wait --run inbox --id D1", output["permissionDecisionReason"])
        self.assertIn("scheduler.py decision wait --run inbox --id D2", output["permissionDecisionReason"])
        self.assertEqual(asks[0], ("Choice one", "Keep or change?",
                                   ["A=Keep :: preserve current behavior", "B=Change :: update behavior"], "B"))
        self.assertEqual(asks[1][3], "A")

    def test_posttool_publishes_markdown_under_plans_or_docs(self):
        document = self.ws / "plans" / "example" / "plan.md"
        document.parent.mkdir(parents=True)
        document.write_text("# Plan\n")
        with mock.patch.object(HOOKS.AC, "publish_document") as publish:
            result = HOOKS.handle_event(self.event("PostToolUse", "Write", {"file_path": "plans/example/plan.md"}))
        self.assertIsNone(result)
        publish.assert_called_once_with(self.ws, "plans/example/plan.md")

    def test_posttool_publish_errors_are_logged_without_blocking(self):
        document = self.ws / "docs" / "notes.md"
        document.parent.mkdir()
        document.write_text("# Notes\n")
        event = self.event("PostToolUse", "Edit", {"file_path": "docs/notes.md"})
        output = StringIO()
        with mock.patch.object(HOOKS.AC, "publish_document", side_effect=OSError("unavailable")), \
                mock.patch.object(HOOKS.AC, "log_action") as log_action, \
                mock.patch("sys.stdin", StringIO(json.dumps(event))), redirect_stdout(output):
            self.assertEqual(HOOKS.main(), 0)
        self.assertEqual(output.getvalue(), "")
        log_action.assert_called_once()


if __name__ == "__main__":
    unittest.main()
