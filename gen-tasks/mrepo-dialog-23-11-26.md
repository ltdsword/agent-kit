# mrepo T2: Herdr dialog for `agent-kit create` (23/11/26)

## Goal
Inside Herdr, `agent-kit create` opens a dialog in the app asking the workspace name, its location and the
repos to link (>= 1), with Browse buttons and live checks; the answers go back to the shell command.

## Read first
- `plans/261123-1500-mrepo/plan.md` (behaviour + the contract below).
- Herdr mod docs (read only): `~/.config/herdr-app/AGENTS.md` (mods, `openOverlay`/`closeOverlay`, `props()`,
  `exec`, `pickFolder`, `readTextFile`/`writeTextFile`, `appHome`, `home`, `mod.open`, mod.json), types in
  `~/.config/herdr-app/herdr.d.ts` and `gpui-kit.d.ts`; examples `~/.config/herdr-app/mods/prompt/main.js`
  (input dialog, Enter/Esc) and `~/.config/herdr-app/mods/spaces-chat/rename.js`.

## Contract (T1 calls it; do not change)
`.agent-system/scripts/create-dialog.sh --cwd D --name N --location L [--repo R]...`
- stdout: one JSON line `{"name": "...", "location": "/abs", "repos": ["/abs", ...]}`, exit 0.
- exit 1: the person cancelled (or no answer in 15 minutes: say so on stderr).
- exit 2: no Herdr here: `herdr-app` not on PATH, `HC_TERMINAL_ID` unset, or `herdr-app status` fails.

## Steps
1. Mod in the kit: `.agent-system/herdr-mods/agent-kit-create/` with `mod.json`
   (`{"place":"none","overlay":{"width":600,"height":520}}`) and `main.js` (plain JS module, like `prompt`).
2. Script: app home `${HERDR_APP_HOME:-$HOME/.config/herdr-app}`. Install the mod: copy the kit's mod folder to
   `<app home>/mods/agent-kit-create/` when missing or different (cmp each file; write via temp + mv).
   Write `<app home>/data/agent-kit-create/request.json` `{id, cwd, name, location, repos, at}` (id random),
   delete any old `response.json`, run `herdr-app do mod.open --name agent-kit-create`, then poll
   `response.json` (0.3 s) until one with the same id appears or 15 min pass. `{"id", "ok": true, name,
   location, repos}` -> print `{"name","location","repos"}` (python3 for JSON) exit 0; `ok: false` -> exit 1.
   Remove request/response after. All JSON written with python3 (no hand-built strings).
