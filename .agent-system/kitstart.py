#!/usr/bin/env python3
"""agent-kit start / continue: open the workspace in Herdr and launch the orchestrator with its configured model.

    kitstart.py --workspace DIR [--dry-run] [--no-attach]
    kitstart.py --workspace DIR --continue [--session ID] [--force] [--dry-run] [--no-attach]

- Inside Herdr (HERDR_ENV=1): create a Herdr workspace for the project, start the orchestrator in it
  and focus it.
- Outside Herdr with its server running: the same, then attach to Herdr (unless --no-attach).
- Herdr not running: start a small background helper that waits for Herdr's server, then does the
  above, and start Herdr in this terminal.
If the orchestrator is already running (agent named orch-<repo>), it is focused instead of started
again. Programs other than Claude Code get a first prompt telling them to read their rules
(AGENTS.md and the notes in CLAUDE.md).

continue (`agent-kit continue`): restart the orchestrator with the current config (e.g. after
`agent-kit config`) in the same chat. The chat id is saved in .orchestrator/orchestrator.json by
start, config and continue; continue closes the running orchestrator (refused while it is busy,
unless --force) and resumes that chat with the new model and effort. Claude Code and Codex can
resume; other programs start a new chat. Python stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
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


# ---------------------------------------------------------------- the orchestrator's chat id

def session_file(ws: Path) -> Path:
    return ws / ".orchestrator" / "orchestrator.json"


def saved_session(ws: Path) -> dict:
    try:
        return json.loads(session_file(ws).read_text())
    except (OSError, ValueError):
        return {}


def save_session(ws: Path, kind: str, session_id: str, name: str) -> None:
    f = session_file(ws)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"kind": kind, "session_id": session_id, "agent": name,
                             "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2) + "\n")


def live_agent(herdr: S.Herdr, name: str) -> dict | None:
    """Herdr's record of the running orchestrator, or None when it is not running."""
    try:
        res = herdr.agent_get(name).get("result") or {}
    except S.SchedulerError:
        return None
    return res.get("agent") or res


def live_session_id(agent: dict | None) -> str | None:
    return ((agent or {}).get("agent_session") or {}).get("value") or None


def remember_session(ws: Path, cfg: dict, herdr: S.Herdr | None = None) -> str | None:
    """Save the running orchestrator's chat id (best effort; used by `agent-kit config`)."""
    try:
        p = plan(ws, cfg)
        herdr = herdr or S.Herdr()
        if not herdr.available():
            return None
        sid = live_session_id(live_agent(herdr, p["name"]))
        if sid:
            save_session(ws, p["kind"], sid, p["name"])
        return sid
    except Exception:  # never fail a config change over this
        return None


def elsewhere_note(ws: Path, saved: dict) -> str:
    """Claude Code finds a chat by the folder it was started in; warn when that was not the workspace."""
    t = saved.get("transcript")
    if not t or Path(t).parent.name == re.sub(r"[^A-Za-z0-9]", "-", str(ws)):
        return ""
    return (f"note: chat {saved['session_id']} was started in another folder ({Path(t).parent.name}), "
            "so Claude Code may not find it from the workspace; ")


def resume_args(kind: str, session_id: str) -> list[str] | None:
    """Arguments that resume a chat, put before the model arguments; None if the program can't."""
    return {"claude": ["--resume", session_id], "codex": ["resume", session_id]}.get(kind)


def server_running(runner=subprocess.run) -> bool:
    p = runner(["herdr", "status", "server"], capture_output=True, text=True)
    return p.returncode == 0 and re.search(r"status:\s*running", p.stdout) is not None


