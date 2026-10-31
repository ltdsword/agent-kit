# Docs: README Windows (WSL2) section (31/10/26)

## Goal
The README's Windows (WSL2) section tells a Windows 11 user where to keep repos and how to work with Windows files, how to keep the hub running, how to start from Windows, and what the new doctor checks mean.

## Read first
- `plans/261031-1819-windows-wsl2/plan.md`: sections **User decisions**, **Contract** and **T2**: **the full spec**. Follow it exactly; check names and messages come from the Contract table.
- `README.md`: the whole "Windows (WSL2)" section (~lines 152-182), the macOS section before it for tone, and the table of contents near line 45.

## Steps
1. Extend the Windows (WSL2) section with the subsections the spec lists, in the README's existing style (short sentences, numbered steps, code spans for commands and paths).
2. Keep every existing step; do not change other sections except the table of contents if you add a heading.
3. Run the command in "Run these".

## Boundaries
**You may edit** (must match owned_paths):
- `README.md`

**You must not edit:**
- Any other file; also `.agent-system/**`, `plans/**`, `gen-tasks/**`, `.orchestrator/**`.

**You may run:**
- read-only git, `grep`.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; any install or download; `wsl.exe`; `systemctl`.

**When to ask:** only for a real blocker (the spec contradicts the README) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Invent commands or settings beyond the spec. Claim native Windows works.

## Done when
- [ ] Every item in spec section T2 is in the README.
- [ ] `git diff --check` passes and only `README.md` changed.

## Run these
- `git diff --check && git diff --stat`: expect no whitespace errors, only README.md

## Notes
- Report: files changed, wording decisions, open questions.

## Worker result - attempt 1 (31/10/26 18:23)

