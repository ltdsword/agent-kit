# winwsl: Windows support via WSL2, done properly (+ macOS realpath fix)

## User decisions
- D11 (2026-10-31): **A, WSL2 done properly (one run)**. Native Windows deferred until it can be tested
  on the user's Windows 11 machine. A repo under `/mnt/c` must **warn, not block**, with advice.
- Research: `plans/reports/scout-261031-1748-windows-support-r1.md`, `...-r2.md` (2 of 3 scout rounds).

## Contract (shared by T1 and T2)
Doctor check names and levels (`scheduler.py doctor`, printed by `doctor.sh` as `[OK  ]/[WARN]/[FAIL]`):

| check | when | ok | not ok |
|---|---|---|---|
| `python-version` | always | Python >= 3.11 | **fail**: "Python 3.11+ required (found X.Y)" |
| `wsl-version` | only inside WSL | WSL 2 | **fail**: WSL 1 is not supported; in PowerShell: `wsl --set-version <distro> 2` |
| `wsl-location` | only inside WSL | workspace and repo are in the Linux filesystem | **warn**: names the path on `/mnt/<drive>`; git, builds and workers are much slower there and the workspace symlink is less reliable; keep repos in the WSL home (e.g. `~/code`) and open them from Windows via `\\wsl.localhost\<distro>\home\<user>` or VS Code's WSL extension |
| `wsl-systemd` | only inside WSL | `/run/systemd/system` exists | **warn**: `agent-kit hub autostart` needs systemd: add `[boot]` `systemd=true` to `/etc/wsl.conf`, then `wsl --shutdown` in PowerShell |
| `wsl-keepalive` | only inside WSL | always ok (advice) | detail: WSL stops when idle and the hub with it; to keep it running set `instanceIdleTimeout=-1` under `[general]` in `%UserProfile%\.wslconfig` (then `wsl --shutdown`) |

WSL detection: `/proc/sys/kernel/osrelease` (fallback `/proc/version`) contains `microsoft` (any case) → WSL;
contains `wsl2` (any case) → WSL 2, else WSL 1. Distro name: env `WSL_DISTRO_NAME` (fallback `Ubuntu`).
A path is "on a Windows drive" when its resolved form starts with `/mnt/<one letter>/`.

## T1: Kit code (worker)
1. `scheduler.py`: pure helpers `wsl_kind(osrelease_text) -> None|"wsl1"|"wsl2"`,
   `windows_drive_paths(paths) -> list[str]`, a small reader for the osrelease text, and the checks
   above added to `doctor()` (python-version for everyone; wsl-* only when WSL is detected).
   Keep existing checks and their order; append the new ones after the tool checks.
2. `install.sh:288`: replace `realpath -m -- "${FOLDER:-$PWD}"` with
   `python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${FOLDER:-$PWD}"` (same
   semantics as `realpath -m`: absolute, symlinks resolved, missing parts allowed; macOS has no `-m`).
   Do not touch `readlink -f` (fine on macOS 12.3+, the README minimum).
3. Tests (`test_scheduler.py`): `wsl_kind` for WSL1/WSL2/plain Linux strings; `windows_drive_paths`;
   doctor under patched WSL detection reports the four wsl-* checks with the right levels
   (WSL1 fail, /mnt/c project warn, no systemd warn) and plain Linux reports none of them;
   python-version present. Install: `create --folder=<path>` works with a fake `realpath` first on
   PATH that exits 1 when given `-m` (simulates macOS).

## T2: Docs (worker)
README "Windows (WSL2)" section (`README.md` ~152-182), keep its style and existing steps; add:
- **Where to keep repos / working with Windows files**: Windows drives are `/mnt/c/...`; a repo there
  works but is slower and the symlink less reliable, doctor warns; recommended: repos in the WSL home,
  open from Explorer `\\wsl.localhost\Ubuntu\home\<you>\...` or `code .` with VS Code's WSL extension.
- **Keep the hub running**: systemd is on by default for the Ubuntu `wsl --install` sets up (else
  `/etc/wsl.conf` `[boot] systemd=true`); WSL stops when idle: `%UserProfile%\.wslconfig`
  `[general]` `instanceIdleTimeout=-1`, then `wsl --shutdown`. The hub website works from any
  browser; the local backend listens on 127.0.0.1, reachable from Windows via localhost.
- **Start from Windows**: Windows Terminal / PowerShell: `wsl -d Ubuntu -- agent-kit start --folder ~/code/<repo>`
  (or a Windows Terminal profile with that command line).
- **Doctor checks**: list the five checks of the contract in one short table or list.
- Keep "Native Windows (PowerShell, cmd) is not supported" and add one line: planned, pending tests
  of herdr and the Codex sandbox on Windows.

## Verification
`python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh`; review the README diff.
