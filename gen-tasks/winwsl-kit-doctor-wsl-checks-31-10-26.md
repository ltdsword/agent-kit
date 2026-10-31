# Kit: WSL doctor checks and portable path resolution (31/10/26)

## Goal
`scheduler.py doctor` detects WSL and reports wsl-version, wsl-location, wsl-systemd and wsl-keepalive (plus python-version everywhere), and `install.sh` resolves `--folder` without GNU-only `realpath -m`, so macOS works.

## Read first
- `plans/261031-1819-windows-wsl2/plan.md`: sections **User decisions**, **Contract** and **T1**: **the full spec** (check names, levels, messages, detection rules, tests). Follow it exactly.
- `.agent-system/scheduler.py` (`doctor`, its `add` helper, the tool checks near `for tool, required in`), `.agent-system/scripts/install.sh` (line ~288, `realpath -m`), `.agent-system/scripts/doctor.sh` (how checks print), tests in `.agent-system/tests/test_scheduler.py` (`test_validate_config_and_doctor_hub_checks`, `test_doctor_checks_repo_separation`, class `TestInstall` and its `kit` helper).

## Steps
1. Add the helpers and the five checks to `scheduler.py` exactly as the spec's Contract table says. Read the osrelease text through one small function so tests can patch it; never shell out.
2. Replace `realpath -m` at `install.sh:288` with the Python one-liner from the spec.
3. Write the tests listed in spec T1.
4. Run the commands in "Run these" until they pass.

## Boundaries
**You may edit** (must match owned_paths):
- `.agent-system/scheduler.py`
- `.agent-system/scripts/install.sh`
- `.agent-system/tests/test_scheduler.py`

**You must not edit:**
- Any other file; also `README.md`, `plans/**`, `gen-tasks/**`, `.orchestrator/**`, `.claude/**`.

**You may run:**
- Python 3 (`python3 -m pytest`), `bash -n`, read-only git.

**You must not run:**
- `git push/merge/rebase/reset/checkout`; `npm install`/`pip install` or any download; `systemctl`; `wsl.exe`; `agent-kit create/update` on real workspaces; `herdr` commands against real agents.

**When to ask:** only for a real blocker (the spec contradicts the code, a sandbox-blocked command) → report "blocked" with the exact reason. Everything else: just do it.

## Do not
- Refactor or reformat code outside the spec. Change existing doctor checks or their order. Log or print secrets.

## Done when
- [ ] Every work item and test in spec section T1 is done.
- [ ] `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh` passes.

## Run these
- `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh`: expect all tests pass

## Notes
- Report: files changed, decisions you made where the spec left room, open questions.

## Worker result - attempt 1 (31/10/26 18:26)

