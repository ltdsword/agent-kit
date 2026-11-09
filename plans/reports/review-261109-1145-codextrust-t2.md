# Review codextrust T2 (docs) - PASS
- Template: approval/worker_approval steps name `hc read`/`hc send`/`hc keys` first, legacy herdr CLI only for `herdr.backend: legacy`; never `hc send --force`. New line: read a non-reporting worker's screen before relaunch; never relaunch a live agent; old CLI "server not running" says nothing about the app.
- GUIDE.md 154, 323 switched likewise.
- Syntax checked against `hc --help`: `read [--lines N] <t>`, `send <t> <text>`, `keys <t> <keys...>`.
- In scope (2 owned files). No issues.
