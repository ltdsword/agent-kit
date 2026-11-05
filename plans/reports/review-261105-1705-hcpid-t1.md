# Review hcpid T1 - owned PID checks (Opus)

Verdict: PASS (one Opus fix before commit)

- `process_command` (/proc cmdline, `ps` fallback off Linux), `process_cwd`, `connector_alive(pid, ws)`,
  `backend_alive(pid)` (node + cli.ts + serve); unknown command -> old pid_alive behaviour.
- All PID sites switched: agentctl watch/status/stop, hubctl connector loop and backend start/stop/status,
  kitstart.start_connector (lazy `import agentctl`, avoids the import cycle).
- **Fixed (MINOR):** `str(ws) in command` matched a sibling folder (`<ws>-2`); now the workspace's own
  `.agent-system/agentctl.py` path or exact cwd. Test added.
- Worker report had a short base_sha (collect ambiguous); worker rewrote it with the full SHA on request.
- Whole suite 262 passed (Opus rerun, Herdr env removed). Live check after merge.
