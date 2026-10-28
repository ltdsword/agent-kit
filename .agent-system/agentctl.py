#!/usr/bin/env python3
"""Agent Hub v2 connector for an agent-kit workspace (stdlib only)."""
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hubschema  # noqa: E402
import kitstart  # noqa: E402
import scheduler as S  # noqa: E402

CONNECTOR_VERSION = "0.1.0"
PROTOCOL_VERSION = 2
ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
MAX_DOCUMENT_BYTES = 1024 * 1024
MAX_SNAPSHOT_BYTES = 256 * 1024
MAX_BATCH_BYTES = 5 * 1024 * 1024
SECRET_RE = re.compile(
    r"sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._~+/-]{16,}=*|"
    r"(?i:(?:password|passwd|secret|token)\s*[=:]\s*\S+)"
)
PEM_RE = re.compile(r"-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----")


class HubError(Exception):
    """An HTTP or protocol error returned by the backend."""

    def __init__(self, status: int, code: str, message: str):
        message = scrub(message)
        super().__init__(f"HTTP {status} {code}: {message}")
        self.status, self.code, self.message = status, code, message


class DuplicateWorkspace(HubError):
    """The backend has another live connector using this workspace id."""


def now() -> str:
    """Return an ISO 8601 UTC timestamp accepted by the protocol."""
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    """Generate a protocol id from sixteen base32 alphabet characters."""
    return prefix + "".join(secrets.choice(ID_ALPHABET) for _ in range(16))


