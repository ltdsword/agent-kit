"""Model registry for agent-kit: which programs can run each role, their models and effort levels.

Python stdlib only. Used by `kitconfig.py` (agent-kit create/config) and by scheduler.py (doctor).

Programs are the agent kinds Herdr can launch (`herdr agent start --kind ...`). Only Claude Code
and Codex are verified with this kit; every other program is UNVERIFIED: its models are typed
freely as `<program>/<model>` and it is not launched by the scheduler yet (phase 2 adds adapters).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Claude Code: aliases resolve to the latest model of that family; full IDs pin one.
CLAUDE_MODELS = [
    ("claude-fable-5-1", "Fable 5.1"),
    ("claude-opus-5-5", "Opus 5.5"),
    ("claude-sonnet-5-5", "Sonnet 5.5"),
    ("claude-haiku-5-5", "Haiku 5.5"),
]
CLAUDE_ALIASES = {"fable": "claude-fable-5-1", "opus": "claude-opus-5-5",
                  "sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}
CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

# Every kind `herdr agent start --kind` accepts (Herdr 0.9.5), in display order after the verified two.
UNVERIFIED_KINDS = ["agy", "amp", "cline", "copilot", "cursor", "devin", "droid", "gemini", "grok",
                    "hermes", "kilo", "kimi", "kiro", "letta", "maki", "mastracode", "muse", "omp",
                    "opencode", "pi", "qodercli", "qwen"]
VERIFIED_KINDS = ["claude", "codex"]
KINDS = VERIFIED_KINDS + UNVERIFIED_KINDS


class ModelError(ValueError):
    """A model or effort that cannot be used; `table` lists what can."""

    def __init__(self, message: str, table: str = ""):
        super().__init__(message)
        self.table = table


def codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


def codex_models(include_hidden: bool = False) -> list[dict]:
    """Codex's own cached catalog (refreshed by the Codex CLI): slug, efforts, default effort."""
    try:
        data = json.loads((codex_home() / "models_cache.json").read_text())
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    for m in data.get("models", []):
        if not m.get("slug") or (m.get("visibility") == "hide" and not include_hidden):
            continue
        efforts = [e.get("effort", e) if isinstance(e, dict) else e for e in m.get("supported_reasoning_levels", [])]
        out.append({"kind": "codex", "model": m["slug"], "label": m.get("display_name") or m["slug"],
                    "efforts": efforts, "default_effort": m.get("default_reasoning_level")})
    return out


def catalog(include_hidden: bool = False) -> list[dict]:
    """All known models of the verified programs."""
    claude = [{"kind": "claude", "model": mid, "label": label, "efforts": CLAUDE_EFFORTS, "default_effort": "high"}
              for mid, label in CLAUDE_MODELS]
    return claude + codex_models(include_hidden)


def is_verified(kind: str) -> bool:
    return kind in VERIFIED_KINDS


def resolve(name: str, kind: str | None = None) -> dict:
    """Turn what the user typed into {kind, model, efforts, default_effort, verified, note}.

    Accepts a model ID or alias (the program is worked out from it), or `<program>/<model>` for an
    explicit program, which is the only way to pick an unverified program."""
    name = (name or "").strip()
    if not name:
        raise ModelError("no model given", table())
    if kind is None and "/" in name and name.split("/", 1)[0] in KINDS:
        kind, name = name.split("/", 1)
    if kind is not None and kind not in KINDS:
        raise ModelError(f"unknown program {kind!r}", table())
    if kind is None or kind == "claude":
        target = CLAUDE_ALIASES.get(name.lower(), name)
        hit = next((m for m in catalog() if m["kind"] == "claude" and m["model"] == target), None)
        if hit:
            return {**hit, "verified": True, "note": ""}
        if kind == "claude" or name.lower().startswith("claude-"):
            return {"kind": "claude", "model": name, "label": name, "efforts": CLAUDE_EFFORTS,
                    "default_effort": "high", "verified": True,
                    "note": f"{name} is not in this kit's Claude list; Claude Code will reject it if it doesn't exist"}
    if kind is None or kind == "codex":
        hit = next((m for m in codex_models(include_hidden=True) if m["model"] == name), None)
        if hit:
            return {**hit, "verified": True, "note": ""}
        if kind == "codex":
            raise ModelError(f"{name!r} is not in Codex's model list ({codex_home() / 'models_cache.json'})",
                             table("codex"))
    if kind is not None:  # unverified program: any model name, effort is free text
        return {"kind": kind, "model": name, "label": name, "efforts": [], "default_effort": None,
                "verified": False, "note": f"{kind} is UNVERIFIED with this kit: the model name is not checked"}
    raise ModelError(f"unknown model {name!r}", table())


