# hub7: relay failover without lost requests

Found in the phone test (29/10/26 16:55). Contract `docs/hub-api.md` (v2) unchanged.

## User request (verbatim)
- "the decision appear corectly on the laptop but phone is not that case. It said that hub connection
  lost, until about 100 sec later it have the decision. ... Then open a new run and work on that"

## Observed
- Backend log: `16:55:30 relay websocket ended: relay websocket failed`, then long-poll-direct until
  `16:56:50 ... fetch failed`, then long-poll-proxy (stable since). The computer's direct path to
  Cloudflare drops every so often (ECONNRESET, websocket errors) on this network.
- The proxy Durable Object (`hub/proxy/src/computer-relay.ts`) routes every relay request to any
  WebSocket whose `readyState` is OPEN and only uses the long-poll queue when there is none. A new
  WebSocket closes old ones, but a long-poll session does not. When the backend's socket dies without
  a close reaching Cloudflare, the DO keeps sending requests into the dead socket until they time out
  (`relayTimeoutSeconds`), while the backend is already long-polling. The browser sees 504s / a
  failing stream → "Hub connection lost".
- `webSocketClose()` fails **all** pending requests, including ones queued for long-poll.
- The backend relay retries the same order every cycle, so it keeps going back to a transport that
  just dropped.
- The web stream reconnect backs off up to 30 s and does not refetch after reconnecting, so events
  missed while down only show at the next 10 s poll or later.

## T1 proxy: never route into a dead or replaced socket (`hub/proxy/src/computer-relay.ts`, `hub/proxy/test/proxy.test.ts`)
1. **Liveness per socket**: record the time of the last frame received on each WebSocket (use
   `socket.serializeAttachment({ lastSeenAt })` so it survives hibernation; set it on accept). The
   backend pings every 30 s (`LIMITS.heartbeatSeconds`). A socket is *live* only if OPEN and
   `lastSeenAt` is within 75 s. Add one helper `liveSocket()` used everywhere the code now does
   `getWebSockets().find(OPEN)` (request routing, `isOnline()`, the cancel path). A non-live OPEN
   socket found there is closed with code 4001 "stale".
2. **Long-poll supersedes**: when a `hello` frame arrives through `/frames` (long-poll session start),
   close every WebSocket with code 4000 "replaced", same as a new WebSocket does today.
3. **Per-socket failure**: track which socket each pending request was sent on (`pending.socket`;
   undefined for long-poll). `webSocketClose(socket)` / `webSocketError(socket)` fail only the
   pending requests sent on that socket.
4. Tests (vitest, existing helpers in `proxy.test.ts`):
   - a request is queued for long-poll (not sent to the socket) when the only socket has been silent
     > 75 s (inject the time: give `ComputerRelay` an optional clock or stub `Date.now`), and that
     socket gets closed;
   - a long-poll `hello` closes an open WebSocket and the next request goes to the poll queue;
   - closing socket A fails only A's pending request; a long-poll pending request survives.

## T2 backend relay: stop returning to a flapping transport (`hub/server/src/relay.ts`, `hub/server/test/server.test.ts`)
1. When a transport ends less than 5 min after it connected (or never connected), mark it
   *demoted until now + 15 min*. Building the order each cycle: transports not demoted first (keep
   the current preferred-first rule among them), demoted ones last. A transport that stays up ≥ 5 min
   clears its own demotion. Durations go through the injected clock (`this.clock`), not `Date.now`.
2. Log one line when a transport connects:
   `<iso> relay <transport> connected` (same style as the existing `ended` line).
3. Tests with `FakeProxy` and a controllable clock:
   - websocket accepted then closed immediately → next cycle tries long-poll first (assert order via
     `proxy.paths` / `websocketAttempts`), and websocket is tried again only after the 15 min window;
   - a transport that stayed up ≥ 5 min (advance the clock) is not demoted when it ends.

## T3 web: recover fast and catch up (`hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/HttpHubClient.test.ts`)
1. Stream reconnect backoff: 1 s, doubling, **cap 5 s** (was 30 s).
2. When a stream (re)connects after having been down (`streamDown` had the computer), refetch every
   workspace of that computer once (`refreshWorkspaceAll`), so events missed while down appear
   immediately.
3. Tests (extend `HttpHubClient.test.ts`, fake `fetch` like the existing test):
   - stream fails twice then succeeds → the third attempt happens within ~3 s total (use fake timers
     or measure), and a decisions refetch follows the successful reconnect.

## Order and integration
T1, T2, T3 are independent (disjoint files). After merge: deploy the proxy (T1) and the web (T3),
restart the backend (T2): **deploys need the user's OK** via a hub decision.