def canonical_bytes(obj) -> bytes:
    """Serialize canonical JSON for protocol hashes."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def snapshot_digest(snapshot: dict) -> str:
    """Hash snapshot content without its volatile capture timestamp."""
    stable = {key: value for key, value in snapshot.items() if key != "taken_at"}
    return digest(canonical_bytes(stable))


def scrub(value):
    """Redact common credential forms recursively from every uploaded value."""
    if isinstance(value, str):
        return PEM_RE.sub("[REDACTED]", SECRET_RE.sub("[REDACTED]", value))
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, dict):
        return {key: scrub(item) for key, item in value.items()}
    return value


def validate(def_name: str, body):
    """Validate a protocol message and return it unchanged."""
    hubschema.validate(def_name, body)
    return body


def default_workspace() -> Path:
    return Path(__file__).resolve().parent.parent


def key_file(env=None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get("AGENT_HUB_CONFIG", "~/.config/agent-hub")).expanduser() / "connector.key"


def read_key(env=None) -> str:
    """Read the connector key without ever including it in diagnostics."""
    path = key_file(env)
    try:
        key = path.read_text().strip()
    except OSError as e:
        raise RuntimeError(f"connector key missing or unreadable at {path}") from e
    if not key:
        raise RuntimeError(f"connector key is empty at {path}")
    return key


def display_url(url: str) -> str:
    """Return a URL safe for human-readable status output."""
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    if parsed.port:
        host += f":{parsed.port}"
    return scrub(parsed._replace(netloc=host).geturl())


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temp.write_text(content, encoding="utf-8")
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def load_config(ws: Path) -> dict:
    cfg = S.load_config(ws)
    hub = cfg.get("hub")
    if isinstance(hub, dict):
        upload = hub.get("upload")
        if isinstance(upload, dict) and "agent_screens" in upload:
            upload.setdefault("orchestrator_screen", upload["agent_screens"])
            del upload["agent_screens"]
            save_config(ws, cfg)
    return cfg


def save_config(ws: Path, cfg: dict) -> None:
    """Update only the hub object so unrelated config formatting stays stable."""
    path = ws / ".agent-system" / "config.json"
    source = path.read_text(encoding="utf-8")
    decoder = json.JSONDecoder()
    index = 0

    def skip_space(position):
        while position < len(source) and source[position].isspace():
            position += 1
        return position

    index = skip_space(index)
    if index >= len(source) or source[index] != "{":
        raise ValueError("config.json must contain a JSON object")
    index += 1
    hub_start = hub_end = None
    hub_key_start = None
    while True:
        index = skip_space(index)
        if index >= len(source) or source[index] == "}":
            break
        if source[index] == ",":
            index = skip_space(index + 1)
        key_start = index
        key, index = decoder.raw_decode(source, index)
        index = skip_space(index)
        if index >= len(source) or source[index] != ":":
            raise ValueError("invalid config.json object")
        value_start = skip_space(index + 1)
        _, value_end = decoder.raw_decode(source, value_start)
        if key == "hub":
            hub_key_start, hub_start, hub_end = key_start, value_start, value_end
            break
        index = value_end

    hub = cfg.get("hub")
    if not isinstance(hub, dict):
        raise ValueError("hub config must be an object")
    pretty = json.dumps(hub, ensure_ascii=False, indent=2)
    if hub_start is not None:
        line_start = source.rfind("\n", 0, hub_key_start) + 1
        leading = source[line_start:hub_key_start]
        base_indent = leading if not leading.strip() else ""
        if "\n" in source[hub_start:hub_end]:
            lines = pretty.splitlines()
            replacement = lines[0] + "\n" + "\n".join(base_indent + line for line in lines[1:])
        else:
            replacement = json.dumps(hub, ensure_ascii=False, separators=(",", ": "))
        updated = source[:hub_start] + replacement + source[hub_end:]
    else:
        root_end = source.rfind("}")
        if root_end < 0:
            raise ValueError("invalid config.json object")
        top_indents = [line[:len(line) - len(line.lstrip())] for line in source.splitlines()
                       if line.lstrip().startswith('"') and ":" in line]
        indent = next((value for value in top_indents if value), "  ")
        before = source[:root_end].rstrip()
        comma = "," if any(key != "hub" for key in cfg) else ""
        addition = f'{comma}\n{indent}"hub": ' + pretty.replace("\n", "\n" + indent) + "\n"
        updated = before + addition + source[root_end:]
    atomic_write(path, updated)


def config_hub(cfg: dict) -> dict:
    hub = cfg.get("hub") or {}
    if not isinstance(hub, dict):
        raise ValueError("hub config must be an object")
    upload = hub.get("upload")
    if isinstance(upload, dict) and "agent_screens" in upload:
        upload.setdefault("orchestrator_screen", upload["agent_screens"])
        del upload["agent_screens"]
    return hub


def http_request(url: str, method="GET", body=None, key=None, timeout=10):
    """Make a protocol request without consulting proxy environment variables."""
    headers = {"X-Agent-Hub-Protocol": str(PROTOCOL_VERSION)}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            err = json.loads(raw.decode("utf-8"))
            code = err.get("error", {}).get("code", "http_error")
            message = err.get("error", {}).get("message", "request failed")
        except (ValueError, AttributeError):
            code, message = "http_error", "request failed"
        error = DuplicateWorkspace if e.code == 409 and code == "duplicate_workspace" else HubError
        raise error(e.code, code, message) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RuntimeError(f"backend request failed: {e}") from e
    if not raw:
        return status, None
    try:
        return status, json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise RuntimeError("backend returned invalid JSON") from e


def ping(url: str, key=None, timeout=10) -> dict:
    """Check the backend and validate its PingResponse."""
    _, response = http_request(url.rstrip("/") + "/api/v1/agent/ping", key=key, timeout=timeout)
    response = validate("PingResponse", response)
    if not response["min_protocol"] <= PROTOCOL_VERSION <= response["protocol"]:
        raise RuntimeError(f"Agent Hub protocol 2 is required; update agent-kit (server supports {response['protocol']})")
    return response


class HubClient:
    """Small typed client for the v2 connector routes."""

    def __init__(self, url: str, key: str, workspace_id: str, timeout=10):
        self.base = url.rstrip("/") + "/api/v1/agent"
        self.key, self.workspace_id, self.timeout = key, workspace_id, timeout
        self.workspace = self.base + "/workspaces/" + urllib.parse.quote(workspace_id, safe="")

    def call(self, suffix: str, method: str, def_name: str | None = None, body=None, timeout=None, query=None):
        if def_name:
            validate(def_name, body)
        url = self.base + suffix if suffix.startswith("/") else self.workspace + "/" + suffix
        if query:
            url += "?" + urllib.parse.urlencode(query)
        _, response = http_request(url, method, body, self.key, timeout or self.timeout)
        return response

    def hello(self, hello: dict) -> dict:
        response = self.call("/hello", "POST", "HelloRequest", hello)
        return validate("HelloResponse", response)

    def snapshot(self, body: dict) -> None:
        self.call("snapshot", "PUT", "Snapshot", body)

    def decisions(self, body: dict) -> None:
        self.call("decisions", "PUT", "DecisionsBatch", body)

    def events(self, body: dict) -> dict:
        return validate("EventsResponse", self.call("events", "POST", "EventsBatch", body))

    def documents(self, body: dict) -> None:
        self.call("documents", "PUT", "DocumentsBatch", body)

    def delete_document(self, path: str) -> None:
        self.call("documents", "DELETE", query={"path": path})

    def heartbeat(self) -> None:
        self.call("heartbeat", "POST")

    def commands(self, wait=25) -> list[dict]:
        response = self.call("commands", "GET", timeout=wait + 5, query={"wait": wait})
        return validate("CommandsResponse", response)["commands"]

    def ack_command(self, command_id: str, status: str, reason: str | None = None) -> None:
        body = validate("AckRequest", {"status": status, "reason": reason})
        self.call(f"commands/{urllib.parse.quote(command_id, safe='')}/ack", "POST", "AckRequest", body)

    def goodbye(self, session_id: str, reason: str) -> None:
        self.call("goodbye", "POST", "GoodbyeRequest", {"session_id": session_id, "reason": reason}, timeout=3)


def load_runs(ws: Path) -> list[dict]:
    """Read each valid run state in stable newest-first order."""
    runs = []
    for path in (ws / ".orchestrator" / "runs").glob("*" + "/state.json"):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(state, dict) and state.get("run_id"):
            runs.append(state)
    return sorted(runs, key=lambda state: str(state.get("created_at") or ""), reverse=True)[:200]


def _herdr_record(name: str | None, runner=subprocess.run) -> tuple[dict | None, str]:
    """Return a Herdr agent record and protocol state; tolerate missing Herdr installations."""
    if not name:
        return None, "absent"
    try:
        result = runner(["herdr", "agent", "get", name], capture_output=True, text=True, timeout=5)
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None, "unknown"
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    if result.returncode:
        if re.search(r"agent[_ ]not[_ ]found|no such agent|agent .*not found", output, re.I):
            return None, "absent"
        return None, "unknown"
    try:
        data = json.loads(result.stdout or "{}")
    except ValueError:
        return None, "unknown"
    agent = ((data.get("result") or {}).get("agent") if isinstance(data, dict) else None)
    if not isinstance(agent, dict) and isinstance(data, dict):
        agent = data.get("agent")
    if not isinstance(agent, dict):
        return None, "absent" if isinstance(data, dict) and ("result" in data or "agent" in data) else "unknown"
    state = agent.get("agent_status")
    return agent, state if state in ("idle", "working", "blocked", "done", "unknown", "absent") else "unknown"


def _screen(name: str | None, lines: int, runner=subprocess.run):
    if not name:
        return None
    try:
        result = runner(["herdr", "agent", "read", name, "--source", "visible", "--lines", str(lines)],
                        capture_output=True, text=True, timeout=5)
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode:
        return None
    output = scrub(result.stdout or "")
    return output.splitlines()[-min(max(lines, 1), 200):]


def _newest_worker_since(state: dict, slot: str, worker: dict) -> str | None:
    for event in reversed(state.get("events", [])):
        if event.get("kind") == "worker" and event.get("worker") == slot:
            return event.get("at")
    return worker.get("session_started_at")


def _run_snapshot(state: dict, ws: Path, cfg: dict) -> dict:
    run_id = state["run_id"]
    tasks = []
    for task in sorted((state.get("tasks") or {}).values(), key=lambda item: item.get("id", "")):
        tasks.append({
            "id": task.get("id", ""), "title": task.get("title", ""),
            "summary": task.get("summary"), "status": task.get("status", "PENDING"),
            "worker": task.get("worker"), "depends_on": task.get("depends_on", []),
            "major_repairs": task.get("major_repairs", 0),
            "max_repairs": cfg.get("limits", {}).get("max_major_repairs", 2),
            "known_issues": task.get("known_issues")
        })
    verification = state.get("verify") or {}
    code = verification.get("exit_code")
    gate_status = "PASS" if code == 0 else "FAIL" if code is not None else None
    problems = []
    decisions = state.get("decisions") or {}
    events = state.get("events", [])
    for task in (state.get("tasks") or {}).values():
        if task.get("status") not in ("BLOCKED", "FIX_REQUIRED"):
            continue
        last = next((event for event in reversed(events)
                     if event.get("kind") == "task" and event.get("task") == task.get("id")), {})
        did = next((decision_id for decision_id, decision in decisions.items()
                    if decision.get("task") == task.get("id") and decision.get("status") == "PENDING"), None)
        problems.append({"task_id": task.get("id"), "type": task.get("status"),
                         "since": last.get("at"), "decision_id": did,
                         "note": str(task.get("status_reason") or last.get("reason") or "")[:1000]})
    if state.get("status") in ("BLOCKED", "FAILED") and state.get("close_reason"):
        closed = next((event for event in reversed(events) if event.get("kind") == "run_closed"), {})
        problems.append({"task_id": None, "type": state["status"], "since": closed.get("at"),
                         "decision_id": None, "note": str(state["close_reason"])[:1000]})
    finish = state.get("finish")
    if isinstance(finish, dict) and finish.get("decision") and finish.get("choice") and finish.get("at"):
        finish = {"decision_id": finish.get("decision"), "choice": finish["choice"],
                  "result": str(finish.get("result", ""))[:1000], "branch": finish.get("branch"),
                  "pushed": finish.get("pushed"), "at": finish["at"]}
    else:
        finish = None
    report = ws / ".orchestrator" / "runs" / run_id / "final-report.md"
    return {
        "run_id": run_id, "title": state.get("title"), "goal": state.get("goal"),
        "status": state.get("status", "RUNNING"), "created_at": state.get("created_at"),
        "base_branch": state.get("base_branch"), "integration_branch": state.get("integration_branch", ""),
        "gate": {"status": gate_status, "at": verification.get("at")}, "tasks": tasks,
        "problems": problems[:50], "report_path": relative_path(ws, report) if report.is_file() else None,
        "finish": finish
    }


def _scout_snapshot(state: dict | None) -> dict | None:
    if not state:
        return None
    research = state.get("research") or {}
    readiness = (research.get("readiness") or [])
    latest_readiness = readiness[-1].get("status") if readiness else None
    rounds = []
    for item in research.get("rounds", []):
        rounds.append({"n": item.get("round", item.get("n", 0)), "questions": item.get("questions", []),
                       "evidence_path": item.get("evidence_path"),
                       "at": item.get("recorded_at", item.get("at"))})
    return {"run_id": state["run_id"], "rounds_used": research.get("scout_rounds_used", len(rounds)),
            "max_rounds": research.get("max_scout_rounds", 3), "readiness": latest_readiness, "rounds": rounds}


def make_snapshot(ws: Path, cfg: dict, session_id: str, runner=subprocess.run) -> dict:
    """Build the protocol snapshot from run state, config and best-effort Herdr observations."""
    ws = ws.resolve()
    repo = S.project_root_for(ws, cfg)
    repo_name = repo.name
    orch = cfg.get("orchestrator", {})
    orch_name = kitstart.agent_name(repo_name)
    orch_record, orch_state = _herdr_record(orch_name, runner)
    upload = config_hub(cfg).get("upload", {})
    screen_on = bool(upload.get("orchestrator_screen", True))
    screen_lines = config_hub(cfg).get("screen_lines", 40)
    orch_screen = _screen(orch_name, screen_lines, runner) if screen_on else None
    orch_session = ((orch_record or {}).get("agent_session") or {}).get("value")
    if not orch_session:
        orch_session = kitstart.saved_session(ws).get("session_id")
    runs = load_runs(ws)
    newest = runs[0] if runs else None
    worker_states = (newest or {}).get("workers") or {}
    worker_items = []
    for slot in cfg.get("pool", {}).get("slots", []):
        worker = worker_states.get(slot, {})
        agent_name = worker.get("agent_name")
        record, herdr_state = _herdr_record(agent_name, runner)
        worker_items.append({
            "slot": slot, "status": worker.get("status", "IDLE"),
            "status_reason": str(worker.get("status_reason") or "")[:500] or None,
            "run_id": newest.get("run_id") if newest and (worker.get("status") == "BUSY" or worker.get("task")) else None,
            "task_id": worker.get("task"), "agent_name": agent_name,
            "kind": cfg.get("worker", {}).get("kind", "codex"),
            "model": cfg.get("worker", {}).get("model", ""),
            "effort": cfg.get("worker", {}).get("reasoning_effort"),
            "herdr_state": herdr_state, "since": _newest_worker_since(newest, slot, worker) if newest else None
        })
    newest_activity = max((event.get("at") for state in runs for event in state.get("events", [])
                           if isinstance(event.get("at"), str)), default=None)
    snapshot = {
        "protocol": PROTOCOL_VERSION, "workspace_id": config_hub(cfg).get("workspace_id"),
        "session_id": session_id, "taken_at": now(),
        "kit_version": kit_version(ws),
        "orchestrator": {"name": orch_name, "kind": orch.get("kind", "claude"), "model": orch.get("model", ""),
                         "effort": orch.get("effort"), "herdr_state": orch_state,
                         "session_id": orch_session, "screen": orch_screen},
        "workers": worker_items, "scout": _scout_snapshot(newest),
        "runs": [_run_snapshot(state, ws, cfg) for state in runs],
        "orchestrator_last_activity_at": newest_activity
    }
    snapshot = scrub(snapshot)
    return trim_snapshot(snapshot)


def kit_version(ws: Path) -> str | None:
    try:
        value = (ws / ".agent-system" / "VERSION").read_text().splitlines()[0].strip()
        return value[:64] or None
    except (OSError, IndexError):
        return os.environ.get("AGENT_HUB_KIT_VERSION")


def trim_snapshot(snapshot: dict) -> dict:
    """Enforce the protocol's cap by removing screens, then the oldest runs."""
    def size():
        return len(canonical_bytes(snapshot))
    if size() > MAX_SNAPSHOT_BYTES:
        snapshot["orchestrator"]["screen"] = None
    while size() > MAX_SNAPSHOT_BYTES and snapshot["runs"]:
        snapshot["runs"].pop()
    if size() > MAX_SNAPSHOT_BYTES:
        raise ValueError("snapshot exceeds 256 KB after dropping screens and oldest runs")
    return validate("Snapshot", snapshot)


