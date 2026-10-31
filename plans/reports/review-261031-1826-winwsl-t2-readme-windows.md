# Review: winwsl T2 (README Windows WSL2 section)

Verdict: MINOR_FIX (fixed by Opus). All T2 items present, style kept, native still unsupported.
Fix: the "Start from Windows" command `wsl -d Ubuntu -- agent-kit start --folder ~/code/<repo>`
would not work: `wsl ... --` runs without a login shell (no `~` expansion, `~/.local/bin` not on
PATH for Git installs) and the kit only accepts `--folder=<repo>`. Replaced with
`wsl -d Ubuntu --cd ~ -- bash -lc "agent-kit start --folder=code/<repo>"` plus one sentence why.
Opus applied the fix before commit-task; it is in commit 7d1ee3e. Final verdict PASS.
