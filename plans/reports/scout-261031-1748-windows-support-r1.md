# Research packet: Windows support for agent-kit (round 1, broad)

**RESEARCH_ID:** win-support-r1. **RUN_ID:** none given. **REPO_HEAD:** not captured. I had no Bash, so I couldn't run `git rev-parse`. The session shows branch `hub/plan` with `.agent-system/config.json` modified.

**Basis.** I read the repo with Read, Grep and Glob only. I ran no tests and did not check for `pyproject` or other packaging files, so any claim about their absence is inferred.

## REQUESTED_ARCHITECTURAL_DECISIONS
- **D1.** Support model: (a) WSL2 only, done properly; (b) native Windows; (c) hybrid.
- **D2.** If native is in scope, which components block it and what each costs.
- **D3.** Windows distribution, and how Linux and macOS installs work today.

## DECISION-READY INDEX

### Confirmed behavior
- **The orchestration core is POSIX-bound** (verified).
  - `fcntl.flock` is imported at the top of `scheduler.py` (`:16`), so `import scheduler` fails on Windows before any command runs.
  - `os.kill(pid, 0)` is used as a liveness probe in 5 places. On Windows, `os.kill` with any signal other than CTRL_C_EVENT or CTRL_BREAK_EVENT calls `TerminateProcess`. So the probe would kill the process it checks. This is from the Python docs as I remember them; I did not fetch them (inferred).
  - `start_new_session=True` appears at `hubctl.py:320`, `kitstart.py:252` and `kitstart.py:341`.
  - `os.execvp("herdr", …)` at `kitstart.py:333,344` does not replace the process on Windows (inferred).
- **The entry point and installer are bash.** `agent-kit` is a symlink to `.agent-system/scripts/install.sh`. It has 474 non-empty lines and uses GNU `readlink -f` and `realpath -m`. Two more scripts are bash: `verify.sh` (112 non-empty lines) and `doctor.sh` (70).
  - `config.json:73-77` makes `verify.sh` the gate command, so the merge gate itself is bash.
- **The workspace layout needs a symlink.** `install.sh:315` runs `ln -s "../$repo_name" "$link"`, and `:307` checks it with `readlink -f`.
- **Hub autostart is systemd only.** `hubctl.py:372-434` shells out to `systemctl --user`. There is no launchd or macOS path anywhere (grep for launchctl, plist and LaunchAgent found nothing). `hub autostart` therefore already returns 1 on macOS ("systemd is unavailable").
- **The hub server itself is portable Node** (verified).
  - It uses `node:sqlite`, `hono` and `undici` on Node ≥24 (`hub/package.json` engines).
  - Paths default to `~/.config/agent-hub` and `~/.local/share/agent-hub` (`hub/server/src/config.ts:66-67`).
  - It uses `chmod 0o600` and `mode:` options, which are no-ops on Windows. That leaves the connector key unprotected by file mode (inferred).
- **herdr is hard-required for dispatch.**
  - `Herdr.require()` raises unless `HERDR_ENV==1` and the binary is on PATH (`scheduler.py:671-677`).
  - `--launch none` is the only bypass, and it means starting workers by hand.
- **herdr claims native Windows support, but I could not confirm the CLI the kit needs.** The herdr docs (v0.9.5) say native Windows is generally available; the kit-specific CLI commands are unconfirmed (details below).
- **Codex has a native Windows sandbox with caveats.** Claude Code has no sandbox on native Windows.

### Per-component table

