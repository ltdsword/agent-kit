# hcport: run agent-kit on the new Herdr app (herdr-core `hc`), keep old herdr as fallback

## Why / user decisions
- The user moved to the new Herdr app; every terminal there is an herdr-core (`hc`) terminal, `HERDR_ENV`
  is unset, `HC_TERMINAL_ID` is set. Old herdr 0.9.5 is installed, its server is not running.
- User (2026-11-04): "conduct the work" after the risk review; questions in chat, not on the phone.
- Hard constraint: the hub protocol, backend, proxy and website stay unchanged (no deploy).

## Verified facts (Opus inline research, 2026-11-04, this machine)
- `hc get <t> --json` keys: address, name, cwd, state (`live`|`finished`), status (null or
  `{"app": "claude-code"|"codex"|..., "state": idle|working|done|blocked|error, "msg"}`), reported (bool),
  labels (dict), foreground ({argv, cwd, name, pid}), argv, exit_code, ... Not found: exit 1 and stdout
  `{"error":{"kind":"not_found",...}}`.
- Codex reports status to hc: idle -> working -> done after a prompt (probe in a scratch dir). Before that
  it can sit at startup dialogs (update / trust folder / hooks review) with no status (`reported: false`).
- `hc run --bg --name N --cwd D --label k=v -- argv...` prints one JSON object (`address`, `name`, ...).
  Default parent = the launching terminal: the child ENDS with the parent's program and hc TYPES NOTES into
  the parent. Kit launches must pass `--no-parent --no-notify`.
- A terminal labeled `herdr.space=<id>` shows in the app; an id the app does not know becomes a new space
  (named after its folder). `herdr-app do space.rename --id <id> --name <n>` names it (needs the app window;
  best effort). A program exiting closes its pane; the last pane closes the space.
- `hc send <t> <text>` pastes + Enter; refuses while blocked unless `--force` (never use --force).
  `hc read --lines N <t>` prints screen + history as text (while working: screen only, marked incomplete).
  `hc ls --json`: live terminals. `hc kill <t>`, `hc rm <t>`. `herdr-app do agent.focus --terminal <addr>`.
- hc keeps no agent chat id; the orchestrator chat id comes from the kit's existing session hooks /
  `.orchestrator/orchestrator.json`.

### Exact output samples (hc 0.1.17; use them in test fakes)
- `hc server status` -> exit 0, stdout `{"core":{"id":"451e...","name":"lap17124-datlt12"},"finished":1,
  "holder":{...},"live":2,"pid":8640,"uptime_ms":445636,"version":"0.1.17"}`. Running = exit 0 and JSON
  with an integer `pid`.
- `hc ls --json` -> `{"hidden_finished":1,"terminals":[{"address":"t2","agent":"claude-code",
  "cwd":"/home/u/Code/agent-kit","state":"live","status":"working","turn":8,"where":"agent-kit / 1"},
  {"address":"t4","agent":"python3","cwd":"/home/u","name":"herdr-automations","state":"live","turn":0}]}`.
  NOTE: in `ls`, `status` is a plain string (absent when none), `agent` is the program, there are NO labels.
  `agent_list()` and `workspace_close()` call `hc get <address> --json` per terminal when they need labels.
- `hc get t2 --json` -> `{"address":"t2","name":null,"cwd":"...","state":"live","status":{"app":"claude-code",
  "msg":"...","state":"working"},"reported":true,"labels":{"herdr.space":"spe86...","herdr.tab":"tbad..."},
  "foreground":{"argv":["claude","--resume"],"cwd":"...","name":"claude","pid":9659},"argv":["/bin/bash"],...}`;
  a terminal with no status: `"status":null,"reported":false`.
- `hc get missing --json` -> exit 3, stdout `{"error":{"hint":"see `hc ls --all`","kind":"not_found",
  "message":"no terminal \"missing\""}}` (treat `error.kind == "not_found"` as absent, any other failure as unknown).
- `hc run --bg ... --json`-style output: `{"address":"t5","agent":"codex","cwd":"...","name":"akprobe-codex",
  "state":"live","turn":0}`.
