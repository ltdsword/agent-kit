#!/usr/bin/env bash
# Tooling / model / integration compatibility report for the orchestration scaffold.
# Read-only: prints versions and runs `scheduler.py doctor`. Never installs or logs in.
#   doctor.sh [--probe-codex]
#   --probe-codex : one tiny live `codex exec` with the configured worker model/effort (read-only
#                   sandbox, empty temp dir) to prove the account can use them (Codex workers only).
set -uo pipefail
PROBE=0
[ "${1:-}" = "--probe-codex" ] && PROBE=1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # workspace: holds .agent-system/
# The git repo is config project.path (workspace mode) or ROOT itself (in-repo mode).
PROJECT="$(cd "$ROOT" && python3 -c 'import json, os
p = json.load(open(".agent-system/config.json")).get("project", {}).get("path")
print(os.path.realpath(os.path.expanduser(p)) if p else os.getcwd())' 2>/dev/null || echo "$ROOT")"

echo "== workspace: $ROOT"
echo "== repository: $PROJECT"
git -C "$PROJECT" rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's/^/   branch: /'
git -C "$PROJECT" status --porcelain 2>/dev/null | head -5 | sed 's/^/   dirty: /'

echo "== tool versions"
for t in git python3 herdr claude codex jq; do
  if command -v "$t" >/dev/null; then
    printf '   %-8s %s\n' "$t" "$("$t" --version 2>&1 | head -1)"
  else
    printf '   %-8s MISSING\n' "$t"
  fi
done

echo "== herdr"
echo "   HERDR_ENV=${HERDR_ENV:-<unset>}"
if command -v herdr >/dev/null; then
  herdr integration status 2>/dev/null | grep -E '^(claude|codex)' | sed 's/^/   integration /'
  herdr status 2>/dev/null | awk '/^server:/{f=1} f&&/status:/{print "   server " $0; exit}'
fi

echo "== codex"
command -v codex >/dev/null && codex login status 2>&1 | head -1 | sed 's/^/   auth: /'
if command -v codex >/dev/null && [ "$(uname -s)" = "Linux" ]; then
  # Workers run every command through Codex's bubblewrap sandbox; it must be able to start.
  sb="$(cd /tmp && timeout 30 codex sandbox -- sh -c 'echo sandbox-ok' 2>&1 | tail -1)"
  if [ "$sb" = "sandbox-ok" ]; then
    echo "   sandbox: OK"
  else
    echo "   sandbox: FAIL: $sb"
    echo "   remedy: see GUIDE.md Part 2 step 2 (AppArmor profile for bwrap); never use danger-full-access."
  fi
fi

read -r WKIND WMODEL WEFFORT < <(cd "$ROOT" && python3 -c 'import json
w = json.load(open(".agent-system/config.json"))["worker"]
print(w.get("kind", "codex"), w["model"], w.get("reasoning_effort") or "medium")' 2>/dev/null || echo "codex ? ?")

if [ $PROBE -eq 1 ] && [ "$WKIND" != codex ]; then
  echo "== codex live probe skipped: the worker program is $WKIND"
elif [ $PROBE -eq 1 ]; then
  echo "== codex live probe ($WMODEL / $WEFFORT)"
  TMPD="$(mktemp -d)"
  out="$(cd "$TMPD" && timeout 240 codex exec --profile worker -m "$WMODEL" -c "model_reasoning_effort=\"$WEFFORT\"" \
        -s read-only --skip-git-repo-check --json "Reply with exactly: OK" </dev/null 2>/dev/null)"
  rm -rf "$TMPD"
  if printf '%s' "$out" | grep -q '"type":"turn.completed"'; then
    echo "   PASS: $WMODEL/$WEFFORT request completed"
  else
    # The error message is itself JSON inside the event; unwrap it when jq is available.
    msg="$(printf '%s\n' "$out" | jq -r 'select(.type=="turn.failed" or .type=="error")
           | (.error.message // .message) | (fromjson? | .error.message) // .' 2>/dev/null | tail -1)"
    echo "   FAIL: ${msg:-no completed turn (timeout or auth)}"
    echo "   remedy: update the client first (\`codex update\`; older clients reject newer models with a"
    echo "           'not supported ... ChatGPT account' error), check \`codex login status\`, or pick"
    echo "           another model with \`agent-kit config --model-worker=...\`."
  fi
fi

echo "== scheduler doctor"
python3 "$ROOT/.agent-system/scheduler.py" --workspace-root "$ROOT" doctor
