"""Deterministic scheduler tests: real git in temp repos, fake Herdr, zero model API calls.

Run: python3 -m unittest discover -s .agent-system/tests -v
"""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scheduler as S  # noqa: E402
import models as M  # noqa: E402
import kitconfig as K  # noqa: E402
import kitstart as KS  # noqa: E402
import agentctl as AC  # noqa: E402

REAL_CONFIG = json.loads((Path(__file__).resolve().parents[1] / "config.json").read_text())
PY_OK = [sys.executable, "-c", "raise SystemExit(0)"]
PY_FAIL = [sys.executable, "-c", "raise SystemExit(3)"]
READY_CHECKLIST = {"preserve": "UserHandler API", "contracts": "packet sections 5", "interactions": "T2 after T1",
                   "testing": "unit tests + gradle build", "assumptions": "none unsafe"}


def sh(cwd, *args):
    return subprocess.run(list(args), cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


_PATH = os.environ.get("PATH", "")
_STUBS = tempfile.TemporaryDirectory()


def setUpModule():
    """Dispatch refuses a worker program that is not on PATH: give the default programs stub
    executables, so the tests pass on machines without them (CI)."""
    for prog in ("codex", "claude"):
        stub = Path(_STUBS.name) / prog
        stub.write_text("#!/bin/sh\nexit 0\n")
        stub.chmod(0o755)
    os.environ["PATH"] = f"{_STUBS.name}{os.pathsep}{_PATH}"


def tearDownModule():
    os.environ["PATH"] = _PATH
    _STUBS.cleanup()


class FakeHerdr(S.Herdr):
    def __init__(self):
        super().__init__(binary="herdr-fake")
        self.calls, self.live, self._n = [], {}, 0

    def available(self):
        return True

    def workspace_create(self, cwd, label):
        self._n += 1
        self.calls.append(("workspace_create", cwd, label))
        return f"w{self._n}", f"w{self._n}:p1"

    def workspace_close(self, ws):
        self.calls.append(("workspace_close", ws))

    def agent_start(self, name, pane, agent_args, timeout_ms, kind="codex"):
        self.calls.append(("agent_start", name, pane, list(agent_args)))
        self.kinds = getattr(self, "kinds", []) + [kind]
        self.live[name] = "idle"
        return {}

    def agent_prompt(self, name, text, timeout_ms):
        self.calls.append(("agent_prompt", name, text))
        self.live[name] = "working"
        return {}

    def agent_get(self, name):
        if name not in self.live:
            raise S.SchedulerError("agent not found")
        return {"result": {"name": name, "state": self.live[name]}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        codex = Path(self.tmp.name) / "codex-home"
        codex.mkdir()
        (codex / "models_cache.json").write_text(json.dumps({"models": [
            {"slug": "gpt-6-luna", "display_name": "GPT-6 Luna", "visibility": "list", "default_reasoning_level": "medium",
             "supported_reasoning_levels": [{"effort": e} for e in ("low", "medium", "high", "xhigh", "max")]},
            {"slug": "gpt-x-sol", "display_name": "GPT-X Sol", "visibility": "list", "default_reasoning_level": "high",
             "supported_reasoning_levels": [{"effort": e} for e in ("low", "high", "ultra")]},
            {"slug": "gpt-hidden", "visibility": "hide", "supported_reasoning_levels": ["low"]}]}))
        env["CODEX_HOME"] = str(codex)
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        sh(self.repo, "git", "init", "-q", "-b", "main")
        (self.repo / ".gitignore").write_text(".orchestrator/\n")
        (self.repo / "app.txt").write_text("base\n")
        sh(self.repo, "git", "add", "-A")
        sh(self.repo, "git", "commit", "-q", "-m", "base")
        self.base_sha = sh(self.repo, "git", "rev-parse", "HEAD")
        self.cfg = copy.deepcopy(REAL_CONFIG)
        self.cfg.pop("project", None)  # in-repo mode by default; TestWorkspaceMode sets its own
        self.cfg["pool"]["worktree_root"] = str(Path(self.tmp.name) / "wt")
        self.cfg["gate"]["post_merge_check"] = PY_OK
        self.cfg["gate"]["verify_cmd"] = PY_OK
        self.herdr = FakeHerdr()
        self.s = self.new_scheduler()
        for tid in ("T1", "T2", "T3"):
            p = self.repo / "packets" / f"{tid}.md"
            p.parent.mkdir(exist_ok=True)
            p.write_text(f"# packet {tid}\n")

    def new_scheduler(self):
        return S.Scheduler(self.repo, cfg=self.cfg, herdr=self.herdr)

    @staticmethod
    def task(tid, deps=(), trivial=False, owned=None):
        return {"id": tid, "title": f"task {tid}", "depends_on": list(deps),
                "owned_paths": owned or [f"{tid.lower()}/"], "acceptance": [f"{tid} file exists"],
                "packet": f"packets/{tid}.md", "trivial": trivial}

    def dag(self, run="r1", trivial=True):
        return self.s.create_run(run, [self.task("T1", trivial=trivial), self.task("T2", ["T1"], trivial),
                                       self.task("T3", trivial=trivial)])

    def make_ready(self, run="r1"):
        ev = Path(self.tmp.name) / "dossier.md"
        ev.write_text("# dossier\n- app.txt:1 base\n")
        self.s.research_round(run, ["what owns app.txt?"], ev)
        self.s.research_readiness(run, "READY", READY_CHECKLIST, [])

    def worker_commit(self, run, tid, content="done\n", report_overrides=None, commit=True):
        t = self.s.store.load(run)["tasks"][tid]
        wt = Path(t["worktree"])
        d = wt / tid.lower()
        d.mkdir(exist_ok=True)
        (d / "out.txt").write_text(content)
        commits = []
        if commit:
            sh(wt, "git", "add", "-A")
            sh(wt, "git", "commit", "-q", "-m", f"{tid}: work")
            out = sh(wt, "git", "rev-list", "--reverse", f"{t['base_sha']}..HEAD")
            commits = out.split()  # contract: every task-branch commit since base_sha
        report = {"task_id": tid, "status": "done", "base_sha": t["base_sha"],
                  "head_sha": sh(wt, "git", "rev-parse", "HEAD"), "commits": commits, "committed": commit,
                  "files_changed": [f"{tid.lower()}/out.txt"],
                  "test_results": [{"command": "test -f out.txt", "exit_code": 0, "log": None}],
                  "risks": [], "not_done": []}
        report.update(report_overrides or {})
        (self.s.store.run_dir(run) / "reports" / f"{tid}.json").write_text(json.dumps(report))
        return report

    def user_decides(self, run, kind, task=None, choice="A"):
        """Open a decision as Opus would and answer it as the user would; returns its id."""
        did = self.s.decision_ask(run, kind, f"{kind}?", "what happened", ["A=go ahead", "B=stop"], task,
                                  "A")["decision"]
        self.s.decision_answer(run, did, choice, "ok", by="tester", quote=f"{did} {choice}")
        return did

    def drive_to_merged(self, run, tid):
        self.worker_commit(run, tid)
        self.assertEqual(self.s.collect(run, tid)["result"], "REVIEW")
        self.s.mark_reviewed(run, tid, "PASS")
        return self.s.integrate(run)


class TestDag(Base):
    def test_cycle_missing_duplicate_self(self):
        with self.assertRaisesRegex(S.SchedulerError, "cycle"):
            S.validate_tasks([self.task("T1", ["T2"]), self.task("T2", ["T1"])], 3)
        with self.assertRaisesRegex(S.SchedulerError, "unknown task"):
            S.validate_tasks([self.task("T1", ["T9"])], 3)
        with self.assertRaisesRegex(S.SchedulerError, "duplicate"):
            S.validate_tasks([self.task("T1"), self.task("T1")], 3)
        with self.assertRaisesRegex(S.SchedulerError, "itself"):
            S.validate_tasks([self.task("T1", ["T1"])], 3)

    def test_task_cap(self):
        with self.assertRaisesRegex(S.SchedulerError, "1..3"):
            S.validate_tasks([self.task(f"T{i}") for i in range(1, 5)], 3)
        with self.assertRaisesRegex(S.SchedulerError, "1..3"):
            S.validate_tasks([], 3)

    def test_invalid_transitions_rejected(self):
        st = self.dag()
        with self.assertRaisesRegex(S.SchedulerError, "invalid task transition"):
            S.transition_task(st, "T2", "MERGED")  # PENDING -> MERGED
        with self.assertRaisesRegex(S.SchedulerError, "invalid task transition"):
            S.transition_task(st, "T1", "PASSED")  # READY -> PASSED
        with self.assertRaisesRegex(S.SchedulerError, "invalid worker transition"):
            S.transition_worker(st, "worker-1", "IDLE")  # IDLE -> IDLE


class TestConfig(Base):
    def test_every_slot_is_luna_xhigh(self):
        self.assertEqual(S.validate_config(REAL_CONFIG), [])
        for slot, v in S.resolve_worker_settings(REAL_CONFIG).items():
            self.assertEqual((v["model"], v["reasoning_effort"]), ("gpt-6-luna", "xhigh"), slot)

    def test_any_model_allowed_but_no_silent_fallback(self):
        ok = copy.deepcopy(REAL_CONFIG)
        ok["worker"].update(model="gpt-6-sol", reasoning_effort="high")
        ok["orchestrator"] = {"kind": "codex", "model": "gpt-6-sol", "effort": "xhigh"}
        self.assertEqual(S.validate_config(ok), [])
        bad = copy.deepcopy(REAL_CONFIG)
        bad["worker"]["kind"] = "notaprogram"
        self.assertTrue(any("worker.kind" in e for e in S.validate_config(bad)))
        bad = copy.deepcopy(REAL_CONFIG)
        bad["worker"]["model"] = " "
        self.assertTrue(any("worker.model must be set" in e for e in S.validate_config(bad)))
        bad = copy.deepcopy(REAL_CONFIG)
        bad["worker"]["fallback_model"] = "gpt-6.1-sol"
        self.assertTrue(any("fallback" in e for e in S.validate_config(bad)))
        bad = copy.deepcopy(REAL_CONFIG)
        bad["pool"]["size"] = 4  # slots and size disagree
        self.assertTrue(any("pool.size" in e for e in S.validate_config(bad)))
        bad["pool"].update(size=11, slots=[f"worker-{i}" for i in range(1, 12)])
        self.assertTrue(any("1..10" in e for e in S.validate_config(bad)))

    def test_sample_dispatch_args_carry_model_and_effort(self):
        self.dag()
        out = self.s.dispatch_ready("r1", launch="herdr")
        starts = [c for c in self.herdr.calls if c[0] == "agent_start"]
        self.assertEqual(len(starts), len(out["dispatched"]))
        for _, _, _, args in starts:
            self.assertEqual(args[args.index("-m") + 1], "gpt-6-luna")
            self.assertIn('model_reasoning_effort="xhigh"', args)
            self.assertNotIn("danger-full-access", args)
            self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", args)

    def test_codex_trusts_worktree_and_repo_root_for_the_run_and_network_switch(self):
        self.cfg["worker"].update(trust_worktree=True, network_access=True, web_search=False)
        args = self.new_scheduler().codex_args("/wt", "r1")
        self.assertIn('projects."/wt".trust_level="trusted"', args)
        self.assertIn(f'projects."{self.repo.resolve()}".trust_level="trusted"', args)
        self.assertIn("sandbox_workspace_write.network_access=true", args)
        self.assertNotIn("--search", args)
        self.cfg["worker"]["web_search"] = True
        self.assertIn("--search", self.new_scheduler().codex_args("/wt", "r1"))
        self.cfg["worker"].update(network_access=False)
        self.assertNotIn("sandbox_workspace_write.network_access=true", self.new_scheduler().codex_args("/wt", "r1"))


class TestDispatch(Base):
    def test_independent_concurrent_dependent_waits_for_merge(self):
        self.dag()
        out = self.s.dispatch_ready("r1", launch="herdr")
        self.assertEqual(sorted(d["task"] for d in out["dispatched"]), ["T1", "T3"])
        st = self.s.store.load("r1")
        self.assertEqual(st["tasks"]["T2"]["status"], "PENDING")
        self.assertNotEqual(st["tasks"]["T1"]["worker"], st["tasks"]["T3"]["worker"])
        # PASSED is not enough for the dependent task
        self.worker_commit("r1", "T1")
        self.s.collect("r1", "T1")
        self.s.mark_reviewed("r1", "T1", "PASS")
        self.assertEqual(self.s.store.load("r1")["tasks"]["T2"]["status"], "PENDING")
        self.assertEqual(self.s.dispatch_ready("r1", dry_run=True)["plan"], [])
        res = self.s.integrate("r1")
        self.assertEqual(res["now_ready"], ["T2"])
        out = self.s.dispatch_ready("r1", launch="herdr")
        self.assertEqual([d["task"] for d in out["dispatched"]], ["T2"])
        st = self.s.store.load("r1")
        self.assertEqual(st["tasks"]["T2"]["base_sha"], st["tasks"]["T1"]["merged_sha"])

    def test_concurrency_cap_and_no_double_assignment(self):
        self.cfg["limits"]["max_parallel"] = 2
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True), self.task("T2", trivial=True),
                                 self.task("T3", trivial=True)])
        out = self.s.dispatch_ready("r1", launch="none")
        self.assertEqual(len(out["dispatched"]), 2)
        self.assertEqual(self.s.dispatch_ready("r1", launch="none")["dispatched"], [])  # cap holds
        st = self.s.store.load("r1")
        holders = [w["task"] for w in st["workers"].values() if w["task"]]
        self.assertEqual(len(holders), len(set(holders)))
        st["workers"]["worker-3"].update(status="BUSY", task=holders[0])  # forged double lease
        with self.assertRaises(S.SchedulerError):
            S.validate_state(st)

    def test_three_slot_cap(self):
        self.s.create_run("r1", [self.task(t, trivial=True) for t in ("T1", "T2", "T3")])
        out = self.s.dispatch_ready("r1", launch="none")
        self.assertEqual(sorted(d["worker"] for d in out["dispatched"]), ["worker-1", "worker-2", "worker-3"])
        st = self.s.store.load("r1")
        self.assertTrue(all(w["status"] == "BUSY" for w in st["workers"].values()))

    def test_missing_packet_blocks_dispatch(self):
        (self.repo / "packets" / "T1.md").unlink()
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        out = self.s.dispatch_ready("r1", launch="none")
        self.assertEqual(out["dispatched"], [])
        self.assertIn("packet missing", out["skipped"]["T1"])

    def test_outside_herdr_requires_launch_none(self):
        self.dag()
        s = S.Scheduler(self.repo, cfg=self.cfg, herdr=S.Herdr(binary="definitely-not-herdr"))
        with mock.patch.dict(os.environ, {"HERDR_ENV": ""}):
            with self.assertRaisesRegex(S.SchedulerError, "HERDR_ENV"):
                s.dispatch_ready("r1", launch="herdr")
        self.assertEqual(self.s.store.load("r1")["tasks"]["T1"]["status"], "READY")


