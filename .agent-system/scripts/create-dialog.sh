#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s --cwd D --name N --location L [--repo R]...\n' "$0" >&2
}

cwd=""
name=""
location=""
has_cwd=0
has_name=0
has_location=0
repos=()
while (($#)); do
  case "$1" in
    --cwd)
      (($# >= 2)) || { usage; exit 2; }
      cwd="$2"
      has_cwd=1
      shift 2
      ;;
    --name)
      (($# >= 2)) || { usage; exit 2; }
      name="$2"
      has_name=1
      shift 2
      ;;
    --location)
      (($# >= 2)) || { usage; exit 2; }
      location="$2"
      has_location=1
      shift 2
      ;;
    --repo)
      (($# >= 2)) || { usage; exit 2; }
      repos+=("$2")
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if (( ! has_cwd || ! has_name || ! has_location )); then
  usage
  exit 2
fi

if ! command -v herdr-app >/dev/null 2>&1 || [[ -z "${HC_TERMINAL_ID:-}" ]]; then
  exit 2
fi
if ! herdr-app status >/dev/null 2>&1; then
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mod_source="$(cd -- "$script_dir/../herdr-mods/agent-kit-create" && pwd)"
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mod_dir="$app_home/mods/agent-kit-create"
data_dir="$app_home/data/agent-kit-create"
request_file="$data_dir/request.json"
response_file="$data_dir/response.json"
temporary_files=()

cleanup() {
  local temporary
  for temporary in "${temporary_files[@]}"; do
    rm -f -- "$temporary"
  done
  rm -f -- "$request_file" "$response_file"
}
trap cleanup EXIT

mkdir -p -- "$mod_dir" "$data_dir"
for file in mod.json main.js; do
  source_file="$mod_source/$file"
  target_file="$mod_dir/$file"
  if ! cmp -s -- "$source_file" "$target_file"; then
    temporary="$target_file.tmp.$$"
    temporary_files+=("$temporary")
    cp -- "$source_file" "$temporary"
    mv -f -- "$temporary" "$target_file"
  fi
done

rm -f -- "$response_file"
request_id="$(python3 - "$data_dir" "$cwd" "$name" "$location" "${repos[@]}" <<'PY'
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

directory = Path(sys.argv[1])
request = {
    "id": secrets.token_hex(16),
    "cwd": sys.argv[2],
    "name": sys.argv[3],
    "location": sys.argv[4],
    "repos": sys.argv[5:],
    "at": datetime.now(timezone.utc).isoformat(),
}
(directory / "request.json").write_text(json.dumps(request), encoding="utf-8")
print(request["id"])
PY
)"

if ! herdr-app do mod.open --name agent-kit-create >/dev/null; then
  printf 'Could not open the agent-kit create dialog in Herdr.\n' >&2
  exit 2
fi

python3 - "$response_file" "$request_id" <<'PY'
import json
import os
import sys
import time
from pathlib import Path

response_file = Path(sys.argv[1])
request_id = sys.argv[2]
timeout = float(os.environ.get("AGENT_KIT_DIALOG_TIMEOUT", "900"))
deadline = time.monotonic() + max(0, timeout)

while time.monotonic() <= deadline:
    try:
        response = json.loads(response_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        response = None
    if isinstance(response, dict) and response.get("id") == request_id:
        if response.get("ok") is True:
            result = {
                "name": response.get("name", ""),
                "location": response.get("location", ""),
                "repos": response.get("repos", []),
            }
            print(json.dumps(result))
            raise SystemExit(0)
        if response.get("ok") is False:
            print("Workspace creation dialog cancelled.", file=sys.stderr)
            raise SystemExit(1)
    time.sleep(0.3)

if timeout >= 900:
    print("No answer in 15 minutes; the workspace dialog timed out.", file=sys.stderr)
else:
    print(f"No answer after {timeout:g} seconds; the workspace dialog timed out.", file=sys.stderr)
raise SystemExit(1)
PY