- Status: **done** (worker worker-1, branch `agent/winwsl-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/scheduler.py`, `.agent-system/scripts/install.sh`, `.agent-system/tests/test_scheduler.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests/test_scheduler.py -k 'wsl_kind or windows_drive_paths or doctor_reports_wsl or older_than_311 or gnu_realpath_m'` -> exit 1
  - `python3 -m pytest -q .agent-system/tests/test_scheduler.py -k 'wsl_kind or windows_drive_paths or doctor_reports_wsl or older_than_311 or gnu_realpath_m'` -> exit 0
  - `python3 -m pytest -q .agent-system/tests && bash -n .agent-system/scripts/install.sh` -> exit 0
- Risks:
  - WSL checks were exercised with patched detection and filesystem conditions, not on a live WSL host.
- Not done: none
- Full diff: `.orchestrator/runs/winwsl/reports/T1.diff`

````text
 .agent-system/scheduler.py            | 47 ++++++++++++++++++++++
 .agent-system/scripts/install.sh      |  2 +-
 .agent-system/tests/test_scheduler.py | 74 +++++++++++++++++++++++++++++++++++
 3 files changed, 122 insertions(+), 1 deletion(-)
````

````diff
diff --git a/.agent-system/scheduler.py b/.agent-system/scheduler.py
index 20ab44f..c6ebaf5 100644
--- a/.agent-system/scheduler.py
+++ b/.agent-system/scheduler.py
@@ -2436,6 +2436,27 @@ class Scheduler:
 
 # --------------------------------------------------------------------------- doctor
 
+def wsl_kind(osrelease_text: str) -> str | None:
+    text = osrelease_text.lower()
+    if "microsoft" not in text:
+        return None
+    return "wsl2" if "wsl2" in text else "wsl1"
+
+
+def windows_drive_paths(paths) -> list[str]:
+    resolved = [str(Path(path).expanduser().resolve()) for path in paths]
+    return [path for path in resolved if re.match(r"^/mnt/[a-zA-Z]/", path)]
+
+
+def _read_osrelease() -> str:
+    for path in ("/proc/sys/kernel/osrelease", "/proc/version"):
+        try:
+            return Path(path).read_text()
+        except OSError:
+            continue
+    return ""
+
+
 def _frontmatter(path: Path) -> dict:
     text = path.read_text()
     if not text.startswith("---"):
@@ -2539,6 +2560,32 @@ def doctor(workspace_root: Path) -> list[dict]:
                            *((t, True) for t in programs), ("jq", False)):
         add(f"tool:{tool}", shutil.which(tool) is not None, shutil.which(tool) or "not on PATH",
             "fail" if required else "warn")
+    major, minor = sys.version_info[:2]
+    python_ok = (major, minor) >= (3, 11)
+    add("python-version", python_ok,
+        f"Python {major}.{minor}" if python_ok else f"Python 3.11+ required (found {major}.{minor})")
+    kind = wsl_kind(_read_osrelease())
+    if kind:
+        add("wsl-version", kind == "wsl2", "WSL 2" if kind == "wsl2" else
+            "WSL 1 is not supported; in PowerShell: `wsl --set-version <distro> 2`")
+        windows_paths = windows_drive_paths((workspace_root, project))
+        if windows_paths:
+            distro = os.environ.get("WSL_DISTRO_NAME") or "Ubuntu"
+            user = Path.home().name
+            windows_home = f"\\\\wsl.localhost\\{distro}\\home\\{user}"
+            add("wsl-location", False,
+                f"{', '.join(windows_paths)} is on a Windows drive; git, builds and workers are much slower there "
+                f"and the workspace symlink is less reliable. Keep repos in the WSL home (e.g. `~/code`) and "
+                f"open them from Windows via `{windows_home}` or VS Code's WSL extension", "warn")
+        else:
+            add("wsl-location", True, "workspace and repo are in the Linux filesystem")
+        systemd = Path("/run/systemd/system").exists()
+        add("wsl-systemd", systemd, "systemd is available" if systemd else
+            "`agent-kit hub autostart` needs systemd: add `[boot]` `systemd=true` to `/etc/wsl.conf`, "
+            "then run `wsl --shutdown` in PowerShell", "warn")
+        add("wsl-keepalive", True,
+            "WSL stops when idle and the hub with it; to keep it running set `instanceIdleTimeout=-1` under "
+            "`[general]` in `%UserProfile%\\.wslconfig` (then `wsl --shutdown`)")
     add("herdr-env", os.environ.get("HERDR_ENV") == "1",
         "HERDR_ENV=1" if os.environ.get("HERDR_ENV") == "1" else
         "HERDR_ENV unset: live dispatch unavailable; start with `agent-kit start`", "warn")
diff --git a/.agent-system/scripts/install.sh b/.agent-system/scripts/install.sh
index 0bfbf43..14b25e9 100755
--- a/.agent-system/scripts/install.sh
+++ b/.agent-system/scripts/install.sh
@@ -285,7 +285,7 @@ ensure_git_repo() {  # ensure_git_repo <folder>: a Git repo with a commit, or of
 
 resolve_folder() {  # sets dest (the workspace) and repo_name from --folder or the current folder
   local f
-  f="$(realpath -m -- "${FOLDER:-$PWD}")"
+  f="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${FOLDER:-$PWD}")"
   case "$(basename "$f")" in
     ?*.workspace) dest="$f"; repo_name="$(basename "$f" .workspace)" ;;  # given the workspace itself
     *) repo_name="$(basename "$f")"; dest="$f.workspace" ;;              # given the repo
