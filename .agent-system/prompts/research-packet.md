# Research packet - Sonnet scout request and dossier format

Opus fills in the REQUEST part and delegates to the `scout` subagent. The scout returns a
DOSSIER in the format below. The scout is read-only: **Opus** saves the reply to a file and registers it:
`scheduler.py research round --run <id> --evidence <file> --question "..." [--question ...]`
(the scheduler copies it to `research/scout-round-<n>.md` and enforces max 3 rounds per request).

## REQUEST (Opus -> scout)
- Run / round: `<RUN_ID>` / round `<n>` of 3 (round 1 broad; rounds 2-3 targeted at unresolved gaps only)
- User request (verbatim): <...>
- Decisions this research must support:
  1. <e.g. where should the new endpoint live and which existing contract does it extend?>
  2. <...>
- Known evidence to build on (rounds 2-3): `<path:line>` ...
- Out of scope for this round: <...>

## DOSSIER (scout -> Opus)
```text
RESEARCH_ID / RUN_ID / REPO_HEAD
REQUESTED_ARCHITECTURAL_DECISIONS
DECISION-READY INDEX
- confirmed behavior            (verified facts only, each with path:line)
- recommended boundaries         (labeled as suggestions)
- decisive uncertainties
SYSTEM MAP
- entry points, flows, dependencies, code ownership
EVIDENCE MATRIX
- finding -> path:line / symbol -> why it matters -> confidence (verified|inferred) / unknowns
CONTRACTS AND INVARIANTS
- public and internal APIs, data ownership, side effects, failure paths
EXISTING TESTS AND CHECKS
- test files and exact commands
RISKS / CONFLICTS / OPEN QUESTIONS
- missing evidence stated plainly, never hidden
CANDIDATE TASK DAG
- 1..3 tasks with dependency rationale (suggestions only)
TARGETED FOLLOW-UP QUERIES
- specific files / functions / questions for Opus or the next round
```

Rules: distinguish verified facts from hypotheses; cite exact `path:line`; do not present a redesign as
current behavior; detail beats brevity for complex features; no secrets in the dossier.
