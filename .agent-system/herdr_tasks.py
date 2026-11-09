"""Best-effort mirror of scheduler tasks into Herdr's Tasks panel."""
from __future__ import annotations

import hashlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def enabled(cfg: dict, env=None) -> bool:
    try:
        env = os.environ if env is None else env
        herdr = cfg.get("herdr", {}) if isinstance(cfg, dict) else {}
        if not isinstance(herdr, dict) or herdr.get("tasks", True) is not True:
            return False
        if not shutil.which("herdr-task", path=env.get("PATH")):
            return False
        if not shutil.which("hc", path=env.get("PATH")):
            return False
        return bool(env.get("HC_TERMINAL_ID") or herdr.get("backend") == "hc")
    except Exception:
        return False


def _fingerprint(status, agent_name, attempts, major_repairs) -> str:
    value = json.dumps([status, agent_name, attempts, major_repairs], separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _ordered_tasks(tasks: dict) -> list[str]:
    ordered, visited, visiting = [], set(), set()

    def visit(tid):
        if tid in visited or tid in visiting:
            return
        visiting.add(tid)
        task = tasks.get(tid, {})
        for dep in task.get("depends_on", []):
            if dep in tasks:
                visit(dep)
        visiting.remove(tid)
        visited.add(tid)
        ordered.append(tid)

    for task_id in tasks:
        visit(task_id)
    return ordered


def _read_map(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        tasks = data.get("tasks") if isinstance(data, dict) else None
        return tasks if isinstance(tasks, dict) else {}
    except Exception:
        return {}


def _write_map(run_dir: Path, tasks: dict) -> None:
    tmp_path = None
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=".herdr-tasks.", suffix=".tmp", dir=run_dir)
        tmp_path = Path(tmp_name)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"tasks": tasks}, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp_path, run_dir / "herdr-tasks.json")
        tmp_path = None
    except Exception:
        pass
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _run(runner, argv):
    try:
        result = runner(argv, capture_output=True, text=True, shell=False, timeout=10)
        return result if result.returncode == 0 else None
    except Exception:
        return None


def _created_task(result):
    try:
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            return None
        task_id, key = value.get("id"), value.get("key")
        if task_id is None or not isinstance(key, str) or not key:
            return None
        return task_id, key
    except Exception:
        return None


def _agent_address(result):
    try:
        value = json.loads(result.stdout)
        if not isinstance(value, dict) or isinstance(value.get("error"), dict):
            return None
        # A live terminal counts even before its agent reports a state (e.g. stuck on a startup screen).
        if value.get("state") != "live":
            return None
        address = value.get("address")
        return address if isinstance(address, str) and address else None
    except Exception:
        return None


def _adopt_store(folder, task_id, address, agent, runner=subprocess.run) -> bool:
    """Adopt a Herdr task into the scheduler-owned run without launching an agent."""
    binary = None
    try:
        binary = shutil.which("herdr-task")
        if not binary:
            return False
        package_dir = os.path.dirname(os.path.realpath(binary))
        old_bytecode = sys.dont_write_bytecode
        sys.dont_write_bytecode = True
        sys.path.insert(0, package_dir)
        old_modules = {name: module for name, module in sys.modules.items()
                       if name == "herdr_task" or name.startswith("herdr_task.")}
        for name in old_modules:
            sys.modules.pop(name, None)
        try:
            store_module = importlib.import_module("herdr_task.store")
            base_module = importlib.import_module("herdr_task.base")
            with store_module.Store(store_module.locate(folder)) as store:
                task = store.find(str(task_id))
                timestamp = base_module.now()
                task["state"] = "running"
                if "started" not in task:
                    task["started"] = timestamp
                if "backup" not in task:
                    task["backup"] = {"state": "skipped",
                                       "why": "agent-kit scheduler owns this task", "at": timestamp}
                if address:
                    agents = task.setdefault("agents", [])
                    if not any(isinstance(item, dict) and item.get("address") == address for item in agents):
                        agents.append({"address": address, "agent": agent, "at": timestamp})
                store.dirty = True
            if address:
                result = _run(runner, ["hc", "label", address, f"herdr.task={store.key(task)}"])
                if result is None:
                    return False
            return True
        finally:
            for name in tuple(sys.modules):
                if name == "herdr_task" or name.startswith("herdr_task."):
                    sys.modules.pop(name, None)
            sys.modules.update(old_modules)
            try:
                sys.path.remove(package_dir)
            except ValueError:
                pass
            sys.dont_write_bytecode = old_bytecode
    except Exception:
        return False


