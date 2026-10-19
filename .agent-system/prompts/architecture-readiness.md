# Architecture-readiness gate (Opus, after EVERY scout round)

Record the outcome with:
```bash
python3 .agent-system/scheduler.py research readiness --run <id> --status READY|NOT_READY \
  --preserve "..." --contracts "..." --interactions "..." --testing "..." --assumptions "..." \
  [--missing "precise missing evidence" ...]
```
The scheduler refuses READY unless all five answers are present and `--missing` is empty, appends
the record to `.orchestrator/runs/<id>/research/architecture-readiness.md`, and blocks dispatch of
every non-trivial task until the latest record is READY.

## Checklist - READY only if every answer is concrete and evidence-backed
- **(a) preserve**: what existing code/behavior must stay intact? (cite path:line)
- **(b) contracts**: what exact implementation contract will each worker receive?
- **(c) interactions**: how do tasks interact, which run in parallel, which wait for a merge, and why?
- **(d) testing**: how will success be tested (commands, new tests, gate)?
- **(e) assumptions**: what remains assumed, and why is each assumption safe?

Also confirm: callers of changed interfaces found; security / concurrency / schema semantics understood;
task boundaries do not overlap hot files without sequencing.

## Decision rules
- READY -> stop scouting; write task packets; `run create` (if not yet) and `dispatch-ready`.
- NOT_READY and rounds < 3 -> next round with ONLY the unresolved questions and the relevant path:line refs.
- NOT_READY after round 3 -> no more scouting for this request (the budget survives restarts and new runs
  with the same `--request-id`). Opus inspects the remaining evidence directly, narrows scope to what the
  evidence supports, or closes the run BLOCKED stating exactly what is missing. The gate is never waived.
- Trivial, localized edits (`"trivial": true` in tasks.json) may skip scouting; Opus inspects directly.
