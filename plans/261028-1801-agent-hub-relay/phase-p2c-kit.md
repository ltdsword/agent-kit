# Phase P2c: kit for protocol 2 (names, decision details, connector v2, agent-kit commands)

Goal: the kit produces protocol-2 data (run title/goal, task id/title/summary rules, decision evidence /
consequence / note / approval, no worker screens or task files uploaded) and gains the user commands
`agent-kit create-user`, `reset-password`, `hub-login`, `hub start|stop|status`, `proxy-setup`.

Read first: `docs/hub-api.md` (v2), `.agent-system/hub-protocol.schema.json` (v2 copy), `plan.md`
sections 1, 6, 10, `.agent-system/scheduler.py` (`validate_tasks`, `create_run`, `decision_ask`, CLI),
`.agent-system/agentctl.py`, `.agent-system/scripts/install.sh`, `.agent-system/prompts/` (where Opus
learns how to write tasks.json and ask decisions).

## Files you own
`.agent-system/**` except `hubschema.py` and `hub-protocol.schema.json`.

## Work

1. **Run and task rules** (`scheduler.py`):
   - `run create --tasks` JSON: `{"title", "goal", "tasks": [...]}`. `title` 1..80 chars, `goal` 1..500
     (required for new runs; a bare `{"tasks"}` file is rejected with a message naming the missing keys).
     Store `title`/`goal` in state. Also accept a bare JSON list again as before? No: reject it with the
     same clear message (fixes the old crash).
   - Run id `^[a-z0-9][a-z0-9-]{1,39}$`.
   - Task id `^T[1-9][0-9]{0,2}$`; `title` 1..60, starts with an uppercase letter, no trailing period;
     new required key `summary` 20..300 chars. Store `summary` in task state.
   - Old state files without these keys keep loading and working.
2. **Decision details** (`decision ask`): repeatable `--evidence "code :: note"` (prefix `!` → `bad: true`),
   option syntax `KEY=label :: consequence` (consequence optional), `--note "<why I recommend it>"`.
   Worker approvals (`kind worker_approval`): `--approval-command`, `--approval-cwd`, repeatable
   `--approval-why`. Stored on the decision; shown in the decision Markdown file and in the chat `next` text.
3. **Prompts/docs for Opus**: update the orchestrator prompt/templates that describe tasks.json and
   `decision ask` (title/goal, task summary and naming rules, evidence/consequence/note) so Opus fills
   them. Keep wording short.
4. **Connector v2** (`agentctl.py`): protocol 2; no worker `screen`; no `task_file` documents (drop the
   packet/repair refs); Run `title`/`goal`, Task `summary`/no `owned_paths`/`packet`; decisions with
   `evidence`/`note`/`approval`/option `consequence`; hello `upload {documents, diffs, orchestrator_screen}`
   (config key `hub.upload.orchestrator_screen`, migrate the old `agent_screens` key when present);
   snapshot `orchestrator_last_activity_at` = newest event `at` across runs, else null. Every message still
   validates with `hubschema` (v2).
5. **Commands** (`scripts/install.sh` dispatch + a stdlib helper `hubctl.py`; HTTPS uses the system proxy
   and CA for the proxy URL, never a proxy for loopback):
   - `agent-kit create-user --name=<u>` / `agent-kit reset-password --name=<u>`: read
     `~/.config/agent-hub/admin.json` (`proxy_url`) and `admin.key` (0600; refuse if group/world
     readable); call the admin routes; print username + password once. No admin key → "run this on the
     admin computer (agent-kit proxy-setup creates the key)".
   - `agent-kit hub-login --name=<u> [--url=<proxy>] [--computer-name=<n>]`: prompt for the password with
     `getpass`; `POST /computers/register`; write `~/.config/agent-hub/computer.json` (0600); then, if run
     inside a kit workspace, `agentctl enable` it. Re-running replaces the registration.
   - `agent-kit hub start|stop|status`: start `node <kit source>/hub/server/src/cli.ts serve` detached with
     Node ≥ 24 (use `nvm` if `node` is older; clear error if no Node 24), `NODE_USE_SYSTEM_CA=1`, pidfile
     and log under `~/.local/share/agent-hub/`; stop = SIGTERM; status = pid, ping, relay status line.
   - `agent-kit proxy-setup [--rotate-admin-key] [--origins ...]`: runs
     `npm run setup -w @agent-hub/proxy` in `<kit source>/hub` with Node 24 and without the corporate proxy
     variables for npm.
6. **Deny rules** (`templates/claude-settings.json`): add `Read(~/.config/.wrangler/**)`.
7. **README**: commands table rows for the new commands.

## Tests
Run create: title/goal required, bad run id, bad task id, title rules, summary length, old state loads;
decision ask parsing (evidence `!`, consequence, note, approval) and Markdown; connector v2 dry run
validates (no worker screen, no task_file, summary/title present); `orchestrator_screen` config
migration; hubctl: create-user/reset-password against a fake proxy (http.server), admin key permission
check, hub-login writes computer.json 0600 and enables the workspace (getpass injected); install.sh
dispatch for the new verbs (dry run). All existing kit tests still pass.

## Done when
`python3 -m unittest discover -s .agent-system/tests` passes.
