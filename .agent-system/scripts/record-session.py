#!/usr/bin/env python3
"""Claude Code hook (SessionStart, UserPromptSubmit): remember the workspace's active chat.

Writes the chat id to <workspace>/.orchestrator/orchestrator.json each time a Claude Code session
in the workspace starts, resumes, is cleared or gets a prompt, so `agent-kit continue` can reopen
the last active chat from anywhere (inside or outside Herdr). Sessions running elsewhere (e.g. a
worker in worktrees/) are ignored. Never blocks Claude: any problem exits 0 silently.
"""
import json
import os
import sys
import time
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[2]


def main() -> None:
    event = json.load(sys.stdin)
    sid, cwd = event.get("session_id"), event.get("cwd") or os.getcwd()
    if not sid or Path(cwd).resolve() != WORKSPACE:
        return
    f = WORKSPACE / ".orchestrator" / "orchestrator.json"
    try:
        cur = json.loads(f.read_text())
    except (OSError, ValueError):
        cur = {}
    if cur.get("session_id") == sid and cur.get("kind") == "claude" and event.get("hook_event_name") != "SessionStart":
        return  # already recorded; skip a write on every prompt
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps({"kind": "claude", "session_id": sid, "agent": cur.get("agent"),
                               "transcript": event.get("transcript_path"),
                               "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                               "saved_by": event.get("hook_event_name", "hook")}, indent=2) + "\n")
    tmp.replace(f)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
