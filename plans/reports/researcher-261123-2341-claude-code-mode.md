# Claude Code "Code Mode" - research report (2026-11-23)

## 1. What it is (verified)

Name is real, but 3 things share it:

| Thing | What | Status |
|---|---|---|
| **Claude Code Code Mode** (the one the user means) | Interactive CLI feature: Claude writes JavaScript that makes many tool calls (Bash/Read/Edit/MCP) in one step, returns only a filtered result. Seen via Ctrl+O "Code" row. | Experimental, off by default, "may change or be removed in any release" |
| Cloudflare "Code Mode" | Original pattern name: MCP tools exposed as a code API | Third-party pattern |
| Anthropic API Programmatic Tool Calling (`allowed_callers`, `code_execution_20260120`) + engineering post "Code execution with MCP" | API-side sibling, server-side code execution tool; separate feature, not Claude Code | API feature |

Claude Code Code Mode = the CLI feature under `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`. Not a claude.ai feature, not in Agent SDK / `claude -p`. Local CLI is 2.1.329 (>= 2.1.323, so available here); `claude --help` has no Code Mode flag (env var only).

### Enable
- `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude`, or `env` block in `~/.claude/settings.json`. First run asks confirmation, restarts, shows "Code Mode (experimental) is on".
- Project `.claude/settings.json` cannot enable it (ignored; cloned repo can't turn it on).
- A `0` anywhere (shell, user, managed, --settings) wins. Org block: managed settings `env` = `"0"`. Managed settings cannot force it on.
- Shipped v2.1.323 (~2026-11-12); v2.1.326 added agent-teams compat; 2.1.327-2.1.330 are mostly Code Mode bugfixes (heavy churn: ~40 Code Mode fixes in 5 releases = immature).

### Requirements / limits (official docs)
- Account: Claude subscription or Console, direct Anthropic API only. NOT Bedrock, Vertex/Google Cloud, Foundry, gateways, custom `ANTHROPIC_BASE_URL`. Not with `apiKeyHelper`, `ANTHROPIC_AUTH_TOKEN`, auth headers in `ANTHROPIC_CUSTOM_HEADERS`.
- Org must not use HIPAA config or Zero Data Retention. No specific plan tier named in docs.
- Models: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2. Native build only.
- Surface: interactive terminal only. Not `claude -p`, Agent SDK, VS Code, Desktop, cloud sessions, Remote Control, Chrome, computer use. Cannot move to background session; /fork background copy unavailable.
- Resume needs the env var still set; Code Mode sessions refuse to resume without it.
- Waiting script stops at 10 min; background script up to 2 h (only auto/bypassPermissions).
- Agent teams: v2.1.326+, teammates in Code Mode only in in-process display; split panes start without it.
- OTel events OK from 2.1.329; OTel tracing must stay off. Some plugins/"mods" that hook tool calls may block it.
- `--restricted`/`--tools` without `REPL` disables it.

## 2. Behavior change

- Tool calling: one `REPL` tool; scripts call tools under normal names (`Bash`, MCP tool names). Parallel calls, loops, filtering inside code; only `return` value reaches model. Fewer model turns.
- MCP: callable from script; intermediate data stays out of context (Anthropic's engineering post claims 150k -> 2k tokens, ~98.7%, for a code-execution-with-MCP workflow; that is a vendor best case, not a Code Mode benchmark).
- Tokens: changelog 2.1.328 "shorter tool descriptions"; one third-party blog claims system-tools 24.6k -> 11.1k (unverified, not Anthropic). Docs give NO numbers. Do not assume savings; measure with `/context`.
- Latency: fewer round trips (anecdote: 13 calls in 2 turns). Cost: scripts can run long, memory runaway was a bug (fixed 2.1.329 with limit).
- Reliability: young. Fixed bugs include MCP calls during scripts, esc/compact losing state, prompt-cache rewrites, skills with inline `!` failing, large file reads in memory. Expect more.
- Permissions/security (matters most):
  - Each call still hits `deny`/`ask` rules and PreToolUse hooks. Compound commands reach hooks as `cd 'app' && git push` -> prefix rules can miss.
  - Auto mode classifier reviews the SCRIPT before it runs, not each call, and cannot see runtime values (paths from search output). Hard limits need rules/hooks/sandbox.
  - Sandbox applies to shell commands only; the JS itself and its file/web/MCP tool calls run OUTSIDE the sandbox. Full isolation = container/VM.
  - PreToolUse hook that times out or gives no decision refuses the call; failure behavior configurable via `onFailure`. `UserPromptSubmit` hooks no longer see script output (since 2.1.328): move redaction to `PostToolUse` matching `REPL`.
  - `ask: ["REPL"]` rule = approve each script (adds prompts, defeats the batching benefit partly). Subagent's code not visible from main view.
  - Scripts can read a secret and pass it to another call; `OTEL_LOG_TOOL_DETAILS` leaks it into telemetry backend.
  - Code Mode only on direct Anthropic API: company data flows to Anthropic exactly as with normal Claude Code; nothing new, but it excludes Bedrock/Vertex-routed setups.

## 3. Other relevant updates (brief, last ~2 months, from changelog 2.1.326-2.1.330)
- Worktree safety: ExitWorktree no longer deletes a worktree another live session uses; asks before removing one with unsaved work. Directly relevant to agent-kit worktrees.
- Subagents: stopped bg subagents stay stopped; resumed subagents keep model/permissions; subagents in `-p`/SDK wait for children by default; subagent-declared MCP servers no longer killed when one finishes.
- Agent teams: `effort` param honored for named teammates (2.1.329); remain experimental flag.
- Permissions: more `rm` root/home paths ask; symlink path checks stricter; `--allowedTools` malformed rule warnings; `managed-mcp.json` explanation.
- Sandbox: Linux fixes; PermissionRequest-hook-rewritten command runs outside sandbox if sandbox-excluded (watch this).
- `claude mcp add-json <name> -` reads stdin.
- Models referenced in docs: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2. Search tool could not corroborate them; docs and the local agent-kit config use them.
- Note: changelog fetch covered only 2.1.326-330 (truncated); earlier Oct-Nov items not reviewed.

## 4. Adoption verdicts

### (a) agent-kit structure: **WAIT** (pilot only on orchestrator, manually)
Fit findings (read `scheduler.py` worker_args, `models.launch_args`, `config.json`, WORKER-RULES):
- Current worker is Codex (`gpt-6-luna`); orchestrator is Claude `claude-opus-5-5` (a supported model). Workers are launched via `herdr agent start -- <args>` as interactive terminal programs, so surface requirement is technically met for Claude workers. But:
- Enablement is env var only; `launch_args` has no env hook (`launch_args` templating covers model/effort/cwd only). Would need an `env` field in worker/orchestrator config or a wrapper; project settings cannot carry it (deliberately ignored). User-level setting turns it on for every session, including ones you don't want.
- Resume coupling: scheduler repair/resume flows would break if env var differs between launch and resume. `--continue --permission-mode auto` is needed for background scripts.
- Worker safety model conflicts: kit relies on Codex sandbox `workspace-write` + approvals and WORKER-RULES boundaries (worktree only, no push, no network installs). Code Mode scripts run JS and file/MCP tools outside the sandbox; auto-mode classifier reviews script not runtime paths. Boundaries become harder to enforce; would need PreToolUse hooks on Bash/Edit path scoping + PostToolUse on `REPL`.
- Little benefit: task files are already planned step lists with small focused edits; batching gain is small. Orchestrator work is mostly scheduler CLI calls and Q&A (AskUserQuestion), few-tool-call turns.
- Compatibility: agent teams not used. Anything routed via gateway/ANTHROPIC_BASE_URL breaks.
- Risks: experimental, 5 releases of fixes in 2 weeks; hub `orchestrator_screen` upload and tests assume normal tool output rows (Code row collapsed, tool calls still shown) - unverified.
- Would change verdict: feature GA/stable flag; env passthrough in config; documented hook-based path scoping; measured token/latency win on a real run; Claude worker kind becomes the default.
- If piloting: add optional `orchestrator.env` only after pilot proves value. Do not make it default. YAGNI.

### (b) personal workflow: **PILOT** (opt-in per session)
- You run interactive CLI + Herdr, many skills, MCP (context7, vercel 200+ tools, claude.ai connectors). That is the best case: large MCP tool surface and multi-file tasks. Subagents opt-in policy unaffected (Code Mode does not spawn agents itself).
- Trial by shell alias/one-off `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude`, not settings.json (avoids resume trap and always-on).
- Check: claude.ai connectors/MCP via direct auth okay? Direct Anthropic account needed (it is). Telemetry vars off or on >= 2.1.329 (you are on 2.1.329).
- Risks: skills with inline `!` commands historically buggy; hooks (any of yours) refuse on timeout; context7 rule "fetch docs" still works through scripts.
- Becomes adopt when 2 weeks of use show fewer tokens (compare `/context`, usage) with no lost-state bugs.

### (c) company projects: **WAIT** (prove in sandboxed pilot first; admin decision)
- Security: scripts run outside sandbox except shell; classifier can't see runtime values; script could read secrets and pass them along; OTel details leak risk. Auto mode is the weak link; use non-auto with prompts or container/VM.
- Compliance: not available with ZDR/HIPAA orgs, gateways, Bedrock/Vertex, custom base URL. Many companies with data constraints route via gateway or ZDR -> feature will simply not start. Check this first.
- Admin can block with managed setting `0`; do not enable without security sign-off. Nothing needs to leave the company beyond normal Claude Code traffic, but code is generated/executed locally with wider blast radius.
- Java/Gradle, Thrift, React/TS: benefits (many-file edits, grep-filter, parallel test runs) are real; Gradle long builds hit the 10 min foreground cap unless background mode (auto/bypass only).
- Would change: GA, security review of REPL hooks, container isolation, confirmed non-ZDR account.

## Ranked recommendation
1. (b) Personal: pilot now, per-session env var, measure.
2. (c) Company: pilot only inside a container/VM on a non-sensitive repo, `ask`/hooks configured, after confirming account eligibility; otherwise wait.
3. (a) agent-kit: wait; revisit after (b) data and when env passthrough justified.
Block-by-default note: if you administer company settings, set managed `"0"` until reviewed.

## Suggested pilot prompt (for a company workspace orchestrator)

```
Goal: trial Claude Code "Code Mode" safely on ONE low-risk repo. Research and report only; no production data.

Rules:
- Use a throwaway clone/worktree in a container or VM. Never use a repo with secrets, customer data or prod credentials. Send nothing to external services except the normal Claude Code connection.
- First check eligibility, read-only: `claude --version` (>= 2.1.323), account is direct Anthropic (no gateway/Bedrock/Vertex/ANTHROPIC_BASE_URL/apiKeyHelper), org not ZDR/HIPAA, no managed setting CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0. If any fails, stop and report; do not work around it.
- Enable per session only: `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude --permission-mode default`. Do not edit settings files. Do not use auto/bypass mode.
- Add (session-only, via the user) ask rules: Bash(git push *), Bash(rm *), REPL; deny reads of .env/credential paths.
- Run 3 tasks, each twice (normal vs Code Mode): (1) find unused imports across a Java module and list them, (2) rename a TS prop across a React package with tests, (3) run Gradle unit tests for two modules in parallel and summarize failures.
- Record per run: model turns, tool calls, /context tokens, wall time, permission prompts, errors, any state lost after Esc or /compact.
- Never print secrets; redact in the report. Read each Code row (Ctrl+O) for the first run and note anything that touched paths outside the repo.
- Output: table normal vs Code Mode, issues found, recommendation (adopt/pilot/wait) with the reason. No commits, pushes or installs.
```

## Sources and credibility
- https://code.claude.com/docs/en/code-mode - official Anthropic docs, primary, highest. (Fetched; basis for requirements/limits/permissions.)
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md - official changelog, primary; undated entries, only 2.1.326-330 read of a very large file.
- https://www.anthropic.com/engineering/code-execution-with-mcp - Anthropic engineering blog, primary for the pattern; numbers are vendor best case.
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling - official API docs (seen in search results only, not fetched); API sibling feature.
- https://startdebugging.net/2026/11/how-to-turn-on-code-mode-in-claude-code-and-block-it-org-wide/ - third-party blog, medium; consistent with official docs but author says snippets untested.
- https://sumus.im/blog/claude-code-mode - third-party blog, low-medium; no own measurements, cites another dev's anecdote.
- https://www.marktechpost.com/2026/11/17/anthropic-claude-code-code-mode-javascript-tool-calls/ - tech news; 403 on fetch, only seen via search snippet; low-medium.
- https://www.remio.ai/post/claude-code-v2-1-326-adds-code-mode-for-teams , https://www.havoptic.com/r/claude-code-2.1.326 - aggregators, low; used only for release date corroboration.
- Local: `claude --version` = 2.1.329; repo files `.agent-system/scheduler.py`, `models.py`, `config.json`, `WORKER-RULES.md` read-only.

## Limitations
- Did not run Code Mode (research only); all behavior claims are from docs/changelog, not hands-on.
- Token savings for Code Mode specifically are unmeasured by anyone credible found.
- Changelog read for 2.1.326-330 only. Did not read ORCHESTRATOR.section.md in full, nor test hub behavior with Code rows.
- Model names (Opus 5.5 etc.) rely on Anthropic docs/changelog; web search could not independently corroborate.
- Plan-tier eligibility unspecified in docs ("not open to your account yet" implies staged rollout/flag).

## Unresolved questions
1. Which plan tiers (Pro/Max/Team/Enterprise) get it; is rollout gated by server-side flag per account?
2. Does the company use a gateway, Bedrock/Vertex, or ZDR? (decides (c) outright)
3. Does Claude Code "mods" (hook-tool-call mods) overlap with agent-kit's `herdr-mods`/hooks; do any block Code Mode?
4. Can Code Mode be enabled per launch for Herdr-started agents without touching user settings (env passthrough in `herdr agent start`)?
5. Real token/latency delta on Java/Gradle workflows?
6. Will it graduate beyond experimental, and will `claude -p`/Agent SDK get it (affects scheduler headless use)?