diff --git a/.agent-system/tests/test_scheduler.py b/.agent-system/tests/test_scheduler.py
index 4ebd314..7cb5c89 100644
--- a/.agent-system/tests/test_scheduler.py
+++ b/.agent-system/tests/test_scheduler.py
@@ -1193,6 +1193,69 @@ class TestCli(Base):
             self.assertEqual(cm.exception.code, 0)
 
 
+class TestWslDoctor(Base):
+    def doctor_checks(self, osrelease, project=None):
+        (self.repo / ".agent-system").mkdir(exist_ok=True)
+        if project:
+            self.cfg["project"] = {"path": str(project)}
+        (self.repo / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))
+        systemd = Path("/run/systemd/system")
+        project = project or self.repo
+        path_exists = Path.exists
+        path_is_dir = Path.is_dir
+        with mock.patch.object(S, "_read_osrelease", return_value=osrelease, create=True), \
+                mock.patch.object(S, "project_root_for", return_value=project), \
+                mock.patch.object(S, "git", return_value=mock.Mock(returncode=128, stdout="")), \
+                mock.patch.object(S.shutil, "which", return_value=None), \
+                mock.patch.object(Path, "exists", autospec=True,
+                                  side_effect=lambda path: False if path == systemd else path_exists(path)), \
+                mock.patch.object(Path, "is_dir", autospec=True,
+                                  side_effect=lambda path: True if path == project and str(project).startswith("/mnt/")
+                                  else path_is_dir(path)):
+            return {item["check"]: item for item in S.doctor(self.repo)}
+
+    def test_wsl_kind_classifies_wsl1_wsl2_and_linux(self):
+        self.assertEqual(S.wsl_kind("Linux 5.15.90.1-microsoft-standard"), "wsl1")
+        self.assertEqual(S.wsl_kind("Linux 5.15.90.1-MICROSOFT-standard-WSL2"), "wsl2")
+        self.assertIsNone(S.wsl_kind("Linux 6.8.0-generic"))
+
+    def test_windows_drive_paths_returns_resolved_windows_drive_paths(self):
+        self.assertEqual(S.windows_drive_paths(("/mnt/c/Users/alex/project", "/home/alex/project",
+                                                "/mnt/cc/not-a-drive")),
+                         ["/mnt/c/Users/alex/project"])
+
+    def test_doctor_reports_wsl_checks_and_python_version(self):
+        wsl2 = self.doctor_checks("Linux 5.15.90.1-microsoft-standard-WSL2", Path("/mnt/c/project"))
+        self.assertEqual(wsl2["python-version"]["status"], "ok")
+        self.assertEqual(wsl2["wsl-version"]["status"], "ok")
+        self.assertEqual(wsl2["wsl-location"]["status"], "warn")
+        self.assertIn("/mnt/c/project", wsl2["wsl-location"]["detail"])
+        self.assertIn("git, builds and workers are much slower", wsl2["wsl-location"]["detail"])
+        self.assertIn("workspace symlink is less reliable", wsl2["wsl-location"]["detail"])
+        self.assertIn(r"\\wsl.localhost\Ubuntu\home", wsl2["wsl-location"]["detail"])
+        self.assertEqual(wsl2["wsl-systemd"]["status"], "warn")
+        self.assertIn("[boot]", wsl2["wsl-systemd"]["detail"])
+        self.assertEqual(wsl2["wsl-keepalive"]["status"], "ok")
+        self.assertIn("instanceIdleTimeout=-1", wsl2["wsl-keepalive"]["detail"])
+
+        wsl1 = self.doctor_checks("Linux 4.4.0-Microsoft", Path("/mnt/c/project"))
+        self.assertEqual(wsl1["wsl-version"]["status"], "fail")
+        self.assertEqual(wsl1["wsl-location"]["status"], "warn")
+        self.assertEqual(wsl1["wsl-systemd"]["status"], "warn")
+        self.assertEqual(wsl1["wsl-keepalive"]["status"], "ok")
+        self.assertIn("WSL 1 is not supported", wsl1["wsl-version"]["detail"])
+
+        linux = self.doctor_checks("Linux 6.8.0-generic")
+        self.assertEqual(linux["python-version"]["status"], "ok")
+        self.assertFalse(any(name.startswith("wsl-") for name in linux))
+
+    def test_doctor_fails_when_python_is_older_than_311(self):
+        with mock.patch.object(S.sys, "version_info", (3, 10, 14)):
+            checks = self.doctor_checks("Linux 6.8.0-generic")
+        self.assertEqual(checks["python-version"]["status"], "fail")
+        self.assertEqual(checks["python-version"]["detail"], "Python 3.11+ required (found 3.10)")
+
+
 class WorkspaceBase(Base):
     """repo/ is the only git repo; repo.workspace/ holds the kit, state, task files and worktrees
     and reaches the repo through the relative symlink repo.workspace/repo -> ../repo."""
