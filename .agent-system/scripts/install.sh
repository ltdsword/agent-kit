#!/usr/bin/env bash
# agent-kit: copy the orchestration kit into a project workspace, or update one.
#   agent-kit create [--folder=<repo>] [--dry-run] [--init-git] [model options]
#   agent-kit update [--folder=<repo>] [--dry-run] [--force-agent]
#   agent-kit config [--folder=<repo>] [model options] [--show] [--list]
#   agent-kit start  [--folder=<repo>] [--dry-run] [--no-attach]   open Herdr + launch the orchestrator
#   agent-kit continue [--folder=<repo>] [--session=ID] [--force] [--dry-run] [--no-attach]
#   agent-kit create-user|reset-password --name=<u> | hub-login --name=<u> [--url=<proxy>] [--computer-name=<n>]
#   agent-kit hub start|stop|status | hub autostart on|off|status | proxy-setup [--rotate-admin-key] [--origins ...]
#                     restart the orchestrator with the current config, in its last chat
#   model options: --model-orchestrator=M --effort-orchestrator=E --model-scout=M --effort-scout=E
#                  --model-worker=M --effort-worker=E  (M: model or alias, or <program>/<model>)
#                  --num-worker=N  (parallel workers, 1..10; default 3)
#   agent-kit [--dry-run] [--force-agent] [--init-git] <target-repo>   legacy: kit inside the repo
#   agent-kit --version [--folder=<repo>]   the kit's version (and the version a workspace was updated to)
# <repo> is the repo folder (default: the current folder). The workspace is <repo>.workspace next
# to it, linked back as <repo>.workspace/<repo> -> ../<repo>. A folder already named *.workspace
# is taken as the workspace itself, so `agent-kit update` also works from inside a workspace.
# create: make the workspace (kit, config with project.path, CLAUDE.md/AGENTS.md, .claude/, folders).
# update: refresh the kit files; keeps config.json, project notes and customized scout.md.
# The kit is copied from this script's kit home (~/Code/agent-kit via ~/.local/bin/agent-kit, or
# /usr/share/agent-kit from apt). Nothing is written into the repo, except `git init` + a first commit
# when create finds no repo and you agree (--init-git: yes); create/update fail if its git status changes.
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
SRC="$(cd "$(dirname "$SELF")/../.." && pwd -P)"   # kit home: holds .agent-system/
usage() { sed -n '2,21p' "$SELF" | sed 's/^# \{0,1\}//'; }
die() { echo "error: $*" >&2; exit 1; }

CMD=""; DRY=0; FORCE_AGENT=0; FOLDER=""; TARGET=""; MODEL_ARGS=(); NEW_ARGS=(); NO_ATTACH=0; FORCE=0; SESSION=""; INIT_GIT=0; SHOW_VERSION=0
is_hub_command() {
  case "$1" in
    create-user|reset-password|hub-login|hub|proxy-setup) return 0 ;;
    *) return 1 ;;
  esac
}
while [ $# -gt 0 ]; do
  if [ "$1" = --dry-run ]; then DRY=1; shift; continue; fi
  if [ -n "$CMD" ] && is_hub_command "$CMD"; then NEW_ARGS+=("$1"); shift; continue; fi
  case "$1" in
    --model-*=*|--effort-*=*|--num-worker=*) MODEL_ARGS+=("$1") ;;
    --model-*|--effort-*|--num-worker) [ $# -ge 2 ] || die "$1 needs a value"; MODEL_ARGS+=("$1=$2"); shift ;;
    --show|--list|--no-input) MODEL_ARGS+=("$1") ;;
    --no-attach) NO_ATTACH=1 ;;
    --force) FORCE=1 ;;
    --session=*) SESSION="${1#--session=}"; [ -n "$SESSION" ] || die "--session needs a value" ;;
    --session) [ $# -ge 2 ] || die "--session needs a value"; SESSION="$2"; shift ;;
    --folder=*) FOLDER="${1#--folder=}"; [ -n "$FOLDER" ] || die "--folder needs a value" ;;
    --folder) [ $# -ge 2 ] || die "--folder needs a value"; FOLDER="$2"; shift ;;
    --dry-run) DRY=1 ;;
    --force-agent) FORCE_AGENT=1 ;;
    --init-git) INIT_GIT=1 ;;
    -h|--help) usage; exit 0 ;;
    --version|-V) SHOW_VERSION=1 ;;
    -*) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)
      if [ -z "$CMD$TARGET" ] && { [ "$1" = create ] || [ "$1" = update ] || [ "$1" = config ] || [ "$1" = start ] || [ "$1" = continue ] || is_hub_command "$1"; }; then CMD="$1"
      elif [ -z "$CMD$TARGET" ]; then TARGET="$1"
      else echo "unexpected argument: $1" >&2; exit 2
      fi ;;
  esac
  shift
