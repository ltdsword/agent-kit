#!/usr/bin/env python3
"""Claude hooks for Agent Hub questions and automatic document publishing."""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agentctl as AC  # noqa: E402
import scheduler as S  # noqa: E402


def workspace_for(event: dict) -> Path | None:
    current = Path(event.get("cwd") or os.getcwd()).absolute()
    for candidate in (current, *current.parents):
        if (candidate / ".agent-system" / "config.json").is_file():
            return candidate
    return None


def hub_connected(ws: Path) -> bool:
    try:
        config = json.loads((ws / ".agent-system" / "config.json").read_text(encoding="utf-8"))
        if not (config.get("hub") or {}).get("enabled"):
            return False
        pid = int((ws / ".orchestrator" / "hub-connector.pid").read_text().strip())
        if pid <= 0:
            return False
        os.kill(pid, 0)
        return True
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def _option_key(index: int) -> str:
    key = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        key = chr(ord("A") + remainder) + key
    return key


def _questions_to_inbox(ws: Path, payload: dict) -> list[str]:
    questions = payload.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("AskUserQuestion did not provide any questions")
    scheduler = S.Scheduler(ws)
    decision_ids = []
    for item in questions:
        if not isinstance(item, dict):
            raise ValueError("AskUserQuestion contains an invalid question")
        question = item.get("question")
        if not isinstance(question, str) or not question.strip():
            raise ValueError("AskUserQuestion is missing question text")
        raw_options = item.get("options")
        if not isinstance(raw_options, list):
            raise ValueError("AskUserQuestion is missing options")
        options, recommended = [], None
        for index, raw in enumerate(raw_options, 1):
            if isinstance(raw, dict):
                label, consequence = raw.get("label"), raw.get("description")
            else:
                label, consequence = raw, None
            if not isinstance(label, str) or not label.strip():
                raise ValueError("AskUserQuestion contains an invalid option")
            marked = "(Recommended)" in label
            label = re.sub(r"\s*\(Recommended\)\s*", " ", label).strip()
            key = _option_key(index)
            if marked:
                recommended = key
            if isinstance(consequence, str) and consequence.strip():
                options.append(f"{key}={label} :: {consequence.strip()}")
            else:
                options.append(f"{key}={label}")
        if recommended is None and options:
            recommended = "A"
        title = item.get("header")
        if not isinstance(title, str) or not title.strip():
            title = question.strip().splitlines()[0][:80]
        result = scheduler.inbox_ask(title, question.strip(), options, recommended)
        decision_ids.append(result["decision"])
    return decision_ids


def _pretool(ws: Path, event: dict) -> dict | None:
    # Hub not connected: no opinion, so the question is asked in the terminal as usual.
    if not hub_connected(ws):
        return None
    try:
        ids = _questions_to_inbox(ws, event.get("tool_input") or {})
    except Exception as error:
        AC.log_action(ws, f"could not route AskUserQuestion: {error}")
        return {"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny",
            "permissionDecisionReason": "Could not route this question to Agent Hub. Use `agentctl ask` instead.",
        }}
    waits = [f"python3 .agent-system/scheduler.py decision wait --run inbox --id {decision_id}" for decision_id in ids]
    reason = (f"Question(s) sent to Agent Hub as {', '.join(ids)}. Start a background wait for each answer: "
              + "; ".join(waits))
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                  "permissionDecisionReason": reason}}


def _posttool(ws: Path, event: dict) -> None:
    payload = event.get("tool_input") or {}
    raw = payload.get("file_path") or payload.get("filePath") or payload.get("path")
    if not isinstance(raw, str) or not raw:
        return
    target = Path(raw)
    if not target.is_absolute():
        target = Path(event.get("cwd") or os.getcwd()) / target
    try:
        rel = target.resolve().relative_to(ws.resolve()).as_posix()
    except (OSError, ValueError):
        return
    if not rel.endswith(".md") or not (rel.startswith("plans/") or rel.startswith("docs/")):
        return
    AC.publish_document(ws, rel)


def handle_event(event: dict) -> dict | None:
    ws = workspace_for(event)
    if ws is None:
        return None
    event_name = event.get("hook_event_name")
    tool_name = event.get("tool_name")
    if event_name == "PreToolUse" and tool_name == "AskUserQuestion":
        return _pretool(ws, event)
    if event_name == "PostToolUse" and tool_name in ("Write", "Edit"):
        try:
            _posttool(ws, event)
        except Exception as error:
            AC.log_action(ws, f"automatic document publish failed: {error}")
    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
        result = handle_event(event)
        if result is not None:
            print(json.dumps(result, ensure_ascii=False))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
