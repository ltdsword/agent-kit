# Review: hub9 T3 web questions, filters, paging

Verdict: PASS

## Checked
- Questions tab/panel (`QuestionsSection`): inbox decisions only, ids shown as Q<n>; inbox excluded from Decisions/NeedsYou/in-flight; open questions counted separately on the tab.
- Documents: chips Run/Plan/Other (none = all); Run reveals Final report/Diff/Decisions/Scout toggles (default on); Plan=plan, Other=review+other; filter/search reset page.
- Shared `Pager` (30/page) on Documents, Decisions (All decisions), Questions, History; Everything shows first 15 + "More…" switching tab.
- History: inbox rows labelled "Question"; prompt FAILED shows reason; HELD label "Waiting for Opus".
- 65 web tests + tsc pass (rerun by Opus).

## Notes
- Decision detail page still titles inbox questions "D<n>" (panel shows Q<n>); cosmetic.
