# Review hcnext T2 - artifacts: run board and decision cards (Opus)

Verdict: PASS (worker reported blocked correctly; Opus fixes applied before commit)

- C4 met: `artifacts.py` (board_data only titles/statuses/questions/options, atomic write_board from
  RunStore.save, enabled gate, publish board at run create and decision card at decision ask, ids in state,
  cleanup removes cards); two panels read board.json live (5 s timer), theme colors, scroll, 320 px.
- **Blocker resolved (D3/D4):** install.sh copies a fixed file list; added `artifacts.py artifacts`, else every
  workspace's scheduler fails to import. Safety net: `import artifacts` optional, every call site guarded.
- **Fixed (MAJOR):** buttons had no `.id()`; the app's guide requires `.id("unique")` before `.on_click`, so
  clicks could be dead. Added ids (options, followups, back, scroll lists).
- **Fixed (MINOR):** a card could send its answer twice; now one reply per card.
- `herdr-app check` passes for both panels with a sample board (Opus run). Whole suite 243 passed.
- Minor (accepted): an "input" followup (type a branch) replies without a value; Opus asks in chat.
