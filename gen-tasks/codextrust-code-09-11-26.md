# codextrust code: Codex trust that works, resume that sees a live stuck worker (09/11/26)

## Goal
Codex workers start without the "Trust this folder?" question, and `resume` never advises a relaunch while
the worker's agent is still alive.

## Evidence (Opus, probed with Codex 0.165.0 in tmux, scratch repo)
- `-c 'projects."<path>".trust_level="trusted"'` is ignored: the trust question shows even when Codex starts
  in the repo root itself with that flag (worktree inside or outside the repo: same).
- One inline-table value works and saves nothing to `~/.codex/config.toml`:
  `-c 'projects={"<worktree>"={trust_level="trusted"},"<repo root>"={trust_level="trusted"}}'`
  -> Codex goes straight to "Hooks need review" (already answered by the scheduler).
- Live case: BanCaZagooMW run p2, workers t2c/t2d stuck at the trust question; launch timed out
  (`agent_not_ready`), so `launch_error` was set and `resume` said "no live agent and no report -> relaunch"
  while hc showed both agents live.

## Read first
- `.agent-system/scheduler.py`: `codex_args` (trust_worktree block ~line 1264), `resume` (~line 2780-2810),
  `Hc.agent_get` / `Herdr.agent_get` (~779, ~994), launch path that sets `launch_error` (~1720).
- `.agent-system/tests/test_scheduler.py` (trust assertions ~line 424, resume tests).

## Steps
1. `codex_args`: when `trust_worktree`, append exactly ONE `-c` whose value is
   `projects={"<p1>"={trust_level="trusted"},"<p2>"={trust_level="trusted"}}` over
   `dict.fromkeys([worktree, str(self.project_root)])` (dedupe kept). Paths are JSON/TOML basic strings: quote
   with `json.dumps(path)` so a `"` or `\` in a path stays valid. Update the comment: the dotted-key form is
   ignored by Codex (0.165), the inline table works and is per-run only.
2. `resume`, RUNNING task without report: if the agent is live (`agent_get` succeeded, not "missing"), report
   `"{tid}: agent {name} is live but has not reported"` plus, when `launch_error` is set,
   `" (launch timed out: it may be stuck on a startup screen; read it with hc read / herdr agent read, then answer it or stop it before relaunch)"`.
   Advise `relaunch` only when the agent is missing, or when it was not observable AND `launch_error` is set.
   Keep the existing message text for those relaunch cases.
3. Tests: codex_args with trust -> one `-c` with the inline table containing both paths, no dotted
   `projects."` keys; same path twice -> one entry; a path with a `"` stays valid TOML (parse the value after
   `projects=` with `tomllib.loads("projects=" + value)` and check both trust levels). Resume: launch_error +
   live agent -> no relaunch advice, "live but has not reported"; launch_error + missing -> relaunch advice;
   no launch_error + live -> existing "running on" text unchanged.

## Boundaries
**You may edit:** `.agent-system/scheduler.py` (`codex_args`, `resume` only), `.agent-system/tests/test_scheduler.py`.
**You must not edit:** templates, docs, GUIDE/README, agentctl.py, artifacts*, hub/**, plans/**, gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `codex` itself, `hc`, `herdr*`, `herdr-app`; git push/merge/rebase/reset/checkout; edits to `~/.codex`.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Steps 1-3 done; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
