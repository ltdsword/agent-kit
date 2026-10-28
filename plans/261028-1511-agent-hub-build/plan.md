---
title: Agent Hub build (phase 2 of the kit roadmap)
status: in-progress
branch: hub/plan
design: .agent-system/docs/DECISION-HUB-PLAN.md
contract: docs/hub-api.md + hub/protocol/
---

# Agent Hub build

The design is in `.agent-system/docs/DECISION-HUB-PLAN.md` (the "plan"), and the contract is in
`docs/hub-api.md` plus `hub/protocol/`. This file schedules the work.

## Schedule

| Step | Owner | Depends on | Status |
|---|---|---|---|
| H0 Herdr + Claude Team check | user + lead | none | done 2026-10-28 (11/11) |
| M0 contract: schema, fixtures, TS types + ajv, Python validator, API doc | lead | H0 | done 2026-10-28 |
| A1 kit sync side: scheduler bits, `agentctl` sync/watch (push only), kitstart, doctor | codex worker-1 | M0 | done 2026-10-28 (run hub1, review PASS) |
| B1 backend: full API, SQLite, auth/pairing, commands queue, SSE, CLI | codex worker-2 | M0 | done 2026-10-28 (run hub1, review PASS) |
| C0 UI design (Claude Design) | user | none | in progress |
| M1 integration: real `agentctl watch` against the real backend | lead | A1, B1 | done 2026-10-28 (sync, ONLINE→STOPPED, restart resync: 0 resent) |
| A2 kit commands: answer/reply/prompt delivery through scheduler + Herdr, orchestrator rule text | subagent A | M1 | todo |
| C1 web app (read-only) built from the design, mocked from fixtures | subagent C | C0, M0 | todo |
| M2 read-only hub on 127.0.0.1 (plan H2+H3) | lead | M1, C1 | todo |
| C2 decisions, replies, prompts, finish two-step in the UI | subagent C | C1 | todo |
| M3 end-to-end decisions and prompts (plan H4 acceptance) | lead | A2, C2 | todo |
| M4 phone access: Tailscale + Vercel check, Web Push (plan H5) | lead | M3 | todo |

## Ownership (parallel tracks never edit the same files)

| Track | Owns | Must not edit |
|---|---|---|
| lead | `hub/protocol/**`, `docs/hub-api.md`, the plan, `hub/package.json`, merges | none |
| A (kit) | `.agent-system/**` except `hubschema.py` and `hub-protocol.schema.json` | `hub/**`, `docs/**` |
| B (backend) | `hub/server/**` (+ adding `"server"` to `hub/package.json` workspaces) | `.agent-system/**`, `hub/protocol/**`, `hub/web/**` |
| C (web) | `hub/web/**` | everything else |

A contract change goes through the lead. A track that needs one stops and reports it, and doesn't
work around it.

## Environment (all tracks)

- Node 24 for `hub/**`: `source ~/.nvm/nvm.sh && nvm use 24` (the default node is 20; `hub/.nvmrc`).
- npm hangs on the corporate proxy: run npm with `env -u HTTPS_PROXY -u https_proxy npm ...`.
- Python is stdlib only (3.10+ syntax; the machine has 3.14).
- Kit tests: `python3 -m unittest discover -s .agent-system/tests` (all must pass, ~20 s).
- Protocol tests: `cd hub && npm test -w @agent-hub/protocol`.

## Phases

- [phase-a1-kit-sync.md](phase-a1-kit-sync.md)
- [phase-b1-backend.md](phase-b1-backend.md)
- phase-a2-kit-commands.md, phase-c1-web.md: written after M1 and C0.
