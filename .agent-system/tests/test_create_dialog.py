"""Contract tests for the Herdr-backed create dialog handoff."""
import json
import os
import subprocess
import textwrap
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".agent-system" / "scripts" / "create-dialog.sh"
MOD_SOURCE = ROOT / ".agent-system" / "herdr-mods" / "agent-kit-create"


FAKE_HERDR = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json
    import os
    import subprocess
    import sys
    import time
    from pathlib import Path

    if sys.argv[1:] == ["--respond"]:
        time.sleep(0.05)
        root = Path(os.environ["HERDR_APP_HOME"]) / "data" / "agent-kit-create"
        request = json.loads((root / "request.json").read_text())
        response = json.loads(os.environ["FAKE_HERDR_RESPONSE"])
        response["id"] = request["id"]
        (root / "response.json").write_text(json.dumps(response))
        raise SystemExit(0)

    with open(os.environ["FAKE_HERDR_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps(sys.argv[1:]) + "\\n")
    if sys.argv[1:] == ["status"]:
        raise SystemExit(0)
    if sys.argv[1:] == ["do", "mod.open", "--name", "agent-kit-create"]:
        subprocess.Popen([sys.executable, __file__, "--respond"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        raise SystemExit(0)
    raise SystemExit(2)
    """
)


def safe_path():
    """Keep normal shell tools available without exposing a real herdr-app."""
    return os.pathsep.join(
        directory for directory in os.environ.get("PATH", "").split(os.pathsep)
        if directory and not (Path(directory) / "herdr-app").exists()
    )


def make_environment(tmp_path, *, response=None, with_herdr=True, terminal=True):
    app_home = tmp_path / "herdr-home"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    path = safe_path()
    if with_herdr:
        herdr = bin_dir / "herdr-app"
        herdr.write_text(FAKE_HERDR, encoding="utf-8")
        herdr.chmod(0o755)
        path = str(bin_dir) + os.pathsep + path

    env = dict(os.environ)
    env.update({
        "PATH": path,
        "HERDR_APP_HOME": str(app_home),
        "AGENT_KIT_DIALOG_TIMEOUT": "3",
        "FAKE_HERDR_LOG": str(tmp_path / "herdr-args.jsonl"),
    })
    if response is not None:
        env["FAKE_HERDR_RESPONSE"] = json.dumps(response)
    else:
        env.pop("FAKE_HERDR_RESPONSE", None)
    if terminal:
        env["HC_TERMINAL_ID"] = "test-terminal"
    else:
        env.pop("HC_TERMINAL_ID", None)
    return env, app_home


def invoke(env):
    return subprocess.run(
        [str(SCRIPT), "--cwd", "/work/project", "--name", "demo",
         "--location", "/work", "--repo", "/work/project"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_ok_answer_prints_contract_json_and_installs_mod(tmp_path):
    answer = {"ok": True, "name": "demo", "location": "/work", "repos": ["/work/project"]}
    env, app_home = make_environment(tmp_path, response=answer)

    result = invoke(env)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "name": "demo", "location": "/work", "repos": ["/work/project"]
    }
    installed = app_home / "mods" / "agent-kit-create"
    assert {path.name for path in installed.iterdir()} == {"mod.json", "main.js"}
    for source in MOD_SOURCE.iterdir():
        assert (installed / source.name).read_bytes() == source.read_bytes()
    calls = [json.loads(line) for line in (tmp_path / "herdr-args.jsonl").read_text().splitlines()]
    assert calls == [["status"], ["do", "mod.open", "--name", "agent-kit-create"]]


def test_cancel_answer_exits_one(tmp_path):
    env, _ = make_environment(tmp_path, response={"ok": False})

    result = invoke(env)

    assert result.returncode == 1
    assert "cancel" in result.stderr.lower()
    assert result.stdout == ""


def test_missing_terminal_exits_two_without_touching_app_home(tmp_path):
    env, app_home = make_environment(tmp_path, terminal=False)

    result = invoke(env)

    assert result.returncode == 2
    assert not app_home.exists()


def test_missing_herdr_exits_two(tmp_path):
    env, app_home = make_environment(tmp_path, with_herdr=False)

    result = invoke(env)

    assert result.returncode == 2
    assert not app_home.exists()


def test_identical_mod_is_not_recopied(tmp_path):
    answer = {"ok": True, "name": "demo", "location": "/work", "repos": ["/work/project"]}
    env, app_home = make_environment(tmp_path, response=answer)
    first = invoke(env)
    assert first.returncode == 0, first.stderr
    installed = app_home / "mods" / "agent-kit-create"
    mtimes = {path.name: path.stat().st_mtime_ns for path in installed.iterdir()}

    second = invoke(env)

    assert second.returncode == 0, second.stderr
    assert {path.name: path.stat().st_mtime_ns for path in installed.iterdir()} == mtimes
