#!/usr/bin/env python3
"""Account, computer and local service commands for Agent Hub (stdlib only)."""
from __future__ import annotations

import argparse
import getpass
import ipaddress
import json
import os
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agentctl  # noqa: E402
import hubschema  # noqa: E402


class HubCtlError(Exception):
    """Expected command failure with safe, user-facing text."""


def config_dir() -> Path:
    return Path(os.environ.get("AGENT_HUB_CONFIG", "~/.config/agent-hub")).expanduser()


def data_dir() -> Path:
    return Path(os.environ.get("AGENT_HUB_DATA", "~/.local/share/agent-hub")).expanduser()


def computer_path() -> Path:
    raw = os.environ.get("AGENT_HUB_COMPUTER")
    return Path(raw).expanduser() if raw else config_dir() / "computer.json"


def admin_config() -> dict:
    path = config_dir() / "admin.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise HubCtlError(f"missing admin config: {path}") from error
    except (OSError, ValueError) as error:
        raise HubCtlError(f"could not read admin config: {path}") from error
    if not isinstance(value, dict) or not isinstance(value.get("proxy_url"), str) or not value["proxy_url"].strip():
        raise HubCtlError(f"admin config must contain proxy_url: {path}")
    return value


def read_admin_key() -> str:
    path = config_dir() / "admin.key"
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
        key = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as error:
        raise HubCtlError("run this on the admin computer (agent-kit proxy-setup creates the key)") from error
    except OSError as error:
        raise HubCtlError(f"could not read admin key: {path}") from error
    if mode & 0o077:
        raise HubCtlError("admin.key must have mode 0600; group/world access is forbidden")
    if not key:
        raise HubCtlError("admin.key is empty")
    return key


def _loopback_url(url: str) -> bool:
    try:
        host = urllib.parse.urlsplit(url).hostname
    except ValueError:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except (ValueError, TypeError):
        return False


def request_json(url: str, method: str, body: dict | None = None, key: str | None = None) -> dict:
    # Cloudflare bot protection rejects the default Python-urllib User-Agent (error 1010).
    headers = {"Accept": "application/json", "User-Agent": "agent-kit/2"}
    raw = None
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(url, data=raw, headers=headers, method=method)
    opener = (urllib.request.build_opener(urllib.request.ProxyHandler({})) if _loopback_url(url)
              else urllib.request.build_opener())
    try:
        with opener.open(request, timeout=30) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise HubCtlError(f"proxy request failed ({error.code})") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise HubCtlError("proxy request failed: network or TLS error") from None
    try:
        result = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise HubCtlError("proxy returned invalid JSON") from error
    if not isinstance(result, dict):
        raise HubCtlError("proxy returned an invalid response")
    return result


def api_url(proxy_url: str, route: str) -> str:
    return proxy_url.rstrip("/") + "/api/v1/" + route.lstrip("/")


def admin_user(name: str, reset: bool) -> int:
    key = read_admin_key()
    proxy_url = admin_config()["proxy_url"].rstrip("/")
    if reset:
        route = "admin/users/" + urllib.parse.quote(name, safe="") + "/reset-password"
        response = request_json(api_url(proxy_url, route), "POST", key=key)
    else:
        body = {"username": name}
        hubschema.validate("AdminUserRequest", body)
        response = request_json(api_url(proxy_url, "admin/users"), "POST", body, key)
    hubschema.validate("AdminUserResponse", response)
    print(f"username: {response['username']}\npassword: {response['password']}")
    return 0


