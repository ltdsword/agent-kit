# Phase A1: kit sync side (connector push, no commands yet)

Goal: a workspace started with the hub enabled runs `agentctl watch`, which pushes the snapshot,
decisions, events and documents to the backend, writes the `hub.json` hint, and exits with the
workspace. The scheduler gains only tiny offline changes. Commands (answers, prompts) are phase A2;
**don't implement command handling here** (no `GET .../commands`).

Read first:
- `docs/hub-api.md`: sections 1-3, 5 and 8 are the contract.
- `.agent-system/docs/DECISION-HUB-PLAN.md`: sections 4, 5, 6, 9, 10 and 13.
- `.agent-system/hubschema.py` (validator; use it, don't edit it).
- `hub/protocol/fixtures/` (the shapes to produce).
- `.agent-system/scheduler.py`, `kitstart.py` and `tests/test_scheduler.py` for style and test
  helpers.

## Files you own

`.agent-system/**` except `hubschema.py` and `hub-protocol.schema.json`. Never edit `hub/**` or
`docs/**`.

## Work

1. **`scheduler.py`**
   - `log_event`: every event gets `n` = `state["event_n"] + 1` (store the counter in state;
     missing = 0). Keep the 500 trim. Old events without `n` stay as they are.
   - `decision_ask`: read `<workspace>/.orchestrator/hub.json`. The hub is "online" only when
     `backend == "online"`, `heartbeat_at` is less than 90 s old, and `connector_pid` is alive
     (`os.kill(pid, 0)`). Add `"hub": "online"|"offline"` to the result. When online, the `next`
     text tells Opus to ask in plain chat (title, 2-3 lines, `A: ...` option lines, recommendation,
     "Answer on the hub or reply here (D<n> A/B/... or your own words)") and end its turn, with no
     AskUserQuestion; when offline, keep today's text. Never fail because of `hub.json`: unreadable
     means offline.
   - `doctor`: a `hub` check, only when `hub.enabled`:
     - `workspace_id` matches `^ws_[a-z2-7]{16}$`;
     - the connector key file is readable;
     - the backend answers `GET /api/v1/agent/ping` within 3 s (warn, don't fail, when it's down).
   - No other scheduler changes, and no network code anywhere in the scheduler except that doctor
     ping (put the ping helper in `agentctl.py` and import it lazily).
2. **`config.json`** (template): add
   `"hub": {"enabled": false, "url": "http://127.0.0.1:7420", "workspace_id": null, "upload": {"documents": true, "diffs": true, "agent_screens": true}, "screen_lines": 40}`.
   `validate_config` must accept it.
3. **`agentctl.py`** (new, stdlib only, kit style: one file, small functions, docstrings).
   Commands: `enable [--url]`, `sync --dry-run [--json]`, `watch [--interval 5] [--no-orchestrator]`,
   `status`, `stop`, `reset-id`.
   - HTTP: `urllib.request` with `ProxyHandler({})` (never use a proxy; the org sets
     `HTTPS_PROXY`). Headers `Authorization: Bearer <key>` and `X-Agent-Hub-Protocol: 1`.
     Timeout 10 s. Key file `$AGENT_HUB_CONFIG/connector.key` (default `~/.config/agent-hub/`).
   - `enable`: set `hub.enabled=true` (and `url`); create `workspace_id` (`ws_` + 16 chars from
     `a-z2-7`, `secrets`) if missing; write `config.json` preserving its formatting style (the
     scheduler's config writer, if there is one; else `json.dumps(indent=2)`). Then ping, and report
     key/backend problems clearly.
   - **Snapshot builder** (`Snapshot` $def):
     - From every run under `.orchestrator/runs/*/state.json`, plus `config.json` for models.
     - The orchestrator: name = `kitstart.agent_name(<repo name>)`; Herdr state from
       `herdr agent get <name>` (`result.agent.agent_status`; missing agent = `absent`).
     - Workers from the newest run's `workers` + `herdr agent get <agent_name>`.
     - Scout from the newest run's `research`.
     - Screens via `herdr agent read <name> --source visible --lines <screen_lines>`, only when
       `upload.agent_screens`; scrub them.
     - `session_id` per watch process (`ses_` + 16).
     - Cap 256 KB: drop screens first, then the oldest runs.
     - Call Herdr through `subprocess` with a 5 s timeout. Don't require `HERDR_ENV` (`agent-kit
       start` may run outside Herdr); if `herdr` is missing, report states as `unknown`.
   - **Decisions**: every decision of every run, mapped to the `Decision` $def. `agent` = the
     worker slot holding `task_id` in that run (`tasks[T].worker`), else `orchestrator`.
     `local_status` = the decision's `status`. Hash = sha256 of the canonical JSON (sorted keys,
     separators `(",", ":")`, UTF-8), the same as the backend.
   - **Events**: per run, events with `n` greater than the backend's cursor, mapped to
     `{n, at, kind, data: <the other keys>}`, in batches of 200.
   - **Documents** (plan section 9, `Document` $def):
     - Kinds: `final_report`, `final_diff`, `task_file` (the `packet` files of the run's tasks
       and their repair files), `decision` (`decisions/D*.md`), `research` (evidence paths of
       research rounds), `review` (review report paths recorded by `mark-reviewed`; find where the
       scheduler stores them).
     - Respect `upload.*`.
     - Paths are workspace-relative; title = the first Markdown heading or the file name.
     - Format: `.diff` → `diff`, `.md` → `markdown`, else `text`.
     - 1 MB cap: truncate and append the line `\n… truncated: full file on your computer (<bytes> bytes)\n`;
       sha256 is of the content sent.
     - Refuse paths matching the scheduler's `SECRET_PATTERNS`.
     - Upload only documents whose hash differs from `document_hashes`, in batches of at most
       5 MB. A file that disappeared → `DELETE`.
   - **Scrubber** on every uploaded string (screens, documents, decision text): replace
     `sk-[A-Za-z0-9_-]{16,}`, `AKIA[0-9A-Z]{16}`, `Bearer [A-Za-z0-9._~+/-]{16,}=*`,
     `(?i)(password|passwd|secret|token)\s*[=:]\s*\S+`, and PEM blocks with `[REDACTED]`.
   - **`sync --dry-run`**: build hello, snapshot, decisions, events and documents with no network.
     Print a summary, or `--json` a single object `{hello, snapshot, decisions, events, documents}`.
     Every part must pass `hubschema.validate`.
   - **`watch`** (plan 10.2, without step 3):
     1. Pidfile `.orchestrator/hub-connector.pid`. Refuse if another live pid holds it.
     2. Hello. On `409 duplicate_workspace`, tell the user to run `reset-id` and exit 2.
     3. Loop every `interval` s, or when a `state.json` mtime changes: snapshot if its hash changed,
        decisions with changed hashes, new events, the document diff. Heartbeat when nothing was
        sent for 30 s.
     4. Write `.orchestrator/hub.json` `{"connector_pid", "backend": "online"|"offline",
        "heartbeat_at": <now ISO>}` after each loop (atomic write).
     5. Backend errors: backoff 1, 2, 4 … 60 s; keep writing `hub.json` with
        `backend: "offline"`. After reconnecting, say hello again (full resync by hashes).
     6. Exit when the orchestrator Herdr agent no longer exists (`herdr agent get` fails twice in a
        row), unless `--no-orchestrator`. On SIGTERM/SIGINT or exit: goodbye (best effort, 3 s),
        remove the pidfile, write `hub.json` with `backend: "offline"`.
     7. Log one line per action to `.orchestrator/hub-connector.log` (keep it under ~1 MB by
        rotating to `.1`).
   - `status`: config, backend ping, pid alive, last `hub.json`, log tail. `stop`: SIGTERM the
     pid. `reset-id`: new `workspace_id`.
4. **`kitstart.py`**: after the orchestrator is launched (start and continue), if `hub.enabled`,
   start `python3 .agent-system/agentctl.py watch` detached (`start_new_session=True`, output to
   the log, cwd = workspace) unless a live pidfile exists. Print one line saying so. Never fail
   the start because of the hub.
5. **`templates/claude-settings.json`**: add deny rules `Read(~/.config/agent-hub/**)`,
   `Edit(~/.config/agent-hub/**)`, `Read(~/.local/share/agent-hub/**)`,
   `Edit(~/.local/share/agent-hub/**)`.
6. **`scripts/install.sh`**: add `agentctl.py` to the `copy_kit` item list (`hubschema.py` and
   `hub-protocol.schema.json` are already there).
7. **Docs**: `.agent-system/README.md` files table + commands (agentctl); no other docs.

## Tests (`tests/test_agentctl.py`, plus additions to `tests/test_scheduler.py`)

- A fake backend: `http.server` in a thread on 127.0.0.1:0, recording requests and returning
  fixture-shaped responses. A fake Herdr: inject a runner into the code that calls `herdr`.
- Cover:
  - event `n` numbering and the trim;
  - `decision_ask` hub online/offline/stale/dead-pid;
  - `doctor` hub check;
  - `enable` creates a valid id;
  - `sync --dry-run` output validates (`hubschema`) for a run made with the existing test helpers
    (decisions, a finish decision with followup, documents incl. a final report);
  - truncation and secret-path refusal;
  - the scrubber;
  - watch:
    - hello → full push;
    - unchanged → heartbeat only;
    - changed decision → only that one;
    - backend down → backoff + `hub.json` offline, then a resync;
    - duplicate 409 → exit 2;
    - orchestrator gone → goodbye + exit;
  - a proxy env var set doesn't affect loopback calls;
  - kitstart starts the connector only when enabled.
- Every message the fake backend receives must pass `hubschema.validate(<def>, body)`.
- All existing tests still pass: `python3 -m unittest discover -s .agent-system/tests`.

## Done when

- All tests pass; `python3 .agent-system/agentctl.py sync --dry-run --json` in a test workspace
  validates.
- Your report lists: files changed, how each mapping was derived (especially `review` documents
  and worker `since`), anything in the contract that didn't fit (don't change the contract), and
  open questions.
