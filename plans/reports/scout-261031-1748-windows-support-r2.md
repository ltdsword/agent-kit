# Targeted packet win-support-r2

RESEARCH_ID: win-support-r2 · REPO: /home/lap17124/Code/agent-kit (branch hub/plan). Read-only. Round 1 is `plans/reports/scout-261031-1748-windows-support-r1.md`.

## Decision-ready index
- **Q1 herdr:**
  - The CLI the kit uses is documented in the herdr v0.9.5 CLI reference, with only one Windows-specific note, for Codex `agent prompt`.
  - Native Windows is GA with listed limits, and `HERDR_ENV=1` is injected into managed panes.
  - I did not find any Windows gating of the individual commands. Nobody has run them on Windows.
- **Q2 Codex:**
  - #34958 is closed, but by the reporter, with no fix, PR or release.
  - 0.165.0 status is unknown. Nothing here shows an interactive run working.
- **Q3 WSL2:**
  - Systemd is the default only for the Ubuntu that `wsl --install` installs. Other distros need `systemd=true`.
  - Services bound to 127.0.0.1 are reachable from Windows in NAT mode, and also in mirrored mode (Windows 11 22H2 and later).
  - Systemd services do not keep WSL alive.
- **Q4 macOS:**
  - Only `install.sh:288` (`realpath -m`) fails on stock macOS.
  - `readlink -f` works from macOS 12.3.
- **Q5 junctions:**
  - A junction needs no Developer Mode, but nobody has verified it with git worktrees or the kit.
  - `[ -L ]` is likely to fail on a junction.
- **D1 recommendation:** WSL2-first, keep native Windows as a deferred, opt-in track. Details at the end.

## Q1. herdr on native Windows

**Answer:** The commands are documented, and Windows is GA. Per-command Windows support is not proven.

**Evidence (verified by reading docs):**
- **Repo moved.** The project is now `github.com/herdrdev/herdr` (branch `master`). The herdr.dev docs index links there. Round 1 and your prompt used `ogulcancelik/herdr`.
- **CLI reference, docs v0.9.5.** Source: `raw.githubusercontent.com/herdrdev/herdr/master/docs/versions/0.9.5/website/src/content/docs/cli-reference.mdx`. It documents the kit's syntax:
  - `herdr agent start <name> --kind KIND --pane ID [--timeout MS] [-- args]`
    - `--kind` accepts claude and codex.
    - `--timeout` must be > 3000 and ≤ 300000 ms.
    - `--pane` must be an idle shell pane.
  - `agent prompt <target> <text> [--wait] [--until STATUS]... [--timeout MS]`
    - `--until` is repeatable and requires `--wait`.
    - Without `--until`, it waits for idle, done or blocked.
    - A prompt sent from a non-working state must show `working` or `blocked` within 5 s, or herdr returns `agent_prompt_stalled`.
  - `agent get`, `agent list`
  - `agent read <target> --source visible|recent|recent-unwrapped|detection`
  - `workspace create --cwd PATH --label TEXT --no-focus`
  - `workspace close <id> [--group]`
  - `status server`
  - `integration install claude|codex`
- **Windows note in that file.** "Codex receives a paste boundary before Enter... The caller's `--timeout` includes submission time." This implies `agent prompt` is meant to work on Windows. The file lists no other Windows exceptions.
- **Windows support page.** Source: `https://herdr.dev/docs/windows-beta`, with the same file under `docs/versions/0.9.5/...windows-beta.mdx`.
  - It says "Native Windows support is generally available."
  - Supported on Windows: ConPTY panes, `cmd.exe` panes, agent discovery, process-tree detection, worktree detection, and `integration install` for Claude Code and Codex.
  - Not supported: `herdr terminal attach`, live server handoff, Unix fd handoff, Unix foreground process groups.
  - An elevated server accepts only administrator clients by default. Sharing needs `allow_unelevated_clients = true`.
  - The page does not list the individual commands above.
- **GA vs beta, resolved.**
  - GA: the install page (`https://herdr.dev/tui/docs/install/`, docs 0.9.5) says "Windows is generally available, with documented platform-specific limitations and ongoing fixes."
  - GA: the Windows page body says the same.
  - "Beta" is only the stale URL slug `windows-beta` (and the filename). Treat it as GA with known limits.