done
[ $SHOW_VERSION -eq 1 ] || [ -n "$CMD$TARGET" ] || { usage >&2; exit 2; }
[ -z "$FOLDER" ] || [ -n "$CMD" ] || [ $SHOW_VERSION -eq 1 ] || die "--folder only applies to create/update/config/start/continue"
[ ${#MODEL_ARGS[@]} -eq 0 ] || [ "$CMD" = create ] || [ "$CMD" = config ] \
  || die "model options only apply to create and config"
[ $INIT_GIT -eq 0 ] || [ "$CMD" = create ] || [ -n "$TARGET" ] || die "--init-git only applies to create"

do_() { if [ $DRY -eq 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
repo_status() { git -C "$1" status --porcelain --untracked-files=all; }

kit_version() {  # the kit home's version: VERSION (written into the apt package), else git describe
  if [ "$(git -C "$SRC" rev-parse --show-toplevel 2>/dev/null)" = "$SRC" ]; then
    git -C "$SRC" describe --tags --match 'v[0-9]*' --always --dirty 2>/dev/null | sed 's/^v//'
  elif [ -f "$SRC/.agent-system/VERSION" ]; then
    head -n1 "$SRC/.agent-system/VERSION"
  else
    echo unknown
  fi
}

cmd_version() {  # agent-kit --version [--folder=<repo>]
  local v from dest repo_name wv
  v="$(kit_version)"
  if [ "$(git -C "$SRC" rev-parse --show-toplevel 2>/dev/null)" = "$SRC" ]; then from="Git checkout"
  elif [ -f "$SRC/.agent-system/VERSION" ]; then from="package"
  else from="copy"; fi
  echo "agent-kit $v ($from: $SRC)"
  resolve_folder
  [ -d "$dest/.agent-system" ] || return 0
  if [ -f "$dest/.agent-system/VERSION" ]; then
    wv="$(head -n1 "$dest/.agent-system/VERSION")"
    if [ "$wv" = "$v" ]; then echo "workspace $dest: $wv (up to date)"
    else echo "workspace $dest: $wv (the kit is $v: run 'agent-kit update' to bring it up to date)"; fi
  else
    echo "workspace $dest: unknown (made before versions were recorded: run 'agent-kit update')"
  fi
}

copy_kit() {  # copy_kit <dest>: kit code, docs, prompts, scripts, tests, templates (never config.json)
  do_ mkdir -p "$1/.agent-system" "$1/.claude/agents"
  for item in scheduler.py models.py kitconfig.py kitstart.py agentctl.py hubctl.py hubschema.py hub-protocol.schema.json WORKER-RULES.md README.md GUIDE.md docs prompts scripts tests templates; do
    [ -e "$SRC/.agent-system/$item" ] || continue
    do_ rm -rf "$1/.agent-system/$item"
    do_ cp -r "$SRC/.agent-system/$item" "$1/.agent-system/$item"
  done
  [ $DRY -eq 1 ] || find "$1/.agent-system" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
  [ $DRY -eq 1 ] || kit_version > "$1/.agent-system/VERSION"  # which kit version this copy is
}

same_but_model() {  # same_but_model <a> <b>: equal apart from model:/effort: lines (set by agent-kit config)
  cmp -s <(grep -vE '^(model|effort):' "$1") <(grep -vE '^(model|effort):' "$2")
}

kitconfig() {  # kitconfig <workspace> [args]: choose / apply models (agent-kit config)
  local ws="$1"; shift
  PYTHONDONTWRITEBYTECODE=1 python3 "$SRC/.agent-system/kitconfig.py" --workspace "$ws" "$@"
}

scout_hash() {  # scout_hash <scout.md>: hash without the model:/effort: lines (set by agent-kit config)
  grep -vE '^(model|effort):' "$1" | sha256sum | cut -d' ' -f1
}

install_agent() {  # install_agent <dest>: scout.md, its stamp, and the kit's scout skill
  local agent="$1/.claude/agents/scout.md" stamp="$1/.claude/agents/.scout.kit-hash"
  # Untouched when it equals the kit's copy, or still matches the hash stamped at the last install
  # (the kit's scout changed since); anything else is a user customization and is kept.
  # Untouched also covers a copy matching any scout the kit shipped before (templates/scout-history.sha256).
  if [ -f "$agent" ] && ! same_but_model "$agent" "$SRC/.claude/agents/scout.md" && [ $FORCE_AGENT -eq 0 ] \
     && ! { [ -f "$stamp" ] && [ "$(scout_hash "$agent")" = "$(cat "$stamp")" ]; } \
     && ! grep -qx "$(scout_hash "$agent")" "$SRC/.agent-system/templates/scout-history.sha256" 2>/dev/null; then
    echo "kept existing .claude/agents/scout.md (differs; use --force-agent to replace)"
  else
    do_ cp "$SRC/.claude/agents/scout.md" "$agent"
    [ $DRY -eq 1 ] || scout_hash "$agent" > "$stamp"
  fi
  # Kit-owned read-only research skill the scout preloads (skills: in scout.md); always refreshed.
  do_ mkdir -p "$1/.claude/skills"
  do_ rm -rf "$1/.claude/skills/agent-kit-research"
  do_ cp -r "$SRC/.claude/skills/agent-kit-research" "$1/.claude/skills/agent-kit-research"
}

merge_settings() {  # merge_settings <settings.json> [<real repo path>]: deny rules, chat-id hooks (+ additionalDirectories)
  if [ $DRY -eq 1 ]; then echo "[dry-run] merge deny rules${2:+ and additionalDirectories $2} into $1"; return; fi
  python3 - "$1" "$SRC/.agent-system/templates/claude-settings.json" "${2:-}" <<'PY'
import json, os, sys
path, tpl, repo = sys.argv[1:]
cur = json.load(open(path)) if os.path.exists(path) else {}
perms = cur.setdefault("permissions", {})
deny = perms.setdefault("deny", [])
# rules for the removed `decide` script / `decision answer` command (answers now come through chat)
obsolete = [r for r in deny if "scripts/decide" in r or "scheduler.py decision answer" in r
            or r in ("Write(.orchestrator/**/state.json)", "Write(.orchestrator/**/decisions/**)")]
# (Claude Code ignores Write(path) deny rules: Edit(path) rules cover every file-editing tool.)
for r in obsolete:
    deny.remove(r)
added = [r for r in json.load(open(tpl))["permissions"]["deny"] if r not in deny]
deny.extend(added)
msg = f"settings.json: {len(added)} deny rule(s) added" if added else "settings.json: deny rules present"
if obsolete:
    msg += f"; {len(obsolete)} obsolete rule(s) removed"
# hooks that record the workspace's active chat id (record-session.py, for `agent-kit continue`)
hooks = cur.setdefault("hooks", {})
for event, entries in json.load(open(tpl)).get("hooks", {}).items():
    have = hooks.setdefault(event, [])
    commands = {h.get("command") for entry in have for h in entry.get("hooks", [])
                if isinstance(h, dict) and isinstance(h.get("command"), str)}
    added = 0
    for template_entry in entries:
        missing = [hook for hook in template_entry.get("hooks", [])
                   if hook.get("command") not in commands]
        if not missing:
            continue
        matcher = template_entry.get("matcher")
        target = next((entry for entry in have if entry.get("matcher") == matcher), None)
        if target is None:
            target = {key: value for key, value in template_entry.items() if key != "hooks"}
            target["hooks"] = []
            have.append(target)
        target.setdefault("hooks", []).extend(missing)
        commands.update(hook.get("command") for hook in missing)
        added += len(missing)
    if added:
        msg += f"; {event} hook(s) added"
if repo:
    dirs = perms.setdefault("additionalDirectories", [])
    if repo not in dirs:
        dirs.append(repo)
        msg += f"; additionalDirectories += {repo}"
json.dump(cur, open(path, "w"), indent=2)
open(path, "a").write("\n")
print(msg)
PY
}

merge_section() {  # merge_section <file> <template> <marker-name>
  local file="$1" tpl="$2" name="$3"
  local begin="<!-- agent-system:$name:begin -->" end="<!-- agent-system:$name:end -->"
  if [ $DRY -eq 1 ]; then echo "[dry-run] merge $name section into $file"; return; fi
  if [ -f "$file" ] && grep -qF "$begin" "$file"; then
    python3 - "$file" "$tpl" "$begin" "$end" <<'PY'
import sys
path, tpl, begin, end = sys.argv[1:]
text = open(path).read()
head, rest = text.split(begin, 1)
_, tail = rest.split(end, 1)
open(path, "w").write(head + open(tpl).read().rstrip("\n") + tail)
PY
    echo "updated $name section in $(basename "$file")"
  else
    { [ -s "$file" ] && printf '\n'; cat "$tpl"; } >> "$file"
    echo "appended $name section to $(basename "$file")"
  fi
}

remove_section() {  # remove_section <file> <marker-name>: drop a marked block (migrations)
  local file="$1" name="$2"
  [ -f "$file" ] && grep -qF "<!-- agent-system:$name:begin -->" "$file" || return 0
  if [ $DRY -eq 1 ]; then echo "[dry-run] remove old $name section from $file"; return; fi
  python3 - "$file" "<!-- agent-system:$name:begin -->" "<!-- agent-system:$name:end -->" <<'PY'
import sys
path, begin, end = sys.argv[1:]
text = open(path).read()
head, rest = text.split(begin, 1)
_, tail = rest.split(end, 1)
open(path, "w").write((head.rstrip("\n") + "\n" + tail.lstrip("\n")).lstrip("\n"))
PY
  echo "removed old $name section from $(basename "$file") (worker rules are now .agent-system/WORKER-RULES.md)"
}

write_instructions() {  # write_instructions <dir>: orchestrator rules into CLAUDE.md and AGENTS.md
  local dir="$1" tpl="$SRC/.agent-system/templates/ORCHESTRATOR.section.md"
  merge_section "$dir/CLAUDE.md" "$tpl" orchestrator
  remove_section "$dir/AGENTS.md" worker
  if [ ! -s "$dir/AGENTS.md" ] && [ $DRY -eq 0 ]; then
    printf '# %s\n\nProject notes: see the top of CLAUDE.md in this folder.\n' "$(basename "${dir%.workspace}")" \
      > "$dir/AGENTS.md"
  fi
  merge_section "$dir/AGENTS.md" "$tpl" orchestrator
}

check_repo_unchanged() {  # check_repo_unchanged <repo> <status before>
  [ $DRY -eq 1 ] || [ "$(repo_status "$1")" = "$2" ] || die "the repo's git status changed during install: inspect $1"
}

ensure_git_repo() {  # ensure_git_repo <folder>: a Git repo with a commit, or offer to make one
  local repo="$1" what cmd answer
  [ -d "$repo" ] || die "$repo does not exist"
  git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1 && return 0
  if git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 \
     && [ "$(git -C "$repo" rev-parse --show-toplevel)" = "$(cd "$repo" && pwd -P)" ]; then
    what="is a Git repository with no commits yet"; cmd="git add -A && git commit -m \"Initial commit\""
  elif git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    return 0  # inside another repo: the top-folder check below explains it
  else
    what="is not a Git repository"; cmd="git init && git add -A && git commit -m \"Initial commit\""
  fi
  echo "$repo $what. agent-kit needs a Git repository with at least one commit (workers use Git worktrees)."
  echo "It can run, in $repo:  $cmd"
  echo "This commits every file in the folder (except those in its .gitignore): add a .gitignore first if"
  echo "some files must not be committed (build output, secrets, large data)."
  if [ $DRY -eq 1 ]; then
    echo "[dry-run] would ask before running it; the rest of the dry run needs the repository"; exit 0
  fi
  if [ $INIT_GIT -eq 1 ]; then
    answer=y; echo "--init-git: yes"
  else
    printf "Create it now? [y/N] "
    read -r answer || answer=""
    [ -t 0 ] || echo "$answer"
  fi
  case "$answer" in
    [yY]|[yY][eE][sS]) ;;
    *) die "aborted: $repo $what (answer y, or pass --init-git, to create it)" ;;
  esac
  git -C "$repo" var GIT_COMMITTER_IDENT >/dev/null 2>&1 \
    || die "Git needs your name and email first: git config --global user.name \"Your Name\" && git config --global user.email you@example.com"
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || git -C "$repo" init -q || die "git init failed in $repo"
  git -C "$repo" add -A && git -C "$repo" commit -q --allow-empty -m "Initial commit" \
    || die "the first commit failed in $repo"
  echo "created the Git repository: $(git -C "$repo" log --oneline -1) ($(git -C "$repo" ls-files | wc -l | tr -d ' ') files)"
}

resolve_folder() {  # sets dest (the workspace) and repo_name from --folder or the current folder
  local f
  f="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${FOLDER:-$PWD}")"
  case "$(basename "$f")" in
    ?*.workspace) dest="$f"; repo_name="$(basename "$f" .workspace)" ;;  # given the workspace itself
    *) repo_name="$(basename "$f")"; dest="$f.workspace" ;;              # given the repo
  esac
  [ "$dest" != "$SRC" ] || die "destination is the kit home itself"
}