- `hc read --lines N t` -> plain text (may end with a line `[hc] incomplete: older output may be missing`;
  drop lines starting with `[hc] `).

## Contract (all tasks)
### C1. Backends (scheduler.py, T1)
- Keep class `Herdr` (legacy, unchanged behaviour) and add `backend = "legacy"`; add class `Hc` with
  `backend = "hc"`, constructor `Hc(binary="hc", app_binary="herdr-app", runner=subprocess.run)`.
- Both classes expose exactly:
  `available() -> bool`, `require() -> None`,
  `workspace_create(cwd, label) -> (workspace_id, pane)`, `workspace_close(workspace_id)`,
  `agent_start(name, pane, agent_args, timeout_ms, kind="codex") -> dict`,
  `agent_prompt(name, text, timeout_ms) -> dict` (returns once observed working or blocked; raises
  SchedulerError on timeout), `agent_get(name) -> dict` (legacy shape `{"result": {"agent": REC}}`; raises
  SchedulerError when not found or unreachable), and NEW `agent_record(name) -> (REC|None, STATE)`,
  `agent_list() -> list[REC] | None` (None = backend unreachable), `agent_read(name, lines) -> list[str] | None`,
  `focus(name) -> None` (best effort, never raises), `server_running() -> bool`.
- REC (normalized record, both backends): `{"name", "agent_status": STATE, "cwd", "pane_id",
  "workspace_id", "kind", "backend"}`; legacy RECs keep every original herdr field too (e.g.
  `agent_session`). STATE is one of `idle, working, blocked, done, unknown, absent`, produced only by
  `agent_state_from_hc(rec)` / the legacy parser. hc mapping: not found or `state == "finished"` -> absent;
  status.state in idle/working/blocked/done -> same; `error`, missing status, anything else -> unknown.
  kind: status.app `claude-code` -> `claude`, `codex` -> `codex`, else foreground.name, else the `agent`
  field. pane_id = hc address; workspace_id = labels["herdr.space"] (None if absent).
- `Hc.available()`: `shutil.which(binary)` and (env `HC_TERMINAL_ID` set, or `server_running()`).
  `Hc.server_running()`: `hc server status` exit 0 and its output says running (match the real output;
  record a sample in a test). `Hc.require()` raises SchedulerError naming `hc` when unavailable.
- `Hc.workspace_create(cwd, label)`: no process starts; returns (`"ak" + 16 hex`, same id) and remembers
  `cwd` and `label` for that id on the instance. `Hc.agent_start(name, pane, args, timeout_ms, kind)`:
  `hc run --bg --no-parent --no-notify --keep --name <name> --cwd <cwd of pane> --label herdr.space=<pane>
  --label agentkit.kind=<kind> -- <binary for kind> <args...>` (binary from `models.binary(kind)`), then best
  effort `herdr-app do space.rename --id <pane> --name <label>`, then poll `agent_record` every 0.5 s until
  `reported` and STATE in (idle, done) or timeout -> SchedulerError containing `agent_not_ready` (same marker
  kitstart already handles). Unknown pane id -> SchedulerError.
- `Hc.agent_prompt`: require STATE in READY_STATES (idle, done) else SchedulerError; `hc send <name> <text>`;
  poll until working or blocked, else SchedulerError `prompt not acknowledged` after timeout_ms.
- `Hc.workspace_close(id)`: `hc kill` then `hc rm` every live terminal whose labels["herdr.space"] == id;
  nothing found -> no error.
- `Hc.agent_read(name, lines)`: `hc read --lines <lines> <name>` text lines (no ANSI), last `lines` lines;
  None on failure. Callers still apply `scrub`.
- All subprocess calls: argv lists, `shell=False`, timeouts (5 s for get/ls/read/send/kill, run per
  timeout_ms), FileNotFoundError/OSError/TimeoutExpired -> unreachable (record: STATE unknown).
- Move `READY_STATES = ("idle", "done")` into scheduler.py; agentctl imports it (keep the name in agentctl).

