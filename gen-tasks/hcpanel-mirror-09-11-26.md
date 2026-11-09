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

## Worker result - attempt 1 (09/11/26 15:56)

- Status: **done** (worker worker-1, branch `agent/hcpanel-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/herdr_tasks.py`, `.agent-system/tests/test_herdr_tasks.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_herdr_tasks.py` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - Herdr behavior was exercised through fake runners and a fake package; real Herdr commands were not run per task boundaries.
- Not done:
  - No commit created; worker .git metadata is read-only.
- Full diff: `.orchestrator/runs/hcpanel/reports/T1.diff`

````text
 .agent-system/herdr_tasks.py            | 283 +++++++++++++++++++++++++++++
 .agent-system/tests/test_herdr_tasks.py | 311 ++++++++++++++++++++++++++++++++
 2 files changed, 594 insertions(+)
````

(diff is 606 lines; read the full diff file)

## Review round 1: PASS (09/11/26 15:57)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 08f60f3ccd3e, commits 08f60f3ccd3e
- Notes: Opus fix: live terminal counts before first status; live check passed

# Review hcpanel T1 (mirror module) - PASS with Opus fix
- herdr_tasks.py: enabled/sync/show_panel per packet; never raises; atomic map file; fingerprint skip; dependency order + --after; adopt via Herdr Store (lock), backup "skipped" marker, hc label.
- Opus fix: `_agent_address` required a reported agent state, so a worker stuck on a startup screen (no status yet) was never attached. Now: any `hc get` record with state "live" and an address.
- Live (Opus, real herdr-task/hc, scratch folder): T1 RUNNING -> HPLI-1 running, agent t2s attached, label herdr.task set, status Working; T2 PENDING -> todo waiting_for [1]. T1 MERGED -> done, T2 waiting cleared; T2 REVIEW -> running + status. Cleaned up (tasks, store file, label).
- Tests: 14 module tests pass.

## Integration: merged (09/11/26 15:57)

- On `agent/integration-hcpanel` at 44374f034b2b; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcpanel/logs/post-merge-T1-a1.log`)

## Final gate: PASS (09/11/26 16:15)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcpanel at 29f37c5c4627 (log `.orchestrator/runs/hcpanel/logs/verify-1794215680.log`)
- Task MERGED; run DONE

## Finished (09/11/26 16:17)

- merged into hub/plan (decision D2)