cmd_create() {
  local dest repo_name repo link before
  resolve_folder
  [ ! -e "$dest/.agent-system" ] || die "$dest already has .agent-system: use 'agent-kit update'"
  repo="$(dirname "$dest")/$repo_name"
  ensure_git_repo "$repo"
  repo="$(cd "$repo" && pwd -P)"
  [ "$(git -C "$repo" rev-parse --show-toplevel)" = "$repo" ] \
    || die "$repo is inside a Git repository, not its top folder: pass the repo's top folder"
  link="$dest/$repo_name"
  if [ -L "$link" ]; then
    [ "$(readlink -f "$link")" = "$repo" ] || die "$link is a symlink to somewhere else"
  elif [ -e "$link" ]; then
    die "$link exists and is not a symlink to the repo"
  fi
  before="$(repo_status "$repo")"

  echo "creating workspace $dest for repo $repo (kit from $SRC)"
  do_ mkdir -p "$dest/gen-tasks" "$dest/worktrees" "$dest/notes"
  [ -L "$link" ] || do_ ln -s "../$repo_name" "$link"
  copy_kit "$dest"
  if [ $DRY -eq 1 ]; then
    echo "[dry-run] write .agent-system/config.json (project.path=$repo_name, worktree_root=worktrees)"
    echo "[dry-run] write CLAUDE.md project notes, AGENTS.md, .gitignore"
  else
    python3 - "$SRC/.agent-system/config.json" "$dest" "$repo_name" "$repo" <<'PY'
import json, os, sys
tpl, dest, name, repo = sys.argv[1:]
cfg = json.load(open(tpl))
import glob, subprocess
has = lambda *pats: any(glob.glob(os.path.join(repo, p)) for p in pats)
c_sources = subprocess.run(["git", "-C", repo, "ls-files", "*.c", "*.cc", "*.cpp", "*.cxx", "*.h", "*.hh", "*.hpp"],
                           capture_output=True, text=True).stdout.strip() != ""
# (stack, worker-writable cache dir or None, marker files, build/test command or None)
stacks = [("Java/Gradle", "~/.gradle", ("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
                                        "gradlew"), "./gradlew build"),
          ("Java/Maven", "~/.m2", ("pom.xml",), "mvn verify"),
          ("Node", "~/.npm", ("package.json",), "npm test"),
          ("Go", "~/go/pkg/mod", ("go.mod",), "go test ./..."),
          ("Rust", "~/.cargo", ("Cargo.toml",), "cargo test"),
          ("Python", None, ("pyproject.toml", "setup.py", "setup.cfg", "requirements*.txt", "pytest.ini", "tox.ini"),
           "python3 -m pytest"),
          ("C/C++ (CMake)", None, ("CMakeLists.txt",),
           "cmake -S . -B build && cmake --build build && ctest --test-dir build"),
          ("C/C++ (Conan)", "~/.conan2", ("conanfile.txt", "conanfile.py"), None),
          ("C/C++ (vcpkg)", "~/.cache/vcpkg", ("vcpkg.json",), None)]
found = [(name, d, cmd) for name, d, files, cmd in stacks if has(*files)]
if c_sources and has("Makefile", "makefile", "GNUmakefile") and not has("CMakeLists.txt"):
    found.append(("C/C++ (make)", None, "make && make test"))
elif c_sources and not any(n.startswith("C/C++") for n, _, _ in found):
    found.append(("C/C++", None, None))
out = {}
for k, v in cfg.items():  # keep the template's key order; project goes right after the header
    if k == "project":
        continue
    out[k] = v
    if k == "_comment":
        out["project"] = {"path": name}
out.setdefault("project", {"path": name})
out["pool"]["worktree_root"] = "worktrees"
dirs = [d for _, d, _ in found if d]
out["worker"]["writable_dirs"] = dirs
with open(os.path.join(dest, ".agent-system", "config.json"), "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")
build = " / ".join(f"`{c}`" for _, _, c in found if c) or "TODO"
stack = ", ".join(n for n, _, _ in found) or "TODO"
claude = os.path.join(dest, "CLAUDE.md")
if not os.path.exists(claude):
    with open(claude, "w") as f:
        f.write(f"# {name}\n\n"
                f"- This folder is the AI workspace (`.agent-system/docs/WORKSPACE-SETUP.md`); the repo is the\n"
                f"  symlink `{name}/` -> `../{name}`. Never write AI tooling files into the repo.\n"
                f"- Stack: {stack}\n"
                f"- Build and test (run inside `{name}/`): {build}\n"
                f"- Generated code not to edit: TODO\n\n")
print(f"config.json: project.path={name}, stack={stack}, writable_dirs={dirs}")
PY
    [ -e "$dest/.gitignore" ] || printf '.orchestrator/\nworktrees/\n**/__pycache__/\n' > "$dest/.gitignore"
  fi
  install_agent "$dest"
  merge_settings "$dest/.claude/settings.json" "$repo"
  write_instructions "$dest"
  if [ $DRY -eq 1 ]; then
    echo "[dry-run] choose models (asked on a terminal, or from --model-* options)"
  else
    echo; echo "== models (change later with: agent-kit config)"
    kitconfig "$dest" ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} || die "model choice failed; fix it with: agent-kit config --folder=$dest"
  fi
  check_repo_unchanged "$repo" "$before"
  [ $DRY -eq 1 ] || PYTHONDONTWRITEBYTECODE=1 python3 "$dest/.agent-system/scheduler.py" --workspace-root "$dest" pool show >/dev/null \
    || die "the new workspace does not load: check $dest/.agent-system/config.json"

  echo
  echo "done. Next, in $dest:"
  echo "  1. fill in the TODOs at the top of CLAUDE.md; check gate commands and writable_dirs in .agent-system/config.json"
  echo "  2. .agent-system/scripts/doctor.sh"
  echo "  3. agent-kit start   (opens Herdr and launches the orchestrator)"
}