- Status: **done** (worker worker-2, branch `agent/winwsl-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `README.md`
- Scope: OK
- Tests reported:
  - `git diff --check && git diff --stat` -> exit 0
  - `git status --short && git diff -- README.md && git rev-parse HEAD` -> exit 0
- Risks:
  - README.md originally had no final newline; the edit added one.
- Not done: none
- Full diff: `.orchestrator/runs/winwsl/reports/T2.diff`

````text
 README.md | 42 +++++++++++++++++++++++++++++++++++++++++-
 1 file changed, 41 insertions(+), 1 deletion(-)
````

````diff
diff --git a/README.md b/README.md
index 0f197c6..48bb628 100644
--- a/README.md
+++ b/README.md
@@ -153,6 +153,7 @@ steps have not yet been tested on a real Mac; please report problems.
 
 agent-kit runs on Windows inside WSL2 (Ubuntu on Windows), where everything works as on Linux.
 Native Windows (PowerShell, cmd) is not supported.
+Native Windows support is planned, pending tests of Herdr and the Codex sandbox on Windows.
 
 1. In **PowerShell as administrator**: `wsl --install` (installs WSL2 and Ubuntu), then restart.
 2. Open **Ubuntu** from the Start menu and create your Linux user when asked.
@@ -164,6 +165,12 @@ Native Windows (PowerShell, cmd) is not supported.
 `wsl --install` installs a current Ubuntu LTS. If `python3 --version` shows less than 3.11, install a
 newer Ubuntu with `wsl --install -d Ubuntu-24.04`.
 
+**Where to keep repos and work with Windows files.** Windows drives appear in WSL under `/mnt/`,
+such as `/mnt/c/`. Repos there work, but Git, builds and workers are much slower and workspace
+symlinks are less reliable; `doctor` warns when the repo or workspace is there. Keep repos in the WSL
+home, e.g. `~/code`, and open them from Explorer at
+`\\wsl.localhost\Ubuntu\home\<you>\code`, or use the VS Code WSL extension with `code .` in Ubuntu.
+
 **Using it from Windows.** agent-kit, Herdr, the agent programs and your workspaces all live in WSL, and
 you run them there: copying the kit or a workspace out to Windows does not work (`agent-kit` is a bash
 script, the workspace links back to the repo with a Linux symlink, and the saved paths are Linux
@@ -181,6 +188,39 @@ agent-kit uses in WSL: they disagree with WSL's Git about line endings and file
 show as changed when nobody edited them, and agent-kit refuses to merge into a folder with
 uncommitted changes. If you want a Windows copy, keep it as a separate clone and sync it with push/pull.
 
+**Keep the hub running.** Ubuntu installed by `wsl --install` enables systemd by default. If systemd is
+off, add this to `/etc/wsl.conf`:
+
+```ini
+[boot]
+systemd=true
+```
+
+Then run `wsl --shutdown` in PowerShell. WSL stops when idle, along with the hub. To keep it running,
+add this to `%UserProfile%\.wslconfig`:
+
+```ini
+[general]
+instanceIdleTimeout=-1
+```
+
+Then run `wsl --shutdown` in PowerShell. The hub website works from any browser; its local backend
+listens on `127.0.0.1` and is reachable from Windows via `localhost`.
+
+**Start from Windows.** In Windows Terminal or PowerShell, run
+`wsl -d Ubuntu -- agent-kit start --folder ~/code/<repo>`. You can also put that command line in a
+Windows Terminal profile.
+
+**Doctor checks.** On WSL, `doctor.sh` reports these checks with `[OK  ]`, `[WARN]` or `[FAIL]`:
+
+| Check | OK | If not OK |
+|---|---|---|
+| `python-version` (always) | Python >= 3.11 | `[FAIL]` Python 3.11+ required (found X.Y) |
+| `wsl-version` (WSL only) | WSL 2 | `[FAIL]` WSL 1 is not supported; in PowerShell: `wsl --set-version <distro> 2` |
+| `wsl-location` (WSL only) | Workspace and repo are in the Linux filesystem | `[WARN]` Names the `/mnt/<drive>` path; Git, builds and workers are slower, and the workspace symlink is less reliable. Keep repos in the WSL home (e.g. `~/code`) and open them from Windows via `\\wsl.localhost\<distro>\home\<user>` or VS Code's WSL extension. |
+| `wsl-systemd` (WSL only) | `/run/systemd/system` exists | `[WARN]` `agent-kit hub autostart` needs systemd: add `[boot] systemd=true` to `/etc/wsl.conf`, then run `wsl --shutdown` in PowerShell. |
+| `wsl-keepalive` (WSL only) | Always OK (advice) | WSL stops when idle and the hub with it; to keep it running set `instanceIdleTimeout=-1` under `[general]` in `%UserProfile%\.wslconfig` (then run `wsl --shutdown` in PowerShell). |
+
 #### From Git (any system; also for working on the kit)
 
 ```bash
@@ -818,4 +858,4 @@ Keep `scheduler.py` stdlib-only.
 This project is licensed under the MIT License.
 See the [LICENSE](LICENSE) file for details.
 
-Copyright (c) 2026 Le Tien Dat.
\ No newline at end of file
+Copyright (c) 2026 Le Tien Dat.
````

## Review round 1: MINOR_FIX (31/10/26 18:28)

- Verdict: **MINOR_FIX** -> task is now REVIEW (fix rounds used: 0/2)
- Reviewed HEAD: 7d1ee3ec5d8c, commits 7d1ee3ec5d8c
- Notes: Fixed the Start from Windows command (login shell, --folder=)

# Review: winwsl T2 (README Windows WSL2 section)

Verdict: MINOR_FIX (fixed by Opus). All T2 items present, style kept, native still unsupported.
Fix: the "Start from Windows" command `wsl -d Ubuntu -- agent-kit start --folder ~/code/<repo>`
would not work: `wsl ... --` runs without a login shell (no `~` expansion, `~/.local/bin` not on
PATH for Git installs) and the kit only accepts `--folder=<repo>`. Replaced with
`wsl -d Ubuntu --cd ~ -- bash -lc "agent-kit start --folder=code/<repo>"` plus one sentence why.

## Final gate: PASS (31/10/26 18:29)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-winwsl at 617458f4a02c (log `.orchestrator/runs/winwsl/logs/verify-1793446100.log`)
- Task REVIEW; run RUNNING

## Final gate: PASS (31/10/26 18:30)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-winwsl at 617458f4a02c (log `.orchestrator/runs/winwsl/logs/verify-1793446179.log`)
- Task REVIEW; run RUNNING

## Review round 1: PASS (31/10/26 18:30)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 7d1ee3ec5d8c, commits 7d1ee3ec5d8c
- Notes: Opus minor fix already in the task commit

# Review: winwsl T2 (README Windows WSL2 section)

Verdict: MINOR_FIX (fixed by Opus). All T2 items present, style kept, native still unsupported.
Fix: the "Start from Windows" command `wsl -d Ubuntu -- agent-kit start --folder ~/code/<repo>`
would not work: `wsl ... --` runs without a login shell (no `~` expansion, `~/.local/bin` not on
PATH for Git installs) and the kit only accepts `--folder=<repo>`. Replaced with
`wsl -d Ubuntu --cd ~ -- bash -lc "agent-kit start --folder=code/<repo>"` plus one sentence why.
Opus applied the fix before commit-task; it is in commit 7d1ee3e. Final verdict PASS.

## Integration: merged (31/10/26 18:30)

- On `agent/integration-winwsl` at 971c66119002; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/winwsl/logs/post-merge-T2-a1.log`)

## Final gate: PASS (31/10/26 18:31)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-winwsl at 971c66119002 (log `.orchestrator/runs/winwsl/logs/verify-1793446249.log`)
- Task MERGED; run DONE