def launch(p: dict, herdr: S.Herdr, timeout_ms: int, log=print) -> str:
    """Start (or focus) the orchestrator inside a running Herdr. Returns what happened."""
    if live_agent(herdr, p["name"]) is not None:
        herdr._call("agent", "focus", p["name"])
        return f"orchestrator {p['name']} is already running: focused it"
    ws = Path(p["ws"])
    if p.get("resume"):
        p["args"] = resume_args(p["kind"], p["resume"]) + p["args"]
        save_session(ws, p["kind"], p["resume"], p["name"])
    elif p["kind"] == "claude":  # choose the chat id up front so `agent-kit continue` can find it
        sid = str(uuid.uuid4())
        p["args"] = ["--session-id", sid] + p["args"]
        save_session(ws, p["kind"], sid, p["name"])
    ws_id, pane = herdr.workspace_create(p["ws"], p["label"])
    try:
        herdr.agent_start(p["name"], pane, p["args"], timeout_ms, kind=p["kind"])
    except S.SchedulerError as e:
        if "agent_not_ready" in str(e):
            herdr._call("workspace", "focus", ws_id)
            return (f"started {p['kind']}, but it is waiting at a startup prompt (e.g. 'trust this folder'): "
                    "answer it in the Herdr pane")
        raise
    if p["prompt"] and not p.get("resume"):
        herdr.agent_prompt(p["name"], p["prompt"], timeout_ms)
    if not p.get("resume") and p["kind"] != "claude":  # e.g. Codex: Herdr learns the chat id once it runs
        sid = live_session_id(live_agent(herdr, p["name"]))
        if sid:
            save_session(ws, p["kind"], sid, p["name"])
    herdr._call("workspace", "focus", ws_id)
    how = f"resumed chat {p['resume']}" if p.get("resume") else "started"
    return f"{how} in orchestrator {p['name']}: {p['kind']} {p['model']}" + (f" ({p['effort']})" if p["effort"] else "")


def stop_for_continue(p: dict, herdr: S.Herdr, session: str | None, force: bool,
                      sleep=time.sleep) -> tuple[str | None, str]:
    """Close the running orchestrator (if any) and choose the chat to resume. Returns (chat id, note)."""
    ws = Path(p["ws"])
    agent = live_agent(herdr, p["name"])
    note = ""
    if agent is not None:
        status = agent.get("agent_status") or agent.get("state")
        if status in ("working", "blocked") and not force:
            raise S.SchedulerError(f"orchestrator {p['name']} is {status}: wait until it is idle (or answer "
                                   "its prompt), or pass --force to interrupt it")
        sid = live_session_id(agent)
        if sid:
            save_session(ws, p["kind"], sid, p["name"])
        if not agent.get("workspace_id"):
            raise S.SchedulerError(f"cannot tell which Herdr workspace holds {p['name']}: exit it yourself, "
                                   "then run agent-kit continue again")
        herdr.workspace_close(agent["workspace_id"])
        for _ in range(40):  # Herdr closes the pane asynchronously
            if live_agent(herdr, p["name"]) is None:
                break
            sleep(0.25)
        else:
            raise S.SchedulerError(f"{p['name']} is still running after closing its workspace; exit it yourself")
        note = f"closed the running orchestrator {p['name']}; "
    saved = saved_session(ws)
    if session:
        return session, note
    if saved.get("session_id") and saved.get("kind") == p["kind"]:
        return saved["session_id"], note + elsewhere_note(ws, saved)
    if saved.get("session_id"):
        note += f"the saved chat belongs to {saved.get('kind')}, not {p['kind']}: starting a new chat; "
    else:
        note += "no saved chat id: starting a new chat; "
    return None, note


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