3. Dialog (`main.js`): on open read `request.json` (`readTextFile(appHome() + ...)`). Fields: Name (input),
   Location (input + Browse -> `pickFolder`), Repos: one row per repo (input + Browse + remove, min 1 row) and
   "+ Add repo". Resolve each path like the shell: absolute, `~`/`~/` via `home()`, else relative to `cwd`.
   Check repos as typed (debounced ~300 ms) with `exec("git", ["-C", p, "rev-parse", "--show-toplevel"])`:
   show "git repo" (ok) when the top equals the path, else a short reason ("not a git repo", "inside <top>:
   pick its top folder", "folder not found"). Under Location show the resulting path `<location>/<name>.workspace`.
   Create (primary, Enter) is enabled only with a name and every repo row ok; it writes response.json with
   resolved absolute paths (`writeTextFile`) and closes. Cancel / Esc writes `{"id","ok":false}` and closes.
   Use theme colors and sizes like `prompt`; title "New agent-kit workspace".
4. Tests in a NEW file `.agent-system/tests/test_create_dialog.py`: run the script with `HERDR_APP_HOME` in a
   temp dir and a fake `herdr-app` first on PATH (a stub script that records its args and, for `do mod.open`,
   writes the response for the request's id in the background; `status` exits 0). Cases: ok answer -> JSON +
   exit 0 + mod installed; ok:false -> exit 1; no HC_TERMINAL_ID -> exit 2 without touching the app home;
   no herdr-app -> exit 2; mod not recopied when identical. Use a short timeout env for tests
   (`AGENT_KIT_DIALOG_TIMEOUT`, default 900 s). `node --check` is not available for ESM imports here: just
   keep `main.js` syntactically valid (a test may run `node --input-type=module --check < main.js` only if node exists; skip otherwise).

## Boundaries
**You may edit:** `.agent-system/herdr-mods/agent-kit-create/**` (new), `.agent-system/scripts/create-dialog.sh`
(new, executable), `.agent-system/tests/test_create_dialog.py` (new).
**You must not edit:** install.sh, kitconfig.py, scheduler.py, README/docs (T1), anything else.
**You may run:** `python3 -m pytest`, `bash -n`, `node --check` if present, read-only git, `git add`/`git commit`.
**You must not run:** the real `herdr-app`, `hc`, `herdr-task`, `agent-kit`; never write under the real
`~/.config/herdr-app` or `~/.herdr` (tests use temp HERDR_APP_HOME); git push/merge/rebase/reset/checkout.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Done when
- [ ] Steps 1-4; `bash -n` clean; whole suite green.

## Run these
- `bash -n .agent-system/scripts/create-dialog.sh`
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

## Worker result - attempt 1 (23/11/26 15:18)

- Status: **done** (worker worker-2, branch `agent/mrepo-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/herdr-mods/agent-kit-create/main.js`, `.agent-system/herdr-mods/agent-kit-create/mod.json`, `.agent-system/scripts/create-dialog.sh`, `.agent-system/tests/test_create_dialog.py`
- Scope: OK
- Tests reported:
  - `bash -n .agent-system/scripts/create-dialog.sh` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - Herdr runtime UI was not exercised because the task forbids running the real herdr-app.
  - The optional JavaScript syntax check was skipped because node is unavailable.
- Not done:
  - Commit unavailable because .git is read-only in the worker sandbox.
- Full diff: `.orchestrator/runs/mrepo/reports/T2.diff`

````text
 .agent-system/herdr-mods/agent-kit-create/main.js  | 240 +++++++++++++++++++++
 .agent-system/herdr-mods/agent-kit-create/mod.json |   1 +
 .agent-system/scripts/create-dialog.sh             | 152 +++++++++++++
 .agent-system/tests/test_create_dialog.py          | 155 +++++++++++++
 4 files changed, 548 insertions(+)
````

(diff is 572 lines; read the full diff file)

## Review round 1: PASS (23/11/26 15:18)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 7a000976b632, commits 7a000976b632
- Notes: contract met; Opus minor fix for path import and symlinked repos

# Review mrepo T2 (Herdr dialog) - PASS with Opus minor fix

- create-dialog.sh follows the contract: exit 2 without herdr-app/HC_TERMINAL_ID/status, mod installed via cmp+tmp+mv,
  request/response JSON via python3, id match, 15 min timeout (env override), cleanup trap. 5 tests pass with a fake herdr-app.
- main.js: fields, Browse via pickFolder, debounced git check, Create gated on all rows ok, Esc/Cancel writes ok:false.
- Minor fix (Opus): `import { resolve } from "path"` is not a Herdr mod built-in (AGENTS.md lists fetch, localStorage,
  fs/promises only) -> hand-written POSIX resolve; git top compared with `realpath` of the folder so symlinked repos pass.
- Live check in Herdr after integration (mod.open overlay sizing, Input focus) - not testable here.

## Integration: merged (23/11/26 15:38)

- On `agent/integration-mrepo` at 0dab06c3e3a6; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/mrepo/logs/post-merge-T2-a1.log`)

## Final gate: PASS (23/11/26 15:39)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-mrepo at 0dab06c3e3a6 (log `.orchestrator/runs/mrepo/logs/verify-1795423125.log`)
- Task MERGED; run DONE

## Final gate: PASS (23/11/26 15:42)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-mrepo at 0dab06c3e3a6 (log `.orchestrator/runs/mrepo/logs/verify-1795423285.log`)
- Task MERGED; run DONE