def atomic_private_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.chmod(temp, 0o600)
        os.replace(temp, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def hub_login(name: str, url: str | None, computer_name: str | None, workspace: Path) -> int:
    if url:
        proxy_url = url.rstrip("/")
    else:
        try:
            proxy_url = admin_config()["proxy_url"].rstrip("/")
        except HubCtlError as error:
            raise HubCtlError("provide --url or set proxy_url in admin.json") from error
    computer_name = (computer_name or socket.gethostname()).strip()[:64]
    if not computer_name:
        raise HubCtlError("computer name cannot be empty")
    password = getpass.getpass(f"Password for {name}: ")
    if not password:
        raise HubCtlError("password cannot be empty")
    registration = {"username": name, "password": password, "name": computer_name}
    hubschema.validate("ComputerRegisterRequest", registration)
    response = request_json(api_url(proxy_url, "computers/register"), "POST", registration)
    hubschema.validate("ComputerRegisterResponse", response)
    saved = {**response, "proxy_url": proxy_url, "name": computer_name}
    atomic_private_json(computer_path(), saved)
    print(f"registered {name} on {computer_name}; saved computer config")
    if (workspace / ".agent-system" / "config.json").is_file():
        code = agentctl.main(["--workspace-root", str(workspace), "enable"], workspace_root=workspace)
        if code:
            raise HubCtlError("registration was saved, but agentctl enable failed")
    return 0


def node24(source: Path) -> Path:
    current = shutil.which("node")
    if current and _node_major(Path(current)) >= 24:
        return Path(current)
    nvm_dir = Path(os.environ.get("NVM_DIR", "~/.nvm")).expanduser()
    nvm = nvm_dir / "nvm.sh"
    if nvm.is_file():
        command = f"source {shlex.quote(str(nvm))} && nvm use --silent 24 >/dev/null && command -v node"
        result = subprocess.run(["bash", "-c", command], capture_output=True, text=True, check=False)
        candidate = result.stdout.strip().splitlines()[-1] if result.returncode == 0 and result.stdout.strip() else ""
        if candidate and _node_major(Path(candidate)) >= 24:
            return Path(candidate)
    raise HubCtlError("Node.js 24 or newer is required; install it or use an installed Node 24 with nvm")


def _node_major(node: Path) -> int:
    try:
        result = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return 0
    if result.returncode:
        return 0
    try:
        return int(result.stdout.strip().lstrip("v").split(".", 1)[0])
    except (ValueError, IndexError):
        return 0


def hub_start(source: Path) -> int:
    directory = data_dir()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    pidfile, logfile = directory / "hub.pid", directory / "hub.log"
    if pidfile.is_file():
        try:
            pid = int(pidfile.read_text().strip())
        except (OSError, ValueError):
            pid = 0
        if agentctl.pid_alive(pid):
            print(f"Agent Hub backend is already running (pid {pid})")
            return 0
    node = node24(source)
    cli = source / "hub" / "server" / "src" / "cli.ts"
    if not cli.is_file():
        raise HubCtlError(f"Agent Hub server CLI is missing: {cli}")
    stream = logfile.open("ab")
    env = {**os.environ, "NODE_USE_SYSTEM_CA": "1"}
    try:
        process = subprocess.Popen([str(node), str(cli), "serve"], cwd=source / "hub", env=env,
                                   stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True, close_fds=True)
    finally:
        stream.close()
    temp = pidfile.with_name(f".{pidfile.name}.{os.getpid()}.tmp")
    temp.write_text(f"{process.pid}\n", encoding="ascii")
    os.chmod(temp, 0o600)
    os.replace(temp, pidfile)
    print(f"started Agent Hub backend (pid {process.pid}); log: {logfile}")
    return 0


def hub_stop() -> int:
    pidfile = data_dir() / "hub.pid"
    try:
        pid = int(pidfile.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        print("Agent Hub backend is not running")
        return 0
    if not agentctl.pid_alive(pid):
        pidfile.unlink(missing_ok=True)
        print("Agent Hub backend pid is stale")
        return 0
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as error:
        raise HubCtlError(f"could not stop Agent Hub backend pid {pid}: {error}") from error
    print(f"sent SIGTERM to Agent Hub backend pid {pid}")
    return 0


def hub_status() -> int:
    directory = data_dir()
    try:
        pid = int((directory / "hub.pid").read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        pid = None
    if pid is not None and not agentctl.pid_alive(pid):
        pid = None
    try:
        response = agentctl.ping("http://127.0.0.1:7420", agentctl.read_key())
        ping = f"online (protocol {response['protocol']})"
    except Exception:
        ping = "offline"
    # The backend writes relay-status.json (transport, connected, owner); never secrets.
    relay = "relay: off (no relay-status.json; run agent-kit hub-login, then hub start)"
    try:
        status = json.loads((directory / "relay-status.json").read_text(encoding="utf-8"))
        state = "connected" if status.get("connected") and pid is not None else "not connected"
        relay = f"relay: {state} via {status.get('transport') or 'none'}, owner {status.get('owner')}"
    except (OSError, ValueError, AttributeError):
        pass
    print(f"pid: {pid if pid is not None else 'stopped'}\nping: {ping}\n{relay}")
    return 0


def proxy_setup(source: Path, rotate_admin_key: bool, origins: str | None) -> int:
    node = node24(source)
    hub = source / "hub"
    env = os.environ.copy()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
                "http_proxy", "https_proxy", "all_proxy", "no_proxy",
                "npm_config_proxy", "npm_config_http_proxy", "npm_config_https_proxy"):
        env.pop(key, None)
    env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    command = ["npm", "run", "setup", "-w", "@agent-hub/proxy"]
    options = []
    if rotate_admin_key:
        options.append("--rotate-admin-key")
    if origins is not None:
        options.extend(["--origins", origins])
    if options:
        command += ["--", *options]
    result = subprocess.run(command, cwd=hub, env=env, check=False)
    return result.returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hubctl.py", description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent.parent,
                        help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("create-user", "reset-password"):
        item = sub.add_parser(command)
        item.add_argument("--name", required=True)
    login = sub.add_parser("hub-login")
    login.add_argument("--name", required=True)
    login.add_argument("--url")
    login.add_argument("--computer-name")
    hub = sub.add_parser("hub")
    hub.add_argument("action", choices=("start", "stop", "status"))
    setup = sub.add_parser("proxy-setup")
    setup.add_argument("--rotate-admin-key", action="store_true")
    setup.add_argument("--origins")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "create-user":
            return admin_user(args.name, False)
        if args.command == "reset-password":
            return admin_user(args.name, True)
        if args.command == "hub-login":
            return hub_login(args.name, args.url, args.computer_name, Path.cwd())
        if args.command == "hub":
            return {"start": lambda: hub_start(args.source), "stop": hub_stop,
                    "status": hub_status}[args.action]()
        if args.command == "proxy-setup":
            return proxy_setup(args.source, args.rotate_admin_key, args.origins)
    except (HubCtlError, OSError, ValueError) as error:
        print(f"agent-kit: {error}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
