# Review: hub3 T3, kit v2 + agent-kit commands (`.agent-system`)

Verdict: **PASS**

## Checked
- `python3 -m unittest discover -s .agent-system/tests`: 130 tests OK, re-run by the lead.
- `hubctl.py`:
  - **Admin key:** refused if it is group- or world-readable (`mode & 0o077`). A missing key gives the "run this on the admin computer" message.
  - **Network:** loopback requests skip the proxy (`ProxyHandler({})`); everything else uses the system proxy and CA. Error messages don't include response bodies.
  - **Passwords:** `create-user` / `reset-password` print the password once.
  - **`hub-login`:** asks for the password with `getpass` and validates both the register request and the response with `hubschema`. It writes `computer.json` atomically with mode 0600 in a 0700 directory. The saved keys are a superset of the ones the backend's `loadComputerConfig` requires (`proxy_url`, `computer_id`, `computer_key`, `proxy_public_key`, `username`).
  - **`hub start`:** uses Node 24, falling back to nvm, with a clear error if neither is available. It sets `NODE_USE_SYSTEM_CA=1`, runs the server detached, and writes a 0600 pidfile. `stop` sends SIGTERM.
  - **`proxy-setup`:** removes the proxy environment variables before running npm.
- `install.sh` routes the new commands to `hubctl`.
- Deny rule `Read(~/.config/.wrangler/**)` is added.

## Notes
- The real Node 24 start and the real proxy setup weren't run; that's covered in P4 (end-to-end).