def sync(sched, state, runner=subprocess.run, adopt=None) -> None:
    """Refresh the run's Herdr task mirror without affecting scheduler progress."""
    try:
        run_dir = Path(sched.store.run_dir(state["run_id"]))
        folder = str(sched.workspace_root)
        task_map = _read_map(run_dir / "herdr-tasks.json")
        tasks = state.get("tasks") or {}
        workers = state.get("workers") or {}
        do_adopt = adopt

        def adopt_task(task_id, address):
            try:
                if do_adopt is None:
                    return _adopt_store(folder, task_id, address, "codex", runner=runner)
                return do_adopt(folder, task_id, address, "codex") is not False
            except Exception:
                return False

        for task_id in _ordered_tasks(tasks):
            try:
                task = tasks[task_id]
                entry = task_map.get(task_id)
                if not isinstance(entry, dict) or entry.get("id") is None or not entry.get("key"):
                    title = f"{state['run_id']} {task_id}: {task.get('title') or task_id}"[:80]
                    prompt = f"{task.get('summary') or ''}\n\nTask file: {task.get('packet') or ''}"
                    argv = ["herdr-task", "add", "--folder", folder, "--json", "--here", "--prompt", prompt]
                    dependencies = task.get("depends_on") or []
                    if dependencies and all(dep in task_map for dep in dependencies):
                        argv.extend(["--after", ",".join(str(task_map[dep]["id"]) for dep in dependencies)])
                    argv.append(title)
                    result = _run(runner, argv)
                    if result is None:
                        continue
                    created = _created_task(result)
                    if created is None:
                        continue
                    entry = {"id": created[0], "key": created[1], "seen": "", "address": None}
                    task_map[task_id] = entry

                worker_id = task.get("worker")
                worker = workers.get(worker_id, {}) if worker_id else {}
                agent_name = worker.get("agent_name") if isinstance(worker, dict) else None
                status = task.get("status")
                report_path = run_dir / "reports" / f"{task_id}.json"
                if status == "RUNNING" and report_path.is_file():
                    status = "REVIEW"
                fingerprint = _fingerprint(status, agent_name, task.get("attempts", 0),
                                           task.get("major_repairs", 0))
                if entry.get("seen") == fingerprint:
                    continue

                task_id_num = str(entry["id"])
                if status in ("PENDING", "READY"):
                    entry["seen"] = fingerprint
                    continue
                if status == "RUNNING":
                    address = None
                    if agent_name:
                        result = _run(runner, ["hc", "get", str(agent_name), "--json"])
                        if result is not None:
                            address = _agent_address(result)
                    if address is None or address != entry.get("address"):
                        if not adopt_task(entry["id"], address):
                            continue
                        if address:
                            entry["address"] = address
                    text = ("Working" if task.get("attempts", 0) <= 1
                            and not task.get("major_repairs", 0)
                            else f"Fix round {task.get('major_repairs') or task.get('attempts', 1) - 1}")
                    result = _run(runner, ["herdr-task", "status", "--folder", folder,
                                          task_id_num, text])
                elif status in ("REVIEW", "PASSED", "FIX_REQUIRED", "BLOCKED", "FAILED"):
                    if not adopt_task(entry["id"], None):
                        continue
                    text = {"REVIEW": "Waiting for review", "PASSED": "Reviewed, waiting to merge",
                            "FIX_REQUIRED": "Fix needed", "BLOCKED": "Blocked: needs you",
                            "FAILED": "Failed"}[status]
                    result = _run(runner, ["herdr-task", "status", "--folder", folder,
                                          task_id_num, text])
                elif status == "MERGED":
                    result = _run(runner, ["herdr-task", "done", "--folder", folder, task_id_num])
                else:
                    continue
                if result is not None:
                    entry["seen"] = fingerprint
            except Exception:
                continue
        _write_map(run_dir, task_map)
    except Exception:
        return


def show_panel(cfg: dict, env=None, runner=subprocess.run) -> bool:
    try:
        if not enabled(cfg, env):
            return False
        commands = (
            ["herdr-app", "do", "layout.select", "--stack", "panel-body", "--child", "tasks"],
            ["herdr-app", "do", "layout.show", "--id", "panel"],
        )
        for argv in commands:
            if _run(runner, argv) is None:
                return False
        return True
    except Exception:
        return False