- **`HERDR_ENV`.** `https://herdr.dev/tui/docs/socket-api/` says herdr injects `HERDR_ENV=1` into managed pane processes. That page is not Windows-specific, and the Windows page does not mention it.
- **Transport.** The socket API is a named pipe on Windows and a Unix socket elsewhere. The kit calls the CLI, not the socket, so this is fine.
- **Releases.** `api.github.com/repos/herdrdev/herdr/releases`:
  - v0.9.5 (2026-10-14) and v0.9.4 (2026-10-13) are both Windows fixes. v0.9.4 made an elevated server accept only admin clients by default.
  - v0.9.3 is 2026-09-29.
  - Preview builds are published alongside.
  - Stable is the default channel.

**Confidence:**
- Documented CLI and GA status: high.
- Per-command behavior on Windows, `HERDR_ENV` in Windows panes, and `$HERDR_PANE`-style env: medium-low. Docs say yes (inferred from the Windows note and the general `HERDR_ENV` statement) but nothing was executed.

**Unknown:**
- The Rust source gating (`cfg(windows)`/`cfg(unix)`). The tree API returned docs paths first and truncated, and I did not locate `src/`. This is not verified.
- Whether `--until working` with Claude panes behaves the same on Windows.
- Whether the kit's other herdr uses are affected: `os.execvp("herdr")` at `kitstart.py:333,344` and the pane-id env variables.

**Suggested decisive check (needs a Windows box):** run `herdr agent start`, then `agent prompt --wait --until working --until blocked`, then `agent read --source visible`. Also confirm `$HERDR_ENV` inside a pane.

## Q2. Codex on native Windows

**Answer:** #34958 is not fixed. Whether it affects 0.165.0 is unknown.

**Evidence:**
- **#34958** (`https://github.com/openai/codex/issues/34958`, fetched this round):
  - Closed as completed on 2026-07-23, the day it was opened. The reporter closed it. There is no maintainer comment, no linked PR or branch, and no fix release.
  - It was reported against `0.145.0-alpha.18`, for direct `codex exec --sandbox workspace-write` on native Windows. It exits 0, but model writes inside the workdir are rejected as read-only.
  - It does not mention mxc, elevated or unelevated. It says "elevated" was an unacceptable alternative to the reporter.
  - The root cause is not established.
- **Related, from a web search (search-result summaries only; I did not open these threads):**
  - #30712 and #32880 reference PR #31138, merged July 8, which changes Windows writable-root ACL handling. I could not tell which release includes it.
  - #17179 describes the elevated sandbox changing project ownership and causing persistent write failures.
  - #32880 says the elevated sandbox protects `.git`, which can block git writes even under workspace-write.
- **Official docs** (`https://learn.chatgpt.com/docs/windows/windows-sandbox`, redirected from `developers.openai.com/codex/windows`):
  - Three implementations: `mxc` (recommended), `elevated` (preferred legacy fallback) and `unelevated` (weaker network isolation, no denied read paths).
  - `mxc` needs Windows 11 24H2 build 26100.9278 or 25H2 build 26200.9278, and `[features] prefer_mxc = true`.
  - The legacy modes are chosen with `[windows] sandbox = "elevated"|"unelevated"`.
  - You can test mxc with `codex -c windows.sandbox=mxc sandbox ...`, available from CLI 0.162.0.
  - Child processes stop when the foreground command exits.
  - Windows 11 is recommended. Windows 10 1809 and newer is best effort.
  - The docs name no flags for `--profile`, `-s`, `-a` or `--add-dir`.
- **Latest release:** I saw `rust-v0.166.0` (2026-10-29). Release bodies were not readable. 0.165.0 is here, so there is a newer release.

**Interactive `codex --profile worker -s workspace-write -a on-request -C <dir> --add-dir <dir>`:**
- No source confirms or denies it for any of the three sandboxes. The only documented break is the exec path in #34958.
- Round 1's pointer to the sandbox probe is consistent with this. The reporter's lower-level probe allowed in-workspace writes and blocked out-of-workspace writes.
- Confidence: low. This is an open question, not a finding.

**Unknown:** which release fixed it, if any. To settle it you need a Windows 11 24H2 machine running 0.165.0 and 0.166.0 with `-c windows.sandbox=mxc|elevated|unelevated`, plus a write test inside and outside the workspace. This is not testable from Linux.

## Q3. WSL2

