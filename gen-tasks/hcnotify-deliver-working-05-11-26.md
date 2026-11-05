# hcnotify: deliver hub notices to a working orchestrator in the Herdr app (05/11/26)

## Goal
When the person answers a decision or sends a prompt from the phone/website, the connector types it into
the orchestrator's terminal even while the orchestrator is working (hc backend), so the orchestrator never
has to remember to watch for answers. Old herdr keeps today's behaviour.

## Facts (Opus, verified 05/11/26)
- User decision 05/11/26: "ok approve" (T4: deterministic notice delivery instead of the model remembering).
- `hc send <t> <text>` into a terminal whose agent status is `working` succeeds (exit 0, stdout
  `{"started":true,"status":"working","turn":23}`); Claude Code queues it and shows it as the next user
  message. `hc send` refuses while `blocked` (never use `--force`).
- Today `_type_hub_notice`, `_deliver_command` and `_retry_hub_commands` in `.agent-system/agentctl.py` only
  deliver when the state is in `READY_STATES` (idle/done) and otherwise HOLD; answer notices are dropped after
  `HUB_DELIVERY_TIMEOUT` (10 min). Logs: "answer notice dropped after 10 minutes" seen repeatedly.
- `S.Hc.agent_prompt` refuses non-ready states, so it cannot be used for a working target.

## Read first
- `.agent-system/agentctl.py`: `READY_STATES`, `_type_hub_notice` (~1206), `_deliver_command` (~1297),
  `_retry_hub_notices`, `_retry_hub_commands` (~1395), `_backends`, `_herdr_record_for_workspace`.
- `.agent-system/scheduler.py`: `class Hc` (`binary`, `runner`, `_run`, `agent_prompt`) - read only.
- `.agent-system/tests/test_agentctl.py`: `fake_connectors` and the hc prompt tests.

## Steps
1. In agentctl.py add `_deliverable(state, backend) -> bool`: True when `state in READY_STATES`, or when
   `getattr(backend, "backend", None) == "hc"` and `state == "working"`.
2. Add `_send_notice(backend, target, state, text, cfg)`: if the state is in READY_STATES -> existing
   `backend.agent_prompt(target, text, cfg["herdr"]["prompt_ack_timeout_ms"])`; else (hc + working) ->
   run `[backend.binary, "send", target, text]` with `backend.runner` (capture_output, text, shell=False,
   timeout=5); non-zero exit or no process -> raise `S.SchedulerError("hc send failed: ...")`. Never `--force`.
3. Use them in all three places: `_type_hub_notice`, `_deliver_command` (prompt path) and
   `_retry_hub_commands`: replace `state not in READY_STATES` by `not _deliverable(state, backend)` and the
   delivery call by `_send_notice(...)`. HELD/retry/ack/log behaviour, texts and timeouts otherwise unchanged
   (blocked/absent/unknown still hold and expire as today).
4. Tests (fakes only) in test_agentctl.py:
   - hc orchestrator working + answer command -> one `hc send <target> <notice>` call, no HELD ack, no retry.
   - hc orchestrator working + phone prompt -> delivered (`hc send`), ack DELIVERED.
   - hc orchestrator blocked -> HELD as today, no send.
   - legacy orchestrator working -> HELD as today (unchanged).
   - hc send exit 1 while working -> answer notice goes to the retry list; prompt acks FAILED as today.