class TestRepairAndMerge(Base):
    def test_failure_retry_same_worker_then_merge(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="herdr")
        st = self.s.store.load("r1")
        wid, branch, wt = st["tasks"]["T1"]["worker"], st["tasks"]["T1"]["branch"], st["tasks"]["T1"]["worktree"]
        self.worker_commit("r1", "T1", "buggy\n")
        self.s.collect("r1", "T1")
        self.assertEqual(self.s.mark_reviewed("r1", "T1", "MAJOR_FIX", "test fails")["status"], "FIX_REQUIRED")
        (self.repo / "packets" / "T1.repair1.md").write_text("# repair\n")
        out = self.s.repair("r1", "T1", "packets/T1.repair1.md", decision=self.user_decides("r1", "repair", "T1"))
        self.assertTrue(out["same_session"])
        prompts = [c for c in self.herdr.calls if c[0] == "agent_prompt"]
        self.assertEqual(prompts[-1][1], S.Scheduler.agent_name("r1", wid))  # same session/agent
        self.assertEqual(sum(1 for c in self.herdr.calls if c[0] == "agent_start"), 1)  # no fresh context
        st = self.s.store.load("r1")
        self.assertEqual((st["tasks"]["T1"]["worker"], st["tasks"]["T1"]["branch"], st["tasks"]["T1"]["worktree"]),
                         (wid, branch, wt))
        self.worker_commit("r1", "T1", "fixed\n")
        self.assertEqual(self.s.collect("r1", "T1")["result"], "REVIEW")
        self.s.mark_reviewed("r1", "T1", "PASS")
        res = self.s.integrate("r1")
        self.assertEqual(res["results"][0]["result"], "MERGED")
        st = self.s.store.load("r1")
        self.assertEqual(st["workers"][wid]["status"], "IDLE")
        self.assertTrue((Path(st["integration_worktree"]) / "t1" / "out.txt").exists())
        self.assertEqual(sh(self.repo, "git", "rev-parse", "main"), self.base_sha)  # user branch untouched
        self.assertEqual(self.s.verify("r1")["run_status"], "DONE")

    def test_two_fix_rounds_then_no_more_review(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="herdr")
        (self.repo / "packets" / "rep.md").write_text(
            "# fix\n\n## Errors found\n1. `t1/out.txt:1`: says buggy. Evidence: test X fails\n\n"
            "## Proposed fix\n1. In `t1/out.txt`, write fixed.\n\n## Do not\n- touch others\n")
        for i in range(2):  # both fix rounds are routine: Opus gives the evidence
            self.worker_commit("r1", "T1", f"try{i}\n")
            self.s.collect("r1", "T1")
            self.assertEqual(self.s.mark_reviewed("r1", "T1", "MAJOR_FIX")["status"], "FIX_REQUIRED")
            self.s.repair("r1", "T1", "packets/rep.md", reason=f"test X fails, round {i + 1}")
        tf = (self.repo / "packets" / "T1.md").read_text()
        self.assertIn("## Fix round 1/2: errors and proposed fix", tf)
        self.assertIn("## Fix round 2/2", tf)
        self.assertIn("### Errors found\n1. `t1/out.txt:1`: says buggy", tf)
        self.assertIn("### Proposed fix", tf)
        self.assertNotIn("touch others", tf)  # only the errors and the fix are copied
        self.worker_commit("r1", "T1", "try3\n")
        self.s.collect("r1", "T1")
        with self.assertRaisesRegex(S.SchedulerError, "no further review round"):
            self.s.mark_reviewed("r1", "T1", "MAJOR_FIX")
        out = self.s.mark_reviewed("r1", "T1", "PASS", known_issues="edge case Y still unhandled")
        self.assertEqual(out["status"], "PASSED")
        self.assertIn("Known issues (accepted: no fix rounds left)", (self.repo / "packets" / "T1.md").read_text())
        self.assertEqual(self.s.integrate("r1")["results"][0]["result"], "MERGED")
        self.s.verify("r1")
        self.s.report("r1", "done")
        rep = (self.s.store.run_dir("r1") / "final-report.md").read_text()
        self.assertIn("- T1: edge case Y still unhandled", rep)
        self.assertIn("| T1 | task T1 | MERGED | 2 |", rep)

    def test_post_merge_failure_after_last_fix_round_blocks(self):
        self.cfg["gate"]["post_merge_check"] = PY_FAIL
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        (self.repo / "packets" / "rep.md").write_text("# fix\n")
        for i in range(2):
            self.worker_commit("r1", "T1", f"try{i}\n")
            self.s.collect("r1", "T1")
            self.s.mark_reviewed("r1", "T1", "MAJOR_FIX")
            self.s.repair("r1", "T1", "packets/rep.md", launch="none", reason="evidence")
        self.worker_commit("r1", "T1", "try3\n")
        self.s.collect("r1", "T1")
        self.s.mark_reviewed("r1", "T1", "PASS")
        self.assertEqual(self.s.integrate("r1")["results"][0]["result"], "post_merge_failed")
        st = self.s.store.load("r1")
        self.assertEqual(st["tasks"]["T1"]["status"], "BLOCKED")  # the user decides, not a 3rd round
        self.assertIsNone(st["workers"]["worker-1"]["task"])

    def test_post_merge_failure_not_merged(self):
        self.cfg["gate"]["post_merge_check"] = PY_FAIL
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        res = self.drive_to_merged("r1", "T1")
        self.assertEqual(res["results"][0]["result"], "post_merge_failed")
        st = self.s.store.load("r1")
        self.assertEqual(st["tasks"]["T1"]["status"], "FIX_REQUIRED")
        self.assertEqual(st["integration_sha"], self.base_sha)
        self.assertEqual(sh(Path(st["integration_worktree"]), "git", "rev-parse", st["integration_branch"]),
                         self.base_sha)

    def test_integration_conflict_preserved(self):
        self.s.create_run("r1", [self.task("T1", trivial=True, owned=["app.txt"]),
                                 self.task("T3", trivial=True, owned=["app.txt"])])
        self.s.dispatch_ready("r1", launch="none")
        for tid, text in (("T1", "one\n"), ("T3", "three\n")):
            wt = Path(self.s.store.load("r1")["tasks"][tid]["worktree"])
            (wt / "app.txt").write_text(text)
            sh(wt, "git", "commit", "-qam", tid)
            self.worker_commit("r1", tid, commit=False, report_overrides={
                "commits": [sh(wt, "git", "rev-parse", "HEAD")], "head_sha": sh(wt, "git", "rev-parse", "HEAD")})
            # worker_commit wrote an extra untracked file; remove it so only app.txt changed
            (wt / tid.lower() / "out.txt").unlink()
            (wt / tid.lower()).rmdir()
            self.assertEqual(self.s.collect("r1", tid)["result"], "REVIEW")
            self.s.mark_reviewed("r1", tid, "PASS")
        res = self.s.integrate("r1")
        kinds = {r["task"]: r["result"] for r in res["results"]}
        self.assertEqual(kinds, {"T1": "MERGED", "T3": "conflict"})
        st = self.s.store.load("r1")
        self.assertEqual(st["tasks"]["T3"]["integration_conflict"]["files"], ["app.txt"])
        self.assertTrue(S.git_is_clean(st["integration_worktree"]))


