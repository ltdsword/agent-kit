# Review mrepo T1 (create with name/location/repos, config --repo) - PASS with Opus minor fix

- Flags --name/--location/--repo (repeatable) validated per command; --folder legacy path unchanged (also auto when cwd is *.workspace).
- Defaults: name <cwd>.workspace; location cwd or the repo's parent; repo = cwd only when it is a repo top. Paths abs, ~/,
  relative; realpath. Dialog via AGENT_KIT_CREATE_DIALOG (default create-dialog.sh): 0 JSON validated, 1 cancel, 2 -> read -e -i prompts.
- Per repo: ensure_git_repo, top-folder check, same-basename and dest-inside-repo refusals, relative symlinks, unchanged check.
  project.repos written only for >1 repo (single repo stays as before); writable_dirs union; CLAUDE.md per repo.
- update checks every project.repos link; kitconfig --repo with RUNNING refusal; --show lists repos.
- Minor fix (Opus): restored the "Next" steps after create (TODOs, doctor, start --folder).
- Note: read -i needs bash 4+ (macOS bash 3.2 falls back to the defaults); acceptable since the Herdr dialog/flags cover it.
- Suite: 301 passed.