def _decision_followup(value):
    if not value:
        return None
    return {"when": value.get("when", []), "question": value.get("question", ""),
            "options": [{"key": option.get("key", ""), "label": option.get("label", ""),
                         "value": option.get("value"), "input": bool(option.get("input", False))}
                        for option in value.get("options", [])],
            "validate": value.get("validate")}


def make_decisions(runs: list[dict]) -> list[dict]:
    """Map every run's scheduler decisions to the backend Decision definition."""
    result = []
    for state in runs:
        run_id = state.get("run_id")
        tasks = state.get("tasks") or {}
        for decision_id, item in sorted((state.get("decisions") or {}).items()):
            task_id = item.get("task")
            worker = (tasks.get(task_id) or {}).get("worker") if task_id else None
            agent = worker if isinstance(worker, str) and re.fullmatch(r"worker-[0-9]{1,2}", worker) else "orchestrator"
            answer = item.get("answer")
            if answer is not None:
                answer = {"choice": answer.get("choice", ""), "label": answer.get("label", ""),
                          "note": answer.get("note", ""), "channel": answer.get("channel", "chat"),
                          "by": answer.get("by", "user"), "at": answer.get("at", item.get("created_at")),
                          "quote": answer.get("quote"), "followup": answer.get("followup")}
            decision = {
                "run_id": run_id, "decision_id": decision_id, "kind": item.get("kind", "question"),
                "task_id": task_id, "agent": agent, "title": item.get("title", ""),
                "question": item.get("question", ""),
                "options": [{"key": option.get("key", ""), "label": option.get("label", ""),
                             "consequence": option.get("consequence")}
                            for option in item.get("options", [])],
                "recommend": item.get("recommend"), "followup": _decision_followup(item.get("followup")),
                "local_status": item.get("status", "PENDING"), "answer": answer,
                "consumed_by": item.get("consumed_by"), "opened_at": item.get("created_at"),
                "cancel_reason": item.get("cancel_reason"),
                "evidence": [{"code": evidence.get("code", ""), "note": evidence.get("note", ""),
                              "bad": bool(evidence.get("bad", False))}
                             for evidence in item.get("evidence", [])],
                "note": item.get("note"),
                "approval": (None if item.get("approval") is None else {
                    "command": item["approval"].get("command", ""),
                    "cwd": item["approval"].get("cwd"), "why": item["approval"].get("why", [])})
            }
            result.append(scrub(decision))
    return result