| Component | Native Windows | WSL2 | Evidence |
|---|---|---|---|
| `scheduler.py` lock (`fcntl`) | **No**, import error | Works | `scheduler.py:16,601,610` (verified) |
| pid liveness / stop (`os.kill`) | **No**, can kill the target | Works | `scheduler.py:2074`, `agentctl.py:1077,1701`, `kitstart.py:229`, `hub-hooks.py:30`, `hubctl.py:346` (verified; Windows semantics inferred) |
| Detach (`start_new_session`) | Needs rework (`creationflags`) | Works | `hubctl.py:320`, `kitstart.py:252,341` (verified) |
| `agentctl.py` signals | Partial; SIGTERM is not deliverable | Works | `agentctl.py:1451,1618` (verified) |
| `chmod 0o600` secrets | No-op, so no protection | Works | `hubctl.py:142-144,325`, `agentctl.py:157-159` (verified) |
| `os.execvp` into herdr | Behaves differently | Works | `kitstart.py:333,344` (verified) |
| `install.sh` / `agent-kit` | **No**; needs a PowerShell or Python port | Works | `install.sh:26,288,315` (verified) |
| `verify.sh`, `doctor.sh` | **No** | Works | `config.json:73-77` (verified) |
| `hubctl.node24` (bash + nvm) | **No** | Works | `hubctl.py:272-280` (verified) |
| Hub autostart | **No** (needs Task Scheduler or similar) | Works if WSL systemd is enabled | `hubctl.py:372-434` (verified); WSL systemd requirement not verified this round |
| Hub server (Node 24) | Likely works; chmod is a no-op | Works | `hub/server/src/db.ts:5`, `config.ts:66-80` (verified code; Windows run not tested) |
| Workspace symlink `<repo>.workspace/<repo>` | Needs Developer Mode or admin | Works on ext4, not under `/mnt/c` | `install.sh:315` (verified); Git on Windows (below) |
| Git worktrees | Work in general | Work | `scheduler.py:927,1055` (verified) |
| herdr | **Unknown** for the kit's CLI | Works (it is Linux) | See External sources |
| Claude Code | Works, **no sandbox** | Works, **sandboxed** | `code.claude.com/docs/en/setup`, `/sandboxing` |
| Codex CLI | Native sandbox exists, with caveats | Linux sandbox | See External sources |
| Install via apt `.deb` | n/a | Works | `build-deb.sh`, `release.yml` |

### Recommended boundaries (suggestions, not current behavior)
- **D1: do (a) now.** Make WSL2-only support a first-class, tested path. Revisit (c) later, as a native Windows hub backend plus an installer, only if there is demand. Defer (b).
  - **Confidence: ~75% for (a) now.**
  - Native needs a port of three bash scripts and the Python process and locking layer. It also needs a Windows-capable herdr CLI contract, and its sandbox story is weaker.
  - The kit's default workers rely on the Codex `workspace-write` sandbox (`models.py:146-147`, `scheduler.py:820`).
  - On native Windows that depends on one of three sandbox implementations. Which one applies depends on the Windows version and on admin approval. It also has an open bug (below).
  - The Claude worker already runs with "no OS sandbox" (`models.py:151`), so native Claude lowers safety no further than today.
- **WSL2 "done properly" would add:**
  - an installer or doctor check for WSL2 versus WSL1, for being under `/mnt/c`, and for Python ≥3.11;
  - hub autostart inside WSL (needs `systemd=true` in `/etc/wsl.conf`; this is my recollection of the Microsoft docs, not fetched);
  - a Windows-side convenience launcher, for example `wsl.exe -d Ubuntu -- agent-kit start`;
  - a doc on Windows browser access to the hub (localhost forwarding is unverified, and I did not check the hub bind host).
- **D3: Windows-native distribution, if native is ever chosen.**
  - **Claude Code and herdr** each ship a PowerShell installer. Claude Code also ships winget as `Anthropic.ClaudeCode`. herdr's PowerShell one-liner is `irm https://herdr.dev/install.ps1 | iex`.
  - **agent-kit** has no Windows packaging today. Nothing is Python-package-shaped: the kit is stdlib-only scripts and an entry symlink (the absence of `pyproject` is inferred).
  - **Options:** a PowerShell installer script, a Scoop bucket, or a winget manifest (needs an installer artifact such as a zip plus a PR to winget-pkgs). pipx and npm would first need a pyproject or package.json, and neither exists.