class TestSafety(Base):
    def test_dirty_files_keeps_first_path_intact(self):
        # " M app.txt" sorts first; its leading status space must not be stripped away.
        (self.repo / "app.txt").write_text("changed\n")
        (self.repo / "new.txt").write_text("new\n")
        dirty = S.git_dirty_files(self.repo)
        self.assertEqual(dirty[:2], ["app.txt", "new.txt"])
        self.assertNotIn("pp.txt", dirty)

    def test_dirty_slot_quarantined_not_reset(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        slot = self.s.slot_path("worker-1")
        sh(self.repo, "git", "worktree", "add", "-q", "--detach", str(slot), self.base_sha)
        (slot / "precious.txt").write_text("user work\n")
        out = self.s.dispatch_ready("r1", launch="none")
        self.assertEqual(out["quarantined"][0]["worker"], "worker-1")
        self.assertEqual(out["dispatched"][0]["worker"], "worker-2")
        self.assertEqual((slot / "precious.txt").read_text(), "user work\n")
        st = self.s.store.load("r1")
        self.assertEqual(st["workers"]["worker-1"]["status"], "BLOCKED")
        with self.assertRaisesRegex(S.SchedulerError, "never auto-reset"):
            self.s.worker_release("r1", "worker-1")

    def test_ambiguous_completion_not_success(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        self.assertEqual(self.s.collect("r1", "T1")["result"], "pending")  # no report, idle != success
        self.worker_commit("r1", "T1", report_overrides={"head_sha": "0" * 40, "commits": ["deadbeef"]})
        self.assertEqual(self.s.collect("r1", "T1")["result"], "ambiguous")
        self.assertEqual(self.s.store.load("r1")["tasks"]["T1"]["status"], "RUNNING")
        # done + no commits + no changes is also ambiguous
        st = self.s.store.load("r1")
        rp = self.s.store.run_dir("r1") / "reports" / "T1.json"
        wt = Path(st["tasks"]["T1"]["worktree"])
        sh(wt, "git", "reset", "-q", "--hard", st["tasks"]["T1"]["base_sha"])  # test fixture only
        rp.write_text(json.dumps({"task_id": "T1", "status": "done", "base_sha": st["tasks"]["T1"]["base_sha"],
                                  "head_sha": st["tasks"]["T1"]["base_sha"], "commits": [], "files_changed": [],
                                  "test_results": [], "risks": [], "not_done": []}))
        self.assertEqual(self.s.collect("r1", "T1")["result"], "ambiguous")

    def test_uncommitted_worker_diff_needs_audited_commit(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        self.worker_commit("r1", "T1", commit=False)
        out = self.s.collect("r1", "T1")
        self.assertTrue(out["needs_orchestrator_commit"])
        with self.assertRaisesRegex(S.SchedulerError, "commit-task"):
            self.s.mark_reviewed("r1", "T1", "PASS")
        c = self.s.commit_task("r1", "T1", "T1: orchestrator commit")
        log = sh(Path(self.s.store.load("r1")["tasks"]["T1"]["worktree"]), "git", "log", "-1", "--format=%B")
        self.assertIn("Orchestrator-Commit", log)
        self.assertEqual(len(c["commits"]), 1)
        self.assertEqual(self.s.mark_reviewed("r1", "T1", "PASS")["status"], "PASSED")

    def test_scope_and_secret_checks(self):
        outside, secrets = S.scope_check(["t1/a.py", "src/b.java", "conf/.env"], ["t1/"])
        self.assertEqual(outside, ["src/b.java", "conf/.env"])
        self.assertEqual(secrets, ["conf/.env"])


class TestPersistence(Base):
    def test_restart_recovery_no_duplicate_dispatch(self):
        self.dag()
        self.s.dispatch_ready("r1", launch="herdr")
        starts = sum(1 for c in self.herdr.calls if c[0] == "agent_start")
        s2 = self.new_scheduler()  # simulated process restart
        res = s2.resume("r1")
        self.assertTrue(any("T1: running" in a for a in res["actions"]))
        self.assertEqual(s2.dispatch_ready("r1", launch="herdr")["dispatched"], [])
        self.assertEqual(sum(1 for c in self.herdr.calls if c[0] == "agent_start"), starts)
        self.herdr.live.clear()  # agents vanished during the outage
        res = self.new_scheduler().resume("r1")
        self.assertTrue(any("relaunch" in a for a in res["actions"]))

    def test_lock_excludes_second_instance(self):
        self.dag()
        s2 = self.new_scheduler()
        with self.s.store.lock():
            with self.assertRaisesRegex(S.SchedulerError, "lock"):
                with s2.store.lock(timeout=0.2):
                    pass

    def test_atomic_save_preserves_previous_state(self):
        self.dag()
        before = self.s.store.state_path("r1").read_text()
        st = json.loads(before)
        st["status"] = "BLOCKED"
        with mock.patch.object(S.os, "replace", side_effect=OSError("crash")):
            with self.assertRaises(OSError):
                self.s.store.save(st)
        self.assertEqual(self.s.store.state_path("r1").read_text(), before)
        self.assertEqual(list(self.s.store.run_dir("r1").glob(".state.*.tmp")), [])

    def test_only_one_active_run(self):
        self.dag()
        with self.assertRaisesRegex(S.SchedulerError, "still RUNNING"):
            self.s.create_run("r2", [self.task("T1", trivial=True)])


class TestResearchGate(Base):
    def _ev(self, n):
        p = Path(self.tmp.name) / f"ev{n}.md"
        p.write_text(f"# dossier {n}\n- app.txt:1\n")
        return p

    def test_rounds_budget_gate_and_restart(self):
        self.dag(trivial=False)
        out = self.s.dispatch_ready("r1", launch="none")
        self.assertEqual(out["dispatched"], [])
        self.assertIn("architecture-readiness gate", out["skipped"]["T1"])
        for n in (1, 2, 3):
            self.s.research_round("r1", [f"question {n}"], self._ev(n))
            if n < 3:
                with self.assertRaisesRegex(S.SchedulerError, "readiness for round"):
                    self.s.research_round("r1", ["skip the gate"], self._ev(9))
            self.s.research_readiness("r1", "NOT_READY", {}, [f"gap {n}"])
            self.assertTrue((self.s.store.run_dir("r1") / "research" / f"scout-round-{n}.md").exists())
        s2 = self.new_scheduler()  # restart keeps the count
        self.assertEqual(s2.store.load("r1")["research"]["scout_rounds_used"], 3)
        with self.assertRaisesRegex(S.SchedulerError, "budget exhausted"):
            s2.research_round("r1", ["fourth"], self._ev(4))
        # unresolved gap after round 3 keeps nontrivial dispatch blocked
        self.assertEqual(s2.dispatch_ready("r1", launch="none")["dispatched"], [])
        st = s2.store.load("r1")
        self.assertIn("never waived", st["research"]["readiness"][-1]["note"])
        index = (self.repo / st["research"]["index_path"]).read_text()
        self.assertIn("3/3", index)
        # Opus direct inspection may then record READY with a full checklist
        with self.assertRaisesRegex(S.SchedulerError, "checklist"):
            s2.research_readiness("r1", "READY", {"preserve": "x"}, [])
        e = s2.research_readiness("r1", "READY", READY_CHECKLIST, [])
        self.assertEqual(e["source"], "opus-direct")
        self.assertEqual(len(s2.dispatch_ready("r1", launch="none")["dispatched"]), 2)

    def test_budget_survives_new_run_same_request(self):
        self.s.create_run("r1", [self.task("T1")], request_id="req-a")
        for n in (1, 2, 3):
            self.s.research_round("r1", [f"q{n}"], self._ev(n))
            self.s.research_readiness("r1", "NOT_READY", {}, ["gap"])
        self.s.close_run("r1", "BLOCKED", "re-plan", self.user_decides("r1", "abandon"))
        self.s.create_run("r2", [self.task("T1")], request_id="req-a")
        with self.assertRaisesRegex(S.SchedulerError, "budget exhausted"):
            self.s.research_round("r2", ["q4"], self._ev(4))
        self.s.close_run("r2", "BLOCKED", "done testing", self.user_decides("r2", "abandon"))
        self.s.create_run("r3", [self.task("T1")], request_id="req-b")  # new request => new budget
        self.assertEqual(self.s.research_round("r3", ["q1"], self._ev(5))["scout_rounds_used"], 1)

    def test_new_round_resets_readiness(self):
        self.dag(trivial=False)
        self.make_ready()
        self.assertTrue(self.s.store.load("r1")["research"]["architecture_ready"])
        self.s.research_round("r1", ["follow-up"], self._ev(2))
        self.assertFalse(self.s.store.load("r1")["research"]["architecture_ready"])

    def test_trivial_task_skips_research_gate(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.assertEqual(len(self.s.dispatch_ready("r1", launch="none")["dispatched"]), 1)


class TestTaskFiles(Base):
    def test_naming_convention_collisions_and_template(self):
        day = S._dt.date(2026, 10, 16)
        p1 = self.s.new_task_file("Register validation!", day)
        p2 = self.s.new_task_file("Register validation!", day)
        self.assertEqual(p1.relative_to(self.repo).as_posix(), "gen-tasks/register-validation-16-10-26.md")
        self.assertEqual(p2.name, "register-validation-16-10-26-2.md")
        text = p1.read_text()
        self.assertTrue(text.startswith("# Register validation! (16/10/26)"))
        self.assertNotIn("guidance", text)
        for section in ("## Steps", "## Boundaries", "**You must not run:**", "## Do not", "## Run these"):
            self.assertIn(section, text)
        r1 = self.s.new_task_file("", repair_of="gen-tasks/register-validation-16-10-26.md")
        r2 = self.s.new_task_file("", repair_of="gen-tasks/register-validation-16-10-26.md")
        self.assertEqual((r1.name, r2.name), ("register-validation-16-10-26-repair1.md",
                                              "register-validation-16-10-26-repair2.md"))
        with self.assertRaises(S.SchedulerError):
            S.slugify("///")

    def test_prompt_points_to_task_file_with_cautions(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        text = self.s.dispatch_ready("r1", launch="none")["dispatched"][0]["manual_command"][-1]
        self.assertIn(str(self.repo / "packets" / "T1.md"), text)
        self.assertIn("Do not guess", text)
        self.assertIn("committed=false", text)
        self.assertIn("unless the file's Boundaries explicitly allow them", text)  # installs only when the task allows
        self.assertIn(str(self.s.store.run_dir("r1") / "reports" / "T1.json"), text)

    def test_collect_captures_uncommitted_diff_and_appends_result(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        wt = Path(self.s.store.load("r1")["tasks"]["T1"]["worktree"])
        (wt / "app.txt").write_text("base\nchanged\n")  # tracked edit
        self.worker_commit("r1", "T1", content="new file\n", commit=False,
                           report_overrides={"files_changed": ["t1/out.txt", "app.txt"]})
        status_before = sh(wt, "git", "status", "--porcelain")
        out = self.s.collect("r1", "T1")
        self.assertEqual(out["result"], "REVIEW")
        self.assertEqual(sh(wt, "git", "status", "--porcelain"), status_before)  # real index untouched
        diff = (self.repo / out["diff"]).read_text()
        self.assertIn("+changed", diff)
        self.assertIn("+new file", diff)  # untracked file included
        task_file = (self.repo / "packets" / "T1.md").read_text()
        self.assertIn("## Worker result - attempt 1", task_file)
        self.assertIn("+new file", task_file)
        self.assertIn("orchestrator commits after review", task_file)

    def test_review_and_final_gate_appended(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        self.worker_commit("r1", "T1")
        self.s.collect("r1", "T1")
        self.s.mark_reviewed("r1", "T1", "PASS", "looks right", report="**Summary:** correct.")
        self.s.integrate("r1")
        self.s.verify("r1")
        text = (self.repo / "packets" / "T1.md").read_text()
        order = [text.index(h) for h in ("## Worker result", "## Review round 1: PASS",
                                         "**Summary:** correct.", "## Integration: merged", "## Final gate: PASS")]
        self.assertEqual(order, sorted(order))

    def test_writable_dirs_passed_and_sensitive_rejected(self):
        self.cfg["worker"]["writable_dirs"] = ["~/.gradle"]
        args = self.new_scheduler().codex_args("/wt", "r1")
        self.assertIn(str(Path("~/.gradle").expanduser()), args)
        for bad in ("~", "/", "~/.ssh", "~/.codex/x"):
            cfg = copy.deepcopy(self.cfg)
            cfg["worker"]["writable_dirs"] = [bad]
            self.assertTrue(any("writable_dirs" in e for e in S.validate_config(cfg)), bad)

    def test_cli_mark_reviewed_requires_report(self):
        with self.assertRaises(SystemExit), mock.patch("sys.stderr"):
            S.main(["--repo-root", str(self.repo), "mark-reviewed", "--run", "r1", "--task", "T1",
                    "--verdict", "PASS"])

    def test_wait_report_blocked_and_timeout(self):
        self.s.create_run("r1", [self.task("T1", trivial=True), self.task("T3", trivial=True)])
        self.s.dispatch_ready("r1")  # FakeHerdr: agents start
        ticks = iter(range(1000))
        clock = lambda: next(ticks)  # noqa: E731
        out = self.s.wait("r1", timeout_s=3, interval_s=0, sleep=lambda s: None, clock=clock)
        self.assertEqual(out["result"], "timeout")
        self.herdr.live["worker-2-r1"] = "blocked"
        out = self.s.wait("r1", timeout_s=3, interval_s=0, sleep=lambda s: None, clock=clock)
        self.assertEqual([b["task"] for b in out["blocked"]], ["T3"])
        self.worker_commit("r1", "T1")
        out = self.s.wait("r1", tids=["T1"], timeout_s=3, interval_s=0, sleep=lambda s: None, clock=clock)
        self.assertEqual(out["reported"], ["T1"])
        self.assertIn("collect --run r1 --task T1", out["next"])


class TestDecisions(Base):
    def blocked_task(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        self.worker_commit("r1", "T1", commit=False,
                           report_overrides={"status": "blocked", "not_done": ["spec unclear"]})
        self.assertEqual(self.s.collect("r1", "T1")["result"], "BLOCKED")

    def test_blocker_needs_answered_user_decision(self):
        self.blocked_task()
        with self.assertRaisesRegex(S.SchedulerError, "needs the user's decision"):
            self.s.task_unblock("r1", "T1")
        did = self.s.decision_ask("r1", "blocker", "Spec unclear", "Worker cannot tell X from Y.",
                                  ["A=Use X", "B=Use Y"], "T1", "A")["decision"]
        with self.assertRaisesRegex(S.SchedulerError, "not answered"):
            self.s.task_unblock("r1", "T1", decision=did)
        wrong = self.user_decides("r1", "repair", "T1")
        with self.assertRaisesRegex(S.SchedulerError, "needs kind blocker"):
            self.s.task_unblock("r1", "T1", decision=wrong)
        self.s.decision_answer("r1", did, "b", "Y is the 2024 contract", by="tester",
                               quote=f"{did} B, Y is the 2024 contract")
        self.assertEqual(self.s.task_unblock("r1", "T1", decision=did)["status"], "READY")
        st = self.s.store.load("r1")
        self.assertIn("task-unblock", st["decisions"][did]["consumed_by"])
        self.assertEqual(st["decisions"][did]["answer"]["choice"], "B")
        text = (self.repo / "packets" / "T1.md").read_text()
        self.assertIn(f"## Decision {did} needed (blocker)", text)
        self.assertIn(f"## Decision {did} answered by the user", text)
        self.assertIn("Y is the 2024 contract", (self.s.store.run_dir("r1") / "decisions" / f"{did}.md").read_text())

    def test_decision_single_use_and_task_bound(self):
        self.s.create_run("r1", [self.task("T1", trivial=True), self.task("T3", trivial=True)])
        did = self.user_decides("r1", "abandon")
        self.s.close_run("r1", "BLOCKED", "stop", did)
        with self.assertRaisesRegex(S.SchedulerError, "already used"):
            self.s.close_run("r1", "FAILED", "again", did)
        t3 = self.user_decides("r1", "blocker", "T3")
        st = self.s.store.load("r1")
        with self.assertRaisesRegex(S.SchedulerError, "about task T3"):
            self.s._require_decision(st, "blocker", "T1", t3, "test")

    def test_scope_exception_and_fail_need_decisions(self):
        self.s.create_run("r1", [self.task("T1", trivial=True, owned=["t1/"])])
        self.s.dispatch_ready("r1", launch="none")
        wt = Path(self.s.store.load("r1")["tasks"]["T1"]["worktree"])
        (wt / "app.txt").write_text("touched\n")  # outside owned paths
        self.worker_commit("r1", "T1", commit=False)
        self.s.collect("r1", "T1")
        with self.assertRaisesRegex(S.SchedulerError, "--allow-outside"):
            self.s.commit_task("r1", "T1", "msg")
        with self.assertRaisesRegex(S.SchedulerError, "scope_exception"):
            self.s.commit_task("r1", "T1", "msg", allow_outside=True)
        self.s.commit_task("r1", "T1", "msg", True, self.user_decides("r1", "scope_exception", "T1"))
        with self.assertRaisesRegex(S.SchedulerError, "scope_exception"):
            self.s.mark_reviewed("r1", "T1", "PASS", accept_scope=True)
        with self.assertRaisesRegex(S.SchedulerError, "kind abandon"):
            self.s.mark_reviewed("r1", "T1", "FAIL")
        out = self.s.mark_reviewed("r1", "T1", "PASS", accept_scope=True,
                                   decision=self.user_decides("r1", "scope_exception", "T1"))
        self.assertEqual(out["status"], "PASSED")

    def test_blocked_review_points_to_asking_user(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        self.worker_commit("r1", "T1")
        self.s.collect("r1", "T1")
        out = self.s.mark_reviewed("r1", "T1", "MAJOR_FIX")
        self.assertIn("routine, your call (fix round 1/2)", out["next"])
        self.cfg["decisions"]["routine_repairs"] = 0
        self.s = self.new_scheduler()
        did = self.s.decision_ask("r1", "repair", "Fix?", "tests fail", ["A=repair", "B=stop"], "T1")["decision"]
        actions = self.s.resume("r1")["actions"]
        self.assertTrue(actions[0].startswith(f"WAITING FOR USER: {did}"))
        self.assertTrue(any("critical, ask the user: decision ask --run r1 --kind repair" in a for a in actions))

    def test_wait_and_cancel(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        did = self.s.decision_ask("r1", "question", "Which?", "q", ["A=x", "B=y"])["decision"]
        ticks = iter(range(100))
        out = self.s.decision_wait("r1", did, timeout_s=2, sleep=lambda s: None, clock=lambda: next(ticks))
        self.assertEqual(out["result"], "timeout")
        self.s.decision_answer("r1", did, "A", by="tester", quote="A")
        self.assertEqual(self.s.decision_wait("r1", did)["answer"]["choice"], "A")
        with self.assertRaisesRegex(S.SchedulerError, "not PENDING"):
            self.s.decision_answer("r1", did, "B", quote="B")
        d2 = self.s.decision_ask("r1", "question", "Other?", "q", ["A=x", "B=y"])["decision"]
        self.s.decision_cancel("r1", d2, "superseded")
        with self.assertRaisesRegex(S.SchedulerError, "CANCELLED"):
            self.s.decision_answer("r1", d2, "A", quote="A")
        with self.assertRaisesRegex(S.SchedulerError, "at least 2 options"):
            self.s.decision_ask("r1", "question", "t", "q", ["A=only"])

    def test_routine_fix_rounds_then_critical(self):
        self.cfg["decisions"]["routine_repairs"] = 1
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="none")
        (self.repo / "packets" / "rep.md").write_text("# repair\n")
        self.worker_commit("r1", "T1", "try0\n")
        self.s.collect("r1", "T1")
        self.s.mark_reviewed("r1", "T1", "MAJOR_FIX")
        with self.assertRaisesRegex(S.SchedulerError, "give the reason"):
            self.s.repair("r1", "T1", "packets/rep.md", launch="none")
        self.s.repair("r1", "T1", "packets/rep.md", launch="none", reason="UserHandlerTest fails: expected 100")
        st = self.s.store.load("r1")
        opus = [d for d in st["decisions"].values() if d["status"] == "DECIDED_BY_OPUS"]
        self.assertEqual((len(opus), opus[0]["kind"]), (1, "repair"))
        self.assertIn("Opus decision D1 (routine repair)", (self.repo / "packets" / "T1.md").read_text())
        self.worker_commit("r1", "T1", "try1\n")
        self.s.collect("r1", "T1")
        self.s.mark_reviewed("r1", "T1", "MAJOR_FIX")
        with self.assertRaisesRegex(S.SchedulerError, "critical and needs the user's decision"):
            self.s.repair("r1", "T1", "packets/rep.md", launch="none", reason="Opus would like to")
        self.s.repair("r1", "T1", "packets/rep.md", launch="none", decision=self.user_decides("r1", "repair", "T1"))

    def test_critical_kinds_never_routine(self):
        self.blocked_task()
        with self.assertRaisesRegex(S.SchedulerError, "critical"):
            self.s.task_unblock("r1", "T1", note="Opus thinks it is fine")
        with self.assertRaisesRegex(S.SchedulerError, "critical"):
            self.s.close_run("r1", "BLOCKED", "Opus gives up")

    def test_record_needs_users_words_and_logs_them(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        did = self.s.decision_ask("r1", "blocker", "Which?", "q", ["A=x", "B=y"], "T1")["decision"]
        for quote in ("", "   "):
            with self.assertRaisesRegex(S.SchedulerError, "user's own words"):
                self.s.decision_answer("r1", did, "A", quote=quote)
        self.assertEqual(self.s.store.load("r1")["decisions"][did]["status"], "PENDING")
        argv = ["--repo-root", str(self.repo), "decision", "record", "--run", "r1", "--id", did,
                "--choice", "b", "--quote", "D1 b, keep the old name", "--note", "keep the old name"]
        with mock.patch.object(S, "load_config", return_value=self.cfg), mock.patch("builtins.print"):
            self.assertEqual(S.main(argv), 0)
        a = self.s.store.load("r1")["decisions"][did]["answer"]
        self.assertEqual((a["choice"], a["channel"], a["quote"]), ("B", "chat", "D1 b, keep the old name"))
        self.assertIn('User\'s words (chat): "D1 b, keep the old name"', (self.repo / "packets" / "T1.md").read_text())
        dfile = self.s.store.run_dir("r1") / "decisions" / f"{did}.md"
        self.assertIn('User\'s words: "D1 b, keep the old name"', dfile.read_text())
        with mock.patch.object(S, "load_config", return_value=self.cfg), mock.patch("sys.stderr"):
            with self.assertRaises(SystemExit):  # --quote is required on the command line
                S.main(argv[:-4])

    def test_routine_worker_approval_is_recorded_with_reason(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        out = self.s.decision_routine("r1", "worker_approval", "approved ./gradlew test for worker-1",
                                      "inside its worktree; allowed by the task's Boundaries", "T1")
        d = self.s.store.load("r1")["decisions"][out["decision"]]
        self.assertEqual((d["status"], d["answer"]["by"]), ("DECIDED_BY_OPUS", "opus"))
        self.assertIn("approved ./gradlew test", (self.repo / "packets" / "T1.md").read_text())
        with self.assertRaisesRegex(S.SchedulerError, "always the user's"):
            self.s.decision_routine("r1", "finish", "merge", "looks fine")
        with self.assertRaisesRegex(S.SchedulerError, "critical here"):
            self.s.decision_routine("r1", "abandon", "close run", "tired", "T1")
        with self.assertRaisesRegex(S.SchedulerError, "give the reason"):
            self.s.decision_routine("r1", "worker_approval", "approved ls", " ", "T1")

    def test_gate_can_be_relaxed_in_config(self):
        self.cfg["decisions"]["require_user_for"] = ["abandon"]
        self.s = self.new_scheduler()
        self.blocked_task()
        with self.assertRaisesRegex(S.SchedulerError, "give the reason"):
            self.s.task_unblock("r1", "T1")
        self.assertEqual(self.s.task_unblock("r1", "T1", note="plan step 2 named the wrong file")["status"],
                         "READY")
        bad = copy.deepcopy(self.cfg)
        bad["decisions"]["require_user_for"] = ["everything"]
        self.assertTrue(any("unknown kinds" in e for e in S.validate_config(bad)))


class TestHubScheduler(Base):
    def test_log_event_numbers_and_keeps_500_events(self):
        state = {"events": [{"at": "old", "kind": "legacy"} for _ in range(500)]}
        S.log_event(state, "first")
        S.log_event(state, "second")
        self.assertEqual(state["event_n"], 2)
        self.assertEqual(len(state["events"]), 500)
        self.assertNotIn("n", state["events"][0])  # existing events are not rewritten
        self.assertEqual([event["n"] for event in state["events"][-2:]], [1, 2])

    def test_decision_ask_hub_online_offline_stale_and_dead_pid(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        hint = self.repo / ".orchestrator" / "hub.json"
        hint.write_text(json.dumps({"backend": "online", "connector_pid": os.getpid(), "heartbeat_at": S.now()}))
        online = self.s.decision_ask("r1", "question", "Choose", "Which option?", ["A=keep", "B=change"],
                                     recommend="B")
        self.assertEqual(online["hub"], "online")
        self.assertIn("Choose", online["next"])
        self.assertIn("Which option?", online["next"])
        self.assertIn("A: keep", online["next"])
        self.assertIn("Recommendation: B: change", online["next"])
        self.assertIn("end your turn", online["next"])
        self.assertIn("do not use AskUserQuestion", online["next"])

        hint.write_text(json.dumps({"backend": "offline", "connector_pid": os.getpid(), "heartbeat_at": S.now()}))
        self.assertEqual(self.s.decision_ask("r1", "question", "Offline", "q", ["A=x", "B=y"])["hub"],
                         "offline")
        hint.write_text(json.dumps({"backend": "online", "connector_pid": os.getpid(),
                                    "heartbeat_at": "2000-01-01T00:00:00+00:00"}))
        self.assertEqual(self.s.decision_ask("r1", "question", "Stale", "q", ["A=x", "B=y"])["hub"],
                         "offline")
        hint.write_text(json.dumps({"backend": "online", "connector_pid": 2**30, "heartbeat_at": S.now()}))
        self.assertEqual(self.s.decision_ask("r1", "question", "Dead", "q", ["A=x", "B=y"])["hub"],
                         "offline")

    def test_validate_config_and_doctor_hub_checks(self):
        self.cfg["hub"] = {"enabled": True, "url": "http://127.0.0.1:7420",
                           "workspace_id": "ws_abcdefghijklmnop",
                           "upload": {"documents": True, "diffs": True, "agent_screens": True},
                           "screen_lines": 40}
        self.assertEqual(S.validate_config(self.cfg), [])
        (self.repo / ".agent-system").mkdir(exist_ok=True)
        (self.repo / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))
        key_dir = Path(self.tmp.name) / "hub-config"
        key_dir.mkdir()
        (key_dir / "connector.key").write_text("test-key")
        with mock.patch.dict(os.environ, {"AGENT_HUB_CONFIG": str(key_dir)}), \
                mock.patch.object(AC, "ping", return_value={}), \
                mock.patch.object(S.shutil, "which", return_value=None):
            checks = S.doctor(self.repo)
        by_name = {item["check"]: item for item in checks}
        self.assertEqual(by_name["hub-workspace-id"]["status"], "ok")
        self.assertEqual(by_name["hub-connector-key"]["status"], "ok")
        self.assertEqual(by_name["hub-backend"]["status"], "ok")
        with mock.patch.dict(os.environ, {"AGENT_HUB_CONFIG": str(key_dir)}), \
                mock.patch.object(AC, "ping", side_effect=RuntimeError("offline")), \
                mock.patch.object(S.shutil, "which", return_value=None):
            checks = S.doctor(self.repo)
        by_name = {item["check"]: item for item in checks}
        self.assertEqual(by_name["hub-backend"]["status"], "warn")


class TestCli(Base):
    def test_help_and_status(self):
        for argv in (["--help"], ["run", "create", "--help"], ["research", "readiness", "--help"]):
            with self.assertRaises(SystemExit) as cm, mock.patch("sys.stdout"):
                S.main(argv)
            self.assertEqual(cm.exception.code, 0)


class WorkspaceBase(Base):
    """repo/ is the only git repo; repo.workspace/ holds the kit, state, task files and worktrees
    and reaches the repo through the relative symlink repo.workspace/repo -> ../repo."""

    def setUp(self):
        super().setUp()
        sh(self.repo, "rm", "-rf", "packets")  # Base writes packets into the repo; here they live in the workspace
        self.ws = Path(self.tmp.name) / "repo.workspace"
        (self.ws / ".agent-system").mkdir(parents=True)
        (self.ws / "repo").symlink_to("../repo")
        (self.ws / "AGENTS.md").write_text("# worker rules\n")
        for tid in ("T1", "T2", "T3"):
            p = self.ws / "packets" / f"{tid}.md"
            p.parent.mkdir(exist_ok=True)
            p.write_text(f"# packet {tid}\n")
        self.cfg["project"] = {"path": "repo"}
        self.cfg["pool"]["worktree_root"] = "worktrees"
        self.s = self.new_scheduler()

    def new_scheduler(self):
        if not hasattr(self, "ws"):  # Base.setUp builds an in-repo scheduler first
            return super().new_scheduler()
        return S.Scheduler(self.ws, cfg=self.cfg, herdr=self.herdr)

    def repo_status(self):
        return sh(self.repo, "git", "status", "--porcelain", "--untracked-files=all")



class TestWorkspaceMode(WorkspaceBase):
    def test_roots(self):
        self.assertTrue(self.s.workspace_mode)
        self.assertEqual(self.s.project_root, self.repo.resolve())
        self.assertEqual(self.s.workspace_root, self.ws.resolve())
        self.assertEqual(self.s.worktree_root, (self.ws / "worktrees").resolve())

    def test_full_run_keeps_repo_clean_and_state_in_workspace(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        self.s.dispatch_ready("r1", launch="herdr")
        st = self.s.store.load("r1")
        wt = Path(st["tasks"]["T1"]["worktree"])
        self.assertEqual(wt.parent, (self.ws / "worktrees").resolve())
        self.assertEqual(Path(st["integration_worktree"]).parent, (self.ws / "worktrees").resolve())
        self.assertEqual(st["project_root"], str(self.repo.resolve()))
        self.assertTrue((self.ws / ".orchestrator" / "runs" / "r1" / "state.json").is_file())
        self.assertFalse((self.repo / ".orchestrator").exists())
        prompt = [c for c in self.herdr.calls if c[0] == "agent_prompt"][-1][2]
        self.assertIn(str(self.ws.resolve() / "packets" / "T1.md"), prompt)
        self.assertIn("WORKER-RULES.md", prompt)
        self.assertEqual(self.repo_status(), "")
        self.worker_commit("r1", "T1")
        self.assertEqual(self.s.collect("r1", "T1")["result"], "REVIEW")
        self.s.mark_reviewed("r1", "T1", "PASS")
        self.assertEqual(self.s.integrate("r1")["results"][0]["result"], "MERGED")
        self.assertEqual(self.s.verify("r1")["run_status"], "DONE")
        self.assertEqual(self.repo_status(), "")
        self.assertEqual(sh(self.repo, "git", "rev-parse", "main"), self.base_sha)  # user branch untouched
        self.assertIn("agent/integration-r1", sh(self.repo, "git", "branch", "--list", "agent/*"))
        r = subprocess.run(["git", "rev-parse", "--git-dir"], cwd=self.ws, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0, "the workspace must not be a git repo")
        self.s.cleanup("r1", remove_worktrees=True)
        self.assertEqual(sh(self.repo, "git", "worktree", "list").count("\n"), 0)

    def test_refuses_bad_project(self):
        cfg = copy.deepcopy(self.cfg)
        cfg["project"] = {"path": "missing"}
        with self.assertRaisesRegex(S.SchedulerError, "does not resolve"):
            S.Scheduler(self.ws, cfg=cfg, herdr=self.herdr)
        inner = self.repo / "inner.workspace"
        inner.mkdir()
        cfg["project"] = {"path": ".."}
        with self.assertRaisesRegex(S.SchedulerError, "must not be inside the project"):
            S.Scheduler(inner, cfg=cfg, herdr=self.herdr)
        cfg["project"] = {"path": ""}
        self.assertTrue(any("project must be" in e for e in S.validate_config(cfg)))

    def test_doctor_checks_repo_separation(self):
        (self.ws / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))

        def status(name):
            return next(c["status"] for c in S.doctor(self.ws) if c["check"] == name)

        self.assertEqual(status("project"), "ok")
        self.assertEqual(status("git"), "ok")
        self.assertEqual(status("project-clean-of-kit"), "ok")
        self.assertEqual(status("claude-additional-dirs"), "warn")
        self.assertNotIn("orchestrator-ignored", [c["check"] for c in S.doctor(self.ws)])
        (self.ws / ".claude").mkdir()
        (self.ws / ".claude" / "settings.json").write_text(
            json.dumps({"permissions": {"additionalDirectories": [str(self.repo)]}}))
        self.assertEqual(status("claude-additional-dirs"), "ok")
        (self.repo / "CLAUDE.md").write_text("stray\n")
        self.assertEqual(status("project-clean-of-kit"), "fail")


class TestFinish(WorkspaceBase):
    """report -> finish ask -> (user answers) -> finish apply."""

    def done_run(self, run="r1"):
        self.s.create_run(run, [self.task("T1", trivial=True)])
        self.s.dispatch_ready(run, launch="herdr")
        self.worker_commit(run, "T1")
        self.s.collect(run, "T1")
        self.s.mark_reviewed(run, "T1", "PASS")
        self.s.integrate(run)
        self.assertEqual(self.s.verify(run)["run_status"], "DONE")
        return self.s.store.load(run)["integration_sha"]

    def ask_and_answer(self, choice, followup=None, value=None, run="r1"):
        self.s.report(run, "Added t1/out.txt.")
        did = self.s.finish_ask(run, "B")["decision"]
        self.s.decision_answer(run, did, choice, "ok", by="tester", followup=followup, value=value,
                               quote=f"{choice} {followup or ''} {value or ''}".strip())
        return did

    def head(self, ref="main"):
        return sh(self.repo, "git", "rev-parse", ref)

    def test_report_has_summary_and_total_diff(self):
        self.done_run()
        out = self.s.report("r1", "Added t1/out.txt.")
        text = Path(out["report"]).read_text()
        for needle in ("Added t1/out.txt.", "Started from: `main`", "Final gate: PASS", "| T1 |", "T1: work"):
            self.assertIn(needle, text)
        self.assertIn("+++ b/t1/out.txt", Path(out["diff"]).read_text())

    def test_finish_needs_done_run_and_report(self):
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        with self.assertRaisesRegex(S.SchedulerError, "DONE"):
            self.s.report("r1")
        with self.assertRaisesRegex(S.SchedulerError, "report first"):
            self.s.finish_ask("r1")

    def test_decision_shape_and_answer_validation(self):
        self.done_run()
        self.s.report("r1")
        did = self.s.finish_ask("r1", "B")["decision"]
        d = self.s.store.load("r1")["decisions"][did]
        self.assertEqual([o["label"] for o in d["options"]],
                         ["Merge and push", "Merge locally only, no push", "Don't merge"])
        self.assertEqual(d["followup"]["question"], "What branch do you choose to merge?")
        self.assertEqual(d["followup"]["options"][0]["label"], "This branch (main)")
        self.assertTrue(d["followup"]["options"][1]["input"])
        for kwargs, msg in (({}, "needs an answer"), ({"followup": "B", "value": ""}, "type a value"),
                            ({"followup": "B", "value": "bad..name"}, "not a valid branch"),
                            ({"followup": "B", "value": "agent/x"}, "agent branch")):
            with self.assertRaisesRegex(S.SchedulerError, msg):
                self.s.decision_answer("r1", did, "B", quote="B", **kwargs)
        st = self.s.store.load("r1")
        self.assertTrue(self.s._is_critical(st, "finish", None))
        self.s.cfg["decisions"]["require_user_for"] = []
        self.assertTrue(self.s._is_critical(st, "finish", None))  # config cannot make merging routine

    def test_merge_locally_into_this_branch_fast_forwards_and_cleans_up(self):
        isha = self.done_run()
        did = self.ask_and_answer("B", "A")
        out = self.s.finish_apply("r1", did)
        self.assertEqual(self.head(), isha)
        self.assertEqual((self.repo / "t1" / "out.txt").read_text(), "done\n")  # the user's folder updated
        self.assertNotIn("pushed", out)
        self.assertEqual(sh(self.repo, "git", "branch", "--list", "agent/*"), "")
        self.assertEqual(sh(self.repo, "git", "worktree", "list").count("\n"), 0)
        self.assertIn("merged into main", self.s.store.load("r1")["finish"]["result"])
        with self.assertRaisesRegex(S.SchedulerError, "already finished"):
            self.s.finish_apply("r1", did)

    def test_other_new_branch_leaves_users_folder_alone(self):
        isha = self.done_run()
        did = self.ask_and_answer("B", "B", "feature/r1")
        self.s.finish_apply("r1", did)
        self.assertEqual(self.head("feature/r1"), isha)
        self.assertEqual(self.head(), self.base_sha)
        self.assertFalse((self.repo / "t1").exists())

    def test_moved_branch_is_merged_in_and_gated_again(self):
        self.done_run()
        (self.repo / "other.txt").write_text("user work\n")
        sh(self.repo, "git", "add", "-A")
        sh(self.repo, "git", "commit", "-q", "-m", "user commit")
        user_tip = self.head()
        did = self.ask_and_answer("B", "A")
        out = self.s.finish_apply("r1", did)
        self.assertIn("gate_after_merge", out)
        self.assertEqual(sh(self.repo, "git", "merge-base", "--is-ancestor", user_tip, "main"), "")
        self.assertTrue((self.repo / "t1" / "out.txt").exists() and (self.repo / "other.txt").exists())

    def test_conflict_or_dirty_folder_changes_nothing_and_keeps_decision(self):
        self.done_run()
        (self.repo / "t1").mkdir()
        (self.repo / "t1" / "out.txt").write_text("conflicting\n")
        sh(self.repo, "git", "add", "-A")
        sh(self.repo, "git", "commit", "-q", "-m", "user edits the same file")
        tip = self.head()
        did = self.ask_and_answer("B", "A")
        with self.assertRaisesRegex(S.SchedulerError, "conflicts"):
            self.s.finish_apply("r1", did)
        self.assertEqual(self.head(), tip)
        (self.repo / "scratch.txt").write_text("wip\n")
        with self.assertRaisesRegex(S.SchedulerError, "uncommitted changes"):
            self.s.finish_apply("r1", did)
        d = self.s.store.load("r1")["decisions"][did]
        self.assertIsNone(d["consumed_by"])  # still usable after the user fixes things

    def test_merge_and_push(self):
        isha = self.done_run()
        remote = Path(self.tmp.name) / "remote.git"
        sh(self.tmp.name, "git", "init", "-q", "--bare", str(remote))
        sh(self.repo, "git", "remote", "add", "origin", str(remote))
        did = self.ask_and_answer("A", "A")
        out = self.s.finish_apply("r1", did)
        self.assertTrue(out["pushed"], out)
        self.assertEqual(sh(remote, "git", "rev-parse", "main"), isha)

    def test_push_without_remote_is_refused_before_merging(self):
        self.done_run()
        did = self.ask_and_answer("A", "A")
        with self.assertRaisesRegex(S.SchedulerError, "no git remote"):
            self.s.finish_apply("r1", did)
        self.assertEqual(self.head(), self.base_sha)

    def record(self, *extra):
        argv = ["--workspace-root", str(self.ws), "decision", "record", "--run", "r1", *extra]
        with mock.patch.object(S, "load_config", return_value=self.cfg), mock.patch("builtins.print"):
            self.assertEqual(S.main(argv), 0)
        return self.s.store.load("r1")

    def test_chat_answer_this_branch(self):
        self.done_run()
        self.s.report("r1")
        did = self.s.finish_ask("r1", "B")["decision"]
        st = self.record("--id", did, "--choice", "B", "--followup", "A", "--quote", "B, then A (main)")
        a = st["decisions"][did]["answer"]
        self.assertEqual((a["choice"], a["followup"]["value"], a["quote"]), ("B", "main", "B, then A (main)"))
        self.s.finish_apply("r1", did)
        self.assertIn("merged into main", self.s.store.load("r1")["finish"]["result"])

    def test_chat_answer_other_branch(self):
        self.done_run()
        self.s.report("r1")
        did = self.s.finish_ask("r1")["decision"]
        st = self.record("--id", did, "--choice", "A", "--followup", "B", "--value", "release/1.2",
                         "--quote", "A. other branch: release/1.2")
        self.assertEqual(st["decisions"][did]["answer"]["followup"]["value"], "release/1.2")

    def test_chat_answer_dont_merge_needs_no_branch(self):
        self.done_run()
        self.s.report("r1")
        did = self.s.finish_ask("r1")["decision"]
        st = self.record("--id", did, "--choice", "C", "--quote", "C, leave it")
        self.assertNotIn("followup", st["decisions"][did]["answer"])

    def test_dont_merge_keeps_everything(self):
        self.done_run()
        did = self.ask_and_answer("C")
        self.s.finish_apply("r1", did)
        self.assertEqual(self.head(), self.base_sha)
        self.assertIn("agent/integration-r1", sh(self.repo, "git", "branch", "--list", "agent/*"))
        self.assertIn("not merged", self.s.store.load("r1")["finish"]["result"])


class TestModels(Base):
    def test_resolve_aliases_catalog_and_unverified(self):
        self.assertEqual(M.resolve("opus")["model"], "claude-opus-5-5")
        self.assertEqual(M.resolve("claude-sonnet-5-5")["kind"], "claude")
        x = M.resolve("gpt-x-sol")
        self.assertEqual((x["kind"], x["efforts"], x["verified"]), ("codex", ["low", "high", "ultra"], True))
        self.assertEqual(M.resolve("gpt-hidden")["kind"], "codex")  # hidden models work when typed exactly
        g = M.resolve("grok/grok-4")
        self.assertEqual((g["kind"], g["model"], g["verified"]), ("grok", "grok-4", False))
        self.assertIn("UNVERIFIED", g["note"])
        self.assertIn("not in this kit's Claude list", M.resolve("claude-opus-9")["note"])

    def test_unknown_model_shows_table(self):
        with self.assertRaises(M.ModelError) as cm:
            M.resolve("gpt-7")
        for needle in ("gpt-x-sol", "claude-opus-5-5", "Unverified programs", "grok", "opencode"):
            self.assertIn(needle, cm.exception.table)
        self.assertNotIn("gpt-hidden", cm.exception.table)
        with self.assertRaises(M.ModelError):
            M.resolve("codex/not-a-model")

    def test_effort(self):
        x = M.resolve("gpt-x-sol")
        self.assertEqual(M.check_effort(x, None), "high")
        self.assertEqual(M.check_effort(x, "ultra"), "ultra")
        with self.assertRaisesRegex(M.ModelError, "low, high, ultra"):
            M.check_effort(x, "xhigh")
        self.assertEqual(M.check_effort(M.resolve("grok/grok-4"), "whatever"), "whatever")

    def test_claude_worker_launches_with_its_flags(self):
        self.cfg["worker"].update(kind="claude", model="claude-sonnet-5-5", reasoning_effort="high")
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        with mock.patch.object(S.shutil, "which", return_value="/usr/bin/claude"):
            self.s.dispatch_ready("r1", launch="herdr")
        start = [c for c in self.herdr.calls if c[0] == "agent_start"][0]
        args = start[3]
        self.assertEqual(self.herdr.kinds, ["claude"])
        self.assertEqual(args[:4], ["--model", "claude-sonnet-5-5", "--effort", "high"])
        self.assertEqual(args[-2:], ["--permission-mode", "auto"])
        self.assertIn(str(self.s.store.run_dir("r1") / "reports"), args)
        prompt = [c for c in self.herdr.calls if c[0] == "agent_prompt"][0][2]
        self.assertIn("You are a worker, not the orchestrator", prompt)
        self.assertIn("WORKER-RULES.md", prompt)
        st = self.s.store.load("r1")
        self.assertEqual(self.s.manual_command(st, "T1", "go")[0], "claude")

    def test_missing_worker_program_refused_before_leasing(self):
        self.cfg["worker"].update(kind="grok", model="grok-4")
        self.s = self.new_scheduler()
        self.s.create_run("r1", [self.task("T1", trivial=True)])
        with mock.patch.object(S.shutil, "which", return_value=None):
            with self.assertRaisesRegex(S.SchedulerError, "not installed"):
                self.s.dispatch_ready("r1", launch="herdr")
        self.assertEqual(self.s.store.load("r1")["tasks"]["T1"]["status"], "READY")  # nothing leased

    def test_unverified_worker_uses_generic_or_configured_args(self):
        self.cfg["worker"].update(kind="gemini", model="gemini-3-pro", reasoning_effort=None)
        self.s = self.new_scheduler()
        self.assertEqual(self.s.worker_args("/wt", "r1"), ["--model", "gemini-3-pro"])
        self.cfg["worker"]["launch_args"] = ["-m", "{model}", "--yolo-off", "--cwd", "{cwd}"]
        self.assertEqual(self.s.worker_args("/wt", "r1"), ["-m", "gemini-3-pro", "--yolo-off", "--cwd", "/wt"])
        self.assertIn("UNVERIFIED", M.sandbox_note("gemini"))

    def test_interactive_picker(self):
        ws = Path(self.tmp.name) / "ws"
        (ws / ".agent-system").mkdir(parents=True)
        (ws / ".claude" / "agents").mkdir(parents=True)
        (ws / ".claude" / "agents" / "scout.md").write_text("---\nname: scout\nmodel: x\neffort: low\n---\nbody\n")
        (ws / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))
        rows = M.numbered()
        n = lambda model: str(next(i for i, r in enumerate(rows, 1) if r["model"] == model))
        keys = [n("claude-fable-5-1"), "",        # orchestrator: Fable, default effort
                "", "",                           # scout: keep, keep
                n("gpt-x-sol"), "3",              # worker: gpt-x-sol, effort #3 = ultra
                ""]                               # number of workers: keep
        with mock.patch.object(K.sys.stdin, "isatty", return_value=True), \
                mock.patch("builtins.input", side_effect=keys), mock.patch("builtins.print"):
            self.assertEqual(K.main(["--workspace", str(ws)]), 0)
        cfg = json.loads((ws / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["orchestrator"]["model"], "claude-fable-5-1")
        self.assertEqual((cfg["worker"]["model"], cfg["worker"]["reasoning_effort"]), ("gpt-x-sol", "ultra"))
        self.assertEqual(json.loads((ws / ".claude" / "settings.json").read_text())["model"], "claude-fable-5-1")
        self.assertIn("model: claude-sonnet-5-5", (ws / ".claude" / "agents" / "scout.md").read_text())
        self.assertEqual(cfg["pool"]["size"], 3)

    def test_num_worker(self):
        ws = Path(self.tmp.name) / "ws"
        (ws / ".agent-system").mkdir(parents=True)
        (ws / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))
        with mock.patch("builtins.print"):
            self.assertEqual(K.main(["--workspace", str(ws), "--num-worker", "5", "--no-input"]), 0)
            self.assertEqual(K.main(["--workspace", str(ws), "--num-worker", "11", "--no-input"]), 2)
            self.assertEqual(K.main(["--workspace", str(ws), "--num-worker", "0", "--no-input"]), 2)
        cfg = json.loads((ws / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["pool"]["slots"], [f"worker-{i}" for i in range(1, 6)])
        self.assertEqual((cfg["pool"]["size"], cfg["limits"]["max_parallel"], cfg["limits"]["max_tasks_per_request"]),
                         (5, 5, 5))
        self.assertEqual(cfg["worker"]["model"], self.cfg["worker"]["model"])  # models untouched
        self.assertEqual(S.validate_config(cfg), [])
        for i in (4, 5):
            (self.repo / "packets" / f"T{i}.md").write_text(f"# packet T{i}\n")
        s = S.Scheduler(self.repo, cfg=cfg, herdr=self.herdr)
        s.create_run("r1", [self.task(f"T{i}", trivial=True) for i in range(1, 6)])
        self.assertEqual(len(s.dispatch_ready("r1", launch="none")["dispatched"]), 5)
        self.assertEqual(sorted(["worker-10", "worker-2", "worker-1"], key=S.slot_order),
                         ["worker-1", "worker-2", "worker-10"])


class StartHerdr(FakeHerdr):
    """FakeHerdr plus the raw calls `agent-kit start` makes (focus) and Herdr's real agent record."""

    def __init__(self):
        super().__init__()
        self.sessions, self.ws_of = {}, {}

    def _call(self, *args, timeout_s=None):
        self.calls.append(("call", *args))
        return {}

    def agent_start(self, name, pane, agent_args, timeout_ms, kind="codex"):
        self.ws_of[name] = pane.split(":")[0]
        return super().agent_start(name, pane, agent_args, timeout_ms, kind)

    def agent_get(self, name):
        if name not in self.live:
            raise S.SchedulerError("agent not found")
        sid = self.sessions.get(name)
        return {"result": {"agent": {"name": name, "agent_status": self.live[name],
                                     "workspace_id": self.ws_of.get(name, "wX"),
                                     **({"agent_session": {"kind": "id", "value": sid}} if sid else {})}}}

    def workspace_close(self, ws):
        super().workspace_close(ws)
        for name, w in list(self.ws_of.items()) + [(n, "wX") for n in self.live if n not in self.ws_of]:
            if w == ws:
                self.live.pop(name, None)


class TestStart(WorkspaceBase):
    def setUp(self):
        super().setUp()
        (self.ws / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))
        self.h = StartHerdr()

    def set_orch(self, **role):
        self.cfg["orchestrator"] = role
        (self.ws / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))

    def start(self, *extra, env=None, running=True):
        execs, popens = [], []
        runner = lambda *a, **k: subprocess.CompletedProcess(a, 0, "server:\n  status: running\n" if running else
                                                             "server:\n  status: stopped\n", "")
        with mock.patch.object(KS.shutil, "which", return_value="/usr/bin/x"), \
                mock.patch.object(KS.subprocess, "Popen", side_effect=lambda *a, **k: popens.append(a)), \
                mock.patch("builtins.print"):
            rc = KS.main(["--workspace", str(self.ws), *extra], herdr=self.h, env=env or {},
                         execvp=lambda *a: execs.append(a), runner=runner)
        return rc, execs, popens

    def test_plan_per_program(self):
        self.set_orch(kind="claude", model="claude-opus-5-5", effort="high")
        p = KS.plan(self.ws, self.cfg)
        self.assertEqual((p["kind"], p["args"], p["prompt"], p["name"], p["label"]),
                         ("claude", ["--model", "claude-opus-5-5", "--effort", "high"], None, "orch-repo", "repo"))
        self.set_orch(kind="codex", model="gpt-6-sol", effort="high")
        p = KS.plan(self.ws, self.cfg)
        self.assertEqual(p["args"], ["-m", "gpt-6-sol", "-c", 'model_reasoning_effort="high"', "-C", str(self.ws),
                                     "--add-dir", str(self.repo.resolve())])
        self.assertIn("read AGENTS.md", p["prompt"])
        self.set_orch(kind="gemini", model="gemini-3-pro", launch_args=["-m", "{model}"])
        p = KS.plan(self.ws, self.cfg)
        self.assertEqual((p["args"], p["verified"]), (["-m", "gemini-3-pro"], False))

    def test_inside_herdr_starts_and_focuses(self):
        self.set_orch(kind="codex", model="gpt-6-sol", effort="high")
        rc, execs, _ = self.start(env={"HERDR_ENV": "1"})
        self.assertEqual(rc, 0)
        create = [c for c in self.h.calls if c[0] == "workspace_create"][0]
        self.assertEqual(create[1:], (str(self.ws), "repo"))
        self.assertEqual(self.h.kinds, ["codex"])
        self.assertTrue(any(c[0] == "agent_prompt" and "read AGENTS.md" in c[2] for c in self.h.calls))
        self.assertTrue(any(c[:3] == ("call", "workspace", "focus") for c in self.h.calls))
        self.assertEqual(execs, [])  # already inside Herdr: no attach

    def test_claude_gets_no_bootstrap_prompt_and_outside_attaches(self):
        self.set_orch(kind="claude", model="claude-opus-5-5", effort=None)
        rc, execs, _ = self.start()
        self.assertEqual(rc, 0)
        self.assertFalse([c for c in self.h.calls if c[0] == "agent_prompt"])
        self.assertEqual(execs, [("herdr", ["herdr"])])
        rc, execs, _ = self.start("--no-attach")
        self.assertEqual(execs, [])

    def test_already_running_is_focused_not_restarted(self):
        self.set_orch(kind="claude", model="claude-opus-5-5")
        self.h.live["orch-repo"] = "idle"
        self.start(env={"HERDR_ENV": "1"})
        self.assertFalse([c for c in self.h.calls if c[0] in ("workspace_create", "agent_start")])
        self.assertIn(("call", "agent", "focus", "orch-repo"), self.h.calls)

    def test_herdr_not_running_spawns_helper_then_starts_herdr(self):
        self.set_orch(kind="claude", model="claude-opus-5-5")
        rc, execs, popens = self.start(running=False)
        self.assertEqual(rc, 0)
        self.assertIn("--when-ready", popens[0][0])
        self.assertEqual(execs, [("herdr", ["herdr"])])
        self.assertFalse([c for c in self.h.calls if c[0] == "agent_start"])  # the helper does that

    def test_start_saves_the_chat_id(self):
        self.set_orch(kind="claude", model="claude-opus-5-5", effort="high")
        self.start(env={"HERDR_ENV": "1"})
        args = [c for c in self.h.calls if c[0] == "agent_start"][0][3]
        saved = KS.saved_session(self.ws)
        self.assertEqual(args[:2], ["--session-id", saved["session_id"]])
        self.assertEqual((saved["kind"], saved["agent"]), ("claude", "orch-repo"))

    def test_continue_restarts_in_the_same_chat_with_new_settings(self):
        self.set_orch(kind="claude", model="claude-opus-5-5", effort="high")
        self.h.live["orch-repo"], self.h.sessions["orch-repo"] = "idle", "chat-1"
        self.set_orch(kind="claude", model="claude-fable-5-1", effort="max")  # agent-kit config
        rc, _, _ = self.start("--continue", env={"HERDR_ENV": "1"})
        self.assertEqual(rc, 0)
        self.assertIn(("workspace_close", "wX"), self.h.calls)
        args = [c for c in self.h.calls if c[0] == "agent_start"][0][3]
        self.assertEqual(args, ["--resume", "chat-1", "--model", "claude-fable-5-1", "--effort", "max"])
        self.assertEqual(KS.saved_session(self.ws)["session_id"], "chat-1")

    def test_continue_refuses_a_busy_orchestrator_unless_forced(self):
        self.set_orch(kind="claude", model="claude-opus-5-5")
        self.h.live["orch-repo"], self.h.sessions["orch-repo"] = "working", "chat-1"
        with mock.patch("sys.stderr"):
            rc, _, _ = self.start("--continue", env={"HERDR_ENV": "1"})
        self.assertEqual(rc, 1)
        self.assertFalse([c for c in self.h.calls if c[0] in ("workspace_close", "agent_start")])
        rc, _, _ = self.start("--continue", "--force", env={"HERDR_ENV": "1"})
        self.assertEqual(rc, 0)
        self.assertEqual([c for c in self.h.calls if c[0] == "agent_start"][0][3][:2], ["--resume", "chat-1"])

    def test_continue_uses_the_saved_chat_or_starts_new(self):
        self.set_orch(kind="codex", model="gpt-6-sol", effort="high")
        self.start("--continue", env={"HERDR_ENV": "1"})  # nothing saved, nothing running: a new chat
        first = [c for c in self.h.calls if c[0] == "agent_start"][-1][3]
        self.assertNotIn("resume", first)
        self.h.live.clear()
        KS.save_session(self.ws, "codex", "chat-9", "orch-repo")
        self.start("--continue", env={"HERDR_ENV": "1"})
        args = [c for c in self.h.calls if c[0] == "agent_start"][-1][3]
        self.assertEqual(args[:4], ["resume", "chat-9", "-m", "gpt-6-sol"])
        self.assertEqual(len([c for c in self.h.calls if c[0] == "agent_prompt"]), 1)  # no bootstrap on resume
        self.h.live.clear()
        self.start("--continue", "--session", "chat-7", env={"HERDR_ENV": "1"})
        self.assertEqual([c for c in self.h.calls if c[0] == "agent_start"][-1][3][:2], ["resume", "chat-7"])

    def test_config_saves_the_running_chat_id(self):
        self.h.live["orch-repo"], self.h.sessions["orch-repo"] = "idle", "chat-3"
        with mock.patch("builtins.print"):
            self.assertEqual(K.main(["--workspace", str(self.ws), "--num-worker", "4", "--no-input"], herdr=self.h), 0)
        self.assertEqual(KS.saved_session(self.ws)["session_id"], "chat-3")

    def test_hook_records_the_active_chat(self):
        hook = self.ws / ".agent-system" / "scripts" / "record-session.py"
        hook.parent.mkdir(parents=True, exist_ok=True)
        hook.write_text((Path(KS.__file__).parent / "scripts" / "record-session.py").read_text())
        run = lambda ev: subprocess.run([sys.executable, str(hook)], input=json.dumps(ev), text=True,
                                        capture_output=True)
        self.assertEqual(run({"session_id": "w1", "cwd": str(self.ws / "worktrees" / "worker-1"),
                              "hook_event_name": "SessionStart"}).returncode, 0)
        self.assertEqual(KS.saved_session(self.ws), {})  # not the workspace: ignored
        run({"session_id": "c1", "cwd": str(self.ws), "hook_event_name": "SessionStart",
             "transcript_path": "/x/projects/elsewhere/c1.jsonl"})
        run({"session_id": "c2", "cwd": str(self.ws), "hook_event_name": "UserPromptSubmit"})  # e.g. after /resume
        self.assertEqual((KS.saved_session(self.ws)["session_id"], KS.saved_session(self.ws)["kind"]), ("c2", "claude"))
        self.assertEqual(run("not json").returncode, 0)  # never blocks Claude
        KS.save_session(self.ws, "claude", "c1", "orch-repo")
        f = KS.session_file(self.ws)
        f.write_text(json.dumps({**json.loads(f.read_text()), "transcript": "/x/projects/elsewhere/c1.jsonl"}))
        sid, note = KS.stop_for_continue(KS.plan(self.ws, self.cfg), self.h, None, False)
        self.assertEqual(sid, "c1")
        self.assertIn("started in another folder", note)

    def test_missing_program_and_dry_run(self):
        self.set_orch(kind="grok", model="grok-4")
        with mock.patch.object(KS.shutil, "which", return_value=None), mock.patch("sys.stderr"), \
                mock.patch("builtins.print"):
            self.assertEqual(KS.main(["--workspace", str(self.ws)], herdr=self.h, env={}), 1)
        rc, execs, _ = self.start("--dry-run")
        self.assertEqual((rc, execs), (0, []))
        self.assertFalse([c for c in self.h.calls if c[0] in ("workspace_create", "agent_start")])

    def test_connector_starts_only_when_hub_enabled(self):
        rc, _, popens = self.start(env={"HERDR_ENV": "1"})
        self.assertEqual(rc, 0)
        self.assertEqual(popens, [])
        self.cfg["hub"] = {"enabled": True, "url": "http://127.0.0.1:7420"}
        (self.ws / ".agent-system" / "config.json").write_text(json.dumps(self.cfg))
        rc, _, popens = self.start(env={"HERDR_ENV": "1"})
        self.assertEqual(rc, 0)
        self.assertEqual(len(popens), 1)
        self.assertEqual(popens[0][0][1:], [str(Path(KS.__file__).with_name("agentctl.py")), "watch"])

    def test_connector_start_is_detached_with_workspace_cwd_and_log(self):
        self.cfg["hub"] = {"enabled": True}
        calls = []
        with mock.patch.object(KS.subprocess, "Popen",
                               side_effect=lambda *args, **kwargs: calls.append((args, kwargs))), \
                mock.patch("builtins.print"):
            KS.start_connector(self.ws, self.cfg)
        args, kwargs = calls[0]
        self.assertTrue(kwargs["start_new_session"])
        self.assertEqual(kwargs["cwd"], str(self.ws))
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertIs(kwargs["stdout"], kwargs["stderr"])


class TestInstall(Base):
    """scripts/install.sh (agent-kit) run for real against temp repos."""
    INSTALL = Path(__file__).resolve().parents[1] / "scripts" / "install.sh"
    KIT = Path(__file__).resolve().parents[2]

    def setUp(self):
        super().setUp()
        sh(self.repo, "rm", "-rf", "packets")
        self.ws = Path(self.tmp.name) / "repo.workspace"

    def kit(self, *args, cwd=None, ok=True, input=None):
        p = subprocess.run(["bash", str(self.INSTALL), *args], cwd=cwd or self.tmp.name,
                           capture_output=True, text=True,
                           **({"input": input} if input is not None else {"stdin": subprocess.DEVNULL}))
        if ok:
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        else:
            self.assertNotEqual(p.returncode, 0, p.stdout)
        return p

    def repo_status(self):
        return sh(self.repo, "git", "status", "--porcelain", "--untracked-files=all")

    def assert_workspace(self):
        ws = self.ws
        self.assertEqual(os.readlink(ws / "repo"), "../repo")
        for d in ("gen-tasks", "worktrees", "notes", ".claude/agents"):
            self.assertTrue((ws / d).is_dir(), d)
        self.assertEqual((ws / ".agent-system" / "scheduler.py").read_bytes(),
                         (self.KIT / ".agent-system" / "scheduler.py").read_bytes())
        self.assertEqual(list(ws.rglob("__pycache__")), [])
        cfg = json.loads((ws / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["project"], {"path": "repo"})
        self.assertEqual(cfg["pool"]["worktree_root"], "worktrees")
        perms = json.loads((ws / ".claude" / "settings.json").read_text())["permissions"]
        self.assertEqual(perms["additionalDirectories"], [str(self.repo.resolve())])
        self.assertIn("Edit(.orchestrator/**/state.json)", perms["deny"])
        self.assertFalse([r for r in perms["deny"] if "decide" in r or "decision answer" in r])
        self.assertFalse([r for r in perms["deny"] if r.startswith("Write(")])  # ignored by Claude Code
        claude = (ws / "CLAUDE.md").read_text()
        self.assertTrue(claude.startswith("# repo\n"))
        self.assertEqual(claude.count("<!-- agent-system:orchestrator:begin -->"), 1)
        agents = (ws / "AGENTS.md").read_text()
        self.assertTrue(agents.startswith("# repo\n"))
        self.assertEqual(agents.count("<!-- agent-system:orchestrator:begin -->"), 1)
        self.assertNotIn("agent-system:worker:begin", agents)
        self.assertTrue((ws / ".agent-system" / "WORKER-RULES.md").is_file())
        self.assertTrue((ws / ".claude" / "agents" / "scout.md").is_file())
        s = S.Scheduler(ws, herdr=self.herdr)  # loads the written config from disk
        self.assertEqual(s.project_root, self.repo.resolve())
        self.assertEqual(self.repo_status(), "")

    def test_create_from_parent_with_folder(self):
        self.kit("create", "--folder=repo")  # names the repo; repo.workspace does not exist yet
        self.assert_workspace()
        self.assertIn("Project notes: see the top of CLAUDE.md", (self.ws / "AGENTS.md").read_text())

    def test_create_inside_repo_without_folder(self):
        self.kit("create", cwd=self.repo)
        self.assert_workspace()

    def test_create_given_workspace_name(self):
        self.ws.mkdir()
        self.kit("create", cwd=self.ws)  # a *.workspace folder is taken as the workspace itself
        self.assert_workspace()

    def test_create_offers_to_create_the_git_repo(self):
        plain = Path(self.tmp.name) / "plain"
        plain.mkdir()
        (plain / "a.txt").write_text("hello\n")
        ws = Path(self.tmp.name) / "plain.workspace"
        out = self.kit("create", "--folder=plain", "--dry-run").stdout  # dry run: asks nothing, changes nothing
        self.assertIn("is not a Git repository", out)
        self.assertIn("[dry-run] would ask", out)
        self.assertFalse((plain / ".git").exists())
        for answer in ("n\n", None):  # "no", or no answer at all: abort, nothing created
            err = self.kit("create", "--folder=plain", input=answer, ok=False).stderr
            self.assertIn("aborted", err)
            self.assertIn("--init-git", err)
            self.assertFalse((plain / ".git").exists())
            self.assertFalse(ws.exists())
        out = self.kit("create", "--folder=plain", input="y\n").stdout
        self.assertIn("git init && git add -A", out)
        self.assertIn("created the Git repository", out)
        self.assertEqual(sh(plain, "git", "ls-files"), "a.txt")
        self.assertEqual(sh(plain, "git", "rev-list", "--count", "HEAD"), "1")
        self.assertEqual(sh(plain, "git", "status", "--porcelain"), "")
        self.assertEqual(os.readlink(ws / "plain"), "../plain")
        self.assertTrue((ws / ".agent-system" / "config.json").is_file())

    def test_create_init_git_flag_and_repo_without_commits(self):
        empty = Path(self.tmp.name) / "empty"
        empty.mkdir()
        sh(empty, "git", "init", "-q")
        out = self.kit("create", "--folder=empty", "--init-git").stdout  # no question asked
        self.assertIn("no commits yet", out)
        self.assertNotIn("git init &&", out)
        self.assertEqual(sh(empty, "git", "rev-list", "--count", "HEAD"), "1")
        self.assertTrue((Path(self.tmp.name) / "empty.workspace" / ".agent-system").is_dir())
        before = sh(self.repo, "git", "rev-list", "--count", "HEAD")
        self.kit("create", "--folder=repo", "--init-git")  # a repo with commits: just proceeds
        self.assertEqual(sh(self.repo, "git", "rev-list", "--count", "HEAD"), before)
        self.assertIn("only applies to create", self.kit("update", "--init-git", ok=False).stderr)

    def test_version(self):
        out = self.kit("--version").stdout
        self.assertRegex(out, r"^agent-kit \S+ \(Git checkout: ")
        kit_v = out.split()[1]
        self.kit("create", "--folder=repo")
        self.assertEqual((self.ws / ".agent-system" / "VERSION").read_text().strip(), kit_v)
        self.assertIn("(up to date)", self.kit("--version", "--folder=repo").stdout)
        (self.ws / ".agent-system" / "VERSION").write_text("0.0.1\n")
        out = self.kit("-V", cwd=self.ws).stdout
        self.assertIn("workspace " + str(self.ws.resolve()) + ": 0.0.1", out)
        self.assertIn("agent-kit update", out)
        self.kit("update", "--folder=repo")
        self.assertIn("(up to date)", self.kit("--version", cwd=self.ws).stdout)
        pkg = Path(self.tmp.name) / "pkg"  # an installed package: no .git, VERSION written at build time
        pkg.mkdir()
        sh(self.KIT, "cp", "-r", str(self.KIT / ".agent-system"), str(self.KIT / ".claude"), str(pkg))
        (pkg / ".agent-system" / "VERSION").write_text("9.9.9\n")
        p = subprocess.run(["bash", str(pkg / ".agent-system" / "scripts" / "install.sh"), "--version"],
                           cwd=self.tmp.name, capture_output=True, text=True, stdin=subprocess.DEVNULL)
        self.assertTrue(p.stdout.startswith("agent-kit 9.9.9 (package: "), p.stdout + p.stderr)

    def test_create_refusals(self):
        other = Path(self.tmp.name) / "repo-tools"
        other.mkdir()
        self.assertIn("not a Git repository", self.kit("create", cwd=other, ok=False).stderr)
        self.assertIn("does not exist", self.kit("create", "--folder=nope", ok=False).stderr)
        (self.repo / "sub").mkdir()
        self.assertIn("top folder", self.kit("create", cwd=self.repo / "sub", ok=False).stderr)
        self.assertFalse((self.repo / "sub.workspace").exists())
        (self.repo / "sub").rmdir()
        self.kit("create", "--folder", "repo")
        self.assertIn("agent-kit update", self.kit("create", "--folder=repo", ok=False).stderr)
        self.assertIn("agent-kit create", self.kit("update", "--folder=" + str(other), ok=False).stderr)
        self.assertFalse((Path(self.tmp.name) / "repo-tools.workspace").exists())
        self.assertEqual(self.repo_status(), "")

    def test_update_keeps_config_and_notes(self):
        self.kit("create", "--folder=repo")
        cfg_path = self.ws / ".agent-system" / "config.json"
        cfg = json.loads(cfg_path.read_text())
        cfg["gate"]["verify_cmd"] = ["make", "check"]
        cfg_path.write_text(json.dumps(cfg))
        claude = self.ws / "CLAUDE.md"
        claude.write_text(claude.read_text().replace("- Stack: TODO", "- Stack: Java 21"))
        (self.ws / ".agent-system" / "scheduler.py").write_text("# stale\n")
        settings = self.ws / ".claude" / "settings.json"
        old = json.loads(settings.read_text())
        old["permissions"]["deny"] += ["Write(.orchestrator/**/state.json)", "Bash(.agent-system/scripts/decide)",
                                       "Bash(python3 .agent-system/scheduler.py decision answer:*)", "Bash(rm:*)"]
        settings.write_text(json.dumps(old))
        (self.ws / ".agent-system" / "scripts" / "decide").write_text("#!/bin/sh\n")
        (self.ws / "AGENTS.md").write_text("# repo\n\nmy own note\n\n<!-- agent-system:worker:begin -->\nold worker "
                                             "rules\n<!-- agent-system:worker:end -->\n")
        self.kit("update", cwd=self.ws)  # from inside the workspace
        deny = json.loads(settings.read_text())["permissions"]["deny"]
        self.assertIn("Bash(rm:*)", deny)  # the user's own rules stay
        self.assertFalse((self.ws / ".agent-system" / "scripts" / "decide").exists())
        agents = (self.ws / "AGENTS.md").read_text()  # migrated: worker block gone, orchestrator rules in
        self.assertIn("my own note", agents)
        self.assertNotIn("old worker rules", agents)
        self.assertIn("<!-- agent-system:orchestrator:begin -->", agents)
        self.assert_workspace()
        self.kit("update", "--folder=repo")  # from the parent, naming the repo
        self.assert_workspace()
        self.assertEqual(json.loads(cfg_path.read_text())["gate"]["verify_cmd"], ["make", "check"])
        self.assertIn("- Stack: Java 21", claude.read_text())

    def test_detects_stack(self):
        (self.repo / "build.gradle").write_text("plugins { id 'java' }\n")
        sh(self.repo, "git", "add", "-A")
        sh(self.repo, "git", "commit", "-q", "-m", "gradle")
        self.kit("create", "--folder=repo")
        cfg = json.loads((self.ws / ".agent-system" / "config.json").read_text())
        self.assertEqual(cfg["worker"]["writable_dirs"], ["~/.gradle"])
        self.assertIn("`./gradlew build`", (self.ws / "CLAUDE.md").read_text())

    def make_repo(self, name, files):
        repo = Path(self.tmp.name) / name
        repo.mkdir()
        for rel, text in files.items():
            (repo / rel).write_text(text)
        sh(repo, "git", "init", "-q", "-b", "main")
        sh(repo, "git", "add", "-A")
        sh(repo, "git", "commit", "-q", "-m", "base")
        return repo

    def test_detects_python_and_cpp(self):
        cases = {  # repo files -> (Stack line, Build line fragment, writable_dirs)
            "py": ({"requirements-dev.txt": "ruff\n"}, "Python", "`python3 -m pytest`", []),
            "cmake": ({"CMakeLists.txt": "project(x)\n", "main.cpp": "int main(){}\n"}, "C/C++ (CMake)",
                      "`cmake -S . -B build", []),
            "cmake-conan": ({"CMakeLists.txt": "project(x)\n", "conanfile.txt": "", "a.cc": ""},
                            "C/C++ (CMake), C/C++ (Conan)", "ctest --test-dir build`", ["~/.conan2"]),
            "make-c": ({"Makefile": "all:\n\ttrue\n", "main.c": "int main(){}\n"}, "C/C++ (make)",
                       "`make && make test`", []),
            "make-only": ({"Makefile": "all:\n\ttrue\n", "README.md": "x\n"}, "TODO", "TODO", []),
        }
        for name, (files, stack, build, dirs) in cases.items():
            with self.subTest(name):
                self.make_repo(name, files)
                self.kit("create", f"--folder={name}")
                ws = Path(self.tmp.name) / f"{name}.workspace"
                claude = (ws / "CLAUDE.md").read_text()
                self.assertIn(f"- Stack: {stack}\n", claude)
                self.assertIn(build, claude)
                cfg = json.loads((ws / ".agent-system" / "config.json").read_text())
                self.assertEqual(cfg["worker"]["writable_dirs"], dirs)

    def verify(self, repo):
        p = subprocess.run(["bash", str(self.INSTALL.parent / "verify.sh"), "--dir", str(repo)],
                           capture_output=True, text=True)
        return p.returncode, p.stdout

    def test_verify_python_and_make(self):
        rc, out = self.verify(self.make_repo("py", {"requirements.txt": "", "test_x.py": "def test_x():\n    pass\n"}))
        self.assertEqual(rc, 0, out)
        try:
            import pytest  # noqa: F401
            self.assertIn("PASS  pytest", out)
        except ImportError:
            self.assertIn("SKIP  pytest - Python project but pytest is not installed", out)
        rc, out = self.verify(self.make_repo("cc", {"main.c": "int main(void){return 0;}\n",
                                                    "Makefile": "all:\n\t@echo built\ntest:\n\t@echo tested\n"}))
        self.assertEqual(rc, 0, out)
        self.assertIn("PASS  make\n", out)
        self.assertIn("PASS  make test", out)
        rc, out = self.verify(self.make_repo("cc-bad", {"main.c": "", "Makefile": "all:\n\t@exit 3\n"}))
        self.assertNotEqual(rc, 0, out)
        self.assertNotIn("make test", out)  # stops after a failed build
        rc, out = self.verify(self.make_repo("mk", {"Makefile": "all:\n\t@exit 3\n"}))
        self.assertEqual(rc, 0, out)  # no C/C++ sources: the Makefile is not run
        self.assertNotIn("----- make", out)

    def test_config_command_and_create_flags(self):
        self.kit("create", "--folder=repo", "--model-worker=gpt-x-sol", "--effort-worker=low")
        cfg_path = self.ws / ".agent-system" / "config.json"
        self.assertEqual(json.loads(cfg_path.read_text())["worker"]["model"], "gpt-x-sol")
        settings = self.ws / ".claude" / "settings.json"
        self.assertEqual(json.loads(settings.read_text())["model"], "claude-opus-5-5")
        out = self.kit("config", "--model-orchestrator=sonnet", "--effort-orchestrator=max", cwd=self.ws).stdout
        self.assertIn("launches claude claude-sonnet-5-5, effort max", out)
        self.assertEqual(json.loads(settings.read_text())["model"], "claude-sonnet-5-5")
        bad = self.kit("config", "--model-worker=gpt-7", cwd=self.ws, ok=False)
        self.assertEqual(bad.returncode, 2)
        self.assertIn("unknown model 'gpt-7'", bad.stderr)
        self.assertIn("gpt-x-sol", bad.stderr)  # the table to choose from
        self.assertIn("does not support effort", self.kit("config", "--effort-worker=xhigh", cwd=self.ws, ok=False).stderr)
        self.assertIn("Claude Code subagent", self.kit("config", "--model-scout=gpt-x-sol", cwd=self.ws, ok=False).stderr)
        out = self.kit("config", "--folder=repo", "--model-worker=grok/grok-4").stdout
        self.assertIn("UNVERIFIED", out)
        self.assertIn("worker.launch_args", out)
        self.kit("config", "--model-scout=haiku", cwd=self.ws)
        self.kit("update", cwd=self.ws)  # keeps the chosen scout model in the refreshed scout.md
        scout = (self.ws / ".claude" / "agents" / "scout.md").read_text()
        self.assertIn("model: claude-haiku-5-5", scout)
        self.assertIn("effort: medium", scout)  # changing only the model keeps a supported effort
        self.assertNotIn("kept existing", self.kit("update", cwd=self.ws).stdout)
        self.assertIn("worker        grok", self.kit("config", "--show", cwd=self.ws).stdout)
        self.assertEqual(self.repo_status(), "")

    def test_dry_run_writes_nothing(self):
        out = self.kit("create", "--folder=repo", "--dry-run").stdout
        self.assertIn("[dry-run]", out)
        self.assertFalse(self.ws.exists())

    def test_legacy_in_repo_mode_keeps_worktrees_outside(self):
        self.kit(str(self.repo))
        cfg = json.loads((self.repo / ".agent-system" / "config.json").read_text())
        self.assertNotIn("project", cfg)
        self.assertEqual(cfg["pool"]["worktree_root"], "../{repo_name}.agent-worktrees")
        self.assertFalse(S.Scheduler(self.repo, herdr=self.herdr).workspace_mode)


if __name__ == "__main__":
    unittest.main()
