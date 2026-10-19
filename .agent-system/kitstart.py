#!/usr/bin/env python3
"""agent-kit start: open the workspace in Herdr and launch the orchestrator with its configured model.

    kitstart.py --workspace DIR [--dry-run] [--no-attach]

- Inside Herdr (HERDR_ENV=1): create a Herdr workspace for the project, start the orchestrator in it
  and focus it.
- Outside Herdr with its server running: the same, then attach to Herdr (unless --no-attach).
- Herdr not running: start a small background helper that waits for Herdr's server, then does the
  above, and start Herdr in this terminal.
If the orchestrator is already running (agent named orch-<repo>), it is focused instead of started
again. Programs other than Claude Code get a first prompt telling them to read their rules
(AGENTS.md and the notes in CLAUDE.md). Python stdlib only.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import models as M  # noqa: E402
import scheduler as S  # noqa: E402

BOOTSTRAP = ("You are the orchestrator for this workspace ({ws}). Before anything else, read AGENTS.md "
             "completely (your rules) and the project notes at the top of CLAUDE.md. Then say you are "
             "ready and wait for my request.")


def agent_name(repo_name: str) -> str:
    name = re.sub(r"[^a-z0-9_-]+", "-", f"orch-{repo_name.lower()}").strip("-")
    return name[:32]


def orchestrator_role(cfg: dict) -> dict:
    o = cfg.get("orchestrator", {})
    return {"kind": o.get("kind", "claude"), "model": o.get("model", ""), "effort": o.get("effort"),
            "launch_args": o.get("launch_args")}


def plan(ws: Path, cfg: dict) -> dict:
    """What to launch: kind, args, name, label, first prompt."""
    role = orchestrator_role(cfg)
    repo = S.project_root_for(ws, cfg)
    add_dirs = (str(repo),) if role["kind"] == "codex" and repo != ws.resolve() else ()
    args = M.launch_args(role, cwd=str(ws), add_dirs=add_dirs)
    return {"kind": role["kind"], "binary": M.binary(role["kind"]), "args": args,
            "name": agent_name(repo.name), "label": repo.name, "ws": str(ws),
            "prompt": None if role["kind"] == "claude" else BOOTSTRAP.format(ws=ws),
            "verified": M.is_verified(role["kind"]), "model": role["model"], "effort": role["effort"]}


def server_running(runner=subprocess.run) -> bool:
    p = runner(["herdr", "status", "server"], capture_output=True, text=True)
    return p.returncode == 0 and re.search(r"status:\s*running", p.stdout) is not None


def launch(p: dict, herdr: S.Herdr, timeout_ms: int, log=print) -> str:
    """Start (or focus) the orchestrator inside a running Herdr. Returns what happened."""
    try:
        herdr.agent_get(p["name"])
        herdr._call("agent", "focus", p["name"])
        return f"orchestrator {p['name']} is already running: focused it"
    except S.SchedulerError:
        pass
    ws_id, pane = herdr.workspace_create(p["ws"], p["label"])
    try:
        herdr.agent_start(p["name"], pane, p["args"], timeout_ms, kind=p["kind"])
    except S.SchedulerError as e:
        if "agent_not_ready" in str(e):
            herdr._call("workspace", "focus", ws_id)
            return (f"started {p['kind']}, but it is waiting at a startup prompt (e.g. 'trust this folder'): "
                    "answer it in the Herdr pane")
        raise
    if p["prompt"]:
        herdr.agent_prompt(p["name"], p["prompt"], timeout_ms)
    herdr._call("workspace", "focus", ws_id)
    return f"started orchestrator {p['name']}: {p['kind']} {p['model']}" + (f" ({p['effort']})" if p["effort"] else "")


def describe(p: dict) -> str:
    cmd = " ".join([p["binary"], *p["args"]])
    lines = [f"orchestrator: {p['kind']} / {p['model']}" + (f" / effort {p['effort']}" if p["effort"] else ""),
             f"herdr agent: {p['name']} in a new Herdr workspace '{p['label']}' at {p['ws']}",
             f"command: {cmd}"]
    if p["prompt"]:
        lines.append(f"first prompt: {p['prompt']}")
    if not p["verified"]:
        lines.append(f"note: {p['kind']} is UNVERIFIED with this kit; if its CLI flags differ, set "
                     "orchestrator.launch_args in .agent-system/config.json")
    return "\n".join(lines)


def main(argv=None, herdr: S.Herdr | None = None, env=None, execvp=os.execvp, runner=subprocess.run) -> int:
    ap = argparse.ArgumentParser(prog="agent-kit start", description=__doc__.split("\n\n")[0])
    ap.add_argument("--workspace", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-attach", action="store_true", help="don't attach to Herdr afterwards")
    ap.add_argument("--when-ready", action="store_true", help=argparse.SUPPRESS)  # background helper
    a = ap.parse_args(argv)
    env = os.environ if env is None else env
    ws = a.workspace.resolve()
    try:
        cfg = S.load_config(ws)
        p = plan(ws, cfg)
    except (S.SchedulerError, M.ModelError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    timeout_ms = cfg["herdr"]["agent_start_timeout_ms"]
    herdr = herdr or S.Herdr()

    if a.when_ready:  # detached helper: wait for Herdr's server, then launch
        for _ in range(60):
            if server_running(runner):
                break
            time.sleep(1)
        else:
            print("Herdr's server did not come up within 60 s; run `agent-kit start` inside Herdr", file=sys.stderr)
            return 1
        print(launch(p, herdr, timeout_ms))
        return 0

    print(describe(p))
    if not a.dry_run and shutil.which(p["binary"]) is None:
        print(f"error: {p['binary']} is not installed (orchestrator program {p['kind']}); install it or "
              "choose another model: agent-kit config --model-orchestrator=...", file=sys.stderr)
        return 1
    if not a.dry_run and shutil.which("herdr") is None:
        print("error: herdr is not installed", file=sys.stderr)
        return 1
    inside = env.get("HERDR_ENV") == "1"
    running = inside or (not a.dry_run and server_running(runner))
    if a.dry_run:
        mode = ("inside Herdr: create the workspace and start the orchestrator here" if inside else
                "outside Herdr: start it there (or start Herdr first), then attach")
        print(f"[dry-run] {mode}; nothing started")
        return 0
    if running:
        print(launch(p, herdr, timeout_ms))
        if not inside and not a.no_attach:
            execvp("herdr", ["herdr"])
        return 0
    # Herdr is not running: a detached helper launches the orchestrator once the server is up.
    log = ws / ".orchestrator" / "start.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a") as f:
        subprocess.Popen([sys.executable, __file__, "--workspace", str(ws), "--when-ready"],
                         stdout=f, stderr=f, stdin=subprocess.DEVNULL, start_new_session=True,
                         env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    print(f"starting Herdr; the orchestrator opens in it shortly (log: {log})")
    execvp("herdr", ["herdr"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
