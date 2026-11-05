# hcnext: use the Herdr app's new features (events, alerts, Codex startup, artifacts)

## Why / user decisions
- Research `plans/reports/research-261105-0833-herdr-app-evolution.md`; user chose option B (Tier 1 + artifacts),
  05/11/26: "yes, plan it with option B". Tasks-panel mirror and herdr-secret are out of scope.
- Change vs option B, from probes: hc templates do NOT get past Codex startup dialogs (probe: template launch
  returned `first_message.sent: false`, "it never reported its status, so it may be showing a dialog"), and they
  are global per machine while worker models are per workspace. Replaced by direct Codex startup handling.
- Hard constraints: hub protocol, backend, proxy and website unchanged; old herdr (legacy) keeps working
  unchanged; every new feature is best effort and never fails a scheduler command.

## Verified facts (Opus probes, 05/11/26, hc 0.1.18, herdr-app 0.1.13)
- `hc events --json`: first line is a snapshot `{"channel":null,"seq":N,"terminals":[<full get records>]}`;
  then one JSON-RPC line per change:
  `{"jsonrpc":"2.0","method":"event","params":{"data":{...},"seq":172,"terminal":"t13","type":"foreground"}}`.
  Seen types: (created: params has `data` = full record and no `type`/`terminal` in the first 600 chars ->
  treat any line as a wake-up), `foreground`, `finished` (`data.exit_code`, `reason`), `removed`. Status
  changes also emit events. `--label K=V` filters (repeatable), `--terminal T` filters one.
- `herdr-task alert "<title>" --body "<why>" --folder <repo> --json` works in a folder with no Herdr tasks:
  exit 0, prints `{"id","at","title","body"}`; shows a toast + sound in the app.
- `herdr-artifact publish <dir> --title T --folder <repo> --json` -> checks the mod (light/dark/320 px) and
  prints its id (`agent-kit-probe-5bbf`); `update <id> <dir> --note N`; `rm <id>`; `list`. Allowed files:
  .js .json .svg .png .jpg .gif .webp .md .txt .csv .ttf .otf, <= 4 MB. Publish writes `./artifact.js`
  (`reply(text)`, `title`, `version`, `id`, `asset()`); `reply` goes to the terminal in `HC_TERMINAL_ID` at
  publish time, arriving as `<hc from="artifact" id=… version=… title=…>text</hc>`. The panel reads data with
  `readTextFile(absPath)` inside `cx.spawn`; colors only from `theme()`; no setTimeout (use `cx.timer.every`).
  API truth: `~/.config/herdr-app/AGENTS.md`, `gpui-kit.d.ts`, `herdr.d.ts`. `herdr-app check <dir>` validates.
- Codex 0.165 startup dialogs, in order: "Update available" (keys: esc = skip), "Trust this folder?" (already
  handled by `worker.trust_worktree` -c overrides), "Hooks need review" (option "Continue without trusting";
  user hooks in `~/.codex/hooks.json`). Config key `check_for_update_on_startup` exists in the binary.
- `.orchestrator/` is gitignored; `RunStore.save` (scheduler.py ~626) writes state.json atomically.

## Contracts

### C1 Codex startup (scheduler.py)
- `codex_args` adds `-c check_for_update_on_startup=false` (always).
- `Hc.agent_start` readiness loop: while not reported, every ~2 s read the visible screen (`agent_read(name, 40)`);
  if it contains "Hooks need review" and "Continue without trusting": press the keys that select that option
  (move to the line, then enter; compute from the numbered options on screen, never "trust"), once per dialog;
  if it contains "Update available" and "Skip": `hc keys <t> esc` once. Never answer "Trust this folder?"
  (trust is config, the person decides). Log each auto-answer in the returned record as `auto_answered: [..]`.
  `Hc.keys(name, *keys)` helper via `hc keys`. Legacy unchanged.

### C2 Event-aware wait (scheduler.py)
- `Hc.wait_change(addresses: set[str], timeout_s: float) -> bool`: run `hc events --json` (Popen, stdout pipe,
  injectable `popen`), skip the first snapshot line, return True on the first event whose `params.terminal`
  is in `addresses` (or any line with an address we watch in `data.address`), False at timeout; always kill the
  child process; on any error fall back to `sleep(timeout_s)` and return False. `Herdr.wait_change` = sleep.
