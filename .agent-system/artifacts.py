"""Best-effort publishing and safe board data for Herdr artifacts."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

PANELS_DIR = Path(__file__).resolve().parent / "artifacts"


def board_data(state: dict) -> dict:
    """Return only the fields the run board and decision cards need."""
    events = state.get("events") or []
    updated_at = state.get("updated_at")
    if not updated_at and events and isinstance(events[-1], dict):
        updated_at = events[-1].get("at")
    updated_at = updated_at or state.get("created_at")

    tasks = []
    for task_id, task in sorted(state.get("tasks", {}).items()):
        reviews = task.get("reviews") or []
        verdict = task.get("verdict")
        if verdict is None and reviews and isinstance(reviews[-1], dict):
            verdict = reviews[-1].get("verdict")
        tasks.append({
            "id": task.get("id", task_id),
            "title": task.get("title"),
            "status": task.get("status"),
            "worker": task.get("worker"),
            "verdict": verdict,
        })

    decisions = []
    for decision_id, decision in state.get("decisions", {}).items():
        followup = decision.get("followup")
        safe_followup = None
        if isinstance(followup, dict):
            safe_followup = {
                "question": followup.get("question"),
                "when": list(followup.get("when") or []),
                "options": [{
                    "key": option.get("key"),
                    "label": option.get("label"),
                    "value": option.get("value"),
                    "input": bool(option.get("input")),
                } for option in followup.get("options", []) if isinstance(option, dict)],
            }
        answer = decision.get("answer")
        safe_answer = None
        if isinstance(answer, dict):
            followup_answer = answer.get("followup")
            safe_answer = {
                "choice": answer.get("choice"),
                "followup": followup_answer.get("value") if isinstance(followup_answer, dict) else None,
            }
        decisions.append({
            "id": decision.get("id", decision_id),
            "kind": decision.get("kind"),
            "title": decision.get("title"),
            "question": decision.get("question"),
            "options": [{"key": option.get("key"), "label": option.get("label")}
                        for option in decision.get("options", []) if isinstance(option, dict)],
            "recommend": decision.get("recommend"),
            "followup": safe_followup,
            "answer": safe_answer,
        })

    return {
        "run_id": state.get("run_id"),
        "title": state.get("title"),
        "status": state.get("status"),
        "updated_at": updated_at,
        "tasks": tasks,
        "decisions": decisions,
    }


def write_board(store_or_run_dir, state: dict) -> None:
    """Atomically refresh board.json. A board write never affects scheduler progress."""
    tmp_path = None
    try:
        run_dir = (store_or_run_dir.run_dir(state["run_id"])
                   if hasattr(store_or_run_dir, "run_dir") else Path(store_or_run_dir))
        run_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=".board.", suffix=".tmp", dir=run_dir)
        tmp_path = Path(tmp_name)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(board_data(state), stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp_path, run_dir / "board.json")
        tmp_path = None
    except Exception:
        pass
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def enabled(cfg: dict, env=None) -> bool:
    try:
        env = os.environ if env is None else env
        herdr = cfg.get("herdr", {}) if isinstance(cfg, dict) else {}
        if not isinstance(herdr, dict) or herdr.get("artifacts", True) is not True:
            return False
        return bool(env.get("HC_TERMINAL_ID") and shutil.which("herdr-artifact", path=env.get("PATH")))
    except Exception:
        return False


def _data_module(run_dir: Path, run_id: str, decision_id: str = "") -> str:
    board_path = (run_dir / "board.json").resolve()
    return (f"export const DATA = {json.dumps(str(board_path))};\n"
            f"export const DECISION = {json.dumps(decision_id)};\n"
            f"export const RUN = {json.dumps(run_id)};\n")


def _publish(project_root, run_dir, state: dict, cfg: dict, env, runner,
             panel: str, artifact_dir: str, title: str, decision_id: str = "") -> str | None:
    if not enabled(cfg, env):
        return None
    try:
        project_root = Path(project_root).resolve()
        run_dir = Path(run_dir).resolve()
        write_board(run_dir, state)
        destination = run_dir / "artifacts" / artifact_dir
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(PANELS_DIR / panel, destination)
        (destination / "data.js").write_text(_data_module(run_dir, state["run_id"], decision_id),
                                              encoding="utf-8")
        argv = ["herdr-artifact", "publish", str(destination), "--title", title,
                "--folder", str(project_root), "--json"]
        result = runner(argv, capture_output=True, text=True, shell=False, timeout=10)
        if result.returncode != 0:
            return None
        response = json.loads(result.stdout)
        artifact_id = response.get("id") if isinstance(response, dict) else response
        if not isinstance(artifact_id, str) or not artifact_id.strip():
            return None
        return artifact_id.strip()
    except Exception:
        return None


def publish_board(project_root, run_dir, state: dict, cfg: dict, env=None,
                  runner=subprocess.run) -> str | None:
    artifact_id = _publish(project_root, run_dir, state, cfg, env, runner, "board", "board",
                           f"{state['run_id']}: board")
    if artifact_id:
        state.setdefault("artifacts", {})["board"] = artifact_id
    return artifact_id


def publish_decision(project_root, run_dir, state: dict, cfg: dict, decision_id: str, env=None,
                     runner=subprocess.run) -> str | None:
    decision = state.get("decisions", {}).get(decision_id)
    if not isinstance(decision, dict):
        return None
    artifact_id = _publish(project_root, run_dir, state, cfg, env, runner, "decision", decision_id,
                           f"{state['run_id']} {decision_id}: {decision.get('title') or decision_id}",
                           decision_id)
    if artifact_id:
        decision["artifact_id"] = artifact_id
    return artifact_id


def remove(ids, runner=subprocess.run) -> None:
    for artifact_id in ids:
        if not isinstance(artifact_id, str) or not artifact_id:
            continue
        try:
            runner(["herdr-artifact", "rm", artifact_id], capture_output=True, text=True,
                   shell=False, timeout=5)
        except Exception:
            pass
