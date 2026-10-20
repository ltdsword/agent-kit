#!/usr/bin/env python3
"""agent-kit config: choose the program, model and effort for each role of a workspace.

Roles: orchestrator (the main session), scout (Claude Code research subagent), worker (implements
tasks). Settings live in <workspace>/.agent-system/config.json; the Claude orchestrator model is
also written to .claude/settings.json and the scout's to .claude/agents/scout.md.

    kitconfig.py --workspace DIR [--model-orchestrator M] [--effort-orchestrator E]
                 [--model-scout M] [--effort-scout E] [--model-worker M] [--effort-worker E]
                 [--num-worker N] [--list] [--show] [--no-input]

A model is an ID or alias (the program is worked out from it) or <program>/<model> for an
unverified program. Unknown names print a table to choose from (picked by number on a terminal).
--num-worker N sets how many workers run in parallel (pool slots worker-1..N, max_parallel and
max_tasks_per_request = N; 1..MAX_WORKERS). With no flags on a terminal, everything is asked
interactively. Python stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import models as M  # noqa: E402
import kitstart as KS  # noqa: E402
from scheduler import MAX_WORKERS  # noqa: E402

ROLES = ("orchestrator", "scout", "worker")


# ---------------------------------------------------------------- reading / writing the workspace

def get_role(cfg: dict, role: str) -> dict:
    if role == "worker":
        w = cfg["worker"]
        return {"kind": w.get("kind", "codex"), "model": w["model"], "effort": w.get("reasoning_effort")}
    r = cfg.get(role, {})
    return {"kind": r.get("kind", "claude"), "model": r.get("model", ""), "effort": r.get("effort")}


def set_role(cfg: dict, role: str, kind: str, model: str, effort: str | None) -> None:
    if role == "worker":
        cfg["worker"].update(kind=kind, model=model, reasoning_effort=effort)
    else:
        cfg.setdefault(role, {}).update(kind=kind, model=model, effort=effort)


def num_workers(cfg: dict) -> int:
    return cfg["pool"]["size"]


def set_num_workers(cfg: dict, n: int) -> None:
    """N worker slots; N may run at once and a request may have up to N tasks."""
    if not 1 <= n <= MAX_WORKERS:
        raise M.ModelError(f"--num-worker must be 1..{MAX_WORKERS}, got {n}")
    cfg["pool"].update(size=n, slots=[f"worker-{i}" for i in range(1, n + 1)])
    cfg["limits"].update(max_parallel=n, max_tasks_per_request=n)


def pick_num_workers(current: int) -> int:
    while True:
        raw = input(f"\nnumber of workers (1..{MAX_WORKERS}) [Enter = keep {current}]: ").strip()
        if not raw:
            return current
        if raw.isdigit() and 1 <= int(raw) <= MAX_WORKERS:
            return int(raw)
        print(f"  enter a number from 1 to {MAX_WORKERS}")


def write_side_files(ws: Path, cfg: dict) -> list[str]:
    """Apply the config where the programs read it: Claude settings and the scout agent file."""
    done = []
    orch = get_role(cfg, "orchestrator")
    settings = ws / ".claude" / "settings.json"
    if orch["kind"] == "claude" and settings.parent.exists():
        cur = json.loads(settings.read_text()) if settings.exists() else {}
        if cur.get("model") != orch["model"]:
            cur["model"] = orch["model"]
            settings.write_text(json.dumps(cur, indent=2) + "\n")
            done.append(f".claude/settings.json: model = {orch['model']}")
    scout = get_role(cfg, "scout")
    agent = ws / cfg.get("scout", {}).get("agent_file", ".claude/agents/scout.md")
    if agent.exists() and scout["model"]:
        text = agent.read_text()
        new = apply_frontmatter(text, scout["model"], scout["effort"])
        if new != text:
            agent.write_text(new)
            done.append(f"{agent.relative_to(ws)}: model = {scout['model']}, effort = {scout['effort']}")
    return done


def apply_frontmatter(text: str, model: str, effort: str | None) -> str:
    """Set `model:` / `effort:` in a Claude agent file's front matter."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return text
    lines = [ln for ln in m.group(1).splitlines() if not re.match(r"^(model|effort):", ln)]
    lines.append(f"model: {model}")
    if effort:
        lines.append(f"effort: {effort}")
    return "---\n" + "\n".join(lines) + "\n---\n" + text[m.end():]


# ---------------------------------------------------------------- choosing

def resolve_or_pick(role: str, name: str, interactive: bool) -> dict:
    """M.resolve(name), or on an unknown name show the table and let the user pick (terminal only)."""
    try:
        entry = M.resolve(name)
    except M.ModelError as e:
        if not interactive:
            raise
        print(f"\n{role}: {e}\n\n{e.table}\n")
        entry = pick_model(role, None)
    return entry


def pick_model(role: str, current: dict | None) -> dict:
    """Interactive: pick a model by number from the table, or type a name / <program>/<model>."""
    kinds = ["claude"] if role == "scout" else None
    rows = M.numbered("claude" if kinds else None)
    print(M.table("claude" if kinds else None))
    hint = f" [Enter = keep {current['kind']}/{current['model']}]" if current else ""
    while True:
        raw = input(f"\n{role} model: number or name{hint}: ").strip()
        if not raw and current:
            return M.resolve(current["model"], current["kind"])
        try:
            entry = rows[int(raw) - 1] if raw.isdigit() and 0 < int(raw) <= len(rows) else M.resolve(raw)
            entry = M.resolve(entry["model"], entry["kind"]) if "verified" not in entry else entry
        except M.ModelError as e:
            print(f"  {e}")
            continue
        if role == "scout" and entry["kind"] != "claude":
            print("  the scout is a Claude Code subagent: choose a Claude model")
            continue
        return entry


