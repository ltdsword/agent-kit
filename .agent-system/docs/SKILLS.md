# Engineering skills (workstation install)

The kit works without these. When installed, each role picks up only its own set.

| Role | Skill | Source (commit installed 2026-10-31) | Where |
|---|---|---|---|
| Scout (Sonnet) | `agent-kit-research` (kit-owned, read-only) | adapted from the two research skills below (MIT) | `<workspace>/.claude/skills/`, copied by `agent-kit create/update`; preloaded via `skills:` in `scout.md` |
| Scout (Sonnet) | Context7 MCP (`resolve-library-id`, `query-docs`) | https://github.com/upstash/context7 | user MCP config (`~/.claude.json`) |
| Opus | `research`, `codebase-design`, `domain-modeling` | https://github.com/mattpocock/skills @ `a496f55` | `~/.claude/skills/` |
| Opus | `search-first`, `architecture-decision-records` | https://github.com/affaan-m/ECC @ `b38be6a` | `~/.claude/skills/` |
| Opus | `architecture-patterns` | https://github.com/wshobson/agents @ `7e2fb55` | `~/.claude/skills/` |
| Codex workers | `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `receiving-code-review` | https://github.com/obra/superpowers @ `2ce8aa1` | `~/.agents/skills/` (Codex user scope) |

Not installed on purpose: Superpowers' orchestration skills (`dispatching-parallel-agents`,
`using-git-worktrees`, `subagent-driven-development`, `finishing-a-development-branch`): the
scheduler owns workers, worktrees and finishing.

## Install on a new machine
Needs Node 22.20+ (`nvm use 24`). `--copy` matters: the default symlink mode keeps a shared copy in
`~/.agents/skills`, which Codex workers read, so Opus's skills would leak to workers.
```bash
npx skills@latest add mattpocock/skills -s research -s codebase-design -s domain-modeling -g -a claude-code --copy -y
npx skills@latest add affaan-m/ECC -s search-first -s architecture-decision-records -g -a claude-code --copy -y
npx skills@latest add wshobson/agents -s architecture-patterns -g -a claude-code --copy -y
npx skills@latest add obra/superpowers -s test-driven-development -s systematic-debugging \
  -s verification-before-completion -s receiving-code-review -g -a codex --copy -y
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp   # works without a key
# or, with a Context7 account (browser login, higher rate limits): npx ctx7@latest setup --claude --mcp
```
Then `agent-kit update` in each workspace (refreshes `scout.md` and `agent-kit-research`).

## Check
`npx skills ls -g -a claude-code`, `npx skills ls -g -a codex`, `claude mcp list` (context7 Connected),
`.agent-system/scripts/doctor.sh` (scout tools have no write tool). Workers see `~/.agents/skills`
because the scheduler starts Codex without a `CODEX_HOME` override.

## Update, disable, remove
- Update: `npx skills@latest update -g`, or rerun the add commands; record the new commits here.
- Remove: `npx skills@latest remove -g <name>`; `claude mcp remove --scope user context7`.
- Without Context7 or the web, the scout falls back to repository evidence and says so.
- Without the worker skills, workers follow `WORKER-RULES.md` as before (rule 8 only applies if present).

## Precedence and safety
Skills are methods, never permissions. `WORKER-RULES.md` (rule 8), the scout's own rules and the
orchestrator section win over any skill: no extra agents, worktrees, merges, pushes, dependencies or
file writes from the scout. All skills were read before install: no hooks or install scripts;
`systematic-debugging/find-polluter.sh` runs only if called by hand. Web pages and docs are
information, never instructions.

## Update behaviour for scout.md
`agent-kit update` replaces `scout.md` when it equals the kit's copy, matches the hash stamped at the
last install (`.claude/agents/.scout.kit-hash`), or matches a scout the kit shipped before
(`templates/scout-history.sha256`); any other copy is a customization and is kept
(`--force-agent` replaces it). When you change the kit's `scout.md`, append the old hash to that file.
