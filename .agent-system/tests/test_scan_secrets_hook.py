import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "templates" / "hooks" / "scan-secrets.sh"
INSTALL = ROOT / "scripts" / "install.sh"
CONFIG_TEMPLATE = ROOT / "config.json"
MARKER = "# agent-kit:scan-secrets-wrapper"


class ScanSecretsHookTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.hook = self.workspace / ".claude" / "hooks" / "scan-secrets.sh"
        self.hook.parent.mkdir(parents=True)
        shutil.copy2(TEMPLATE, self.hook)
        self.hook.chmod(0o755)

    def write_config(self, path, repos=None):
        project = {"path": path}
        if repos is not None:
            project["repos"] = repos
        config = self.workspace / ".agent-system" / "config.json"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(json.dumps({"project": project}) + "\n")

    def write_target(self, repo, content=None):
        target = Path(repo) / ".claude" / "hooks" / "scan-secrets.sh"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content or "#!/usr/bin/env bash\nprintf 'fake-target:%s\\n' \"$(wc -c | tr -d '[:space:]')\"\nexit 7\n")
        target.chmod(0o755)
        return target

    def run_hook(self, payload="payload"):
        return subprocess.run([str(self.hook)], input=payload, capture_output=True, text=True, check=False)

    def test_delegates_to_project_path_and_passes_stdin_and_exit_code(self):
        repo = self.workspace / "repo"
        self.write_target(repo)
        self.write_config("repo")

        result = self.run_hook("stdin-payload")

        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, "fake-target:13\n")
        self.assertEqual(result.stderr, "")

    def test_falls_back_to_project_repos(self):
        second = self.workspace / "second"
        self.write_target(second)
        self.write_config("first", ["first", "second"])

        result = self.run_hook("fallback")

        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, "fake-target:8\n")
        self.assertEqual(result.stderr, "")

    def test_no_candidate_script_exits_silently(self):
        self.write_config("repo")

        result = self.run_hook()

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_skips_target_containing_wrapper_marker(self):
        repo = self.workspace / "repo"
        target = self.write_target(repo, f"#!/usr/bin/env bash\n{MARKER}\necho must-not-run\n")
        self.write_config("repo")

        result = self.run_hook()

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        self.assertTrue(target.is_file())

    def test_skips_workspace_when_repo_link_resolves_to_wrapper_itself(self):
        self.hook.write_text(self.hook.read_text().replace(f"{MARKER}\n", ""))
        (self.workspace / "self-repo").symlink_to(self.workspace, target_is_directory=True)
        self.write_config("self-repo")

        result = self.run_hook()

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_missing_config_exits_silently(self):
        result = self.run_hook()

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")


class InstallHooksTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.workspace = self.root / "workspace.workspace"
        self.workspace.mkdir()
        self.repo = self.workspace / "repo"
        self.repo.mkdir()
        child_settings = {
            "PATH": os.getenv("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home),
            "AGENT_HUB_CONFIG": str(self.root / "hub-config"),
            "GIT_AUTHOR_NAME": "test",
            "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "test",
            "GIT_COMMITTER_EMAIL": "test@example.invalid",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        self.child_settings = child_settings
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repo, env=child_settings, check=True)
        (self.repo / "source.txt").write_text("base\n")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, env=child_settings, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "base"], cwd=self.repo, env=child_settings, check=True)
        config = json.loads(CONFIG_TEMPLATE.read_text())
        config["project"] = {"path": "repo"}
        agent_system = self.workspace / ".agent-system"
        agent_system.mkdir()
        (agent_system / "config.json").write_text(json.dumps(config) + "\n")
        self.hook = self.workspace / ".claude" / "hooks" / "scan-secrets.sh"

    def update(self):
        return subprocess.run(
            ["bash", str(INSTALL), "update", "--folder", str(self.workspace), "--no-hub"],
            cwd=self.root,
            env=self.child_settings,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_update_installs_updates_and_keeps_scan_secrets_hook(self):
        installed = self.update()
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        self.assertIn("hooks: scan-secrets wrapper installed", installed.stdout)
        self.assertEqual(self.hook.read_bytes(), TEMPLATE.read_bytes())
        self.assertEqual(self.hook.stat().st_mode & 0o777, 0o755)

        self.hook.write_text(f"#!/usr/bin/env bash\n{MARKER}\necho stale\n")
        updated = self.update()
        self.assertEqual(updated.returncode, 0, updated.stdout + updated.stderr)
        self.assertIn("hooks: scan-secrets wrapper updated", updated.stdout)
        self.assertEqual(self.hook.read_bytes(), TEMPLATE.read_bytes())
        self.assertEqual(self.hook.stat().st_mode & 0o777, 0o755)

        foreign = b"#!/bin/sh\n# repo-owned hook\nprintf 'keep bytes\\n'\n\xff\n"
        self.hook.write_bytes(foreign)
        kept = self.update()
        self.assertEqual(kept.returncode, 0, kept.stdout + kept.stderr)
        self.assertIn("hooks: own scan-secrets.sh kept", kept.stdout)
        self.assertEqual(self.hook.read_bytes(), foreign)


if __name__ == "__main__":
    unittest.main()
