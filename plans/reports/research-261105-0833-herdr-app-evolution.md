# Herdr app: new features and how agent-kit can evolve (research)

Sources: herdr.dev (site + docs), installed guides `herdr-app --skill` (0.1.13), `hc --skill` (0.1.18),
`herdr-task --help`, `herdr-artifact guide`, `~/.config/herdr-core/templates/assistant.md`. Verified locally 05/11/26.

## What is new vs old herdr

| Area | New app | agent-kit today |
|---|---|---|
| Orchestration core | `hc run/send/wait/read/interrupt`, parent/child terminals, child reports arrive as `<hc from=…>` messages, hc notifies parent when a child is blocked/error/exited | we launch `--no-parent --no-notify`, poll state with `scheduler.py wait` + our own monitors |
| Waiting | `hc wait <t>`, `hc wait --children any/all`, `hc events --label k=v` (live JSON stream) | polling loops (scheduler wait, connector watch every N s) |
| Templates | `~/.config/herdr-core/templates/<name>.md` (frontmatter command+model, body = instructions); `hc run reviewer "task"`; 60 s readiness retry, `first_message.sent` | we pass prompt by `hc send` after start; Codex startup dialogs need manual keys |
| Tasks | `herdr-task`: per-folder tasks, Tasks panel, queue (`--after`, max-running), worktree per task, worker `status`/`ready`, person Accept -> merge/PR, review rounds, `alert` (toast+sound), automations, Autopilot heartbeat, backups | our scheduler: packets, slots, worktrees, Opus review, integration branch, final gate, hub decisions |
| Coordinator | built-in `assistant` / `worker` / `reviewer` templates (Claude coordinates, never codes) | our ORCHESTRATOR.md + Codex workers |
| Artifacts | `herdr-artifact publish/update`: small JS panels in the app sidebar + chat; `reply()` buttons send text back to the agent; person can mark up an area -> note back to the agent | reports are Markdown files; decisions go to phone/website |
| Remote machines | `hc machine add vps`, `hc run --on vps`, `hc exec/file --on`; remote spaces in the same sidebar | single machine; WSL is a separate install |
| Secrets | `herdr-secret ask/run/env`: secrets by name, masked card, output masked | regex scrub on upload; manual "never print keys" rules |
| Persistence | `hc keep`, core survives app quit/crash; `restore-spaces` backups | orchestrator.json + `agent-kit continue` |
| UI customisation | mods (JS) in `~/.config/herdr-app/mods`, layouts, themes | none |
| Chat | Assistant chat tab with reactions, task mentions (`HAT-1`), live task rows | Claude in a pane; phone hub |

## Recommendation: integrate at the edges, keep our scheduler as the source of truth

herdr-task overlaps our scheduler but has a different trust model (worker self-reviews, person Accepts,
PR-based merge). Ours (Opus review, integration branch + final gate, hub decisions from phone) is the
product. Replacing it = rewrite + loses the website. So: adopt hc primitives inside, mirror outward.

### Tier 1: cheap, high value (one run, ~3 tasks)
1. **Event-driven waits.** Launch workers as children of the orchestrator (`--parent $HC_TERMINAL_ID
   --outlive-parent --keep`, keep `--no-notify` off) so hc itself tells the orchestrator when a worker is
   done/blocked/exited; `scheduler.py wait` uses `hc wait --children any` / `hc events --label
   agentkit.run=<run>` instead of polling. Connector `watch` follows `hc events` for state changes
   (website updates instantly, fewer `hc get` calls). Removes my ad-hoc monitor scripts.
   Risk: `--outlive-parent` is required or workers die with the orchestrator.
2. **Templates for workers.** `agent-kit install/update` writes `agentkit-worker.md` (+ `agentkit-reviewer`)
   templates with the configured command/model/effort; dispatch = `hc run --bg agentkit-worker "<packet>"`.
   Gains hc's 60 s readiness retry and `first_message.sent` (fixes the "prompt swallowed by a startup
   dialog" problem we hit; the Codex hooks-review dialog still needs a one-time trust).
3. **Local alerts.** On decision ask / worker blocked / run done, also `herdr-task alert "…"` (toast +
   sound in the app) when inside the app. Phone stays the remote channel.

### Tier 2: visible upgrades (one run each)
4. **Artifacts for reports and decisions.** `report` and `decision ask` also publish an artifact: run board
   (tasks, slots, verdicts, diff stat) and a decision card whose buttons `reply("D3: B")`. Answer from the app,
   chat or phone; whichever comes first is recorded (`decision record`). Markup notes on a report reach Opus.
5. **Mirror runs into the Tasks panel (read-only).** Each scheduler task -> `herdr-task add` with
   `--here`/no-start + `status` updates, so the person sees agent-kit work in Herdr's native Tasks panel.
   Only if herdr-task supports tracking without starting its own worker (to verify: `_track`).
6. **Secrets through herdr-secret.** Hub keys / API tokens stored by name; workers run `herdr-secret run`
   so values never enter a transcript. Complements (not replaces) scrub.

### Tier 3: strategic (needs a decision)
7. **Remote workers.** `pool.slots[*].machine` -> `hc run --on <machine>`; worktree + git on that machine
   via `hc exec --on`. Lets a VPS/WSL box run Codex workers while the laptop sleeps. Biggest change: collect,
   diff and integrate must fetch the branch from the remote (git push to a shared remote first).
8. **agent-kit as a Herdr "assistant" flavour.** Ship an `agentkit` coordinator template so the person can
   start our orchestrator from the app's Assistant tab (chat, reactions, task rows) instead of
   `agent-kit start`. Depends on 1-5.
9. **Hub <-> Herdr status/progress.** Workers report `status "…" --done 40 --left 5m`; the website shows
   progress. Requires a hub protocol addition (website change), so last.

### Not recommended
- Replacing the scheduler with herdr-task/autopilot (different review/merge model; loses the website and the
  final gate).
- Mods for a sidebar run board (artifacts cover it with less code and are versioned).

## Suggested order
Run `hcnext`: Tier 1 (items 1-3) -> release v0.3.6. Then Tier 2 item 4 (artifacts) as its own run. Decide on
Tier 3 remote workers after that.

## Unresolved questions
- Can `herdr-task` track a task without starting its own agent (needed for item 5)? `_track` is hidden; needs a probe.
- `--outlive-parent` + `--parent`: does a child keep reporting to a restarted orchestrator (new terminal id)?
  If not, `agent-kit continue` must re-parent (`hc label`/events by label instead of children).
- Old herdr (legacy) keeps the polling path; is legacy still worth supporting after v0.3.6?
