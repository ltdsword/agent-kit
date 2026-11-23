# Claude token usage: run pchecks (24/11/26)

Source: Claude Code transcripts. Each API response is counted once (deduplicated by message id).
Window: from the "plan as a new run" request (2026-11-23T19:28Z) to the merge (~20:27Z).
Codex workers (GPT-6-Luna) are not included because they are not Claude.
Equivalent = input + 1.25 x cache write + 0.1 x cache read + 5 x output, measured in input-token units at Anthropic's price
ratios. This is a cost comparison, not an exact bill.

| Session | Model | Requests | Input | Cache write | Cache read | Output | Raw total | Equivalent |
|---|---|---|---|---|---|---|---|---|
| Orchestrator (this session) | Opus 5.5 | 92 | 184 | 131,325 | 24,017,781 | 54,392 | 24.20M | **~2.84M** |
| Check round 1: review (FAIL) | Opus 5.5 | 11 | 22 | 86,006 | 1,012,027 | 11,377 | 1.11M | ~266k |
| Check round 1: test, Code Mode (PASS) | Opus 5.5 | 18 | 10 | 38,937 | 205,242 | 3,138 | 247k | ~85k |
| Check round 2: review (PASS) | Opus 5.5 | 9 | 18 | 81,246 | 791,964 | 7,078 | 880k | ~216k |
| Check round 2: test, Code Mode (PASS) | Opus 5.5 | 14 | 6 | 33,450 | 105,854 | 1,995 | 141k | ~62k |
| **Checkers total** | | 52 | 56 | 239,639 | 2,115,087 | 23,588 | 2.38M | **~629k** |
| Researcher subagent (Code Mode research, before the run) | Sonnet 5.5 | 6 | 12 | 53,195 | 162,703 | 9,374 | 225k | ~130k |

## Notes
- The orchestrator dominates: 92 requests, each re-reading a context of about 260k tokens (cache reads of 24M). This
  window also includes side work outside the run: the hook-error investigation, the Herdr task-store leak fix and the
  Cloudflare D1 analysis.
- The Code Mode test checkers are cheap (62-85k equivalent each) while running the full suite (326 tests). That is in
  line with the user's earlier trial (76-96k).
- Review sessions cost 3-4x more than test sessions (216-266k each), because Opus at high effort reads the diff and
  the files. Round 1 found a real major bug, so it paid for itself. A cheaper option is a lower review effort, or
  Sonnet for the review through the `checks.review` model setting.
- The biggest saving left is orchestrator context. A fresh orchestrator session per run (not one long session) would
  cut most of the 24M cache reads.
