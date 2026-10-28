# Review: Agent Hub plan (`.agent-system/docs/DECISION-HUB-PLAN.md`) vs current code

Date: 2026-10-28. Code checked: `scheduler.py` (decisions, finish, events), `templates/ORCHESTRATOR.section.md`, `config.json`, README.

## Verdict

- **Proper?** Core architecture yes: local scheduler stays source of truth, outbound-only connector, snapshot-overwrite (not event replay), idempotent keys, project-token can't answer, data minimization. Those are the right calls.
- **Comprehensive?** No, it is **stale**. Written for the `scripts/decide` era (removed in d150201). It misses the chat-answer flow, the `finish` decision, and has a weak signature design (its own 2026-10-19 review said so).
- **Doable?** Yes. ~1-2k lines Python stdlib (outbox + `agentctl`) + a small Next.js app. Three design issues must be settled first (B1-B3).

## Blockers (settle before coding)

**B1. Chat question vs. hub answer conflict.** Today Opus asks via AskUserQuestion and ends its turn; answer arrives as chat, recorded with `decision record --quote`. Plan 4.1 assumes Opus instead runs `decision wait` in background. While an AskUserQuestion dialog is open, a hub answer can't dismiss it, so Opus never wakes. Need a rule: when `hub.enabled`, Opus opens the decision, starts `decision wait` in background (long timeout, e.g. hours, not 540 s, so it doesn't re-wake and burn tokens), and asks in **plain chat** ("D3 waiting: answer on the hub or reply here"). Either channel then works; first answer wins under the scheduler lock.

**B2. Signature is not real enforcement.**
- HMAC key sits on the same machine as the agent; a `Read` deny rule doesn't stop `cat` via Bash. Use **asymmetric**: hub signs with an Ed25519 private key that never leaves the hub; the connector/scheduler holds only the public key.
- Python stdlib has no Ed25519. Options: shell out to `ssh-keygen -Y verify` (present on Linux/macOS) or `openssl pkeyutl -verify`. Pick one; keeps the "stdlib only" rule.
- Even then, `decision record --quote` (chat channel) lets Opus record any answer. Be honest in the doc: hub answers get a **verified** badge + audit; real enforcement only with an opt-in strict mode (`decisions.require_signed_for: [...]`) where chat recording is refused for those kinds.

**B3. `finish` decision not covered.** It is the most important decision and has a follow-up (branch choice; option with free-text `input`, validated locally by `git check-ref-format`, agent branches refused). Plan's kinds table, `decision.json`, `answer.json`, UI form and DB schema have no `followup`. Also "review the report and total diff, then choose" is impossible from a phone if uploads are off: at minimum upload `final-report.md` summary + diff **stat** (no code) for finish decisions, opt-in for full diff.

## Stale / inconsistent items to fix in the doc

1. Header says "not planned"; update status and the README/`docs` mentions when reopening.
2. `scripts/decide`, "terminal channel", `CLAUDECODE` stdin check: all gone. Fallback channel is now **chat** (`channel=chat`, with `quote`). Section 4.2 "answered in terminal" -> "answered in chat". G5, 12.3, 14 likewise.
3. `decision_answer` requires `quote`; hub channel must pass one (e.g. `"<KEY>: <label>"` + note, marked `channel=hub`).
4. Kinds list lacks `finish`; `DECIDED_BY_OPUS` routine decisions (the `decision routine` audit) should be first-class in the feed/snapshot.
5. Phase numbering: plan's Phase 1 (outbox + connector, local only) is **not done** (no `outbox` in scheduler). Your "phase 2: the hub" = plan phases 1+2+3 (+4 for notifications).
6. `log_event` keeps last 500 events in `state.json`; the outbox must be its own file with its own `seq` (plan has this right; keep it per workspace, not per run).
7. Worker programs are no longer Codex-only; snapshot `herdr.state` must not assume Codex.

## Simplifications (YAGNI for single user)

- **Drop device-code login + machine credential.** Create the project in the web UI, copy the token once, `agentctl project register --token ...`. Saves a whole auth flow.
- **Hosting decision first** (open question 1). For work repos, a self-hosted/local hub reached from the phone over Tailscale removes the company-data issue and Vercel Pro cost. The Next.js app runs anywhere Node runs; keep it host-agnostic (no Vercel-only APIs; cron via a route hit by an external timer).
- Attachments, history/metrics, multi-user: keep in phase 5 as planned.
- Adaptive polling (5 s with an open decision, 30 s otherwise) from day one: trivial, cuts ~80% traffic.

## Gaps worth adding

- Protocol schemas location: plan puts them in the hub repo, but the kit (shipped as `.deb`) needs them for contract tests. Put `protocol/` in **this** repo (or make the hub a folder of this repo).
- Hub-side rejection path for follow-up values the hub can't validate (invalid branch name) -> connector acks REJECTED with reason -> UI shows it -> Opus reopens.
- Decision "re-asked" UX: once delivered the answer is immutable; UI must show the superseding decision link.
- Who wakes Opus if the session ended: `resume` already lists answered decisions; mention `agent-kit continue` in the offline banner text.
- Notification phase: Claude Code `PushNotification` / Remote Control already notify; hub push only needed when Remote Control isn't used.

## Recommended build order

1. Update the plan doc (B1-B3, stale items, simplifications). Decide hosting.
2. Kit: outbox in `log_event` path + tests; `agentctl push --dry-run` snapshot builder; JSON Schemas.
3. Hub MVP read-only: projects, project detail, connector offline.
4. Decisions from web incl. finish follow-up + Ed25519 verify + `channel=hub`.
5. Notifications, worker approvals.

## Unresolved questions

1. Hosting: Vercel (personal only) vs self-hosted/Tailscale for work projects?
2. Strict signed-only mode for critical kinds, or "verified badge" only?
3. Hub code in this repo (`hub/`) or separate repo?
4. Is final-report summary + diff stat upload acceptable for work projects?
