# hub protocol v2 (28/10/26)

## Goal
`hub/protocol` (schema, fixtures, generated types, `api.ts`), the kit's schema copy and `docs/hub-api.md` describe protocol 2 exactly as specified.

## Read first
- `plans/261028-1801-agent-hub-relay/phase-p1-protocol-v2.md`: **the full spec** (work items, tests, done criteria). Follow it exactly.
- `plans/261028-1801-agent-hub-relay/plan.md`: decisions D-1..D-12 and sections 2, 10 (why).
- `docs/hub-api.md` and `hub/protocol/src/api.ts`: the protocol-2 contract (after the protocol task, which this task depends on, merged).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `hub/protocol/**` (except package.json)
- `.agent-system/hub-protocol.schema.json` (only via the sync script)
- `.agent-system/tests/test_hubschema.py` (only fixture names)
- `docs/hub-api.md`

**You must not edit:**
- `hub/server/**`, `hub/proxy/**`, `hub/web/**`, `.agent-system/*.py`, any package.json/lockfile, `plans/**`, `gen-tasks/**`.
- The protocol contract (schema, fixtures, `api.ts`, `docs/hub-api.md`) unless this is the protocol task: if it doesn't fit, implement the closest faithful behavior and list the gap in your report's `risks`.

**You may run:**
- Node 24 only: `source ~/.nvm/nvm.sh && nvm use 24` first (default node is 20; engine-strict).
- Dependencies are already installed in `hub/` by the lead; run `env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund` in `hub/` once if `node_modules` is missing. **No new dependencies, no edits to any package.json or lockfile.**
- `npm test`, `npm run typecheck`, the protocol gen/sync scripts, `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py`; read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; anything that talks to a Cloudflare account (`wrangler login/deploy/secret`, `--remote`);
  reading `~/.config/.wrangler/**`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub` (use temp dirs via env vars);
  real `herdr`/`codex`/`claude`; downloads.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason / command and error. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in the spec is done.
- [ ] `cd hub && npm test -w @agent-hub/protocol` passes.
- [ ] `cd hub && npm run typecheck -w @agent-hub/protocol` passes.
- [ ] `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py` passes.
- [ ] Server/kit/proxy tests may fail after this task (other tasks fix them): list which in the report.

## Run these
- `cd hub && npm test -w @agent-hub/protocol`: expect all pass
- `cd hub && npm run typecheck -w @agent-hub/protocol`: no errors
- `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py`: OK

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (28/10/26 22:23)

- Status: **done** (worker worker-1, branch `agent/hub3-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/hub-protocol.schema.json`, `docs/hub-api.md`, `hub/protocol/fixtures/AdminUserRequest.json`, `hub/protocol/fixtures/AdminUserResponse.json`, `hub/protocol/fixtures/Assertion.json`, `hub/protocol/fixtures/Command.answer-finish.json`, `hub/protocol/fixtures/Command.answer.json`, `hub/protocol/fixtures/Command.prompt.json`, `hub/protocol/fixtures/Command.reply.json`, `hub/protocol/fixtures/CommandsResponse.json`, `hub/protocol/fixtures/ComputerRegisterRequest.json`, `hub/protocol/fixtures/ComputerRegisterResponse.json`, `hub/protocol/fixtures/Decision.finish-answered-hub.json`, `hub/protocol/fixtures/Decision.repair-open.json`, `hub/protocol/fixtures/Decision.routine.json`, `hub/protocol/fixtures/Decision.worker-approval.json`, `hub/protocol/fixtures/DecisionsBatch.json`, `hub/protocol/fixtures/Device.json`, `hub/protocol/fixtures/HelloRequest.json`, `hub/protocol/fixtures/HistoryItem.answer.json`, `hub/protocol/fixtures/HubDecision.open.json`, `hub/protocol/fixtures/HubDecision.rejected.json`, `hub/protocol/fixtures/HubDecision.reply-sent.json`, `hub/protocol/fixtures/List.history.json`, `hub/protocol/fixtures/List.workspaces.json`, `hub/protocol/fixtures/LoginRequest.json`, `hub/protocol/fixtures/LoginResponse.json`, `hub/protocol/fixtures/Me.json`, `hub/protocol/fixtures/PairRequest.json`, `hub/protocol/fixtures/PairResponse.json`, `hub/protocol/fixtures/PasswordChangeRequest.json`, `hub/protocol/fixtures/PingResponse.json`, `hub/protocol/fixtures/RelayCancel.json`, `hub/protocol/fixtures/RelayFramesRequest.json`, `hub/protocol/fixtures/RelayHello.json`, `hub/protocol/fixtures/RelayPing.json`, `hub/protocol/fixtures/RelayPollResponse.json`, `hub/protocol/fixtures/RelayPong.json`, `hub/protocol/fixtures/RelayRequest.json`, `hub/protocol/fixtures/RelayRequest.stream.json`, `hub/protocol/fixtures/RelayResponse.json`, `hub/protocol/fixtures/RelayStreamChunk.json`, `hub/protocol/fixtures/RelayStreamEnd.json`, `hub/protocol/fixtures/RelayWorkspaces.json`, `hub/protocol/fixtures/Snapshot.idle-new-workspace.json`, `hub/protocol/fixtures/Snapshot.running.json`, `hub/protocol/fixtures/UserCommand.prompt-held.json`, `hub/protocol/fixtures/WorkspaceDetail.json`, `hub/protocol/fixtures/WorkspaceIndexEntry.json`, `hub/protocol/fixtures/WorkspaceSummary.online.json`, `hub/protocol/fixtures/WorkspaceSummary.stopped.json`, `hub/protocol/fixtures/invalid/Command.bad-type.json`, `hub/protocol/fixtures/invalid/Decision.bad-id.json`, `hub/protocol/fixtures/invalid/Decision.extra-field.json`, `hub/protocol/fixtures/invalid/LoginRequest.bad-username.json`, `hub/protocol/fixtures/invalid/PasswordChangeRequest.short.json`, `hub/protocol/fixtures/invalid/Run.null-finish-wrong-type.json`, `hub/protocol/fixtures/invalid/Snapshot.missing-orchestrator.json`, `hub/protocol/fixtures/invalid/Task.bad-id.json`, `hub/protocol/fixtures/invalid/Worker.has-screen.json`, `hub/protocol/schemas/protocol.schema.json`, `hub/protocol/src/api.ts`, `hub/protocol/src/types.gen.ts`, `hub/protocol/test/contract.test.ts`
- Scope: OK
- Tests reported:
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run gen -w @agent-hub/protocol` -> exit 1
  - `source ~/.nvm/nvm.sh && nvm use 24 && env -u HTTPS_PROXY -u https_proxy npm ci --cache ./.npm-cache --no-audit --no-fund` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run gen -w @agent-hub/protocol` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm test -w @agent-hub/protocol` -> exit 0
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck -w @agent-hub/protocol` -> exit 0
  - `python3 -m unittest discover -s .agent-system/tests -p test_hubschema.py` -> exit 0
  - `git diff --check` -> exit 0
- Risks: none
- Not done:
  - Server, proxy, web, and broader .agent-system suites were not run; outside the task's Run these list.
- Full diff: `.orchestrator/runs/hub3/reports/T1.diff`

````text
 .agent-system/hub-protocol.schema.json             | 190 ++++++++---
 docs/hub-api.md                                    | 372 +++++++++++----------
 hub/protocol/fixtures/AdminUserRequest.json        |   1 +
 hub/protocol/fixtures/AdminUserResponse.json       |   1 +
 hub/protocol/fixtures/Assertion.json               |   1 +
 hub/protocol/fixtures/Command.answer-finish.json   |   2 +-
 hub/protocol/fixtures/Command.answer.json          |   2 +-
 hub/protocol/fixtures/Command.prompt.json          |   2 +-
 hub/protocol/fixtures/Command.reply.json           |   2 +-
 hub/protocol/fixtures/CommandsResponse.json        |   4 +-
 hub/protocol/fixtures/ComputerRegisterRequest.json |   1 +
 .../fixtures/ComputerRegisterResponse.json         |   1 +
 .../fixtures/Decision.finish-answered-hub.json     |  14 +-
 hub/protocol/fixtures/Decision.repair-open.json    |  14 +-
 hub/protocol/fixtures/Decision.routine.json        |   5 +-
 .../fixtures/Decision.worker-approval.json         |  20 ++
 hub/protocol/fixtures/DecisionsBatch.json          |  19 +-
 hub/protocol/fixtures/Device.json                  |   7 -
 hub/protocol/fixtures/HelloRequest.json            |   5 +-
 hub/protocol/fixtures/HistoryItem.answer.json      |   2 +-
 hub/protocol/fixtures/HubDecision.open.json        |  14 +-
 hub/protocol/fixtures/HubDecision.rejected.json    |  16 +-
 hub/protocol/fixtures/HubDecision.reply-sent.json  |  40 +++
 hub/protocol/fixtures/List.history.json            |   8 +-
 hub/protocol/fixtures/List.workspaces.json         |  15 +-
 hub/protocol/fixtures/LoginRequest.json            |   1 +
 hub/protocol/fixtures/LoginResponse.json           |   1 +
 hub/protocol/fixtures/Me.json                      |   1 +
 hub/protocol/fixtures/PairRequest.json             |   4 -
 hub/protocol/fixtures/PairResponse.json            |  10 -
 hub/protocol/fixtures/PasswordChangeRequest.json   |   1 +
 hub/protocol/fixtures/PingResponse.json            |   4 +-
 hub/protocol/fixtures/RelayCancel.json             |   1 +
 hub/protocol/fixtures/RelayFramesRequest.json      |   1 +
 hub/protocol/fixtures/RelayHello.json              |   1 +
 hub/protocol/fixtures/RelayPing.json               |   1 +
 hub/protocol/fixtures/RelayPollResponse.json       |   1 +
 hub/protocol/fixtures/RelayPong.json               |   1 +
 hub/protocol/fixtures/RelayRequest.json            |   1 +
 hub/protocol/fixtures/RelayRequest.stream.json     |   1 +
 hub/protocol/fixtures/RelayResponse.json           |   1 +
 hub/protocol/fixtures/RelayStreamChunk.json        |   1 +
 hub/protocol/fixtures/RelayStreamEnd.json          |   1 +
 hub/protocol/fixtures/RelayWorkspaces.json         |   1 +
 .../fixtures/Snapshot.idle-new-workspace.json      |   5 +-
 hub/protocol/fixtures/Snapshot.running.json        |  38 +--
 hub/protocol/fixtures/UserCommand.prompt-held.json |   2 +-
 hub/protocol/fixtures/WorkspaceDetail.json         |  63 ++--
 hub/protocol/fixtures/WorkspaceIndexEntry.json     |   1 +
 hub/protocol/fixtures/WorkspaceSummary.online.json |   9 +-
 .../fixtures/WorkspaceSummary.stopped.json         |   6 +-
 .../fixtures/invalid/Command.bad-type.json         |   2 +-
 hub/protocol/fixtures/invalid/Decision.bad-id.json |  14 +-
 .../fixtures/invalid/Decision.extra-field.json     |  12 +-
 .../invalid/LoginRequest.bad-username.json         |   1 +
 .../invalid/PasswordChangeRequest.short.json       |   1 +
 .../invalid/Run.null-finish-wrong-type.json        |   7 +-
 .../invalid/Snapshot.missing-orchestrator.json     |  38 +--
 hub/protocol/fixtures/invalid/Task.bad-id.json     |   1 +
 .../fixtures/invalid/Worker.has-screen.json        |   1 +
 hub/protocol/schemas/protocol.schema.json          | 190 ++++++++---
 hub/protocol/src/api.ts                            |  48 ++-
 hub/protocol/src/types.gen.ts                      | 197 +++++++++--
 hub/protocol/test/contract.test.ts                 |  20 +-
 64 files changed, 986 insertions(+), 462 deletions(-)
````

(diff is 2961 lines; read the full diff file)

## Review round 1: PASS (28/10/26 22:23)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 739a1f37e1ab, commits 739a1f37e1ab

# Review: hub3 T1, protocol v2 contract (P1)

Verdict: **PASS**

- Scripted check of every spec item (ids, Worker no screen, Task summary, Run title/goal, Snapshot last activity,
  Option consequence, Decision evidence/note/approval, REPLY_SENT, DocumentKind, Hello/Summary upload + computer
  fields, by instead of device, Device/Pair removed, 27 new defs, password min 12): all OK.
- Kit schema copy byte-identical; api.ts PROTOCOL/MIN 2, LIMITS, ERRORS, USER/ADMIN/COMPUTER routes per spec.
- Protocol: 77 tests pass, typecheck clean, generated types --check clean; test_hubschema passes.
- docs/hub-api.md v2 has proxy/user routes, relay frames, assertion verification sections.
- Expected: server and kit suites fail against v2 until hub3 T2/T3.

## Integration: merged (28/10/26 22:23)

- On `agent/integration-hub3` at 99cb749f9396; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hub3/logs/post-merge-T1-a1.log`)

## Final gate: PASS (28/10/26 22:54)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hub3 at b82502faff42 (log `.orchestrator/runs/hub3/logs/verify-1793202836.log`)
- Task MERGED; run DONE

## Finished (28/10/26 22:56)

- merged into hub/plan (decision D1)
