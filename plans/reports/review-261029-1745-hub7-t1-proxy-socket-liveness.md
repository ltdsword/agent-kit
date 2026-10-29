# Review hub7 T1: proxy socket liveness: PASS (with orchestrator fix)

- Diff: `hub/proxy/src/computer-relay.ts` (+50/-?), `hub/proxy/test/proxy.test.ts` (+156). Scope OK.
- `liveSocket()` = OPEN and heard from within 75 s (lastSeenAt in socket attachment, set on accept and
  every message); used for routing, `isOnline()`, cancel. Stale sockets closed 4001.
- Long-poll `hello` closes all WebSockets (4000 "replaced"). Pending requests remember their socket;
  `webSocketClose(socket)` fails only that socket's requests. Optional clock in the constructor.
- Orchestrator fix: when the proxy closes a socket itself (stale or replaced), it now calls
  `webSocketClose(socket)` right away, since a self-initiated close may not fire the handler and those
  requests would wait for the relay timeout.
- Worker's temporary `relay_socket_debug` log was removed before the report (checked).
- Verified: proxy vitest 17/17, tsc clean. `hub/node_modules` symlink (orchestrator's) removed before commit.
- Unresolved: Cloudflare hibernation behaviour of attachments verified only by unit test, not live.