def pick_effort(role: str, entry: dict, current: str | None) -> str | None:
    default = current if current in entry["efforts"] else entry.get("default_effort")
    if not entry["efforts"]:
        raw = input(f"{role} effort (free text, Enter = none): ").strip()
        return raw or None
    for i, e in enumerate(entry["efforts"], 1):
        print(f"  {i}. {e}" + ("  (default)" if e == default else ""))
    while True:
        raw = input(f"{role} effort: number or name [Enter = {default}]: ").strip()
        if not raw:
            return default
        if raw.isdigit() and 0 < int(raw) <= len(entry["efforts"]):
            return entry["efforts"][int(raw) - 1]
        try:
            return M.check_effort(entry, raw)
        except M.ModelError as e:
            print(f"  {e}")


def describe(cfg: dict) -> str:
    lines = [f"{'role':13} {'program':9} {'model':22} {'effort':8} status"]
    for role in ROLES:
        r = get_role(cfg, role)
        status = "verified" if M.is_verified(r["kind"]) else "UNVERIFIED"
        lines.append(f"{role:13} {r['kind']:9} {r['model']:22} {str(r['effort'] or '-'):8} {status}")
    lines.append(f"workers: {num_workers(cfg)} (run in parallel; up to {cfg['limits']['max_tasks_per_request']} "
                 "tasks per request)")
    return "\n".join(lines)


def notes(cfg: dict) -> list[str]:
    out = []
    o, s, w = (get_role(cfg, r) for r in ROLES)
    out.append("orchestrator: start it with `agent-kit start` (opens Herdr and launches "
               f"{o['kind']} {o['model']}" + (f", effort {o['effort']}" if o["effort"] else "") + ")")
    if o["kind"] != "claude":
        out.append("scout: used only when the orchestrator is Claude Code")
    out.append(f"worker: {w['kind']}: {M.sandbox_note(w['kind'])}")
    for role, r in zip(ROLES, (o, s, w)):
        if not M.is_verified(r["kind"]):
            out.append(f"{role}: {r['kind']} is UNVERIFIED with this kit (not tested; model name not checked; "
                       f"if its CLI flags differ, set {role}.launch_args in .agent-system/config.json)")
    return out


# ---------------------------------------------------------------- main

def main(argv=None, herdr=None) -> int:
    ap = argparse.ArgumentParser(prog="agent-kit config", description=__doc__.split("\n\n")[0])
    ap.add_argument("--workspace", type=Path, required=True)
    for role in ROLES:
        ap.add_argument(f"--model-{role}")
        ap.add_argument(f"--effort-{role}")
    ap.add_argument("--num-worker", type=int, help=f"number of parallel workers (1..{MAX_WORKERS})")
    ap.add_argument("--list", action="store_true", help="show every known model and exit")
    ap.add_argument("--show", action="store_true", help="show the current roles and exit")
    ap.add_argument("--no-input", action="store_true", help="never prompt (fail on unknown names)")
    a = ap.parse_args(argv)

    if a.list:
        print(M.table())
        return 0
    path = a.workspace / ".agent-system" / "config.json"
    try:
        cfg = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: cannot read {path}: {e}", file=sys.stderr)
        return 1
    if a.show:
        print(describe(cfg))
        return 0

    interactive = sys.stdin.isatty() and not a.no_input
    given = {r: (getattr(a, f"model_{r}"), getattr(a, f"effort_{r}")) for r in ROLES}
    ask_all = interactive and not any(m or e for m, e in given.values()) and a.num_worker is None
    try:
        if a.num_worker is not None:
            set_num_workers(cfg, a.num_worker)
        for role in ROLES:
            model, effort = given[role]
            cur = get_role(cfg, role)
            if ask_all:
                print(f"\n== {role} (now {cur['kind']}/{cur['model']}, effort {cur['effort'] or '-'})")
                entry = pick_model(role, cur)
                effort = pick_effort(role, entry, cur["effort"] if entry["model"] == cur["model"] else None)
            elif model or effort:
                entry = resolve_or_pick(role, model, interactive) if model else M.resolve(cur["model"], cur["kind"])
                if role == "scout" and entry["kind"] != "claude":
                    raise M.ModelError("the scout is a Claude Code subagent: choose a Claude model", M.table("claude"))
                if effort is None and (entry["model"] == cur["model"] or not entry["efforts"]
                                       or cur["effort"] in entry["efforts"]):
                    effort = cur["effort"]  # keep the current effort when the new model supports it
                effort = M.check_effort(entry, effort)
            else:
                continue
            if entry.get("note"):
                print(f"note: {entry['note']}")
            set_role(cfg, role, entry["kind"], entry["model"], effort)
        if ask_all:
            set_num_workers(cfg, pick_num_workers(num_workers(cfg)))
    except M.ModelError as e:
        print(f"error: {e}\n\n{e.table}" if e.table else f"error: {e}", file=sys.stderr)
        return 2
    except (EOFError, KeyboardInterrupt):
        print("\ncancelled; nothing changed", file=sys.stderr)
        return 1

    path.write_text(json.dumps(cfg, indent=2) + "\n")
    print(describe(cfg))
    for line in write_side_files(a.workspace, cfg) + notes(cfg):
        print(f"- {line}")
    sid = KS.remember_session(a.workspace, cfg, herdr)
    if sid:
        print(f"- saved the running orchestrator's chat id {sid}: `agent-kit continue` restarts it there "
              "with these settings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