@@ -1828,6 +1891,17 @@ class TestInstall(Base):
         self.assert_workspace()
         self.assertIn("Project notes: see the top of CLAUDE.md", (self.ws / "AGENTS.md").read_text())
 
+    def test_create_folder_does_not_require_gnu_realpath_m(self):
+        bin_dir = Path(self.tmp.name) / "fake-bin"
+        bin_dir.mkdir()
+        realpath = bin_dir / "realpath"
+        realpath.write_text('#!/bin/sh\n[ "$1" != "-m" ] || exit 1\nexit 0\n')
+        realpath.chmod(0o755)
+        path = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"
+        with mock.patch.dict(os.environ, {"PATH": path}):
+            self.kit("create", "--folder=repo")
+        self.assert_workspace()
+
     def test_settings_merge_registers_every_template_hook_idempotently(self):
         self.kit("create", "--folder=repo")
         settings_path = self.ws / ".claude" / "settings.json"
````

## Review round 1: PASS (31/10/26 18:28)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: 29433d3a75d6, commits 29433d3a75d6
- Notes: Contract followed; 187 tests pass

# Review: winwsl T1 (kit doctor WSL checks, portable realpath)

Verdict: PASS. Matches the plan Contract: five checks, names, levels and messages; WSL detection via
osrelease with /proc/version fallback; /mnt/<letter>/ rule; checks appended after the tool checks,
existing order kept. `project` is defined (scheduler.py:2525) before use. install.sh:288 uses
python os.path.realpath (same semantics as realpath -m). Tests: wsl_kind, windows_drive_paths,
doctor under patched WSL (WSL1 fail, /mnt/c warn, no systemd warn), plain Linux has no wsl-*,
Python <3.11 fail, create with a fake macOS realpath. Ran `python3 -m pytest -q .agent-system/tests`
in the worktree: 187 passed; `bash -n install.sh` ok.
Notes: keepalive is advisory only (the .wslconfig lives on the Windows side), as specified.

## Integration: merged (31/10/26 18:28)

- On `agent/integration-winwsl` at 617458f4a02c; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/winwsl/logs/post-merge-T1-a1.log`)

## Final gate: PASS (31/10/26 18:29)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-winwsl at 617458f4a02c (log `.orchestrator/runs/winwsl/logs/verify-1793446100.log`)
- Task MERGED; run RUNNING

## Final gate: PASS (31/10/26 18:30)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-winwsl at 617458f4a02c (log `.orchestrator/runs/winwsl/logs/verify-1793446179.log`)
- Task MERGED; run RUNNING

## Final gate: PASS (31/10/26 18:31)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-winwsl at 971c66119002 (log `.orchestrator/runs/winwsl/logs/verify-1793446249.log`)
- Task MERGED; run DONE
