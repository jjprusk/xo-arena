# Realtime migration postmortem

Socket.io was the original realtime spine for xo-arena. Multi-day pain with the redis-adapter, polling↔websocket upgrade flakes (especially on Safari Private), per-tab session id divergence, and an opaque "in-memory adapter fallback" boot path drove the move to **SSE+POST**. Phases 1–7 dual-emitted both transports behind feature flags; Phase 8 (this doc) deleted socket.io entirely.

## What changed

| Layer                     | Before                                                                  | After                                                                                          |
| ------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Server transport          | `socket.io` server attached to the same HTTP server, redis-adapter pub/sub for fan-out | `EventSource` GET `/api/v1/events/stream` + Redis Streams (`appendToStream`) for fan-out + `/rt/*` POST routes for client → server |
| Client transport          | `socket.io-client` singleton (polling in dev, polling+ws in prod)       | One `EventSource` per tab via `landing/src/lib/useEventStream.js` + `rtFetch` for POSTs        |
| Session identity          | `socket.id` (per-tab), reset on every reconnect                         | `sseSessionId` (per stream), echoed by every POST as `X-SSE-Session`                           |
| Presence                  | Per-`socket.id` watcher map in `socketHandler`                          | Per-`sseSessionId` watcher map in `tablePresence` + `tablePresenceService`                     |
| Disconnect detection      | `socket.disconnect` event → in-process timers                           | SSE stream close → 3 s debounce in `sseSessions` → `disconnectForfeitService` runs the forfeit / table-cancel logic |
| Idle warnings (per-socket)| 2-phase `_idleTimers` map + `idle:warning` socket emit                  | Retired. The `/rt/tables/:slug/idle/pong` route is a no-op ack so older clients don't 4xx; idle abandons are caught by the 24 h `tableGcService` sweep and by the SSE-dispose forfeit timer when the user actually leaves |

Lines deleted: ~2,500 across `backend/src/realtime/socketHandler.js` (rewritten as a slim helpers-only file), `backend/src/lib/notificationBus.js`, `landing/src/lib/socket.js`, `landing/src/lib/realtimeMode.js`, plus the per-feature `viaSse(...)` gates in components. Three npm deps removed (`socket.io`, `@socket.io/redis-adapter`, `socket.io-client`).

## What stayed

- Redis is still required — the SSE broker uses Redis Streams for cross-process fan-out, and the tournament service's pub/sub still rides the same Redis instance.
- The `notificationBus` registry, dedupe filter, push fan-out, and per-user preference logic are unchanged. Only the legacy `_io.to(...).emit(...)` shim was removed.
- The `botGameRunner` in-memory state machine is unchanged; only its emit path now goes through `appendToStream` instead of `_io.to().emit()`.

## Why it took eight phases

The migration plan (`doc/Realtime_Migration_Plan.md`) deliberately rolled features one at a time behind `realtime.<feature>.via` SystemConfig flags so the team could:

1. Ship the SSE infrastructure (Phase 1).
2. Migrate read-mostly features first — guide notifications, ML training, admin logs (Phases 2–4).
3. Migrate stateful tables in two stages: presence first (Phase 5), then game flow (Phase 7).
4. Soak each stage in stage / dev with both transports live before flipping.
5. Cut the socket transport last (Phase 8) once the SSE path was proven on every feature.

The flag-gated dual-emit pattern meant zero coordinated client deploys: a server flag flip routed each feature to its new transport without touching the client bundle. Phase 8 removed both branches in one PR after every flag was on `sse` for ≥1 dev cycle.

## Bugs surfaced during the cut

Three regressions appeared after `realtime.gameflow.via=sse` and were patched live before Phase 8:

1. **Guests never opened a stream.** `landing/src/components/layout/AppLayout.jsx` gated `useEventStream` on `!!user?.id`, so guest users had no `sseSessionId` and the `waitForSseSession()` helper hung forever inside `useGameSDK`. Fix: open the stream unconditionally; the backend's `optionalSessionCookie` middleware already accepts guests.
2. **Mid-game `EventSource` reopen disposed the seat.** `useEventStream` originally re-opened the stream when the dynamic `eventTypes` set changed (i.e. when the FORMING table's id arrived). The new SSE session displaced the original one; the original's 3 s debounce dispose then fired and forfeited the player's seat. Fix: split `useEventStream` into a stable open/close effect plus a separate listener-management effect that attaches to the live `EventSource` without reconnecting.
3. **HvB games hung after the first move.** `socketHandler.dispatchBotMove` only emitted via `io.to().emit('game:moved')` — the SSE clients never saw the bot's reply. Fix: dual-emit `appendToStream('table:<id>:state', { kind: 'moved', ...payload })`. (The dual-emit then became the only emit when Phase 8 deleted the socket path.)

## Operational notes

- `/admin/health` reports `socketAdapter: 'sse'`. The legacy `'redis' | 'in-memory' | 'unknown'` values are gone.
- `getStreamLength()` and `sseLastXreadAt` are the live observability signals. Prod runs `realtime.transport = sse` and never flips back.
- The `realtime.<feature>.via` SystemConfig keys can be deleted at the next maintenance window. They're inert until then — no code path reads them.
- Any new realtime feature should publish via `appendToStream(channel, payload, { userId })` and let clients subscribe through `useEventStream`. There is no socket fallback path to write toward.