### C2. Choosing a backend (scheduler.py, T1)
- config `herdr.backend`: `"auto"` (default; add to `.agent-system/config.json` template and validation:
  one of auto/hc/legacy; missing = auto).
- `make_herdr(cfg, env=None, runner=subprocess.run)`: hc -> Hc; legacy -> Herdr; auto -> Hc if env has
  `HC_TERMINAL_ID` and hc is on PATH; else Herdr if env `HERDR_ENV == "1"`; else Hc if hc is on PATH and its
  server runs; else Herdr.
- Scheduler(herdr=None) uses `make_herdr(self.cfg)`; an injected herdr (tests) is used for everything.
- Per run: on the first live launch store `state["herdr_backend"]` (= self.herdr.backend). Later live calls
  for that run (prompt, get, close, cleanup) use a backend of that kind: `self.herdr_for(state)` returns
  self.herdr when kinds match or herdr was injected, else a new instance of the recorded kind. Runs without
  the field behave as today (legacy record = old runs).
- Messages that say "herdr agent read X" (wait blocked hint) become backend-neutral
  (`hc read --lines 80 X` for hc).

### C3. Hub connector (agentctl.py, T2)
- Replace raw `herdr` subprocess calls (`_herdr_record`, `_herdr_record_for_workspace`, `_screen`, the
  `S.Herdr(runner=runner).agent_prompt` calls) with backend methods. Backend order for the connector: the
  `backend` saved in `.orchestrator/orchestrator.json` (T3 writes it) if present, else config
  `herdr.backend` if not auto, else probe hc then legacy: the first backend that knows the agent wins;
  absent only if every reachable backend says absent; unknown if none is reachable.
- The workspace fallback (unnamed orchestrator of the configured kind whose cwd is the workspace) uses
  `agent_list()` of each backend, matching REC.kind and REC.cwd.
- Snapshot `herdr_state` values stay within the protocol enum (REC states guarantee it). Phone prompts are
  delivered only in READY_STATES, through the backend that found the orchestrator. Screen: `agent_read` + `scrub`.
- Function signatures with `runner=` stay; existing tests keep passing (they may pin `herdr.backend` to
  legacy in their cfg). New tests: hc-only orchestrator (live, idle -> prompt delivered via `hc send`;
  `error` -> unknown in snapshot; finished -> absent -> connector stops after 2 checks), mixed backends.

### C4. Start / continue / docs (kitstart.py, hubctl.py, docs, T3)
- kitstart uses `S.make_herdr(cfg, env)` (tests inject). When the backend is hc:
  no `herdr status server` wait, no `execvp("herdr")`; launch = `workspace_create` + `agent_start` (label =
  repo name) + `focus`; `continue` closes via `workspace_close(REC.workspace_id)` (hc: kill+rm the terminal
  if no space label). Save `backend` into orchestrator.json (`save_session` gains `backend`).
- Never two orchestrators: before launching, look the orchestrator up in BOTH backends (by name, then the
  workspace fallback); if one is alive anywhere: `start` focuses it when it is in the current backend,
  otherwise refuses with a message naming where it runs and `agent-kit continue` / how to stop it.
- `hubctl.py` `_orchestrator_alive` callers keep working through agentctl (no new logic there).
- Docs: README + GUIDE + .agent-system/README: the new app is the default; `herdr.backend` setting; old
  herdr still works (`legacy`); doctor checks. Doctor (T1): `hc` on PATH (warn if missing and backend
  auto/hc), `herdr-app` (warn), old herdr only required when backend is legacy; HERDR_ENV check becomes
  "inside Herdr app or old herdr".

## Tasks
- T1 (adapter, scheduler, config, doctor, tests) - first.
- T2 (hub connector, tests) - after T1.  T3 (start/continue, docs, tests) - after T1. T2 and T3 run in parallel.

## Verification
`python3 -m pytest -q .agent-system/tests` all green; `bash -n` scripts; Opus live checks after merge:
start an hc orchestrator for a scratch workspace, connector shows ONLINE + screen, hub prompt delivered,
dispatch one trivial worker through hc.
