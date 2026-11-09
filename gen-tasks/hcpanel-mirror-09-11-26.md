# hcpanel mirror: module that mirrors a run's tasks into Herdr's Tasks panel (09/11/26)

## Goal
`.agent-system/herdr_tasks.py`: keeps one Herdr task per run task, with its state, the live worker and a
status line, so the person follows the run in the Tasks panel.

## Read first
- `plans/261109-1540-hcpanel/plan.md` (all facts were probed; follow them exactly).
- `.agent-system/artifacts.py` (style to copy: `enabled`, runner injection, never raises, `show_panel`).
- `.agent-system/scheduler.py`: task statuses (line ~44), `Scheduler.store.run_dir`, `workspace_root`,
  worker records (`state["workers"][wid]["agent_name"]`), task fields `worker`, `attempts`, `major_repairs`,
  `summary`, `title`, `depends_on`, `packet`.

## Steps
1. `enabled(cfg, env=None) -> bool`: `cfg["herdr"].get("tasks", True)` is True, `herdr-task` and `hc` on PATH
   (shutil.which), and HC_TERMINAL_ID set or `cfg["herdr"].get("backend") == "hc"`.
2. `sync(sched, state, runner=subprocess.run, adopt=None) -> None` (never raises; each subprocess:
   capture_output, text, timeout=10, shell=False). Folder = `str(sched.workspace_root)`.
   Map file `<run_dir>/herdr-tasks.json`: `{"tasks": {tid: {"id": n, "key": "...", "seen": "<fingerprint>",
   "address": "..."}}}`, written atomically (tmp + os.replace).
   a. Create missing Herdr tasks in dependency order: title `"<run_id> <tid>: <title>"` cut to 80 chars;
      prompt = summary + "\n\nTask file: <packet>"; `--here`; `--after` = mapped ids of depends_on (comma list,
      only when all deps are mapped). Parse `--json` for id/key.
   b. Fingerprint per task = status, worker agent name, attempts, major_repairs. Skip unchanged.
   c. Per status (Herdr task id n):
      - PENDING/READY: nothing.
      - RUNNING: resolve the worker's agent address with `hc get <agent_name> --json` -> "address" (skip
        address if not live/unknown). Call `adopt(folder, n, address, "codex")` (default adopt: see 3) once
        per new address, then `herdr-task status --folder F n "<text>"`: "Working" (attempts<=1 and no
        major_repairs) else "Fix round <major_repairs or attempts-1>".
      - REVIEW (or report present before review): status "Waiting for review"; PASSED: "Reviewed, waiting to merge";
        FIX_REQUIRED: "Fix needed"; BLOCKED: "Blocked: needs you"; FAILED: "Failed". For these, adopt
        first without an address if the task is not running yet (status needs running).
      - MERGED: `herdr-task done --folder F n`.
3. Default adopt (`_adopt_store`): import Herdr's package from `dirname(realpath(which("herdr-task")))`
   (sys.path insert, sys.dont_write_bytecode kept True), then
   `with Store(locate(folder)) as s: t = s.find(str(n))`: set `state="running"`, `started` if missing (now()),
   `backup={"state": "skipped", "why": "agent-kit scheduler owns this task", "at": now()}` if missing; when
   an address is given and not yet in `t["agents"]`, append `{"address", "agent", "at"}`; `s.dirty = True`.
   Then, with an address, `hc label <address> herdr.task=<key>`. Any exception -> False.
4. `show_panel(cfg, env=None, runner=subprocess.run) -> bool`: only when `enabled`; runs
   `herdr-app do layout.select --stack panel-body --child tasks`, then `herdr-app do layout.show --id panel`;
   stop at first failure; never raises.
5. Tests `.agent-system/tests/test_herdr_tasks.py` (fake runner recording argv and returning canned JSON;
   fake adopt): creation order + `--after` ids; title/prompt; unchanged fingerprint -> no calls; RUNNING ->
   hc get, adopt with address, status "Working"; repair -> "Fix round 1"; REVIEW -> adopt without address +
   "Waiting for review"; MERGED -> done; runner raising -> no exception; disabled -> no calls;
   map file round-trip; show_panel argv order/failure. `_adopt_store` with a fake herdr_task package in a
   temp dir (Store context manager, locate, find, base.now) -> fields set, label call made.

## Boundaries
**You may edit:** `.agent-system/herdr_tasks.py` (new), `.agent-system/tests/test_herdr_tasks.py` (new).
**You must not edit:** scheduler.py, artifacts*, agentctl.py, docs, hub/**, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch; reading files
under `~/.config/herdr-app/mods/tasks/bin/herdr_task/` (read only).
**You must not run:** `herdr-task`, `hc`, `herdr-app`, `herdr-artifact`; git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Steps 1-5; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests/test_herdr_tasks.py` then `python3 -m pytest -q .agent-system/tests`.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