cmd_update() {
  local dest repo_name repo="" before=""
  resolve_folder
  [ -f "$dest/.agent-system/config.json" ] || die "$dest has no kit (.agent-system/config.json): use 'agent-kit create'"
  repo="$(python3 - "$dest" <<'PY'
import json, os, sys
dest = sys.argv[1]
p = json.load(open(os.path.join(dest, ".agent-system", "config.json"))).get("project", {}).get("path")
print(os.path.realpath(os.path.join(dest, os.path.expanduser(p))) if p else "")
PY
)"
  if [ -n "$repo" ]; then  # workspace mode: the repo must stay untouched
    git -C "$repo" rev-parse --verify HEAD >/dev/null 2>&1 || die "project.path $repo is not a Git repository"
    before="$(repo_status "$repo")"
    do_ mkdir -p "$dest/gen-tasks" "$dest/worktrees" "$dest/notes"
  fi

  echo "updating kit in $dest from $SRC"
  copy_kit "$dest"
  install_agent "$dest"
  merge_settings "$dest/.claude/settings.json" "$repo"
  write_instructions "$dest"
  python3 - "$SRC/.agent-system/config.json" "$dest/.agent-system/config.json" <<'PY'
import json, sys
new, cur = (json.load(open(p)) for p in sys.argv[1:])
missing = [k for k in new if k not in cur and k != "project"]
print("kept .agent-system/config.json" + (f"; the kit template has new keys: {missing}" if missing else ""))
PY
  [ $DRY -eq 1 ] || kitconfig "$dest" --no-input >/dev/null  # re-apply chosen models to Claude files
  [ -z "$repo" ] || check_repo_unchanged "$repo" "$before"
  echo "done. Run .agent-system/scripts/doctor.sh in $dest"
}

