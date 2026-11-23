# pchecks-hooks (24/11/26)

## Goal
Every kit workspace has `.claude/hooks/scan-secrets.sh`. It runs the linked project repo's own secret scanner,
so the company's managed PreToolUse Read hook (`bash "$CLAUDE_PROJECT_DIR/.claude/hooks/scan-secrets.sh"`) stops
failing with "No such file or directory" in workspaces, and the scan really runs there.

## Read first
- `plans/261124-0230-pchecks/plan.md`, section "Hook errors".
- `.agent-system/scripts/install.sh`: `install_agent` (~156), `merge_settings` (~175), and the three places that
  call `install_agent` (create ~501, update ~652, legacy ~692); `copy_kit` (~132; it copies `templates/`).
- `.agent-system/config.json` keys `project.path` (string) and `project.repos` (optional list), both relative to
  the workspace.
- `.agent-system/tests/test_create_repos.py`: how install.sh is tested with temp dirs.

## Steps
1. New template `.agent-system/templates/hooks/scan-secrets.sh` (bash, executable). Line 2 is the exact marker
   comment `# agent-kit:scan-secrets-wrapper`. Behaviour:
   - `ws` = the workspace = `$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)`.
   - Candidate repos: from `$ws/.agent-system/config.json`, read with `python3 -c` and printed one per line:
     `project.path` first, then each `project.repos` entry, without duplicates. Each one is resolved against `$ws`.
     If python3 or the config is missing, there are no candidates.
   - For each candidate `r`: `s="$r/.claude/hooks/scan-secrets.sh"`. Use the first `s` that is a regular file
     (after symlinks), whose `realpath` differs from this script's `realpath`, and that does NOT contain the
     marker line. Run `exec bash "$s" "$@"` (stdin passes through, and the exit code and output are the target's).
   - No target: `exit 0` silently (no stdout, no stderr).
   - Never print the hook input. Use `set -u` only (no `-e`, so a failed lookup cannot break the hook).
2. `install.sh`: new function `install_hooks() {  # install_hooks <dest>: workspace hook wrappers (scan-secrets)`.
   For the target `$1/.claude/hooks/scan-secrets.sh`:
   - Missing: mkdir -p, copy the template, chmod 755, and echo "hooks: scan-secrets wrapper installed".
   - Exists and contains the marker: replace it when it differs from the template (`cmp -s`). Echo "updated" or
     stay quiet when it is the same.
   - Exists WITHOUT the marker: it belongs to the repo (for example a company repo in legacy mode). Never touch
     it; echo "hooks: own scan-secrets.sh kept".
   - Respect `$DRY` like `do_` (print "[dry-run] ...").
   - Call it right after `install_agent` in create, update and legacy.
3. Tests: a NEW file `.agent-system/tests/test_scan_secrets_hook.py`. Run the template directly from a temp
   workspace layout (copy it to `<ws>/.claude/hooks/`; write `<ws>/.agent-system/config.json`; make the repo dirs
   with a fake `scan-secrets.sh` that echoes a marker plus its stdin length and exits 7).
   - It delegates to project.path's script, stdin passes through, and the exit code is 7.
   - It falls back to a `project.repos` entry when the first has none.
   - No candidate script: exit 0 with empty stdout/stderr.
   - It never runs a target that contains the marker, and never runs itself (a repo symlinked to the workspace).
   - No config: exit 0.
   - install_hooks via `bash install.sh update --folder <tmp ws>` if the existing tests make that easy; otherwise
     call it by sourcing install.sh functions the way test_create_repos does. Cover: missing gets installed, our
     marker gets updated, a foreign file is kept byte-for-byte.

## Boundaries
**You may edit** (owned_paths):
- `.agent-system/templates/hooks/scan-secrets.sh` (new)
- `.agent-system/scripts/install.sh` (only `install_hooks` and its three calls)
- `.agent-system/tests/test_scan_secrets_hook.py` (new)

**You must not edit:** scheduler.py, models.py, prompts/ (T1); ORCHESTRATOR.section.md, GUIDE.md, README.md (T3);
`templates/claude-settings.json` (the hook comes from the company's managed settings, not ours); anything else,
`.orchestrator/`, other worktrees. Never copy or quote any real company `scan-secrets.sh` content into the kit
(tests use fakes only).

**You may run:** the commands in "Run these"; `bash -n`; read-only git; `git add` / `git commit` on your branch.

**You must not run:** `install.sh` against real folders (temp dirs only), the real `agent-kit`, `hc` or `herdr`;
downloads or installs; git push, merge, rebase, reset, checkout or clean. Never write under the real `~/.claude`
or `~/Code/Internal`.

**When to ask:** only a real blocker: report "blocked" with the exact reason.

## Done when
- [ ] Steps 1-3; `bash -n` is clean on both scripts; the whole suite passes.

## Run these
- `bash -n .agent-system/templates/hooks/scan-secrets.sh`
- `bash -n .agent-system/scripts/install.sh`
- `python3 -m pytest -q .agent-system/tests/test_scan_secrets_hook.py`
- `python3 -m pytest -q .agent-system/tests`

## Worker result - attempt 1 (24/11/26 02:48)

- Status: **done** (worker worker-2, branch `agent/pchecks-t2`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/scripts/install.sh`, `.agent-system/templates/hooks/scan-secrets.sh`, `.agent-system/tests/test_scan_secrets_hook.py`
- Scope: OK
- Tests reported:
  - `bash -n .agent-system/templates/hooks/scan-secrets.sh` -> exit 0
  - `bash -n .agent-system/scripts/install.sh` -> exit 0
  - `python3 -m pytest -q .agent-system/tests/test_scan_secrets_hook.py` -> exit 0
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks: none
- Not done: none
- Full diff: `.orchestrator/runs/pchecks/reports/T2.diff`

````text
 .agent-system/scripts/install.sh              |  24 ++++
 .agent-system/templates/hooks/scan-secrets.sh |  53 ++++++++
 .agent-system/tests/test_scan_secrets_hook.py | 176 ++++++++++++++++++++++++++
 3 files changed, 253 insertions(+)
````

````diff
diff --git a/.agent-system/scripts/install.sh b/.agent-system/scripts/install.sh
index d294cd1..55dbb97 100755
--- a/.agent-system/scripts/install.sh
+++ b/.agent-system/scripts/install.sh
@@ -172,6 +172,27 @@ install_agent() {  # install_agent <dest>: scout.md, its stamp, and the kit's sc
   do_ cp -r "$SRC/.claude/skills/agent-kit-research" "$1/.claude/skills/agent-kit-research"
 }
 
+install_hooks() {  # install_hooks <dest>: workspace hook wrappers (scan-secrets)
+  local hook="$1/.claude/hooks/scan-secrets.sh"
+  local template="$SRC/.agent-system/templates/hooks/scan-secrets.sh"
+  if [ ! -e "$hook" ]; then
+    do_ mkdir -p "$1/.claude/hooks"
+    do_ cp "$template" "$hook"
+    do_ chmod 755 "$hook"
+    if [ $DRY -eq 1 ]; then echo "[dry-run] hooks: scan-secrets wrapper installed"
+    else echo "hooks: scan-secrets wrapper installed"; fi
+  elif grep -Fqx '# agent-kit:scan-secrets-wrapper' "$hook"; then
+    if ! cmp -s "$hook" "$template"; then
+      do_ cp "$template" "$hook"
+      do_ chmod 755 "$hook"
+      if [ $DRY -eq 1 ]; then echo "[dry-run] hooks: scan-secrets wrapper updated"
+      else echo "hooks: scan-secrets wrapper updated"; fi
+    fi
+  else
+    echo "hooks: own scan-secrets.sh kept"
+  fi
+}
+
 merge_settings() {  # merge_settings <settings.json> [<real repo path>]: deny rules, chat-id hooks (+ additionalDirectories)
   if [ $DRY -eq 1 ]; then echo "[dry-run] merge deny rules${2:+ and additionalDirectories $2} into $1"; return; fi
   python3 - "$1" "$SRC/.agent-system/templates/claude-settings.json" "${2:-}" <<'PY'
@@ -499,6 +520,7 @@ PY
     [ -e "$dest/.gitignore" ] || printf '.orchestrator/\nworktrees/\n**/__pycache__/\n' > "$dest/.gitignore"
   fi
   install_agent "$dest"
+  install_hooks "$dest"
   merge_settings "$dest/.claude/settings.json" "${repo_paths[0]}"
   write_instructions "$dest"
   if [ $DRY -eq 1 ]; then
@@ -651,6 +673,7 @@ PY
   echo "updating kit in $dest from $SRC"
   copy_kit "$dest"
   install_agent "$dest"
+  install_hooks "$dest"
   merge_settings "$dest/.claude/settings.json" "$repo"
   write_instructions "$dest"
   python3 - "$SRC/.agent-system/config.json" "$dest/.agent-system/config.json" <<'PY'
@@ -690,6 +713,7 @@ with open(dst, "w") as f:
 PY
   fi
   install_agent "$TARGET"
+  install_hooks "$TARGET"
   merge_settings "$TARGET/.claude/settings.json"
   write_instructions "$TARGET"
   if ! grep -qE '^/?\.orchestrator/?$' "$TARGET/.gitignore" 2>/dev/null; then
diff --git a/.agent-system/templates/hooks/scan-secrets.sh b/.agent-system/templates/hooks/scan-secrets.sh
new file mode 100755
index 0000000..c19396e
--- /dev/null
+++ b/.agent-system/templates/hooks/scan-secrets.sh
@@ -0,0 +1,53 @@
+#!/usr/bin/env bash
+# agent-kit:scan-secrets-wrapper
+set -u
+
+ws="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
+config="$ws/.agent-system/config.json"
+[ -f "$config" ] || exit 0
+command -v python3 >/dev/null 2>&1 || exit 0
+
+script_real="$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || true)"
+candidates=()
+mapfile -t candidates < <(python3 - "$ws" "$config" 2>/dev/null <<'PY'
+import json
+import os
+import sys
+
+workspace, config_path = sys.argv[1:]
+try:
+    with open(config_path) as config_file:
+        project = json.load(config_file).get("project")
+except (OSError, ValueError):
+    raise SystemExit(0)
+
+if not isinstance(project, dict):
+    raise SystemExit(0)
+
+paths = [project.get("path")]
+repos = project.get("repos")
+if isinstance(repos, list):
+    paths.extend(repos)
+
+seen = set()
+for path in paths:
+    if not isinstance(path, str) or not path:
+        continue
+    resolved = os.path.realpath(os.path.join(workspace, path))
+    if resolved not in seen:
+        seen.add(resolved)
+        print(resolved)
+PY
+)
+
+for r in "${candidates[@]}"; do
+  s="$r/.claude/hooks/scan-secrets.sh"
+  [ -f "$s" ] || continue
+  target_real="$(realpath "$s" 2>/dev/null || true)"
+  [ -n "$target_real" ] || continue
+  [ "$target_real" != "$script_real" ] || continue
+  grep -Fqx '# agent-kit:scan-secrets-wrapper' "$s" 2>/dev/null && continue
+  exec bash "$s" "$@"
+done
+
+exit 0
diff --git a/.agent-system/tests/test_scan_secrets_hook.py b/.agent-system/tests/test_scan_secrets_hook.py
new file mode 100644
index 0000000..d5303b4
--- /dev/null
+++ b/.agent-system/tests/test_scan_secrets_hook.py
@@ -0,0 +1,176 @@
+import json
+import os
+import shutil
+import subprocess
+import tempfile
+import unittest
+from pathlib import Path
+
+
+ROOT = Path(__file__).resolve().parents[1]
+TEMPLATE = ROOT / "templates" / "hooks" / "scan-secrets.sh"
+INSTALL = ROOT / "scripts" / "install.sh"
+CONFIG_TEMPLATE = ROOT / "config.json"
+MARKER = "# agent-kit:scan-secrets-wrapper"
+
+
+class ScanSecretsHookTests(unittest.TestCase):
+    def setUp(self):
+        self.tmp = tempfile.TemporaryDirectory()
+        self.addCleanup(self.tmp.cleanup)
+        self.root = Path(self.tmp.name)
+        self.workspace = self.root / "workspace"
+        self.workspace.mkdir()
+        self.hook = self.workspace / ".claude" / "hooks" / "scan-secrets.sh"
+        self.hook.parent.mkdir(parents=True)
+        shutil.copy2(TEMPLATE, self.hook)
+        self.hook.chmod(0o755)
+
+    def write_config(self, path, repos=None):
+        project = {"path": path}
+        if repos is not None:
+            project["repos"] = repos
+        config = self.workspace / ".agent-system" / "config.json"
+        config.parent.mkdir(parents=True, exist_ok=True)
+        config.write_text(json.dumps({"project": project}) + "\n")
+
+    def write_target(self, repo, content=None):
+        target = Path(repo) / ".claude" / "hooks" / "scan-secrets.sh"
+        target.parent.mkdir(parents=True, exist_ok=True)
+        target.write_text(content or "#!/usr/bin/env bash\nprintf 'fake-target:%s\\n' \"$(wc -c | tr -d '[:space:]')\"\nexit 7\n")
+        target.chmod(0o755)
+        return target
+
+    def run_hook(self, payload="payload"):
+        return subprocess.run([str(self.hook)], input=payload, capture_output=True, text=True, check=False)
+
+    def test_delegates_to_project_path_and_passes_stdin_and_exit_code(self):
+        repo = self.workspace / "repo"
+        self.write_target(repo)
+        self.write_config("repo")
+
+        result = self.run_hook("stdin-payload")
+
+        self.assertEqual(result.returncode, 7)
+        self.assertEqual(result.stdout, "fake-target:13\n")
+        self.assertEqual(result.stderr, "")
+
+    def test_falls_back_to_project_repos(self):
+        second = self.workspace / "second"
+        self.write_target(second)
+        self.write_config("first", ["first", "second"])
+
+        result = self.run_hook("fallback")
+
+        self.assertEqual(result.returncode, 7)
+        self.assertEqual(result.stdout, "fake-target:8\n")
+        self.assertEqual(result.stderr, "")
+
+    def test_no_candidate_script_exits_silently(self):
+        self.write_config("repo")
+
+        result = self.run_hook()
+
+        self.assertEqual(result.returncode, 0)
+        self.assertEqual(result.stdout, "")
+        self.assertEqual(result.stderr, "")
+
+    def test_skips_target_containing_wrapper_marker(self):
+        repo = self.workspace / "repo"
+        target = self.write_target(repo, f"#!/usr/bin/env bash\n{MARKER}\necho must-not-run\n")
+        self.write_config("repo")
+
+        result = self.run_hook()
+
+        self.assertEqual(result.returncode, 0)
+        self.assertEqual(result.stdout, "")
+        self.assertEqual(result.stderr, "")
+        self.assertTrue(target.is_file())
+
+    def test_skips_workspace_when_repo_link_resolves_to_wrapper_itself(self):
+        self.hook.write_text(self.hook.read_text().replace(f"{MARKER}\n", ""))
+        (self.workspace / "self-repo").symlink_to(self.workspace, target_is_directory=True)
+        self.write_config("self-repo")
+
+        result = self.run_hook()
+
+        self.assertEqual(result.returncode, 0)
+        self.assertEqual(result.stdout, "")
+        self.assertEqual(result.stderr, "")
+
+    def test_missing_config_exits_silently(self):
+        result = self.run_hook()
+
+        self.assertEqual(result.returncode, 0)
+        self.assertEqual(result.stdout, "")
+        self.assertEqual(result.stderr, "")
+
+
+class InstallHooksTests(unittest.TestCase):
+    def setUp(self):
+        self.tmp = tempfile.TemporaryDirectory()
+        self.addCleanup(self.tmp.cleanup)
+        self.root = Path(self.tmp.name)
+        self.home = self.root / "home"
+        self.home.mkdir()
+        self.workspace = self.root / "workspace.workspace"
+        self.workspace.mkdir()
+        self.repo = self.workspace / "repo"
+        self.repo.mkdir()
+        child_settings = {
+            "PATH": os.getenv("PATH", "/usr/bin:/bin"),
+            "HOME": str(self.home),
+            "AGENT_HUB_CONFIG": str(self.root / "hub-config"),
+            "GIT_AUTHOR_NAME": "test",
+            "GIT_AUTHOR_EMAIL": "test@example.invalid",
+            "GIT_COMMITTER_NAME": "test",
+            "GIT_COMMITTER_EMAIL": "test@example.invalid",
+            "GIT_CONFIG_GLOBAL": os.devnull,
+            "GIT_CONFIG_NOSYSTEM": "1",
+        }
+        self.child_settings = child_settings
+        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repo, env=child_settings, check=True)
+        (self.repo / "source.txt").write_text("base\n")
+        subprocess.run(["git", "add", "-A"], cwd=self.repo, env=child_settings, check=True)
+        subprocess.run(["git", "commit", "-q", "-m", "base"], cwd=self.repo, env=child_settings, check=True)
+        config = json.loads(CONFIG_TEMPLATE.read_text())
+        config["project"] = {"path": "repo"}
+        agent_system = self.workspace / ".agent-system"
+        agent_system.mkdir()
+        (agent_system / "config.json").write_text(json.dumps(config) + "\n")
+        self.hook = self.workspace / ".claude" / "hooks" / "scan-secrets.sh"
+
+    def update(self):
+        return subprocess.run(
+            ["bash", str(INSTALL), "update", "--folder", str(self.workspace), "--no-hub"],
+            cwd=self.root,
+            env=self.child_settings,
+            capture_output=True,
+            text=True,
+            check=False,
+        )
+
+    def test_update_installs_updates_and_keeps_scan_secrets_hook(self):
+        installed = self.update()
+        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
+        self.assertIn("hooks: scan-secrets wrapper installed", installed.stdout)
+        self.assertEqual(self.hook.read_bytes(), TEMPLATE.read_bytes())
+        self.assertEqual(self.hook.stat().st_mode & 0o777, 0o755)
+
+        self.hook.write_text(f"#!/usr/bin/env bash\n{MARKER}\necho stale\n")
+        updated = self.update()
+        self.assertEqual(updated.returncode, 0, updated.stdout + updated.stderr)
+        self.assertIn("hooks: scan-secrets wrapper updated", updated.stdout)
+        self.assertEqual(self.hook.read_bytes(), TEMPLATE.read_bytes())
+        self.assertEqual(self.hook.stat().st_mode & 0o777, 0o755)
+
+        foreign = b"#!/bin/sh\n# repo-owned hook\nprintf 'keep bytes\\n'\n\xff\n"
+        self.hook.write_bytes(foreign)
+        kept = self.update()
+        self.assertEqual(kept.returncode, 0, kept.stdout + kept.stderr)
+        self.assertIn("hooks: own scan-secrets.sh kept", kept.stdout)
+        self.assertEqual(self.hook.read_bytes(), foreign)
+
+
+if __name__ == "__main__":
+    unittest.main()
````

## Review round 1: PASS (24/11/26 02:48)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 60ae7d5c8b01, commits 60ae7d5c8b01

# Review pchecks T2: PASS
- Wrapper: workspace from its own path; candidates project.path then project.repos (strings, as kitconfig writes), realpath-deduped; skips itself and any marker file; exec passes stdin/args/exit code; silent exit 0 otherwise; set -u only. Matches packet.
- install_hooks: install when missing, update only our marker file when different, never touches a foreign script; DRY respected; called after install_agent in create/update/legacy.
- Tests: 176 lines covering delegation, fallback, none, self/marker guard, no config, install/update/keep. Worker: all commands exit 0.

## Integration: merged (24/11/26 03:22)

- On `agent/integration-pchecks` at a2c0558b4a36; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/pchecks/logs/post-merge-T2-a1.log`)

## Final gate: PASS (24/11/26 03:24)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-pchecks at 807e4c823f72 (log `.orchestrator/runs/pchecks/logs/verify-1795465355.log`)
- Task MERGED; run DONE

## Finished (24/11/26 03:28)

- merged into hub/plan (decision D2)
