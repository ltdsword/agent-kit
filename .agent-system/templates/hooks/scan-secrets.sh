#!/usr/bin/env bash
# agent-kit:scan-secrets-wrapper
set -u

ws="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
config="$ws/.agent-system/config.json"
[ -f "$config" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

script_real="$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || true)"
candidates=()
mapfile -t candidates < <(python3 - "$ws" "$config" 2>/dev/null <<'PY'
import json
import os
import sys

workspace, config_path = sys.argv[1:]
try:
    with open(config_path) as config_file:
        project = json.load(config_file).get("project")
except (OSError, ValueError):
    raise SystemExit(0)

if not isinstance(project, dict):
    raise SystemExit(0)

paths = [project.get("path")]
repos = project.get("repos")
if isinstance(repos, list):
    paths.extend(repos)

seen = set()
for path in paths:
    if not isinstance(path, str) or not path:
        continue
    resolved = os.path.realpath(os.path.join(workspace, path))
    if resolved not in seen:
        seen.add(resolved)
        print(resolved)
PY
)

for r in "${candidates[@]}"; do
  s="$r/.claude/hooks/scan-secrets.sh"
  [ -f "$s" ] || continue
  target_real="$(realpath "$s" 2>/dev/null || true)"
  [ -n "$target_real" ] || continue
  [ "$target_real" != "$script_real" ] || continue
  grep -Fqx '# agent-kit:scan-secrets-wrapper' "$s" 2>/dev/null && continue
  exec bash "$s" "$@"
done

exit 0