def start_connector(ws: Path, cfg: dict, popen=None, log=None, no_orchestrator=False) -> None:
    """Start the optional hub connector after the orchestrator, without affecting the start result."""
    if not (cfg.get("hub") or {}).get("enabled"):
        return
    log = log or print
    pidfile = ws / ".orchestrator" / "hub-connector.pid"
    try:
        pid = int(pidfile.read_text().strip())
        if pid <= 0:
            pid = None
            raise ProcessLookupError
        try:
            os.kill(pid, 0)
        except PermissionError:
            pass
    except (OSError, ValueError):
        pid = None
    if pid is not None:
        log("hub connector already running")
        return
    popen = popen or subprocess.Popen
    logpath = ws / ".orchestrator" / "hub-connector.log"
    logpath.parent.mkdir(parents=True, exist_ok=True)
    try:
        # Run the workspace's own agentctl: it takes its workspace from its own location, so the kit's
        # copy (used when `hub start` runs from another folder) would connect the wrong workspace.
        script = ws / ".agent-system" / "agentctl.py"
        if not script.is_file():
            script = Path(__file__).resolve().with_name("agentctl.py")
        args = [sys.executable, str(script), "watch"]
        if no_orchestrator:
            args.append("--no-orchestrator")
        with open(logpath, "a") as output:
            popen(args,
                  cwd=str(ws), stdout=output, stderr=output, stdin=subprocess.DEVNULL,
                  start_new_session=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        log(f"hub connector started (log: {logpath})")
    except Exception as e:
        log(f"hub connector could not be started: {e}; orchestrator continues")


def main(argv=None, herdr: S.Herdr | None = None, env=None, execvp=os.execvp, runner=subprocess.run) -> int:
    ap = argparse.ArgumentParser(prog="agent-kit start", description=__doc__.split("\n\n")[0])
    ap.add_argument("--workspace", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-attach", action="store_true", help="don't attach to Herdr afterwards")
    ap.add_argument("--continue", dest="resume", action="store_true",
                    help="restart the orchestrator with the current config in its last chat")
    ap.add_argument("--session", help="with --continue: the chat id to resume instead of the saved one")
    ap.add_argument("--force", action="store_true", help="with --continue: restart even if it is busy")
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

    if a.resume and not resume_args(p["kind"], "x"):
        print(f"note: {p['kind']} cannot resume a chat with this kit: continue starts a new chat")

    if a.when_ready:  # detached helper: wait for Herdr's server, then launch
        for _ in range(60):
            if server_running(runner):
                break
            time.sleep(1)
        else:
            print("Herdr's server did not come up within 60 s; run `agent-kit start` inside Herdr", file=sys.stderr)
            return 1
        if a.resume:
            p["resume"] = a.session or (saved_session(ws).get("session_id")
                                        if saved_session(ws).get("kind") == p["kind"] else None)
            if p["resume"] and not resume_args(p["kind"], p["resume"]):
                p["resume"] = None
        print(launch(p, herdr, timeout_ms))
        start_connector(ws, cfg)
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
        if a.resume:
            live = live_session_id(live_agent(herdr, p["name"])) if shutil.which("herdr") else None
            saved = a.session or live or saved_session(ws).get("session_id")
            mode = (f"close the running orchestrator if idle, then resume chat {saved}" if saved else
                    "close the running orchestrator if idle, then start a new chat (no saved chat id)") + "; " + mode
        print(f"[dry-run] {mode}; nothing started")
        return 0
    if running:
        if a.resume:
            try:
                sid, note = stop_for_continue(p, herdr, a.session, a.force)
            except S.SchedulerError as e:
                print(f"error: {e}", file=sys.stderr)
                return 1
            p["resume"] = sid if sid and resume_args(p["kind"], sid) else None
            if note:
                print(note.rstrip("; "))
        print(launch(p, herdr, timeout_ms))
        start_connector(ws, cfg)
        if not inside and not a.no_attach:
            execvp("herdr", ["herdr"])
        return 0
    # Herdr is not running: a detached helper launches the orchestrator once the server is up.
    log = ws / ".orchestrator" / "start.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a") as f:
        subprocess.Popen([sys.executable, __file__, "--workspace", str(ws), "--when-ready",
                          *(["--continue"] if a.resume else []), *(["--session", a.session] if a.session else [])],
                         stdout=f, stderr=f, stdin=subprocess.DEVNULL, start_new_session=True,
                         env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    print(f"starting Herdr; the orchestrator opens in it shortly (log: {log})")
    execvp("herdr", ["herdr"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
