# pchecks-hooks (24/11/26)

## Goal
Every kit workspace has `.claude/hooks/scan-secrets.sh`. It runs the linked project repo's own secret scanner,
so the company's managed PreToolUse Read hook (`bash "$CLAUDE_PROJECT_DIR/.claude/hooks/scan-secrets.sh"`) stops
failing with "No such file or directory" in workspaces, and the scan really runs there.

## Read first
- `plans/261124-0230-pchecks/plan.md`, section "Hook errors".
- `.agent-system/scripts/install.sh`: `install_agent` (~156), `merge_settings` (~175), and the three places that
  call `install_agent` (create ~501, update ~652, legacy ~692); `copy_kit` (~132; it copies `templates/`).
- `.agent-system/config.json` keys `project.path` (string) and `project.repos` (optional list), both relative to
  the workspace.
- `.agent-system/tests/test_create_repos.py`: how install.sh is tested with temp dirs.

## Steps
1. New template `.agent-system/templates/hooks/scan-secrets.sh` (bash, executable). Line 2 is the exact marker
   comment `# agent-kit:scan-secrets-wrapper`. Behaviour:
   - `ws` = the workspace = `$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)`.
   - Candidate repos: from `$ws/.agent-system/config.json`, read with `python3 -c` and printed one per line:
     `project.path` first, then each `project.repos` entry, without duplicates. Each one is resolved against `$ws`.
     If python3 or the config is missing, there are no candidates.
   - For each candidate `r`: `s="$r/.claude/hooks/scan-secrets.sh"`. Use the first `s` that is a regular file
     (after symlinks), whose `realpath` differs from this script's `realpath`, and that does NOT contain the
     marker line. Run `exec bash "$s" "$@"` (stdin passes through, and the exit code and output are the target's).
   - No target: `exit 0` silently (no stdout, no stderr).
   - Never print the hook input. Use `set -u` only (no `-e`, so a failed lookup cannot break the hook).
2. `install.sh`: new function `install_hooks() {  # install_hooks <dest>: workspace hook wrappers (scan-secrets)`.
   For the target `$1/.claude/hooks/scan-secrets.sh`:
   - Missing: mkdir -p, copy the template, chmod 755, and echo "hooks: scan-secrets wrapper installed".
   - Exists and contains the marker: replace it when it differs from the template (`cmp -s`). Echo "updated" or
     stay quiet when it is the same.
   - Exists WITHOUT the marker: it belongs to the repo (for example a company repo in legacy mode). Never touch
     it; echo "hooks: own scan-secrets.sh kept".
   - Respect `$DRY` like `do_` (print "[dry-run] ...").
   - Call it right after `install_agent` in create, update and legacy.
3. Tests: a NEW file `.agent-system/tests/test_scan_secrets_hook.py`. Run the template directly from a temp
   workspace layout (copy it to `<ws>/.claude/hooks/`; write `<ws>/.agent-system/config.json`; make the repo dirs
   with a fake `scan-secrets.sh` that echoes a marker plus its stdin length and exits 7).
   - It delegates to project.path's script, stdin passes through, and the exit code is 7.
   - It falls back to a `project.repos` entry when the first has none.
   - No candidate script: exit 0 with empty stdout/stderr.
   - It never runs a target that contains the marker, and never runs itself (a repo symlinked to the workspace).
   - No config: exit 0.
   - install_hooks via `bash install.sh update --folder <tmp ws>` if the existing tests make that easy; otherwise
     call it by sourcing install.sh functions the way test_create_repos does. Cover: missing gets installed, our
     marker gets updated, a foreign file is kept byte-for-byte.

## Boundaries
**You may edit** (owned_paths):
- `.agent-system/templates/hooks/scan-secrets.sh` (new)
- `.agent-system/scripts/install.sh` (only `install_hooks` and its three calls)
- `.agent-system/tests/test_scan_secrets_hook.py` (new)

**You must not edit:** scheduler.py, models.py, prompts/ (T1); ORCHESTRATOR.section.md, GUIDE.md, README.md (T3);
`templates/claude-settings.json` (the hook comes from the company's managed settings, not ours); anything else,
`.orchestrator/`, other worktrees. Never copy or quote any real company `scan-secrets.sh` content into the kit
(tests use fakes only).

**You may run:** the commands in "Run these"; `bash -n`; read-only git; `git add` / `git commit` on your branch.

**You must not run:** `install.sh` against real folders (temp dirs only), the real `agent-kit`, `hc` or `herdr`;
downloads or installs; git push, merge, rebase, reset, checkout or clean. Never write under the real `~/.claude`
or `~/Code/Internal`.

**When to ask:** only a real blocker: report "blocked" with the exact reason.

## Done when
- [ ] Steps 1-3; `bash -n` is clean on both scripts; the whole suite passes.

## Run these
- `bash -n .agent-system/templates/hooks/scan-secrets.sh`
- `bash -n .agent-system/scripts/install.sh`
- `python3 -m pytest -q .agent-system/tests/test_scan_secrets_hook.py`
- `python3 -m pytest -q .agent-system/tests`