cmd_legacy() {  # kit inside the target repo (your own repos only: also edits its .gitignore)
  TARGET="$(cd "$TARGET" && pwd -P)"
  [ "$SRC" != "$TARGET" ] || die "target is the kit home"
  ensure_git_repo "$TARGET"
  echo "installing agent-system (in-repo mode) from $SRC into $TARGET"
  copy_kit "$TARGET"
  if [ -f "$TARGET/.agent-system/config.json" ]; then
    echo "kept existing .agent-system/config.json (compare with $SRC/.agent-system/config.json)"
  elif [ $DRY -eq 1 ]; then
    echo "[dry-run] write .agent-system/config.json (worktree_root=../{repo_name}.agent-worktrees)"
  else  # in-repo mode: worktrees must live outside the repo
    python3 - "$SRC/.agent-system/config.json" "$TARGET/.agent-system/config.json" <<'PY'
import json, sys
src, dst = sys.argv[1:]
cfg = json.load(open(src))
cfg.pop("project", None)
cfg["pool"]["worktree_root"] = "../{repo_name}.agent-worktrees"
with open(dst, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
  fi
  install_agent "$TARGET"
  merge_settings "$TARGET/.claude/settings.json"
  write_instructions "$TARGET"
  if ! grep -qE '^/?\.orchestrator/?$' "$TARGET/.gitignore" 2>/dev/null; then
    do_ sh -c "printf '\n# multi-agent orchestration runtime state\n.orchestrator/\n.agent-system/**/__pycache__/\n' >> '$TARGET/.gitignore'"
  fi
  echo
  echo "done. Next, in $TARGET: check .agent-system/config.json, run .agent-system/scripts/doctor.sh,"
  echo "commit the kit, then open the repo in Herdr and start Claude"
}

cmd_config() {
  local dest repo_name
  resolve_folder
  [ -f "$dest/.agent-system/config.json" ] || die "$dest has no kit (.agent-system/config.json): use 'agent-kit create'"
  kitconfig "$dest" ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"}  # bash 3.2 (macOS): empty array + set -u
}

cmd_start() {
  local dest repo_name args=()
  resolve_folder
  [ -f "$dest/.agent-system/config.json" ] || die "$dest has no kit (.agent-system/config.json): use 'agent-kit create'"
  [ $DRY -eq 1 ] && args+=(--dry-run)
  [ $NO_ATTACH -eq 1 ] && args+=(--no-attach)
  if [ "$CMD" = continue ]; then
    args+=(--continue)
    [ $FORCE -eq 1 ] && args+=(--force)
    [ -n "$SESSION" ] && args+=(--session "$SESSION")
  fi
  PYTHONDONTWRITEBYTECODE=1 exec python3 "$dest/.agent-system/kitstart.py" --workspace "$dest" ${args[@]+"${args[@]}"}
}

cmd_hubctl() {
  if [ $DRY -eq 1 ]; then
    printf '[dry-run] python3 %q --source %q' "$SRC/.agent-system/hubctl.py" "$SRC"
    printf ' %q' "$CMD" "${NEW_ARGS[@]}"
    printf '\n'
  else
    PYTHONDONTWRITEBYTECODE=1 python3 "$SRC/.agent-system/hubctl.py" --source "$SRC" "$CMD" "${NEW_ARGS[@]}"
  fi
}

if [ $SHOW_VERSION -eq 1 ]; then cmd_version; exit 0; fi
case "$CMD" in
  create-user|reset-password|hub-login|hub|proxy-setup) cmd_hubctl ;;
  create) cmd_create ;;
  start|continue) cmd_start ;;
  update) cmd_update ;;
  config) cmd_config ;;
  *) cmd_legacy ;;
esac
