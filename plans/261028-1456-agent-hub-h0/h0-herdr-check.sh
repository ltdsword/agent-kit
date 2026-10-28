#!/usr/bin/env bash
# H0 check for the Agent Hub (.agent-system/docs/DECISION-HUB-PLAN.md, section 16):
# can a separate local process (the future connector) see and drive a Claude Code session
# through Herdr on this machine, under the Claude Team policy (Remote Control disabled)?
#
# Safe by design: it starts its OWN throwaway Claude session (Haiku, default permission mode) in a
# new Herdr workspace "hub-h0", never touches your other agents, and closes the workspace at the end.
# It costs a few cheap Haiku turns. Run it from a terminal inside Herdr:
#   bash plans/261028-1456-agent-hub-h0/h0-herdr-check.sh [--keep]
set -uo pipefail

NAME=hub-h0
MODEL=${H0_MODEL:-claude-haiku-5-5}
CWD=${H0_CWD:-$(cd "$(dirname "$0")/../.." && pwd)}  # a folder Claude already trusts (this repo)
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
pass=0; fail=0; WS=""

ok()   { echo "PASS  $*"; pass=$((pass + 1)); }
bad()  { echo "FAIL  $*"; fail=$((fail + 1)); }
info() { echo "      $*"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
state() { herdr agent get "$NAME" 2>/dev/null | json "d['result']['agent']['agent_status'] if 'agent' in d['result'] else d['result'].get('agent_status')" 2>/dev/null; }
screen_has() { herdr agent read "$NAME" --source recent --lines 200 2>/dev/null | grep -q "$1"; }
cleanup() { [ $KEEP -eq 0 ] && [ -n "$WS" ] && herdr workspace close "$WS" >/dev/null 2>&1; }
trap cleanup EXIT

echo "== T0 environment"
[ "${HERDR_ENV:-}" = "1" ] && ok "running inside Herdr" || { bad "not inside Herdr (HERDR_ENV != 1)"; exit 1; }
herdr status server >/dev/null 2>&1 && ok "herdr server running ($(herdr --version))" || { bad "herdr server not running"; exit 1; }
command -v claude >/dev/null && ok "claude $(claude --version 2>/dev/null | head -1)" || { bad "claude not found"; exit 1; }
if [ -f ~/.claude/policy-limits.json ]; then
  info "org policy: $(python3 -c "import json; r=json.load(open('$HOME/.claude/policy-limits.json'))['restrictions']; print(', '.join(f'{k}={v.get(\"allowed\")}' for k,v in r.items()))")"
fi
env | grep -qi '^http_proxy=' && info "http_proxy is set: the connector must bypass it for 127.0.0.1" || true
herdr agent get "$NAME" >/dev/null 2>&1 && { bad "an agent named $NAME already exists; close it first"; exit 1; }

echo "== T1 start a throwaway Claude session ($MODEL) in Herdr workspace '$NAME'"
r=$(herdr workspace create --cwd "$CWD" --label "$NAME" --no-focus) || { bad "workspace create: $r"; exit 1; }
WS=$(echo "$r" | json "(lambda w: w if isinstance(w,str) else (w.get('workspace_id') or w.get('id')))(d.get('result',d)['workspace'])")
PANE=$(echo "$r" | json "(lambda p: p if isinstance(p,str) else (p.get('pane_id') or p.get('id')))(d.get('result',d)['root_pane'])")
if herdr agent start "$NAME" --kind claude --pane "$PANE" --timeout 120000 -- --model "$MODEL" --permission-mode default >/dev/null; then
  ok "Claude started and is ready for input (workspace $WS, pane $PANE)"
else
  bad "Claude did not become ready (trust dialog? login? policy?). Look at the '$NAME' workspace in Herdr."; KEEP=1; exit 1
fi

echo "== T2 read state and screen (what the connector's snapshot needs)"
s=$(state); [ -n "$s" ] && ok "agent state readable: $s" || bad "agent state not readable"
herdr agent read "$NAME" --source visible --lines 10 >/dev/null 2>&1 && ok "screen readable" || bad "screen not readable"

echo "== T3 prompt an IDLE session (hub prompt / answer notice)"
herdr agent prompt "$NAME" "[hub] Reply with exactly the word PONGONE and nothing else. Do not use tools." \
  --wait --until idle --until done --timeout 120000 >/dev/null 2>&1
sleep 2
screen_has PONGONE && ok "prompt delivered and answered" || bad "no PONGONE on screen"

echo "== T4 prompt a WORKING session (is typed input queued?)"
herdr agent prompt "$NAME" "[hub] Write the numbers 1 to 150, one per line, as plain text. Do not use tools." \
  --wait --until working --timeout 30000 >/dev/null 2>&1
s=$(state)
if [ "$s" = "working" ]; then
  if herdr agent prompt "$NAME" "[hub] Reply with exactly the word PONGTWO and nothing else." >/dev/null 2>&1; then
    herdr agent wait "$NAME" --until idle --until done --timeout 180000 >/dev/null 2>&1
    sleep 5; herdr agent wait "$NAME" --until idle --until done --timeout 120000 >/dev/null 2>&1; sleep 2
    screen_has PONGTWO && ok "input typed while working was queued and answered" \
                       || bad "PONGTWO missing: input typed during a turn was lost (connector must wait for idle)"
  else
    bad "herdr refused a prompt while working"
  fi
else
  info "SKIP: the session finished before the second prompt (state: $s); rerun or use a longer task"
fi

echo "== T5 prompt while a DIALOG is open (permission prompt => Herdr 'blocked')"
herdr agent prompt "$NAME" "[hub] Use the Bash tool to run exactly: touch /tmp/hub-h0-check" \
  --wait --until blocked --until idle --timeout 120000 >/dev/null 2>&1
s=$(state)
if [ "$s" = "blocked" ]; then
  ok "permission dialog detected as blocked"
  out=$(herdr agent prompt "$NAME" "[hub] this must be rejected" 2>&1)
  echo "$out" | grep -q agent_blocked && ok "herdr rejected the prompt with agent_blocked (connector => HELD)" \
                                      || bad "prompt into an open dialog was not rejected: $out"
  herdr agent send-keys "$NAME" esc >/dev/null 2>&1
  herdr agent wait "$NAME" --until idle --until done --timeout 60000 >/dev/null 2>&1
  s=$(state); [ "$s" != "blocked" ] && ok "dialog dismissed with Esc, state now $s" || bad "still blocked after Esc"
else
  info "SKIP: no permission dialog appeared (state: $s); your settings may allow the command"
fi
rm -f /tmp/hub-h0-check

echo
echo "Result: $pass passed, $fail failed. Workspace '$NAME' $([ $KEEP -eq 1 ] && echo kept || echo closed)."
[ $fail -eq 0 ]
