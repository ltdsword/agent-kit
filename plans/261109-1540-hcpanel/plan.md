# hcpanel: run tasks in Herdr's Tasks panel (09/11/26)

User: run tasks belong in the Tasks panel, not the Artifacts board (chose A: live mirror).

## Facts (Opus probes, herdr-task in ~/.config/herdr-app/mods/tasks/bin)
- Store: ~/.herdr/tasks/<slug>.json; `herdr-task where --folder F --json` -> slug, store, prefix.
- `herdr-task add --folder F --json --here --prompt P [--after 1,2] TITLE` -> {"id", "ref", "key" (slug#id), "state":"todo", "waiting_for"}.
- Running only via `start` (launches Herdr's own agent + brief: unusable). Herdr's own migrate() adopts an outside live agent: state running, started, agents.append({address, agent, at}), `hc label <addr> herdr.task=<key>`. Probed via `herdr_task.store.Store(locate(F))` context manager (flock, atomic) + `herdr_task.base.now()`: works.
- `t["backup"] = {"state":"skipped", ...}` makes takeover skip the task (takeover.py: `if t.get("backup")`), no news (news only for state "started").
- `herdr-task status --folder F <id> "<=40 chars>" [--done N]` needs running|ready. `herdr-task done --folder F <id>` sets done (no merge for mode here). A dependent's waiting_for clears when its dep is done.
- Herdr retry nudges (hc send "continue" after a provider cut) may reach our worker: acceptable.
- Panel: `herdr-app do layout.select --stack panel-body --child tasks`, `herdr-app do layout.show --id panel`.

## Design
- `.agent-system/herdr_tasks.py` (T1): `enabled(cfg, env)`, `sync(scheduler, state, runner, adopt)` (idempotent; map file `<run_dir>/herdr-tasks.json`), `show_panel(cfg, env, runner)`. Never raises.
- Scheduler (T2): call sync in store save (next to write_board); run_create: tasks on -> no run board, show Tasks panel; off -> current board. Config `herdr.tasks` bool, default true.