### Decisive uncertainties (for round 2)
1. Whether the herdr Windows CLI supports the kit's commands: `agent start --kind … --pane … -- args`, `agent prompt --wait --until`, `agent read --source visible`, `workspace create --cwd … --no-focus`, `status server`, `integration install claude|codex`. Also whether `HERDR_ENV=1` is set in Windows panes.
2. Whether Codex `workspace-write` actually works in native `codex exec` today. Issue 34958 says it doesn't, on 0.145.0-alpha.18.
3. Whether the hub is reachable from the Windows host when it runs in WSL2 (bind host and localhost forwarding).
4. The macOS state. It is untested per the README, and `realpath -m` and `readlink -f` (GNU-only; BSD `realpath` has no `-m`) suggest `install.sh` has problems there that no one has reported (inferred).

## SYSTEM MAP
- **Entry.** `agent-kit` → `install.sh` (bash). Its subcommands are create, update, start, config and hub. `start` runs `python3 kitstart.py` (`install.sh:480`).
- **Orchestrator.** `kitstart.py` launches the orchestrator in herdr. Then `scheduler.py` and `agentctl.py` run workers in herdr panes, one git worktree per worker.
- **Workspace layout.** `<repo>.workspace/` holds config, state, tasks, worktrees and the symlink back to `<repo>` (`install.sh:16-17,315`). `scheduler.py:726-731` rejects a workspace inside the repo.
- **Hub.** The Node backend is started by `hubctl.hub_start` with `start_new_session` and a pidfile. A per-workspace connector (`agentctl.py watch`) is started detached from `kitstart.start_connector`.

## EVIDENCE MATRIX

| Finding | Path:line | Why it matters | Confidence / unknowns |
|---|---|---|---|
| `import fcntl`; exclusive `flock` on `scheduler.lock`, 30 s retry | `scheduler.py:16,592-611` | Hard import failure on Windows. Replacement: `msvcrt.locking` or a lock-directory/pidfile approach, only in `Store.lock`. | Verified |
| `os.kill(pid, 0)` in 5 places | `scheduler.py:2074`, `agentctl.py:1077`, `kitstart.py:229`, `hub-hooks.py:30`, `hubctl.py:346` (SIGTERM) | Can kill the checked process on Windows. Needs a single `pid_alive` helper (`agentctl.pid_alive` already exists and is reused at `hubctl.py:306,341`). | Verified; Windows semantics from Python docs, not re-fetched |
| `agentctl` installs SIGTERM/SIGINT handlers | `agentctl.py:1451-1453,1618` | SIGTERM is not usable on Windows. | Verified; behavior inferred |
| `start_new_session=True` | `hubctl.py:320`, `kitstart.py:252,341`; asserted in `test_scheduler.py:1767` | Needs `DETACHED_PROCESS` / `CREATE_NEW_PROCESS_GROUP` equivalent. | Verified |
| `shell=True` | none found (`scheduler.py:680` explicitly passes `shell=False`) | Good for porting. | Verified |
| `/tmp` hard-coded | none found in the 6 modules | Good. | Verified |
| `bash -c "source nvm.sh …"` | `hubctl.py:272-280` | POSIX-only Node resolution. Windows would use `where node` or `fnm`. | Verified |
| `chmod` of secrets | `hubctl.py:142-144,325`, `agentctl.py:157-159` | Secrets rely on file mode. Windows has no `0o600`; use ACLs (icacls) or the user profile ACL. | Verified |
| `HOME`-relative paths (`~/.config/agent-hub`, `~/.codex`) | `agentctl.py:114,119`, `hubctl.py:33,37`, `models.py:43`, `scheduler.py:2471` | Work via `expanduser` but are not Windows-idiomatic (`%APPDATA%`). Tests rely on `XDG_CONFIG_HOME`. | Verified |
| `SENSITIVE_DIR_NAMES` / home check | `scheduler.py:209-214` | Names probably Unix-oriented; Windows sensitive dirs not covered. | Verified location; contents not read (inferred) |
| Workspace `ln -s` and `readlink -f` | `install.sh:307,315`; test `test_scheduler.py:1204` | Windows needs symlink privilege, or a junction (directory-only) or a copy fallback. | Verified |
| `systemctl --user` unit generation | `hubctl.py:362-434`; tests `test_hubctl.py:246-311`; second unit generator in `hub/server/src/cli.ts:76-83` | Two systemd generators exist. No macOS or Windows equivalent. | Verified |
| `.deb` = `/usr/share/agent-kit` + `/usr/bin/agent-kit` symlink; `Depends: bash, git, python3 (>= 3.11)`; `Suggests: herdr` | `build-deb.sh:28-42` | There is no "package" beyond tar contents. | Verified |
| Release flow: tag → test → deb → GitHub release → signed apt repo on Pages | `release.yml:26-52` | CI runs only on `ubuntu-latest`. There is no Windows CI job. | Verified |
| README Windows section: WSL2 only; "Native Windows … not supported" | `README.md:152-182,806` | Existing docs. Also: `README.md:64` and `:806` ("developed on Linux; macOS untested") | Verified |
| herdr commands used: `workspace create/close/focus`, `agent start/prompt/get/read/focus/list`, `status server`, `integration status/install` | `scheduler.py:688-711,2546`, `kitstart.py:130,137,152`, `agentctl.py:401,429,543` | This is the full surface to verify on Windows. | Verified |
| `-s <sandbox> -a <approval>` and `--add-dir` passed to Codex | `scheduler.py:820-830` | Codex-specific sandbox flags. | Verified |

