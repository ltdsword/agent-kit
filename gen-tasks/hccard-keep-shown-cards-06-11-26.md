# hccard: never delete a decision card a Herdr layout is showing (06/11/26)

## Goal
Run cleanup removes a run's decision cards, but a card open in the person's Artifacts view is referenced by
their layout file; deleting it made the whole layout fail to load ("shepherdr" fell back to "main").
Cleanup must leave such a card in place.

## Facts (Opus, verified 06/11/26, herdr-app 0.1.13)
- App home: `$HERDR_APP_HOME`, default `~/.config/herdr-app`. Layouts: `<home>/layouts/*.json`.
- An artifact with id `X` is installed as mod `art-X`; the Artifacts view shows it by writing
  `{"content": {"mod": "art-X"}}` into the layout's block `"id": "artifacts-view-body"` (mods/artifacts/sidebar.js).
- After `herdr-artifact rm X`, a layout still holding `art-X` fails: status error
  `mod art-X: no mod folder ~/.config/herdr-app/mods/art-X`.
- Only caller: `scheduler.py` cleanup (`artifacts.remove(artifact_ids)`, ~2894).

## Read first
- `.agent-system/artifacts.py` (`remove`, `enabled`), `.agent-system/tests/test_artifacts.py`.

## Steps
1. artifacts.py: `shown_in_layouts(env=None) -> set[str]`: read every `<home>/layouts/*.json` (home from
   env/os.environ `HERDR_APP_HOME`, else `~/.config/herdr-app`), walk the JSON tree, collect every
   `content.mod` string starting with `art-`, return them without the `art-` prefix. Unreadable/invalid
   files are skipped; never raises.
2. `remove(ids, runner=subprocess.run, env=None)`: skip ids in `shown_in_layouts(env)` (one line to stderr per
   skipped id: `kept artifact <id>: shown in a Herdr layout`); others removed as today.
3. Tests (temp HERDR_APP_HOME, fake runner): shown card kept and not passed to the runner; other ids removed;
   a broken layout file is ignored; no layouts dir -> all removed.

## Boundaries
**You may edit:** `.agent-system/artifacts.py`, `.agent-system/tests/test_artifacts.py`.
**You must not edit:** scheduler.py, panels, docs, plans/**, gen-tasks/**, .orchestrator/**, anything in
`~/.config/herdr-app`.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `herdr*`, `hc`; git push/merge/rebase/reset/checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Shown cards survive cleanup; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->
