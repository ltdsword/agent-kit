# hub8: website detects a dead live stream

Found in the phone test (29/10/26 17:13). Starts after hub7 merges (builds on hub7 T3's
`HttpHubClient.ts`). Contract `docs/hub-api.md` (v2) unchanged.

## User decision (verbatim)
- hub7 D4: "A (Add it as hub8 after hub7)".
- Observed by the user: "also wait for 5 mins but nothing happens. Unti i refresh, the decision appears."
- hub7 D5: "A (Add it to hub8)": retry panels that failed to load.
- Observed by the user (17:48): "no decision, no history, no document. But the state of agent still corrrect"
  (page loaded during the 17:45:55 relay drop; detail loaded, the list requests failed).

## Observed
- The backend writes `: keepalive` on `/api/v1/stream` every 20 s (`hub/server/src/user-api.ts`).
- `HttpHubClient.streamLoop` never checks for silence. A stream that dies without an error (phone
  sleeps or changes network, a relay path that stops passing chunks) leaves the page "Live" forever;
  `streamDown` is never set, so the 10 s poll fallback never starts.
- No `visibilitychange` / `online` handling.

## T1 web: stream watchdog and load retry (`hub/web/src/api/http/HttpHubClient.ts`, `hub/web/src/api/http/HttpHubClient.test.ts`)
1. **Silence watchdog**: in `streamLoop`, reset a timer on every chunk read (comments included).
   If no bytes arrive for 45 s, abort that fetch (per-attempt `AbortController` linked to the loop's
   signal) and treat it as a failure: `streamDown` add, start the 10 s poll, reconnect with the normal
   backoff (hub7: 1 s doubling, cap 5 s). The catch-up refetch from hub7 then runs on reconnect.
   Keep the 45 s in one named constant.
2. **Page visible / back online**: on `document.visibilitychange` to `visible` and on `window`
   `online`, restart every stream (abort current attempts, reconnect immediately, no backoff) and
   refetch all workspaces once. Register in the constructor, remove in `dispose()`. Guard for
   environments without `document`/`window`.
3. **Retry panels that failed to load**: in `refreshWorkspaceAll`, run decisions / commands /
   documents / history independently (`Promise.allSettled`); for each one that fails (other than
   `unauthorized`), remember it per workspace and retry just that resource every 5 s until it
   succeeds (one timer per workspace+resource, cleared on success, on `dispose()` and when the
   workspace's computer goes offline). While any such retry is pending, report the connection as
   `lost` (the existing "Hub connection lost … showing what we had" banner), so an empty panel is
   never presented as "nothing here"; back to `live` when all retries have succeeded and no stream
   is down.
4. Tests (fake timers + fake fetch, like hub7's test):
   - a stream that sends one chunk then stays silent is aborted after 45 s and a new stream attempt
     follows; a stream that keeps sending a chunk every 20 s is not aborted;
   - dispatching `visibilitychange` (visible) causes a new stream attempt and a decisions refetch;
   - `dispose()` removes the listeners (no new attempts after dispose + event);
   - decisions request fails once, then succeeds → decisions appear after the 5 s retry without
     any stream event; documents still loaded on the first try are not refetched by that retry.