def check_effort(entry: dict, effort: str | None) -> str | None:
    """The effort to use: the given one if the model supports it, else the model's default."""
    if effort in (None, ""):
        return entry.get("default_effort")
    if entry["efforts"] and effort not in entry["efforts"]:
        raise ModelError(f"{entry['model']} does not support effort {effort!r}; choose one of "
                         f"{', '.join(entry['efforts'])}")
    return effort


def table(kind: str | None = None) -> str:
    """Numbered table of known models, plus the unverified programs (typed as <program>/<model>)."""
    rows = [m for m in catalog() if kind in (None, m["kind"])]
    lines = [f"{'#':>3}  {'program':8} {'model':22} {'efforts':38} status",
             f"{'-' * 3}  {'-' * 8} {'-' * 22} {'-' * 38} {'-' * 8}"]
    for i, m in enumerate(rows, 1):
        lines.append(f"{i:>3}  {m['kind']:8} {m['model']:22} {', '.join(m['efforts']):38} verified")
    if kind is None or kind not in VERIFIED_KINDS:
        lines.append("")
        lines.append("Unverified programs (type <program>/<model>, e.g. grok/grok-4 or opencode/deepseek-chat):")
        lines.append("  " + ", ".join(UNVERIFIED_KINDS))
    if not codex_models() and kind in (None, "codex"):
        lines.append("")
        lines.append("(No Codex models found: run Codex once to fill ~/.codex/models_cache.json.)")
    return "\n".join(lines)


def numbered(kind: str | None = None) -> list[dict]:
    """The rows of `table(kind)` in the same order, for picking by number."""
    return [m for m in catalog() if kind in (None, m["kind"])]


# ---------------------------------------------------------------- launching (phase 2/3)
# How to start each program in a Herdr pane. "{model}", "{effort}", "{cwd}", "{dir}" are filled in.
# Only claude and codex are verified. Every other program gets a GUESS (`--model <model>`, no
# effort flag); if its CLI differs, set "launch_args" for that role in config.json, e.g.
#   "worker": {"kind": "gemini", "model": "gemini-3-pro", "launch_args": ["-m", "{model}"]}
ADAPTERS = {
    "codex": {"model": ["-m", "{model}"], "effort": ["-c", 'model_reasoning_effort="{effort}"'],
              "cwd": ["-C", "{cwd}"], "add_dir": ["--add-dir", "{dir}"],
              "sandbox": "Codex sandbox (workspace-write) + approvals: writes only inside its folders"},
    "claude": {"model": ["--model", "{model}"], "effort": ["--effort", "{effort}"],
               "cwd": [], "add_dir": ["--add-dir", "{dir}"],
               "worker": ["--permission-mode", "auto"],
               "sandbox": "no OS sandbox; Claude Code auto mode approves safe actions and stops risky ones"},
}
GENERIC = {"model": ["--model", "{model}"], "effort": [], "cwd": [], "add_dir": [],
           "sandbox": "UNVERIFIED program: no sandbox assumed; only the worktree, Boundaries and the "
                      "scheduler's changed-file check protect you"}


def adapter(kind: str) -> dict:
    return ADAPTERS.get(kind, GENERIC)


def binary(kind: str) -> str:
    """The executable: Herdr's kind names are the programs' canonical executables."""
    return kind


def launch_args(role: dict, cwd: str | None = None, add_dirs: tuple = (), worker: bool = False) -> list[str]:
    """Arguments to start `role` ({kind, model, effort[, launch_args]}) after `herdr agent start --`."""
    if role.get("launch_args"):
        fill = {"model": role["model"], "effort": role.get("effort") or "", "cwd": cwd or ""}
        return [a.format(**fill) for a in role["launch_args"]]
    ad = adapter(role["kind"])
    args = [a.format(model=role["model"]) for a in ad["model"]]
    if role.get("effort") and ad["effort"]:
        args += [a.format(effort=role["effort"]) for a in ad["effort"]]
    if cwd and ad["cwd"]:
        args += [a.format(cwd=cwd) for a in ad["cwd"]]
    for d in add_dirs:
        args += [a.format(dir=d) for a in ad["add_dir"]]
    if worker:
        args += ad.get("worker", [])
    return args


def sandbox_note(kind: str) -> str:
    return adapter(kind)["sandbox"]
