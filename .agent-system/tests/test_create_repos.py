import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


INSTALL = Path(__file__).resolve().parents[1] / "scripts" / "install.sh"


class CreateReposTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cwd = self.root / "work"
        self.cwd.mkdir()
        self.home = self.root / "home"
        self.home.mkdir()
        self.dialog = self.root / "missing-create-dialog"
        path = os.pathsep.join(p for p in os.getenv("PATH", "").split(os.pathsep)
                               if p and not (Path(p) / "herdr-app").exists())
        self.settings = {"HOME": str(self.home), "PATH": path,
                         "AGENT_HUB_CONFIG": str(self.root / "hub-config"),
                         "AGENT_KIT_CREATE_DIALOG": str(self.dialog),
                         "GIT_AUTHOR_NAME": "test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
                         "GIT_COMMITTER_NAME": "test", "GIT_COMMITTER_EMAIL": "test@example.invalid",
                         "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        self.model_args = ["--model-orchestrator=opus", "--model-scout=sonnet",
                           "--model-worker=haiku"]

    def make_repo(self, path, files=None):
        repo = Path(path)
        repo.mkdir(parents=True, exist_ok=True)
        files = files or {"source.txt": "base\n"}
        for rel, content in files.items():
            target = repo / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, env=self.settings, check=True)
        subprocess.run(["git", "add", "-A"], cwd=repo, env=self.settings, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "base"], cwd=repo, env=self.settings, check=True)
        return repo.resolve()

    def install(self, *args, cwd=None, input_text=None, settings=None, ok=True):
        child_settings = self.settings.copy()
        child_settings.update(settings or {})
        result = subprocess.run(["bash", str(INSTALL), *args], cwd=cwd or self.cwd,
                                env=child_settings, input=input_text, capture_output=True,
                                text=True, check=False)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def create(self, *args, **kwargs):
        return self.install("create", *args, *self.model_args, "--no-hub", **kwargs)

    def test_create_resolves_relative_home_and_absolute_repos_and_writes_workspace(self):
        first = self.make_repo(self.cwd / "first", {"package.json": "{}\n"})
        second = self.make_repo(self.home / "projects" / "second", {"go.mod": "module example\n"})
        third = self.make_repo(self.root / "third", {"pyproject.toml": "[project]\n"})
        result = self.create("--name=demo", "--location=output", "--repo=first",
                             "--repo=~/projects/second", f"--repo={third}")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        workspace = self.cwd / "output" / "demo.workspace"
        self.assertTrue((workspace / ".agent-system" / "config.json").is_file())
        for name, repo in (("first", first), ("second", second), ("third", third)):
            link = workspace / name
            self.assertTrue(link.is_symlink(), name)
            self.assertFalse(Path(os.readlink(link)).is_absolute())
            self.assertEqual(link.resolve(), repo)
        cfg = json.loads((workspace / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["project"], {"path": "first", "repos": ["first", "second", "third"]})
        self.assertEqual(cfg["worker"]["writable_dirs"], ["~/.npm", "~/go/pkg/mod"])
        notes = (workspace / "CLAUDE.md").read_text()
        for name, repo in (("first", first), ("second", second), ("third", third)):
            self.assertIn(f"`{name}/` -> {repo}", notes)
        self.assertIn("active", notes)
        self.assertIn("agent-kit config --repo NAME", notes)
        for build in ("`npm test`", "`go test ./...`", "`python3 -m pytest`"):
            self.assertIn(build, notes)

    def test_create_rejects_duplicate_basenames_and_dest_inside_repo(self):
        left = self.make_repo(self.root / "left" / "shared")
        right = self.make_repo(self.root / "right" / "shared")
        duplicate = self.create("--name=dupe", "--location=output", f"--repo={left}", f"--repo={right}", ok=False)
        self.assertIn("same basename", duplicate.stderr)
        self.assertIn(str(left), duplicate.stderr)
        self.assertIn(str(right), duplicate.stderr)
        self.assertFalse((self.cwd / "output" / "dupe.workspace" / ".agent-system").exists())
        repo = self.make_repo(self.root / "container")
        nested = self.create("--name=embedded", f"--location={repo}", f"--repo={repo}", ok=False)
        self.assertIn("inside a chosen repo", nested.stderr)
        self.assertFalse((repo / "embedded.workspace" / ".agent-system").exists())

    def test_folder_keeps_legacy_one_repo_layout_and_rejects_custom_create_options(self):
        self.make_repo(self.cwd / "legacy")
        result = self.create("--folder=legacy")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        workspace = self.cwd / "legacy.workspace"
        self.assertEqual(os.readlink(workspace / "legacy"), "../legacy")
        cfg = json.loads((workspace / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["project"]["path"], "legacy")
        self.assertNotIn("repos", cfg["project"])
        self.assertIn(str(workspace.resolve()), result.stdout)
        self.assertIn(f"agent-kit start --folder={workspace.resolve()}", result.stdout)
        self.assertIn("cannot be combined", self.create("--folder=legacy", "--repo=legacy", ok=False).stderr)
        self.assertIn("only apply to create", self.install("update", "--name=oops", ok=False).stderr)

    def test_create_defaults_to_repo_at_current_git_top_without_a_tty(self):
        repo = self.make_repo(self.cwd / "default")
        result = self.create(cwd=repo)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        cfg = json.loads((repo.parent / "default.workspace" / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["project"], {"path": "default"})

    def write_dialog(self, code, output=""):
        script = self.root / "create-dialog-stub"
        script.write_text("#!/bin/sh\n" + (f"printf '%s\\n' '{output}'\n" if output else "") + f"exit {code}\n")
        script.chmod(0o755)
        return script

    def test_create_dialog_success_cancel_and_terminal_fallback(self):
        repo = self.make_repo(self.root / "dialog-repo")
        data = json.dumps({"name": "from-dialog", "location": str(self.cwd), "repos": [str(repo)]})
        success = self.create(settings={"AGENT_KIT_CREATE_DIALOG": str(self.write_dialog(0, data)),
                                       "AGENT_KIT_ASSUME_TTY": "1"})
        self.assertEqual(success.returncode, 0, success.stdout + success.stderr)
        self.assertTrue((self.cwd / "from-dialog.workspace" / "dialog-repo").is_symlink())
        cancel = self.create(settings={"AGENT_KIT_CREATE_DIALOG": str(self.write_dialog(1)),
                                      "AGENT_KIT_ASSUME_TTY": "1"}, ok=False)
        self.assertIn("cancelled", cancel.stderr)
        prompt_input = f"from-prompt\n{self.cwd}\n{repo}\n\n"
        fallback = self.create(input_text=prompt_input,
                               settings={"AGENT_KIT_CREATE_DIALOG": str(self.write_dialog(2)),
                                         "AGENT_KIT_ASSUME_TTY": "1"})
        self.assertEqual(fallback.returncode, 0, fallback.stdout + fallback.stderr)
        self.assertTrue((self.cwd / "from-prompt.workspace" / "dialog-repo").is_symlink())

    def test_create_noninteractive_without_repo_gives_repo_hint(self):
        result = self.create(cwd=self.cwd, ok=False)
        self.assertIn("pass --repo", result.stderr)

    def test_config_switch_show_unknown_single_repo_and_running_guard(self):
        self.make_repo(self.cwd / "first")
        self.make_repo(self.cwd / "second")
        result = self.create("--name=multi", "--location=output", "--repo=first", "--repo=second")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        workspace = self.cwd / "output" / "multi.workspace"
        switched = self.install("config", "--folder", str(workspace), "--repo", "second")
        self.assertEqual(switched.returncode, 0, switched.stdout + switched.stderr)
        cfg_path = workspace / ".agent-system" / "config.json"
        self.assertEqual(json.loads(cfg_path.read_text())["project"]["path"], "second")
        shown = self.install("config", "--folder", str(workspace), "--show")
        self.assertEqual(shown.returncode, 0, shown.stdout + shown.stderr)
        self.assertIn("* second", shown.stdout)
        self.assertIn("  first", shown.stdout)
        unknown = self.install("config", "--folder", str(workspace), "--repo", "missing", ok=False)
        self.assertIn("missing", unknown.stderr)
        self.assertIn("first", unknown.stderr)
        self.assertIn("second", unknown.stderr)
        run_dir = workspace / ".orchestrator" / "runs" / "run-42"
        run_dir.mkdir(parents=True)
        (run_dir / "state.json").write_text('{"status":"RUNNING"}\n')
        busy = self.install("config", "--folder", str(workspace), "--repo", "first", ok=False)
        self.assertIn("run-42", busy.stderr)
        self.assertEqual(json.loads(cfg_path.read_text())["project"]["path"], "second")
        single = self.create("--folder=first")
        self.assertEqual(single.returncode, 0, single.stdout + single.stderr)
        single_cfg = self.cwd / "first.workspace" / ".agent-system" / "config.json"
        single_data = json.loads(single_cfg.read_text())
        single_data["project"].pop("repos", None)
        single_cfg.write_text(json.dumps(single_data))
        no_repos = self.install("config", "--folder", str(self.cwd / "first.workspace"),
                                "--repo", "first", ok=False)
        self.assertIn("this workspace links one repo", no_repos.stderr)

    def test_update_validates_every_repo_link(self):
        self.make_repo(self.cwd / "one")
        self.make_repo(self.cwd / "two")
        result = self.create("--name=multi", "--location=output", "--repo=one", "--repo=two")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        workspace = self.cwd / "output" / "multi.workspace"
        (workspace / "two").unlink()
        updated = self.install("update", "--folder", str(workspace), ok=False)
        self.assertIn("two", updated.stderr)
        self.assertIn("broken", updated.stderr)


if __name__ == "__main__":
    unittest.main()
