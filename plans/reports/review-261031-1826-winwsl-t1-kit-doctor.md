# Review: winwsl T1 (kit doctor WSL checks, portable realpath)

Verdict: PASS. Matches the plan Contract: five checks, names, levels and messages; WSL detection via
osrelease with /proc/version fallback; /mnt/<letter>/ rule; checks appended after the tool checks,
existing order kept. `project` is defined (scheduler.py:2525) before use. install.sh:288 uses
python os.path.realpath (same semantics as realpath -m). Tests: wsl_kind, windows_drive_paths,
doctor under patched WSL (WSL1 fail, /mnt/c warn, no systemd warn), plain Linux has no wsl-*,
Python <3.11 fail, create with a fake macOS realpath. Ran `python3 -m pytest -q .agent-system/tests`
in the worktree: 187 passed; `bash -n install.sh` ok.
Notes: keepalive is advisory only (the .wslconfig lives on the Windows side), as specified.
