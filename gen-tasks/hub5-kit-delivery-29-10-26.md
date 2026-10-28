# hub5 kit delivery (29/10/26)

## Goal
The connector delivers website commands (answer, reply, prompt) to the orchestrator, and the hub setup commands work in the right order (hub-login, hub start/stop, enable keeps config formatting).

## Read first
- `plans/261029-0150-hub5-delivery-decisions/plan.md` section **T1**: **the full spec** (work items, tests). Follow it exactly.
- `docs/hub-api.md` sections 3.3 (commands) and 4 (connector behavior per command); `.agent-system/hub-protocol.schema.json` (`CommandsResponse`, `Command`, `AckRequest`).
- `.agent-system/agentctl.py` (`watch`, `_herdr_record`), `.agent-system/scheduler.py` (`decision_answer`, the herdr prompt helper), `.agent-system/hubctl.py`, `.agent-system/kitstart.py` (how `agent-kit start` launches `agentctl watch`).

## Steps
1. Implement the spec's work items in order.
2. Write the tests listed in the spec.
3. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/**` except `hubschema.py` and `hub-protocol.schema.json`

**You must not edit:**
- `hub/**`, `docs/**`, `plans/**`, `gen-tasks/**`, root `README.md`, `.gitignore`.
- The protocol contract: if it doesn't fit, implement the closest faithful behavior and list the gap in `risks`.

**You may run:**
- `python3 -m unittest discover -s .agent-system/tests` and single modules; `python3 .agent-system/*.py ...` against temp dirs, fake HTTP servers on 127.0.0.1 and fake herdr runners; read-only git. Python stdlib only (3.10+ syntax).

**You must not run:**
- `git push/merge/rebase/reset/checkout`; real `herdr`/`codex`/`claude`; anything that talks to Cloudflare;
  reading `~/.config/.wrangler/**`; touching the real `~/.config/agent-hub` or `~/.local/share/agent-hub` (use temp dirs via env vars); downloads.

**When to ask:** only for a real blocker (the spec contradicts the code or the contract, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Log or print secrets (keys, tokens, passwords).

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `python3 -m unittest discover -s .agent-system/tests` passes.

## Run these
- `python3 -m unittest discover -s .agent-system/tests`: expect OK

## Notes
- Report: files changed, decisions you made where the spec left room, contract gaps, open questions.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