def make_events(runs: list[dict], cursors: dict) -> list[dict]:
    """Convert numbered scheduler events to protocol batches after each backend cursor."""
    result = []
    for state in runs:
        run_id = state.get("run_id")
        cursor = cursors.get(run_id, 0)
        events = []
        for event in state.get("events", []):
            n = event.get("n")
            if not isinstance(n, int) or n <= cursor:
                continue
            events.append({"n": n, "at": event.get("at"), "kind": event.get("kind", ""),
                           "data": {key: value for key, value in event.items() if key not in ("n", "at", "kind")}})
        for start in range(0, len(events), 200):
            result.append(validate("EventsBatch", scrub({"run_id": run_id, "events": events[start:start + 200]})))
    return result


def relative_path(ws: Path, path: Path) -> str:
    return path.resolve().relative_to(ws.resolve()).as_posix()


def secret_path(path: str) -> bool:
    return any(fnmatch.fnmatch(part, pattern) for part in Path(path).parts for pattern in S.SECRET_PATTERNS)


def safe_document_path(ws: Path, raw: str) -> Path | None:
    """Resolve a workspace-relative document and reject secrets or paths outside the workspace."""
    if not isinstance(raw, str) or not raw or Path(raw).is_absolute() or secret_path(raw):
        return None
    try:
        path = (ws / raw).resolve()
        path.relative_to(ws.resolve())
        return path
    except (OSError, ValueError):
        return None


def document_refs(ws: Path, runs: list[dict]) -> dict[str, tuple[str | None, str]]:
    """Collect allowed document paths with their run and protocol kind."""
    refs = {}
    for state in runs:
        run_id = state.get("run_id")
        run_dir = f".orchestrator/runs/{run_id}"
        refs[f"{run_dir}/final-report.md"] = (run_id, "final_report")
        refs[f"{run_dir}/final.diff"] = (run_id, "final_diff")
        for decision_id in (state.get("decisions") or {}):
            refs.setdefault(f"{run_dir}/decisions/{decision_id}.md", (run_id, "decision"))
        for item in (state.get("research") or {}).get("rounds", []):
            evidence = item.get("evidence_path")
            if evidence:
                refs.setdefault(evidence, (run_id, "research"))
    return refs


def managed_document_kind(path: str) -> str | None:
    """Infer a managed document kind from its stable workspace-relative path."""
    if re.fullmatch(r"\.orchestrator/runs/[^/]+/final-report\.md", path):
        return "final_report"
    if re.fullmatch(r"\.orchestrator/runs/[^/]+/final\.diff", path):
        return "final_diff"
    if re.fullmatch(r"\.orchestrator/runs/[^/]+/decisions/D[0-9]{1,4}\.md", path):
        return "decision"
    if "/research/" in path:
        return "research"
    return None


def _truncate(content: str, original_bytes: int) -> tuple[str, bool]:
    encoded = content.encode("utf-8")
    if len(encoded) <= MAX_DOCUMENT_BYTES:
        return content, False
    marker = f"\n… truncated: full file on your computer ({original_bytes} bytes)\n"
    room = MAX_DOCUMENT_BYTES - len(marker.encode("utf-8"))
    return encoded[:room].decode("utf-8", errors="ignore") + marker, True


