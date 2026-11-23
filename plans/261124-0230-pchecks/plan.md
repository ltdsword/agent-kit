# pchecks: parallel review + Code Mode test sessions; hook fixes (24/11/26)

## Why
Code Mode trials on BanCaZagooMW and cms-migrate (the user's measurements, 23-24/11/26):
- Test/gate in a separate Code Mode session: 76k vs 125k (-40%), 4 vs 8 requests, 75s vs 104s, same correct FAIL.
  In the orchestrator with 200k context: ~285k; separate normal ~145k; separate Code Mode ~96k; orchestrator
  context grows +0.5k instead of +8.8k.
- Review in a separate session: ~100k and a ~2k report back, versus 140-180k plus ~50k of file content left in the
  orchestrator. A separate reviewer is also not anchored by the orchestrator's plan.
- Research stays inline in the Opus orchestrator. The orchestrator stays in normal mode (Remote Control, hooks,
  Agent Hub). Workers (Codex) still write code.
- Code Mode facts (plans/reports/researcher-261123-2341-claude-code-mode.md): env `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`,
  interactive sessions only (no `-p`), direct Anthropic API only, experimental. Script file/MCP calls are not
  sandboxed; deny rules and hooks still apply per call.

## Decided design (user: "two of this can run parallel; when one fails, both terminated, back to worker")
After `collect` (task in REVIEW) the orchestrator runs `scheduler.py check start --run R --task T`. It starts two
Claude sessions at once, in one Herdr space, with cwd = the task worktree:
- **review** (normal mode): reviews `reports/T.diff` against the task file and `prompts/review-checklist.md`.
- **test** (Code Mode): runs the task file's "Run these" commands and `gate.post_merge_check` in the worktree,
  logging to files from the first run, and verifies every number and file:line by opening the file.
Each writes `reports/T.check-<kind>.json` (+ `.md`). `scheduler.py check wait` returns on the FIRST FAIL and
then closes the space, which ends both sessions. If both PASS, it closes the space and returns pass. On FAIL the
orchestrator repairs (same worker, existing repair flow). On PASS it runs `mark-reviewed --verdict PASS --report
<review md>`. The final `verify` and `post_merge_check` in `integrate` stay plain subprocesses (no model).
Sessions are read-only by rule, and the scheduler enforces it: a snapshot of `git status --porcelain -uall` and
`git diff HEAD` is taken before and after, and a changed worktree means FAIL ("checker changed the worktree").
Config (optional, defaults in code): `checks: {enabled, timeout_seconds, review: {kind, model, effort, code_mode},
test: {...}}`. A null model or effort means the orchestrator's. Checks need `herdr.backend: hc`.

## Hook errors (Agent Hub relies on hooks)
1. The company managed settings (`~/.claude/remote-settings.json`) add PreToolUse Read:
   `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/scan-secrets.sh"`. Only the company repos ship that script, so in a
   workspace or scratch dir every Read logs "No such file or directory" and the secret scan silently does not run.
   Fix: every kit workspace gets `.claude/hooks/scan-secrets.sh`, a delegating wrapper. It runs the project repo's
   own script (project.path, then each linked repo), passing stdin through; with none found it exits 0.
   Never copy company code into the kit.
2. Plugin SessionStart hooks run `node`. Sessions started by hc lack the nvm PATH, so they log "node: not found".
   Fix: every Claude-kind session the scheduler starts is launched through `env PATH=<scheduler's PATH> ...`.

## Tasks
- T1 scheduler: `check start|wait|status`, the hc argv prefix (env), PATH passthrough for Claude-kind launches,
  prompts `prompts/check-review.md` and `prompts/check-test.md`, tests.
- T2 install: the scan-secrets wrapper template plus installing it on create/update/kit, and tests.
- T3 docs/rules: ORCHESTRATOR.section.md step 4 and the routine list, GUIDE.md, README.md.
T1, T2 and T3 own disjoint files, so all three run in parallel.