**Answer:**
- **Systemd.** It is on by default only for "the current version of Ubuntu" installed by `wsl --install`. This is Microsoft's wording (`https://learn.microsoft.com/en-us/windows/wsl/systemd`, ms.date 2025-01-13, updated 2026-06-02).
  - Other distros need `[boot] systemd=true` in `/etc/wsl.conf`, WSL ≥ 0.67.6, and the `systemd-sysv` package on Debian/Ubuntu/Kali.
  - The `wsl-config` page (`https://learn.microsoft.com/en-us/windows/wsl/wsl-config`, ms.date 2026-10-16) lists the key as `systemd`, boolean, default `false`, "Only supported on WSL 2".
  - The `[boot]` setting is "only available on Windows 11 and Server 2022".
  - The two pages are slightly inconsistent. The key default is false, and Ubuntu's image sets it.
  - The doctor check should read `systemctl is-system-running` or `/etc/wsl.conf` and not assume.
- **Localhost.** `https://learn.microsoft.com/en-us/windows/wsl/networking` (updated 2026-06-02) says that in the default NAT mode, a networking app in Linux is reachable from Windows via `localhost`.
  - `.wslconfig` `[wsl2] localhostForwarding` defaults to true. It says ports bound to wildcard or localhost in the VM are connectable from the host via `localhost:port`. It is ignored when `networkingMode=mirrored`.
  - Mirrored mode needs Windows 11 22H2 or later. In it, Windows and WSL can reach each other via `127.0.0.1`. `::1` is unsupported, and inbound LAN access needs a Hyper-V firewall rule.
  - NAT-mode caveat: LAN or remote IP access needs a `0.0.0.0` bind.
  - A hub bound to 127.0.0.1 inside WSL is therefore reachable from the Windows browser. I did not verify the hub's bind host in the repo this round.
- **Keepalive.**
  - "systemd services will NOT keep your WSL instance alive", same systemd page.
  - `.wslconfig` `[wsl2] vmIdleTimeout` defaults to 60000 ms. It is Windows 11 only.
  - `[general] instanceIdleTimeout` defaults to 15000 ms, and -1 disables auto-shutdown.
  - The docs describe no `wsl.exe` keepalive, but the standard trick is a long-running `wsl.exe` process, for example `wsl.exe -d Ubuntu -- sleep infinity`, as a hidden scheduled task. This part is inferred. I could not find official guidance for it.
  - Config changes follow the 8-second rule: they apply after `wsl --shutdown`.

**Confidence:** high on the settings. Medium on whether `instanceIdleTimeout=-1` is enough to keep the hub up through user logoff and reboot (inferred).

**Unknown:** WSL version minimums for `instanceIdleTimeout`. The wsl-config page does not say.

## Q4. macOS

