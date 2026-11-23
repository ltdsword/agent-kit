# Review mrepo T2 (Herdr dialog) - PASS with Opus minor fix

- create-dialog.sh follows the contract: exit 2 without herdr-app/HC_TERMINAL_ID/status, mod installed via cmp+tmp+mv,
  request/response JSON via python3, id match, 15 min timeout (env override), cleanup trap. 5 tests pass with a fake herdr-app.
- main.js: fields, Browse via pickFolder, debounced git check, Create gated on all rows ok, Esc/Cancel writes ok:false.
- Minor fix (Opus): `import { resolve } from "path"` is not a Herdr mod built-in (AGENTS.md lists fetch, localStorage,
  fs/promises only) -> hand-written POSIX resolve; git top compared with `realpath` of the folder so symlinked repos pass.
- Live check in Herdr after integration (mod.open overlay sizing, Input focus) - not testable here.