## Boundaries
**You may edit:** `.agent-system/agentctl.py`, `.agent-system/tests/test_agentctl.py`.
**You must not edit:** scheduler.py, kitstart.py, hubctl.py, hub protocol, hub/**, docs, plans/**,
gen-tasks/**, .orchestrator/**.
**You may run:** `python3 -m pytest`, read-only git, `git add`/`git commit` on your branch.
**You must not run:** `hc`, `herdr*`, `agentctl.py watch`, the hub backend; git push/merge/rebase/reset/
checkout; installs.
**When to ask:** only a real blocker -> report "blocked" with the reason.

## Do not
- Use `hc send --force`; deliver to a blocked agent; change the hub protocol or ack semantics; print secrets.

## Done when
- [ ] Working hc orchestrators receive notices and prompts; legacy unchanged; tests pass; whole suite green.

## Run these
- `python3 -m pytest -q .agent-system/tests`: expect all passed.

---
<!-- Do not edit above this line after dispatch. scheduler.py appends: Worker result, Review, Integration, Final gate. -->

## Worker result - attempt 1 (05/11/26 16:35)

- Status: **done** (worker worker-1, branch `agent/hcnotify-t1`)
- Commits: none, changes left uncommitted (orchestrator commits after review)
- Files: `.agent-system/agentctl.py`, `.agent-system/tests/test_agentctl.py`
- Scope: OK
- Tests reported:
  - `python3 -m pytest -q .agent-system/tests` -> exit 1
  - `python3 -m pytest -q .agent-system/tests` -> exit 0
- Risks:
  - Changes remain uncommitted because .git is read-only in the sandbox.
- Not done: none
- Full diff: `.orchestrator/runs/hcnotify/reports/T1.diff`

````text
 .agent-system/agentctl.py            |  30 ++++++++--
 .agent-system/tests/test_agentctl.py | 112 ++++++++++++++++++++++++++++++++++-
 2 files changed, 133 insertions(+), 9 deletions(-)
````

````diff
diff --git a/.agent-system/agentctl.py b/.agent-system/agentctl.py
index 1380f80..41ba904 100644
--- a/.agent-system/agentctl.py
+++ b/.agent-system/agentctl.py
@@ -1203,13 +1203,31 @@ def _short_reason(error) -> str:
     return (message or "command delivery failed")[:300]
 
 
+def _deliverable(state: str, backend) -> bool:
+    return state in READY_STATES or (getattr(backend, "backend", None) == "hc" and state == "working")
+
+
+def _send_notice(backend, target: str, state: str, text: str, cfg: dict) -> None:
+    if state in READY_STATES:
+        backend.agent_prompt(target, text, cfg["herdr"]["prompt_ack_timeout_ms"])
+        return
+    try:
+        process = backend.runner([backend.binary, "send", target, text], capture_output=True,
+                                 text=True, shell=False, timeout=5)
+    except (OSError, subprocess.TimeoutExpired) as error:
+        raise S.SchedulerError(f"hc send failed: {_short_reason(error)}") from error
+    if not process or process.returncode != 0:
+        detail = (process.stderr or process.stdout).strip() if process else "hc unavailable"
+        raise S.SchedulerError(f"hc send failed: {detail}")
+
+
 def _type_hub_notice(ws: Path, name: str, text: str, cfg: dict,
                      runner=subprocess.run) -> tuple[bool, str | None]:
     _, state, target, backend = _herdr_record_for_workspace(
         name, ws, cfg.get("orchestrator", {}).get("kind", "claude"), runner, _backends(ws, cfg, runner))
-    if state not in READY_STATES:
+    if not _deliverable(state, backend):
         return False, HUB_HELD_REASON
-    backend.agent_prompt(target, scrub(text), cfg["herdr"]["prompt_ack_timeout_ms"])
+    _send_notice(backend, target, state, scrub(text), cfg)
     return True, None
 
 
@@ -1346,7 +1364,7 @@ def _deliver_command(ws: Path, cfg: dict, name: str, runner, client: HubClient,
     except Exception as error:
         _ack_command(client, command_id, "FAILED", _short_reason(error))
         return
-    if state not in READY_STATES:
+    if not _deliverable(state, backend):
         log_action(ws, f"hub command {command_id} held: orchestrator {name} is {state}")
         command_retries[command_id] = _new_delivery_schedule(command_id, notice, clock(), command=command)
         _ack_command(client, command_id, "HELD", HUB_HELD_REASON)
@@ -1357,7 +1375,7 @@ def _deliver_command(ws: Path, cfg: dict, name: str, runner, client: HubClient,
         _ack_command(client, command_id, "FAILED", _short_reason(error))
         return
     try:
-        backend.agent_prompt(target, notice, cfg["herdr"]["prompt_ack_timeout_ms"])
+        _send_notice(backend, target, state, notice, cfg)
     except Exception as error:
         reason = _short_reason(error)
         try:
@@ -1413,13 +1431,13 @@ def _retry_hub_commands(ws: Path, name: str, cfg: dict, runner, client: HubClien
             _, state, target, backend = _herdr_record_for_workspace(
                 name, ws, cfg.get("orchestrator", {}).get("kind", "claude"), runner,
                 _backends(ws, cfg, runner))
-            if state not in READY_STATES:
+            if not _deliverable(state, backend):
                 log_action(ws, f"hub command {command_id} still held: orchestrator {name} is {state}")
                 _advance_delivery_schedule(item)
                 continue
             command = item["command"]
             _append_hub_log(ws, command, records)
-            backend.agent_prompt(target, item["notice"], cfg["herdr"]["prompt_ack_timeout_ms"])
+            _send_notice(backend, target, state, item["notice"], cfg)
         except Exception as error:
             reason = _short_reason(error)
             try:
diff --git a/.agent-system/tests/test_agentctl.py b/.agent-system/tests/test_agentctl.py
index 492cc7d..188de85 100644
--- a/.agent-system/tests/test_agentctl.py
+++ b/.agent-system/tests/test_agentctl.py
@@ -423,7 +423,7 @@ class AgentCtlTests(Base):
                          [["hc", "send", orch_name, "[hub] Please continue"]])
         self.assertEqual(client.acks, [("DELIVERED", None)])
 
-    def test_hc_prompt_while_working_is_held_without_send(self):
+    def test_hc_prompt_while_working_is_delivered_with_send(self):
         self.cfg["herdr"]["backend"] = "hc"
         orch_name = AC.kitstart.agent_name(S.project_root_for(self.ws, self.cfg).name)
         runner, calls = self.fake_connectors(hc_status="working", hc_name=orch_name)
@@ -437,8 +437,9 @@ class AgentCtlTests(Base):
                                run_id=None, decision_id=None)
         AC._deliver_command(self.ws, self.cfg, orch_name, runner, client, command, {}, [], {}, lambda: 0)
 
-        self.assertFalse(any(args[0] == "hc" and args[1] == "send" for args in calls))
-        self.assertEqual(client.acks, [("HELD", AC.HUB_HELD_REASON)])
+        self.assertEqual([args for args in calls if args[0] == "hc" and args[1] == "send"],
+                         [["hc", "send", orch_name, "[hub] Please continue"]])
+        self.assertEqual(client.acks, [("DELIVERED", None)])
 
     def test_missing_hc_agent_falls_back_to_legacy(self):
         self.cfg["herdr"]["backend"] = "auto"
@@ -903,6 +904,111 @@ class AgentCtlTests(Base):
         self.assertEqual(client.acks[-1], ("DELIVERED", None))
         self.assertNotIn(command["id"], commands)
 
+    def test_working_hc_delivers_answer_notice_without_retry(self):
+        class Client:
+            def __init__(self):
+                self.acks = []
+
+            def ack_command(self, command_id, status, reason=None):
+                self.acks.append((status, reason))
+
+        self.sample_run()
+        self.cfg["herdr"]["backend"] = "hc"
+        runner, calls = self.fake_connectors(hc_status="working")
+        client, records, notices, commands = Client(), {}, [], {}
+        command = self.command("cmd_hc_answer_000001", "answer", {"choice": "A"})
+
+        AC._deliver_command(self.ws, self.cfg, "orch-repo", runner, client, command,
+                            records, notices, commands, lambda: 0)
+
+        sends = [call for call in calls if call[:2] == ["hc", "send"]]
+        self.assertEqual(sends, [["hc", "send", "t2",
+                                  "[hub] D3 answered by alice: A (Allow). It is recorded; "
+                                  "carry it out with --decision D3."]])
+        self.assertEqual(client.acks, [("DELIVERED", None)])
+        self.assertEqual(notices, [])
+        self.assertEqual(commands, {})
+
+    def test_blocked_hc_prompt_stays_held(self):
+        class Client:
+            def __init__(self):
+                self.acks = []
+
+            def ack_command(self, command_id, status, reason=None):
+                self.acks.append((status, reason))
+
+        self.cfg["herdr"]["backend"] = "hc"
+        runner, calls = self.fake_connectors(hc_status="blocked")
+        client, commands = Client(), {}
+        command = self.command("cmd_hc_blocked_0001", "prompt", {"text": "Run the check"},
+                               run_id=None, decision_id=None)
+
+        AC._deliver_command(self.ws, self.cfg, "orch-repo", runner, client, command,
+                            {}, [], commands, lambda: 0)
+
+        self.assertFalse(any(call[:2] == ["hc", "send"] for call in calls))
+        self.assertEqual(client.acks, [("HELD", AC.HUB_HELD_REASON)])
+        self.assertIn(command["id"], commands)
+
+    def test_working_legacy_prompt_stays_held(self):
+        class Client:
+            def __init__(self):
+                self.acks = []
+
+            def ack_command(self, command_id, status, reason=None):
+                self.acks.append((status, reason))
+
+        self.cfg["herdr"]["backend"] = "legacy"
+        runner, calls = self.fake_connectors(hc_present=False, legacy_present=True,
+                                             legacy_status="working")
+        client, commands = Client(), {}
+        command = self.command("cmd_legacy_working_001", "prompt", {"text": "Run the check"},
+                               run_id=None, decision_id=None)
+
+        AC._deliver_command(self.ws, self.cfg, "orch-repo", runner, client, command,
+                            {}, [], commands, lambda: 0)
+
+        self.assertFalse(any(call[:2] == ["herdr", "agent", "prompt"] for call in calls))
+        self.assertEqual(client.acks, [("HELD", AC.HUB_HELD_REASON)])
+        self.assertIn(command["id"], commands)
+
+    def test_hc_send_failure_retries_answer_and_fails_phone_prompt(self):
+        class Client:
+            def __init__(self):
+                self.acks = []
+
+            def ack_command(self, command_id, status, reason=None):
+                self.acks.append((status, reason))
+
+        self.sample_run()
+        self.cfg["herdr"]["backend"] = "hc"
+        base_runner, calls = self.fake_connectors(hc_status="working")
+
+        def failed_send_runner(args, **kwargs):
+            args = list(args)
+            if args[:2] == ["hc", "send"]:
+                calls.append(args)
+                return subprocess.CompletedProcess(args, 1, "", "send failed")
+            return base_runner(args, **kwargs)
+
+        client, records, notices, commands = Client(), {}, [], {}
+        answer = self.command("cmd_hc_failed_answer_01", "answer", {"choice": "A"})
+        AC._deliver_command(self.ws, self.cfg, "orch-repo", failed_send_runner, client, answer,
+                            records, notices, commands, lambda: 0)
+        self.assertEqual(len(notices), 1)
+        self.assertEqual(notices[0]["notice"],
+                         "[hub] D3 answered by alice: A (Allow). It is recorded; "
+                         "carry it out with --decision D3.")
+
+        prompt = self.command("cmd_hc_failed_prompt_01", "prompt", {"text": "Run the check"},
+                              run_id=None, decision_id=None)
+        AC._deliver_command(self.ws, self.cfg, "orch-repo", failed_send_runner, client, prompt,
+                            records, notices, commands, lambda: 0)
+
+        self.assertEqual(client.acks, [("DELIVERED", None), ("FAILED", "hc send failed: send failed")])
+        self.assertEqual(records[prompt["id"]]["status"], "FAILED")
+        self.assertEqual(len([call for call in calls if call[:2] == ["hc", "send"]]), 2)
+
     def test_done_state_counts_as_ready_for_a_hub_prompt(self):
         # Herdr reports "done" for a finished turn nobody has looked at (the user is on the phone).
         class Client:
````

## Review round 1: PASS (05/11/26 16:37)

- Verdict: **PASS** -> task is now PASSED (fix rounds used: 0/2)
- Reviewed HEAD: f289d48a2efa, commits f289d48a2efa
- Notes: packet steps 1-4 met; 247 tests pass

# Review hcnotify T1 - connector delivers notices while working (Opus)

Verdict: PASS

- `_deliverable`: READY_STATES, or hc backend + `working`; blocked/absent/unknown still hold; legacy unchanged.
- `_send_notice`: ready -> `agent_prompt` as before; hc+working -> `hc send <target> <text>` (no `--force`),
  OSError/timeout/non-zero -> SchedulerError, so existing retry/FAILED paths apply.
- Used at all three hold points (`_type_hub_notice`, `_deliver_command`, `_retry_hub_commands`); scrub kept.
- Tests: the 5 packet cases; one old assertion (no send while working) updated to the new behaviour, as intended.
- Whole suite 247 passed (Opus rerun, Herdr env removed). Live check after integrate.

## Integration: merged (05/11/26 16:37)

- On `agent/integration-hcnotify` at 0c2a29fee955; `.agent-system/scripts/verify.sh --quick` passed (log `.orchestrator/runs/hcnotify/logs/post-merge-T1-a1.log`)

## Final gate: PASS (05/11/26 16:38)

- `.agent-system/scripts/verify.sh` exit 0 on agent/integration-hcnotify at 0c2a29fee955 (log `.orchestrator/runs/hcnotify/logs/verify-1793871425.log`)
- Task MERGED; run DONE

## Finished (05/11/26 16:40)

- merged into hub/plan (decision D1)