def make_document(ws: Path, raw_path: str, run_id: str | None, kind: str) -> dict | None:
    path = safe_document_path(ws, raw_path)
    if path is None or scrub(Path(raw_path).as_posix()) != Path(raw_path).as_posix():
        return None
    try:
        original = path.read_bytes()
    except OSError:
        return None
    text = scrub(original.decode("utf-8", errors="replace"))
    content, truncated = _truncate(text, len(original))
    encoded = content.encode("utf-8")
    heading = next((match.group(1).strip() for line in content.splitlines()
                    if (match := re.match(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", line))), None)
    title = scrub(heading or Path(raw_path).name)
    fmt = "diff" if path.suffix == ".diff" else "markdown" if path.suffix == ".md" else "text"
    doc = {"path": Path(raw_path).as_posix(), "run_id": run_id, "kind": kind, "title": title[:300],
           "format": fmt, "sha256": digest(encoded), "bytes": len(encoded), "truncated": truncated,
           "content": content}
    return validate("Document", doc)


def document_batches(documents: list[dict]) -> list[dict]:
    batches, current = [], []
    for doc in documents:
        trial = {"documents": current + [doc]}
        if current and (len(current) >= 50 or len(canonical_bytes(trial)) > MAX_BATCH_BYTES):
            batches.append(validate("DocumentsBatch", {"documents": current}))
            current = []
        current.append(doc)
    if current:
        batches.append(validate("DocumentsBatch", {"documents": current}))
    return batches


def make_documents(ws: Path, runs: list[dict], cfg: dict, document_hashes: dict | None = None):
    """Build changed, safe documents, batches and disappeared paths."""
    upload = config_hub(cfg).get("upload", {})
    refs = document_refs(ws, runs)
    remote = document_hashes or {}
    docs, deleted = [], []
    for raw_path, (run_id, kind) in sorted(refs.items()):
        enabled = kind == "final_report" or (kind == "final_diff" and upload.get("diffs", True)) or \
            (kind not in ("final_report", "final_diff") and upload.get("documents", True))
        if not enabled or secret_path(raw_path):
            continue
        path = safe_document_path(ws, raw_path)
        if path is None:
            continue
        if path.exists():
            doc = make_document(ws, raw_path, run_id, kind)
            if doc and remote.get(raw_path) != doc["sha256"]:
                docs.append(doc)
        elif raw_path in remote:
            deleted.append(raw_path)
    for raw_path in remote:
        if raw_path in refs or raw_path in deleted or secret_path(raw_path):
            continue
        if raw_path.startswith("gen-tasks/") and raw_path.endswith(".md"):
            deleted.append(raw_path)
            continue
        kind = managed_document_kind(raw_path)
        enabled = kind == "final_report" or (kind == "final_diff" and upload.get("diffs", True)) or \
            (kind is not None and kind not in ("final_report", "final_diff") and upload.get("documents", True))
        path = safe_document_path(ws, raw_path)
        if enabled and path is not None and not path.exists():
            deleted.append(raw_path)
    return docs, document_batches(docs), deleted, refs


def make_hello(ws: Path, cfg: dict, session_id: str) -> dict:
    hub = config_hub(cfg)
    workspace_id = hub.get("workspace_id")
    if not isinstance(workspace_id, str):
        raise ValueError("hub.workspace_id is missing; run `agentctl enable` first")
    repo = S.project_root_for(ws, cfg)
    upload = hub.get("upload") or {}
    hello = {"protocol": PROTOCOL_VERSION, "workspace_id": workspace_id, "session_id": session_id,
             "name": repo.name[:128], "path": str(ws.resolve())[:1024], "kit_version": kit_version(ws),
             "connector_version": CONNECTOR_VERSION,
             "upload": {"documents": bool(upload.get("documents", True)),
                        "diffs": bool(upload.get("diffs", True)),
                        "orchestrator_screen": bool(upload.get("orchestrator_screen", True))}}
    return validate("HelloRequest", scrub(hello))


def build_sync(ws: Path, cfg: dict, session_id: str | None = None, runner=subprocess.run,
               remote: dict | None = None) -> dict:
    """Build and validate the hello, snapshot, decisions, events and document batches."""
    ws, remote = ws.resolve(), remote or {}
    session_id = session_id or new_id("ses_")
    runs = load_runs(ws)
    hello = make_hello(ws, cfg, session_id)
    snapshot = make_snapshot(ws, cfg, session_id, runner)
    snapshot_hash = snapshot_digest(snapshot)
    decisions = [decision for decision in make_decisions(runs)
                 if remote.get("decision_hashes", {}).get(f"{decision['run_id']}/{decision['decision_id']}")
                 != digest(canonical_bytes(decision))]
    decision_batches = [validate("DecisionsBatch", {"decisions": decisions[i:i + 200]})
                        for i in range(0, len(decisions), 200)]
    events = make_events(runs, remote.get("event_cursors", {}))
    docs, documents, deleted, refs = make_documents(ws, runs, cfg, remote.get("document_hashes", {}))
    if remote.get("snapshot_hash") == snapshot_hash:
        snapshot = None
    return {"hello": hello, "snapshot": snapshot, "snapshot_hash": snapshot_hash,
            "decisions": decision_batches, "events": events, "documents": documents,
            "document_items": docs, "deleted_documents": deleted, "document_refs": refs}


def apply_sync(client: HubClient, data: dict, remote: dict) -> tuple[dict, bool]:
    """Send changed protocol data and update the local view of backend cursors/hashes."""
    sent = False
    if data["snapshot"] is not None:
        client.snapshot(data["snapshot"])
        remote["snapshot_hash"] = data["snapshot_hash"]
        sent = True
    for batch in data["decisions"]:
        client.decisions(batch)
        for decision in batch["decisions"]:
            remote.setdefault("decision_hashes", {})[f"{decision['run_id']}/{decision['decision_id']}"] = \
                digest(canonical_bytes(decision))
        sent = True
    for batch in data["events"]:
        response = client.events(batch)
        remote.setdefault("event_cursors", {})[batch["run_id"]] = response["cursor"]
        sent = True
    for batch in data["documents"]:
        client.documents(batch)
        for doc in batch["documents"]:
            remote.setdefault("document_hashes", {})[doc["path"]] = doc["sha256"]
        sent = True
    for path in data["deleted_documents"]:
        client.delete_document(path)
        remote.setdefault("document_hashes", {}).pop(path, None)
        sent = True
    return remote, sent


def print_dry_run(ws: Path, cfg: dict, as_json=False, runner=subprocess.run) -> int:
    data = build_sync(ws, cfg, runner=runner)
    output = {key: data[key] for key in ("hello", "snapshot", "decisions", "events", "documents")}
    if as_json:
        print(json.dumps(output, ensure_ascii=False))
    else:
        print("Agent Hub dry run")
        print(f"workspace: {output['hello']['workspace_id']}")
        print(f"snapshot: {'unchanged' if output['snapshot'] is None else 'ready'}")
        print(f"decisions: {sum(len(batch['decisions']) for batch in output['decisions'])}")
        print(f"events: {sum(len(batch['events']) for batch in output['events'])}")
        print(f"documents: {sum(len(batch['documents']) for batch in output['documents'])}")
    return 0


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def write_hint(ws: Path, online: bool) -> None:
    atomic_write(ws / ".orchestrator" / "hub.json", json.dumps(
        {"connector_pid": os.getpid(), "backend": "online" if online else "offline", "heartbeat_at": now()},
        separators=(",", ":")) + "\n")


def log_action(ws: Path, message: str) -> None:
    """Append one redacted log line and rotate the current file at about 1 MB."""
    path = ws / ".orchestrator" / "hub-connector.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 1024 * 1024:
        old = path.with_name(path.name + ".1")
        try:
            old.unlink()
        except FileNotFoundError:
            pass
        os.replace(path, old)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(f"{now()} {scrub(message).replace(chr(10), ' ')[:1000]}\n")


def _state_mtimes(ws: Path) -> tuple:
    result = []
    for path in sorted((ws / ".orchestrator" / "runs").glob("*/state.json")):
        try:
            result.append((str(path), path.stat().st_mtime_ns))
        except OSError:
            continue
    return tuple(result)


def _orchestrator_alive(name: str, runner=subprocess.run) -> bool:
    _, state = _herdr_record(name, runner)
    return state not in ("absent", "unknown")


def _load_hub_log(ws: Path) -> dict[str, dict]:
    records = {}
    try:
        lines = (ws / ".orchestrator" / "hub-log.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return records
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        command_id = entry.get("id") if isinstance(entry, dict) else None
        if not isinstance(command_id, str):
            continue
        if "type" in entry:
            records[command_id] = entry
        elif command_id in records:
            records[command_id].update({key: entry[key] for key in ("status", "reason") if key in entry})
    return records


def _append_hub_log(ws: Path, command: dict, records: dict[str, dict]) -> None:
    entry = {"id": command["id"], "type": command["type"], "by": scrub(command["by"]),
             "body": scrub(command["body"]), "at": now()}
    path = ws / ".orchestrator" / "hub-log.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    records[entry["id"]] = {**entry, "status": "DELIVERED"}


def _update_hub_log(ws: Path, command_id: str, status: str, reason: str | None,
                    records: dict[str, dict]) -> None:
    event = {"id": command_id, "status": status}
    if reason:
        event["reason"] = scrub(reason)
    path = ws / ".orchestrator" / "hub-log.jsonl"
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    records[command_id].update(event)


def _short_reason(error) -> str:
    message = scrub(str(error)).replace("\n", " ").strip()
    return (message or "command delivery failed")[:300]


def _type_hub_notice(name: str, text: str, cfg: dict, runner=subprocess.run) -> tuple[bool, str | None]:
    _, state = _herdr_record(name, runner)
    if state == "blocked":
        return False, "orchestrator is blocked"
    if state not in ("idle", "working"):
        return False, "orchestrator is not live"
    S.Herdr(runner=runner).agent_prompt(name, scrub(text), cfg["herdr"]["prompt_ack_timeout_ms"])
    return True, None


def _answer_notice(scheduler: S.Scheduler, command: dict) -> tuple[dict, str]:
    body = scrub(command["body"])
    run_id, decision_id = command.get("run_id"), command.get("decision_id")
    choice = body.get("choice")
    if not isinstance(run_id, str) or not isinstance(decision_id, str) or not isinstance(choice, str):
        raise ValueError("answer command is missing its run, decision or choice")
    note = body.get("note") if isinstance(body.get("note"), str) else ""
    label = ""
    try:
        decision = scheduler.store.load(run_id).get("decisions", {}).get(decision_id, {})
        option = next((item for item in decision.get("options", [])
                       if item.get("key", "").lower() == choice.lower()), None)
        label = option.get("label", "") if option else ""
    except (S.SchedulerError, AttributeError, TypeError):
        pass
    quote = note if note.strip() else (label or choice)
    result = scheduler.decision_answer(run_id, decision_id, choice, note, channel="hub", by=command["by"],
                                       followup=body.get("followup"), value=body.get("value"), quote=quote)
    text = (f"[hub] {decision_id} answered by {command['by']}: {result['choice']} ({result['label']}). "
            f"It is recorded; carry it out with --decision {decision_id}.")
    return result, scrub(text)


def _command_notice(command: dict) -> str:
    body = scrub(command["body"])
    if command["type"] == "reply":
        decision_id = command.get("decision_id")
        if not isinstance(decision_id, str) or not decision_id:
            raise ValueError("reply command is missing its decision id")
        text = body.get("text")
        if not isinstance(text, str) or not text:
            raise ValueError("reply command is missing text")
        return scrub(f'[hub] reply to {decision_id} from {command["by"]}: "{text}"')
    if command["type"] == "prompt":
        text = body.get("text")
        if not isinstance(text, str) or not text:
            raise ValueError("prompt command is missing text")
        return scrub(f"[hub] {text}")
    raise ValueError(f"unsupported command type: {command.get('type')}")


def _ack_command(client: HubClient, command_id: str, status: str, reason: str | None = None) -> None:
    client.ack_command(command_id, status, reason)


def _deliver_command(ws: Path, cfg: dict, name: str, runner, client: HubClient,
                     command: dict, records: dict[str, dict], notice_retries: list[tuple[str, str]]) -> None:
    command_id = command["id"]
    if command_id in records:
        record = records[command_id]
        _ack_command(client, command_id, record.get("status", "DELIVERED"), record.get("reason"))
        return

    if command["type"] == "answer":
        try:
            scheduler = S.Scheduler(ws, cfg=cfg, herdr=S.Herdr(runner=runner))
        except Exception as error:
            _ack_command(client, command_id, "FAILED", _short_reason(error))
            return
        try:
            _, notice = _answer_notice(scheduler, command)
        except S.SchedulerError as error:
            _ack_command(client, command_id, "REJECTED", scrub(str(error))[:2000])
            return
        except Exception as error:
            _ack_command(client, command_id, "FAILED", _short_reason(error))
            return
        try:
            _append_hub_log(ws, command, records)
        except OSError as error:
            log_action(ws, f"hub command log unavailable: {error}")
        try:
            delivered, _ = _type_hub_notice(name, notice, cfg, runner)
            if not delivered:
                notice_retries.append((command_id, notice))
        except Exception as error:
            log_action(ws, f"answer notice will retry locally: {_short_reason(error)}")
            notice_retries.append((command_id, notice))
        _ack_command(client, command_id, "DELIVERED")
        return

    try:
        notice = _command_notice(command)
    except Exception as error:
        _ack_command(client, command_id, "FAILED", _short_reason(error))
        return
    try:
        _, state = _herdr_record(name, runner)
    except Exception as error:
        _ack_command(client, command_id, "FAILED", _short_reason(error))
        return
    if state == "blocked":
        _ack_command(client, command_id, "HELD", "orchestrator is blocked")
        return
    if state not in ("idle", "working"):
        _ack_command(client, command_id, "HELD", "orchestrator is not live")
        return
    try:
        _append_hub_log(ws, command, records)
    except OSError as error:
        _ack_command(client, command_id, "FAILED", _short_reason(error))
        return
    try:
        S.Herdr(runner=runner).agent_prompt(name, notice, cfg["herdr"]["prompt_ack_timeout_ms"])
    except Exception as error:
        reason = _short_reason(error)
        try:
            _update_hub_log(ws, command_id, "FAILED", reason, records)
        except OSError as log_error:
            log_action(ws, f"could not update hub command log: {log_error}")
        _ack_command(client, command_id, "FAILED", reason)
        return
    _ack_command(client, command_id, "DELIVERED")


def _retry_hub_notices(ws: Path, name: str, cfg: dict, runner,
                       notice_retries: list[tuple[str, str]]) -> None:
    remaining = []
    for command_id, notice in notice_retries:
        try:
            delivered, _ = _type_hub_notice(name, notice, cfg, runner)
        except Exception as error:
            log_action(ws, f"answer notice retry failed for {command_id}: {_short_reason(error)}")
            delivered = False
        if not delivered:
            remaining.append((command_id, notice))
    notice_retries[:] = remaining


def _poll_hub_commands(ws: Path, cfg: dict, name: str, runner, client: HubClient,
                       records: dict[str, dict], notice_retries: list[tuple[str, str]], wait: int = 25) -> None:
    commands = sorted(client.commands(wait=wait), key=lambda command: (command["created_at"], command["id"]))
    for command in commands:
        _deliver_command(ws, cfg, name, runner, client, command, records, notice_retries)


def watch(ws: Path, interval=5, no_orchestrator=False, runner=subprocess.run, sleep=time.sleep,
          max_loops=None, clock=time.monotonic) -> int:
    """Run the connector until stopped, the backend is duplicated, or the orchestrator exits."""
    ws = ws.resolve()
    if interval <= 0:
        raise ValueError("watch interval must be greater than zero")
    cfg = load_config(ws)
    hub = config_hub(cfg)
    if not hub.get("enabled"):
        print("hub is disabled; run `agentctl enable` first", file=sys.stderr)
        return 1
    hello = make_hello(ws, cfg, new_id("ses_"))
    session_id = hello["session_id"]
    client = None
    try:
        key = read_key()
    except RuntimeError as e:
        key = None
        log_action(ws, str(e))
    pidfile = ws / ".orchestrator" / "hub-connector.pid"
    try:
        existing = int(pidfile.read_text().strip())
    except (OSError, ValueError):
        existing = None
    if existing and existing != os.getpid() and pid_alive(existing):
        print(f"hub connector already running as pid {existing}", file=sys.stderr)
        return 1
    atomic_write(pidfile, f"{os.getpid()}\n")
    write_hint(ws, False)
    original_handlers = {}
    stop = {"value": False}

    def request_stop(signum, frame):
        stop["value"] = True

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            original_handlers[sig] = signal.signal(sig, request_stop)
        except (ValueError, OSError):
            pass
    remote = {"event_cursors": {}, "decision_hashes": {}, "document_hashes": {}, "snapshot_hash": None}
    connected = False
    backoff, loops, gone_count = 1, 0, 0
    last_send, last_check, last_mtimes = clock(), 0.0, None
    reason = "signal"
    orch_name = kitstart.agent_name(S.project_root_for(ws, cfg).name)
    command_records = _load_hub_log(ws)
    notice_retries = []
    log_action(ws, "connector started")

    def connect_and_sync():
        nonlocal client, connected, remote, backoff, last_send, last_check, key
        if key is None:
            try:
                key = read_key()
            except RuntimeError as error:
                raise RuntimeError("connector key unavailable") from error
        client = HubClient(hub.get("url", "http://127.0.0.1:7420"), key, hello["workspace_id"])
        response = client.hello(hello)
        remote = {"event_cursors": response["event_cursors"], "decision_hashes": response["decision_hashes"],
                  "document_hashes": response["document_hashes"], "snapshot_hash": response["snapshot_hash"]}
        connected = True
        data = build_sync(ws, cfg, session_id, runner, remote)
        remote, sent = apply_sync(client, data, remote)
        last_send = clock()
        last_check = clock()
        backoff = 1
        log_action(ws, "hello and sync complete")

    try:
        try:
            connect_and_sync()
        except DuplicateWorkspace as e:
            reason = "manual"
            print(f"workspace id is already online ({e.message}); run `agentctl reset-id`", file=sys.stderr)
            log_action(ws, "duplicate workspace id; reset-id required")
            return 2
        except Exception as e:
            connected = False
            log_action(ws, f"backend offline: {e}")
            write_hint(ws, False)
            sleep(backoff)
            backoff = min(backoff * 2, 60)
        write_hint(ws, connected)
        while not stop["value"] and (max_loops is None or loops < max_loops):
            loops += 1
            mtimes = _state_mtimes(ws)
            now_mono = clock()
            changed = last_mtimes is None or mtimes != last_mtimes
            due = now_mono - last_check >= max(interval, 0)
            last_mtimes = mtimes
            if not no_orchestrator:
                if _orchestrator_alive(orch_name, runner):
                    gone_count = 0
                else:
                    gone_count += 1
                    if gone_count >= 2:
                        reason = "orchestrator_gone"
                        break
            if not connected:
                try:
                    connect_and_sync()
                except DuplicateWorkspace as e:
                    reason = "manual"
                    print(f"workspace id is already online ({e.message}); run `agentctl reset-id`", file=sys.stderr)
                    log_action(ws, "duplicate workspace id; reset-id required")
                    return 2
                except Exception as e:
                    log_action(ws, f"backend offline: {e}")
                    write_hint(ws, False)
                    sleep(backoff)
                    backoff = min(backoff * 2, 60)
                    continue
            elif changed or due:
                try:
                    data = build_sync(ws, cfg, session_id, runner, remote)
                    remote, sent = apply_sync(client, data, remote)
                    if sent:
                        last_send = clock()
                        log_action(ws, "sync sent")
                    last_check = clock()
                except Exception as e:
                    connected = False
                    log_action(ws, f"backend offline: {e}")
                    write_hint(ws, False)
                    sleep(backoff)
                    backoff = min(backoff * 2, 60)
            if connected and clock() - last_send >= 30:
                try:
                    client.heartbeat()
                    last_send = clock()
                    log_action(ws, "heartbeat")
                except Exception as e:
                    connected = False
                    log_action(ws, f"backend offline: {e}")
                    write_hint(ws, False)
                    sleep(backoff)
                    backoff = min(backoff * 2, 60)
            if connected:
                _retry_hub_notices(ws, orch_name, cfg, runner, notice_retries)
                try:
                    # Hold the long-poll only for one sync interval so snapshots keep their cadence.
                    _poll_hub_commands(ws, cfg, orch_name, runner, client, command_records, notice_retries,
                                       wait=max(1, min(25, int(interval))))
                except Exception as e:
                    connected = False
                    log_action(ws, f"command poll failed: {e}")
                    write_hint(ws, False)
                    sleep(backoff)
                    backoff = min(backoff * 2, 60)
            write_hint(ws, connected)
            if max_loops is None or loops < max_loops:
                sleep(min(max(interval, 0.1), 0.5) if not changed and not due else 0)
        if not stop["value"] and reason != "orchestrator_gone":
            reason = "manual"
        return 0
    finally:
        if connected and client:
            try:
                client.goodbye(session_id, reason)
                log_action(ws, f"goodbye: {reason}")
            except Exception as e:
                log_action(ws, f"goodbye failed: {e}")
        try:
            if pidfile.read_text().strip() == str(os.getpid()):
                pidfile.unlink()
        except OSError:
            pass
        write_hint(ws, False)
        for sig, handler in original_handlers.items():
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                pass


def command_enable(ws: Path, url: str | None) -> int:
    cfg = load_config(ws)
    hub = config_hub(cfg)
    hub["enabled"] = True
    hub["url"] = url or hub.get("url") or "http://127.0.0.1:7420"
    if not hub.get("workspace_id"):
        hub["workspace_id"] = new_id("ws_")
    hub.setdefault("upload", {"documents": True, "diffs": True, "orchestrator_screen": True})
    hub.setdefault("screen_lines", 40)
    cfg["hub"] = hub
    save_config(ws, cfg)
    try:
        key = read_key()
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
    try:
        ping(hub["url"], key)
    except Exception as e:
        print(f"Agent Hub backend check failed at {hub['url']}: {e}", file=sys.stderr)
        return 1
    print(f"hub enabled for {hub['workspace_id']} ({display_url(hub['url'])})")
    return 0


def command_status(ws: Path) -> int:
    cfg = load_config(ws)
    hub = config_hub(cfg)
    pidfile = ws / ".orchestrator" / "hub-connector.pid"
    try:
        pid = int(pidfile.read_text().strip())
    except (OSError, ValueError):
        pid = None
    hint_path = ws / ".orchestrator" / "hub.json"
    try:
        hint = json.loads(hint_path.read_text())
    except (OSError, ValueError):
        hint = None
    try:
        response = ping(hub.get("url", "http://127.0.0.1:7420"), read_key(), timeout=3)
        backend = f"online ({response.get('version', 'unknown')})"
    except Exception as e:
        backend = f"offline ({e})"
    logpath = ws / ".orchestrator" / "hub-connector.log"
    try:
        tail = logpath.read_text(errors="replace").splitlines()[-10:]
    except OSError:
        tail = []
    print(json.dumps({"enabled": bool(hub.get("enabled")), "url": display_url(hub.get("url", "")),
                      "workspace_id": hub.get("workspace_id"), "backend": backend,
                      "pid": pid, "pid_alive": bool(pid and pid_alive(pid)), "last_hint": hint, "log_tail": tail},
                     ensure_ascii=False, indent=2))
    return 0


def command_stop(ws: Path) -> int:
    pidfile = ws / ".orchestrator" / "hub-connector.pid"
    try:
        pid = int(pidfile.read_text().strip())
    except (OSError, ValueError):
        print("hub connector is not running")
        return 0
    if not pid_alive(pid):
        print("hub connector pid is stale")
        return 0
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as e:
        print(f"could not stop hub connector pid {pid}: {e}", file=sys.stderr)
        return 1
    print(f"sent SIGTERM to hub connector pid {pid}")
    return 0


def command_reset_id(ws: Path) -> int:
    cfg = load_config(ws)
    hub = config_hub(cfg)
    hub["workspace_id"] = new_id("ws_")
    cfg["hub"] = hub
    save_config(ws, cfg)
    print(f"new workspace id: {hub['workspace_id']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agentctl.py", description=__doc__)
    parser.add_argument("--workspace-root", type=Path, help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="command", required=True)
    enable = sub.add_parser("enable", help="enable the Agent Hub connector")
    enable.add_argument("--url")
    sync = sub.add_parser("sync", help="preview a sync without network access")
    sync.add_argument("--dry-run", action="store_true", required=True)
    sync.add_argument("--json", action="store_true")
    watch_parser = sub.add_parser("watch", help="run the background connector")
    watch_parser.add_argument("--interval", type=float, default=5)
    watch_parser.add_argument("--no-orchestrator", action="store_true")
    sub.add_parser("status", help="show connector status")
    sub.add_parser("stop", help="stop the connector")
    sub.add_parser("reset-id", help="assign a new workspace id")
    return parser


def main(argv=None, workspace_root: Path | None = None, runner=subprocess.run, sleep=time.sleep) -> int:
    args = build_parser().parse_args(argv)
    ws = (workspace_root or args.workspace_root or default_workspace()).resolve()
    try:
        if args.command == "enable":
            return command_enable(ws, args.url)
        if args.command == "sync":
            return print_dry_run(ws, load_config(ws), args.json, runner)
        if args.command == "watch":
            return watch(ws, args.interval, args.no_orchestrator, runner, sleep)
        if args.command == "status":
            return command_status(ws)
        if args.command == "stop":
            return command_stop(ws)
        if args.command == "reset-id":
            return command_reset_id(ws)
    except (S.SchedulerError, OSError, ValueError, HubError, RuntimeError) as e:
        print(f"agentctl: {e}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