- `Scheduler.wait`: replace `sleep(interval_s)` with `herdr.wait_change(addrs, interval_s)` where addrs are the
  running workers' pane_ids (from `agent_record`); fake-sleep tests keep working (inject).
- Workers launched by `Hc.agent_start` also get labels `agentkit.run=<run>` and `agentkit.slot=<wid>`
  (signature: optional `labels: dict | None = None`).

### C3 Local alerts (scheduler.py)
- `local_alert(project_root, cfg, title, body)`: only when `cfg["herdr"].get("alerts", True)`, `HC_TERMINAL_ID`
  is set and `herdr-task` is on PATH; runs `herdr-task alert <title> --body <body> --folder <root> --json`,
  timeout 5 s, ignores every failure; never prints secrets (titles are fixed strings + ids).
- Call sites: `decision_ask` ("Decision <id> needs you", body = title), `wait` returning blocked
  ("Worker <agent> is waiting for approval"), `report` when the run is DONE ("Run <id> is ready to finish").
- `validate_config`: `herdr.alerts` and `herdr.artifacts`, when present, must be bool. Missing = true.

### C4 Artifacts (new `.agent-system/artifacts.py` + `.agent-system/artifacts/{board,decision}/main.js`)
- `board_data(state) -> dict`: `{run_id, title, status, updated_at, tasks:[{id,title,status,worker,verdict}],
  decisions:[{id,kind,title,question,options:[{key,label}],recommend,followup,answer}]}` (answer = choice/
  followup value or null). Only titles/questions/options: no packet bodies, no paths outside the repo, no env.
- `write_board(store, state)`: writes `.orchestrator/runs/<run>/board.json` atomically; called from
  `RunStore.save` (best effort, never raises).
- `enabled(cfg, env)`: `herdr.artifacts` true (default), `HC_TERMINAL_ID` set, `herdr-artifact` on PATH.
- `publish_board(...)`/`publish_decision(...)`: copy the shipped JS dir to `.orchestrator/runs/<run>/artifacts/
  <board|D3>/`, write `data.js` = `export const DATA = "<abs board.json>"; export const DECISION = "<id or ''>";
  export const RUN = "<run>";`, then `herdr-artifact publish <dir> --title "<run>: board" | "<run> <id>: <title>"
  --folder <project_root> --json`; store the id in state (`state["artifacts"]["board"]`,
  `decisions[id]["artifact_id"]`). Board published at `run create`; decision card at `decision ask`.
  Failure -> one log line, command continues.
- Board panel: summary line (status, n tasks by status), task rows (id, title, status colored with
  `working/blocked/done` theme colors), pending decisions list. Refresh: `cx.timer.every` 5 s re-read.
- Decision panel: question, options as buttons (recommended marked), then followup options as buttons when
  the choice is in `followup.when` (input options say "type it in chat"). Click -> `reply("decision <id> (run
  <run>): <choice>[, followup <key>=<value>]")`. Once `answer` is set in board.json, show "Answered: ..." and
  no buttons. Missing/invalid board.json -> "Waiting for data".
- ORCHESTRATOR.section.md: an `<hc from="artifact" ...>decision D3 (run X): B...</hc>` message is the person's
  answer: record it with `decision record --quote "<text verbatim>" --note "answered in the Herdr app card"`.

## Tasks
- T1 scheduler: C1 + C2 + C3 (+ tests). Owns scheduler.py, test_hc_adapter.py, test_scheduler.py.
- T2 artifacts: C4 (+ tests, `herdr-app check` of both panels). Depends on T1. Owns artifacts.py, artifacts/**,
  scheduler.py (call sites only), test_artifacts.py.
- T3 docs: README, GUIDE, .agent-system/README.md (config rows `herdr.alerts`, `herdr.artifacts`), ORCHESTRATOR
  section (artifact replies). Depends on T1, T2.

## Live checks (Opus, after integrate)
- Dispatch a tiny smoke task live with `--launch herdr`: Codex starts with no manual keys; wait returns on the
  event, not after 10 s; a decision ask shows a toast and a card; clicking a button reaches Opus; board updates.

## Unresolved
- Hooks dialog keys depend on Codex's option order; T1 computes them from the screen text, tested on a
  recorded screen sample; live check confirms.