## EXTERNAL SOURCES (fetched 2026-10-31)
- **herdr, Windows page** (https://herdr.dev/docs/windows-beta/, docs v0.9.5, undated).
  - **Status:** "Native Windows support is generally available." Search snippets and third-party posts call it beta/preview; the URL slug still says "windows-beta". This is a conflict (see uncertainties).
  - **Runtime:** it uses ConPTY. No minimum Windows version is stated.
  - **Supported:**
    - local persistent sessions
    - native panes
    - Windows Terminal/PowerShell attach
    - `--remote`
    - `cmd.exe` panes
    - agent command discovery
    - process-tree detection
    - self-report integrations for supported agents
  - **Not supported:** `herdr terminal attach`, live server handoff, and Unix foreground process groups.
  - **Integration installation:** it "covers a narrower set of agents than on Unix."
  - **Not documented:** the page does not mention `agent start`, `agent prompt` or `workspace create`.
  - **Install:** `powershell -ExecutionPolicy Bypass -c "irm https://herdr.dev/install.ps1 | iex"`.
- **herdr, releases** (https://github.com/ogulcancelik/herdr/releases).
  - v0.9.5 was released 14 Oct 2026, and v0.9.2 on 29 Sep 2026.
  - Windows-specific fixes are listed in each:
    - Windows panes default to `pwsh`.
    - A Claude Code multi-line paste fix.
    - Claude session tracking with non-ASCII user folders.
    - Codex and Pi status recognition.
  - So herdr has real Windows traffic and agent tracking for Claude and Codex.
  - The GitHub README itself says nothing on status. It only has the PowerShell installer line.
- **Claude Code** (https://code.claude.com/docs/en/setup; shows version `2.1.211` as an example).
  - **Platforms:** Windows 10 1809+ is supported natively.
  - **Git Bash:** Git for Windows is optional. Without it, Claude Code uses PowerShell as the shell tool.
  - **Installers:** PowerShell `irm https://claude.ai/install.ps1 | iex`, CMD, and `winget install Anthropic.ClaudeCode` (winget installs do not auto-update).
  - **Native table:** native Windows → Sandboxing "Not supported". WSL 2 → "Supported". WSL 1 → "Not supported".
  - **Sandboxing page** (https://code.claude.com/docs/en/sandboxing): "On native Windows, Claude Code runs commands unsandboxed."
- **Codex** (official page, 308-redirected from developers.openai.com/codex/windows to https://learn.chatgpt.com/docs/windows/windows-sandbox; undated). I followed the redirect, so this is the redirected host's content.
  - **Native sandbox:** it works with the CLI, in PowerShell, with no WSL or VM.
  - **Three implementations:**
    - `mxc` (recommended): needs Windows 11 24H2 (build 26100.9278) or 25H2 (build 26200.9278); test with CLI ≥0.162.0.
    - `elevated`: needs administrator-approved setup and creates dedicated sandbox users and firewall rules.
    - `unelevated`: "weaker network isolation" and no denied read paths.
  - **Windows 10:** best effort only.
  - **WSL2:** recommended when you need Linux tooling.
  - **`workspace-write`:** the page does not use that term; it says the permission profile controls readable and writable paths.
  - **Open bug** (https://github.com/openai/codex/issues/34958, CLI 0.145.0-alpha.18): native `codex exec --sandbox workspace-write` exits 0, but model writes inside the cwd are rejected as read-only. This is user-reported and I could not confirm whether it is fixed.
  - **Earlier bug** (https://github.com/openai/codex/issues/9062, v0.80.0): approval prompts on nearly every command on native Windows.
  - **Kit baseline:** the kit requires Codex 0.163.0+ (`README.md:65`).
- **Git symlinks.** On Windows, `git clone` and `git init` typically set `core.symlinks=false`, and creating symlinks needs Developer Mode or elevation. This comes from the git-config documentation as I remember it; the fetch was truncated before that entry (inferred). The Microsoft Developer Mode page returned 404, so I could not cite it. Treat as unconfirmed.
- **Python on Windows.** `fcntl` is Unix-only; `msvcrt.locking` is the standard-library equivalent for a byte-range lock. The Context7 query returned no `msvcrt` content, so this is from knowledge and unverified here.

## CONTRACTS AND INVARIANTS
- The scheduler lock is a cross-process exclusive lock with a 30 s timeout. Its error message is "another scheduler instance holds the lock" (`scheduler.py:593-611`). Any port must keep the same semantics.
- State writes are atomic (`os.replace` after fsync, `scheduler.py:621-634`). `os.replace` is atomic on Windows when the destination isn't open elsewhere.
- Workers must run sandboxed: `danger-full-access` is rejected (`scheduler.py:183-184`). Native Windows must keep this guarantee, or the kit must declare that it is weakened.
- A herdr state is an observation, never authority (`scheduler.py:665`).
- The workspace must not be inside the repo (`scheduler.py:726-731`).

## EXISTING TESTS AND CHECKS
- Tests: `python3 -m unittest discover -s .agent-system/tests -q` (from `release.yml:39`). Files: `test_scheduler.py`, `test_agentctl.py`, `test_hubctl.py`, `test_hubschema.py`, `test_hub_hooks.py`. I did not run them.
- The tests use a `FakeHerdr`, so herdr contract changes are mostly untested against the real binary.
- POSIX assumptions inside the tests: `chmod(0o755)` stubs (`test_scheduler.py:65`), `symlink_to` (`:1204`), `/usr/bin/systemctl` mocks (`test_hubctl.py:246-311`), `chmod(0o600)` checks (`test_hubctl.py:85,118`).
- Hub tests use vitest. CI runs on Linux only.

## RISKS / CONFLICTS / OPEN QUESTIONS
- **Conflict on herdr's Windows status.** Official docs v0.9.5 say "generally available"; a search snippet and third-party blog posts say beta/preview. The docs page is undated, so I could not tell which is newer. The release notes show active Windows work, but the page doesn't say whether `agent start/prompt` work.
- **Silent loss of the safety boundary.** If native Windows were allowed and Codex fell back to an unelevated or no sandbox, the kit's `worker-safety` check (`scheduler.py:2502`) tests only the worker program, not the actual sandbox. It would not notice (inferred).
- **Timing.** The `mxc` sandbox needs Windows 11 24H2/25H2 builds, so a large share of Windows 10 and older Windows 11 machines would get weaker modes.
- **WSL2 gaps.** The hub's WSL systemd autostart needs `systemd=true` in `/etc/wsl.conf`. Without it, `hub autostart` fails with "systemctl was not found" or a bus error.
- **Possible macOS parity bugs** (`readlink -f`, `realpath -m`, missing launchd). If the user wants "all platforms", fixing these is separate and cheaper than Windows.
- **Open question for Opus:** is the user's goal "Windows users can use it" (WSL2 is enough) or "no WSL" (native is required)? That decides D1.

## CANDIDATE TASK DAG (suggestions only)
1. **T1: WSL2 hardening** (docs plus doctor/installer checks). Independent. Check WSL version, `/mnt/c` location, Python ≥3.11 and WSL systemd; add the `wsl.exe` launcher note. Update `README.md` Windows section and `doctor.sh`.
2. **T2: Portability shim in Python, only if (b)/(c) is chosen.** Introduce `platform_compat.py` with `lock`, `pid_alive`, `detach_kwargs`, `secure_file` and `sandbox_probe`. Replace the 5 `os.kill`, the `fcntl` lock and the `start_new_session` callers. Needs T3's verified herdr contract first. Unit-testable on Linux with mocks; add `windows-latest` CI later.
3. **T3: Native Windows installer and hub backend.** Depends on T2 and the herdr and Codex answers. A PowerShell `agent-kit.ps1` replacing `install.sh` subcommands, a Task Scheduler autostart for the hub, a zip or Scoop/winget artifact in `release.yml`, and replacing the bash gate (`verify.sh`) with a Python entry.

Dependency rationale: T1 is useful in every scenario. T2 and T3 are gated by the herdr and Codex uncertainties.

## TARGETED FOLLOW-UP QUERIES (round 2)
1. Run on a real Windows host, or find the herdr repo docs/API reference for: `herdr agent start --kind claude|codex --pane … --timeout … -- <args>`, `agent prompt … --wait --until working --until blocked`, `agent read --source visible`, `workspace create --cwd … --no-focus`, `status server`, and the HERDR_ENV semantics. Also which agent kinds `integration install` supports on Windows. The API page is at `herdr.dev/tui/docs/socket-api/`.
2. Check whether Codex issue 34958 is fixed in current CLI releases, and whether `-s workspace-write -a on-request -C … --add-dir …` plus `--profile worker` works on native Windows 11 24H2 (`mxc`).
3. Get Microsoft's WSL2 documentation (systemd in `/etc/wsl.conf`, localhost forwarding or mirrored networking) to ground the hub autostart and browser access in T1. Also get Git for Windows's symlink behavior from the Git for Windows wiki.
4. Check what the git worktree and symlink behavior is for `<repo>.workspace/<repo> -> ../<repo>` on NTFS with Developer Mode, and whether a junction would be an acceptable fallback.
5. (Optional) Check whether macOS `install.sh` works at all (`realpath -m`), to scope "all platforms".

Sources: https://herdr.dev/docs/windows-beta/ · https://github.com/ogulcancelik/herdr/releases · https://code.claude.com/docs/en/setup · https://code.claude.com/docs/en/sandboxing · https://learn.chatgpt.com/docs/windows/windows-sandbox · https://github.com/openai/codex/issues/34958 · https://github.com/openai/codex/issues/9062 · https://git-scm.com/docs/git-config