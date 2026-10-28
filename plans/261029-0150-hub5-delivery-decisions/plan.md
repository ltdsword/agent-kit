# hub5: command delivery, Decisions panel, document filters, setup gaps

Found in P4 (end-to-end on the live proxy, 29/10/26). Contract: `docs/hub-api.md` (v2) is unchanged.

## User decisions (verbatim)
- Decisions: "Is it what the "Needs you" panel do? Can make them in it, the decision list will be below
  the Needs you panel. Also rename into Decisions, not need you."
- Documents: "classify the Documents. Provide user to search and filter based on docs, diff, and
  decisions (if still exists)"
- Company workspaces: "Yes, connect them" (done by the lead after this run merges, not by workers).

## T1 kit (`.agent-system/**`)

1. **Command delivery** (phase A2 of the first hub plan, never built). In `agentctl.py watch`, alongside
   the sync loop, a command loop (thread or interleaved, stdlib only):
   - `GET /api/v1/workspaces/<ws>/commands?wait=25` with the connector key (loopback, no proxy).
     Validate with `hubschema` (`CommandsResponse`). Handle commands oldest first.
   - `answer`: apply through the scheduler **in process** (import `scheduler`, call `decision_answer`
     with `channel="hub"`, `by=command.by`, `followup`/`value`/`note` from the body,
     `quote` = the body `note` if non-empty, else the chosen option's label: the user's own input on
     the hub). Scheduler refusal (`SchedulerError`) → ack `REJECTED` with its exact message, final.
     Success → type the notice (below) and ack `DELIVERED` (even if typing fails: retry the notice
     locally, as the contract says).
   - `reply` / `prompt`: type the text, then ack `DELIVERED`.
   - Typing = `herdr agent prompt <orchestrator name> <text> --wait --until working` (same helper the
     scheduler uses). Orchestrator `blocked` or not live → ack `HELD` with a short reason (retried by the
     backend). Other errors → `FAILED` with a short reason.
   - Texts: answer `[hub] D3 answered by alice: <choice> (<label>). It is recorded; carry it out with
     --decision D3.`; reply `[hub] reply to D3 from alice: "<text>"`; prompt `[hub] <text>` (prompt from
     alice). Never include secrets.
   - Append each delivered command (id, type, by, body, at) to `.orchestrator/hub-log.jsonl`.
   - `POST .../commands/<id>/ack` body per `AckRequest` (validate). Acks are idempotent; a crash between
     typing and ack must not type twice: write the hub-log line first and skip ids already logged.
2. **Orchestrator rule text** (`templates/ORCHESTRATOR.section.md`, short): lines starting `[hub]` come
   from the user via Agent Hub. An `answered` notice means the decision is already recorded: carry it
   out with `--decision <id>`, don't ask again. A `reply`/prompt is the user's words: treat like chat.
3. **hub-login order**: after saving `computer.json`, if run inside a kit workspace: start the backend
   (`hub start` logic) if it isn't running, wait (≤ 20 s) for `connector.key`, then `agentctl enable`,
   then if the orchestrator agent is live start `agentctl watch` detached (it ends with the
   orchestrator, as today). Clear messages for each failure.
4. **hub start**: also start `agentctl watch` detached for the current workspace when its hub is enabled
   and its orchestrator is live and no connector pid is alive.
5. **hub stop**: after SIGTERM wait up to 10 s for the pid to exit; then report "stopped" or "still
   running (pid N)".
6. **agentctl enable**: keep `config.json` formatting stable: rewrite only the `hub` object (don't
   re-indent the rest of the file); key order kept.
7. README rows updated.

Tests: answer → scheduler records channel hub/by/quote and ack DELIVERED + notice text; scheduler refusal
→ REJECTED with message; reply/prompt texts; orchestrator blocked → HELD; typing failure after answer →
DELIVERED + local retry; no double typing after a restart (hub-log); every request/ack body validates;
hub-login order with a fake backend (key appears after start); hub stop waits; enable keeps formatting.
All with fakes (fake HTTP server, fake herdr runner), never real herdr.

## T2 hub (`hub/server/**`, `hub/web/**`)

Backend:
1. Publish a `workspace` event when the connector says hello (new or re-online workspace), goodbye, or
   a workspace's name/status/last_seen changes, so the relay sends the debounced `workspaces` frame
   (today the proxy only learns workspaces on relay reconnect). Test: hello from a new workspace →
   `workspaces` frame reaches the fake proxy.

Web:
2. **Decisions panel**: rename "Needs you" to **Decisions** (tab, section, chips, empty text "Nothing
   needs you" can stay as the empty state of the open part). Top: open decisions (as today). Below:
   **all decisions** of the workspace (every run), newest `opened_at` first, each row: run, D-id, kind,
   title, status chip, answer (who/what) when answered; follow `next` cursors; opens the structured
   decision page (same page History links to). Loads from `GET /workspaces/:ws/decisions`.
3. **Documents**: one list, newest first (not grouped by run), a search box (title, path, run) and
   filter chips **Docs** (final_report + research), **Diffs** (final_diff), **Decisions** (decision);
   all on by default. Decision documents open the structured decision page (raw file still reachable
   from that page as "Raw file"). Keep the per-row run label.
4. Mock mode and existing tests updated; new tests: Decisions panel (open + all, newest first),
   Documents search + filter chips, decision document opens the decision page, adapter for the
   decisions list.

Done: `cd hub && npm test -w @agent-hub/server -w @agent-hub/web && npm run typecheck -w @agent-hub/server
-w @agent-hub/web && npm run build -w @agent-hub/web`.