**Answer:**
- **`realpath -m`.** The macOS man page shows `realpath [-q] [path ...]` and no `-m` (mirror `leancrew.com/all-this/man/man1/realpath.html`, a third-party mirror; I did not check Apple's own page). I did not verify macOS 13+ specifically.
  - macOS `realpath` fails on nonexistent paths. A coreutils bug-list thread says it is a thin wrapper around the realpath function.
  - Treat `-m` as unsupported (medium confidence).
- **`readlink -f`.** It was added in macOS 12.3 (Monterey, March 2022), per `https://scriptingosx.com/2022/03/some-cli-updates-in-macos-monterey/` (secondary source).
  - Older macOS rejects it ("illegal option -f").

**install.sh lines that fail on stock macOS (verified in `.agent-system/scripts/install.sh`):**
- `:288` `realpath -m -- "${FOLDER:-$PWD}"`. This is the only blocker. It must tolerate a nonexistent path, because `--folder` can name a not-yet-created repo.
- `:26` `readlink -f "${BASH_SOURCE[0]}"` is fine on macOS 12.3 and later. It is only a risk on macOS 12.2 and older.
- `:307` `readlink -f "$link"` has the same status.
- `:404` already uses `python3 ... os.path.realpath(...)`.
- I only grepped for these specific commands. I did not audit the rest of the script for other GNU-isms such as `sed -i`, `date -d`, `stat -c` or `mktemp`. Grep returned no `sed -i` hits.

**Portable replacement (suggestion, not current behavior):** `python3 -c 'import os,sys; print(os.path.realpath(os.path.expanduser(sys.argv[1])))' "${FOLDER:-$PWD}"`.
- `os.path.realpath` is non-strict by default, so it tolerates missing paths and matches `-m`.
- It already matches the pattern at `:404`, so the kit already depends on `python3`.
- Use `os.path.realpath`, not `readlink -f`. A simple `readlink -f` swap would also fail on nonexistent paths in `:288`.

## Q5. Native Windows: directory junctions instead of symlinks

**Answer:** In principle yes, but unverified.

**Evidence (secondary sources only):**
- A web-search summary of the Git for Windows wiki (`https://github.com/git-for-windows/git/wiki/symbolic-links`) says junctions (`mklink /J`) can be created by non-admin users by default.
- Git for Windows has `core.symlinks` off by default. A junction is treated as an ordinary directory and does not depend on that setting.
- A Jenkins bug report warns that `clean` or wipe operations can follow a junction and delete files in the target. This matters for `git clean` and worktree cleanup.
- I found no source confirming how `git worktree` treats a junction.

**Reasoning (inferred):**
- `git worktree add` itself does not need the `<repo>.workspace/<repo>` link. It operates on the real repo. Only the kit's path convention depends on it.
- `[ -L "$link" ]` at `install.sh:306,315` would likely not detect a junction in Git Bash or MSYS. Junctions are reparse points but not POSIX symlinks, so the script's idempotency check could fail and it could try to recreate the link. This is not tested.
- A junction needs an absolute target. The relative `../<repo>` form in `install.sh:315` would have to be resolved to an absolute path, and the junction would break if the folders move.
- On WSL2 none of this applies, since ext4 symlinks work.
- Alternatives are a copy or an env-configured project path, which would need a kit change.

**Unknown:** worktree behavior with a junction, `git clean` traversal, and the actual `-L` result. Test on a Windows machine.

## Updated recommendation for D1

**WSL2-first, with native Windows deferred as an opt-in track (a staged hybrid).**
- **Do now (WSL2).** Support WSL2 on Ubuntu.
  - The Ubuntu distro installed by `wsl --install` has systemd enabled by default, so `systemctl --user` autostart (`hubctl.py:362-434`) works.
  - A hub on 127.0.0.1 is reachable from Windows via localhost.
  - Two real caveats to document and enforce. First, don't install the kit under `/mnt/c`. Second, keep the instance alive with `instanceIdleTimeout=-1` and/or a `wsl.exe` keepalive task.
  - This path avoids everything round 1 flagged: fcntl, os.kill, execvp and chmod.
- **Defer native.** Round 1's blockers still apply (fcntl, os.kill, execvp, bash scripts, chmod). Two further blockers now:
  - herdr per-command Windows support is documented but unverified.
  - Codex Windows sandbox write behavior (#34958) is unresolved, and the interactive path is unverified.
  - A junction is also unverified for the kit.
  - Revisit native only after the Windows-box checks below pass.
- **Cheap macOS fix.** Replace `realpath -m` at `install.sh:288` with the Python one-liner.
- **Windows-box verification (the highest-value next check):**
  1. herdr command smoke test.
  2. Codex interactive workspace-write under mxc, elevated and unelevated, on 0.165.0 and 0.166.0.
  3. Junction plus `git worktree add`.

## Candidate task DAG (suggestions)
1. WSL2 doctor and docs: check WSL2 vs WSL1, `/mnt/c`, systemd state, Python ≥3.11; document `.wslconfig` keepalive and localhost access. Independent.
2. `install.sh:288` portable path resolution (Python). Independent, small.
3. Windows-box smoke test (herdr, Codex, junction). Blocks any native decision.

## Open questions
- herdr Rust-source gating for the listed commands was not located.
- Whether Codex #34958 reproduces on 0.165.0 or 0.166.0, and whether the interactive command works under mxc, elevated and unelevated.
- A junction with worktrees and the kit's `-L` checks.
- The hub's bind host (not checked this round).

Sources:
- [herdr CLI reference 0.9.5](https://raw.githubusercontent.com/herdrdev/herdr/master/docs/versions/0.9.5/website/src/content/docs/cli-reference.mdx)
- [herdr Windows page](https://herdr.dev/docs/windows-beta)
- [herdr install](https://herdr.dev/tui/docs/install/)
- [herdr socket API](https://herdr.dev/tui/docs/socket-api/)
- [herdr releases API](https://api.github.com/repos/herdrdev/herdr/releases?per_page=5)
- [Codex #34958](https://github.com/openai/codex/issues/34958)
- [Codex Windows sandbox docs](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [Codex releases API](https://api.github.com/repos/openai/codex/releases?per_page=12)
- [WSL wsl-config](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
- [WSL systemd](https://learn.microsoft.com/en-us/windows/wsl/systemd)
- [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking)
- [Scripting OS X on macOS 12.3 CLI updates](https://scriptingosx.com/2022/03/some-cli-updates-in-macos-monterey/)
- [realpath man page mirror](https://leancrew.com/all-this/man/man1/realpath.html)
- [Git for Windows symbolic links wiki](https://github.com/git-for-windows/git/wiki/symbolic-links)