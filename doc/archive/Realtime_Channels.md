# Realtime channel reference

The platform's only realtime transport is **SSE+POST**:

- The browser opens one long-lived `EventSource` to `GET /api/v1/events/stream` and receives every server-pushed event as a named SSE message.
- Client → server messages are authenticated `POST` requests under `/api/v1/rt/*`. Each POST carries an `X-SSE-Session: <id>` header that pins it to the open SSE connection.

Channel names are namespaced by feature and (where relevant) by table / session id. The client subscribes by passing a comma-joined `channels=` prefix list when opening the stream and by registering named-event listeners for the specific topics it cares about (see `landing/src/lib/useEventStream.js`).

## Channel namespace

| Prefix                                      | Direction        | Purpose                                                                           |
| ------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| `guide:notification`                        | server → client  | Bus-dispatched notifications (`tournament.*`, `match.*`, `table.*`, etc.)         |
| `guide:journeyStep`                         | server → client  | Journey step completed                                                            |
| `guide:hook_complete`                       | server → client  | Hook reward popup                                                                 |
| `guide:curriculum_complete`                 | server → client  | Curriculum graduation popup                                                       |
| `guide:specialize_start`                    | server → client  | Specialize phase entered                                                          |
| `guide:coaching_card`                       | server → client  | Cup-completion advice card                                                        |
| `guide:discovery_reward`                    | server → client  | One-shot discovery reward grant                                                   |
| `presence:changed`                          | server → client  | Online users membership changed                                                   |
| `user:<id>:idle`                            | server → client  | Idle warning to a single user                                                     |
| `table:<id>:state`                          | server → client  | Per-game state — `kind ∈ {start, moved, forfeit}`                                 |
| `table:<id>:lifecycle`                      | server → client  | `kind ∈ {cancelled, abandoned, guestJoined, spectatorJoined, playerDisconnected, playerReconnected, opponent_left}` |
| `table:<id>:reaction`                       | server → client  | `{ emoji, fromMark }`                                                             |
| `table:<id>:presence`                       | server → client  | Watcher list + spectator count                                                    |
| `tournament:<id>:series:complete`           | server → client  | Series completion (PvP tournaments)                                               |
| `tournament:match:score`                    | server → client  | Mid-series score update                                                           |
| `tournament:<event>`                        | server → client  | `published`, `started`, `registration_closed`, `participant:joined`, `participant:left`, `match:ready`, `bot:match:ready`, `round:started`, `match:result`, `warning`, `completed`, `cancelled` |
| `pong:<slug>:state`                         | server → client  | Pong physics tick (~30 Hz)                                                        |
| `pong:<slug>:lifecycle`                     | server → client  | `kind ∈ {started, abandoned}`                                                     |
| `ml:session:<id>:<topic>`                   | server → client  | Training progress: `progress`, `curriculum_advance`, `complete`, `cancelled`, `error`, `early_stop` |
| `ml:tournament:tournament_complete`         | server → client  | Bot tournament complete                                                           |
| `ml:benchmark:<id>:benchmark_complete`      | server → client  | Benchmark run complete                                                            |
| `ml:model:<id>:regression_detected`         | server → client  | Win-rate regression detected                                                      |
| `admin:logs:entry`                          | server → client  | Live log tail (admin only)                                                        |

## POST routes

| Route                                                   | Direction        | Purpose                                                                  |
| ------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `POST /rt/tables`                                       | client → server  | Create PvP / HvB table                                                   |
| `POST /rt/tables/:slug/join`                            | client → server  | Join (player or spectator); idempotent for the host                     |
| `POST /rt/tables/:slug/leave`                           | client → server  | Leave a finished table                                                   |
| `POST /rt/tables/:slug/move`                            | client → server  | `{ cellIndex }`                                                          |
| `POST /rt/tables/:slug/forfeit`                         | client → server  | Mid-game forfeit                                                         |
| `POST /rt/tables/:slug/rematch`                         | client → server  | Restart a finished HvB / PvP table                                       |
| `POST /rt/tables/:slug/reaction`                        | client → server  | `{ emoji }`                                                              |
| `POST /rt/tables/:slug/idle/pong`                       | client → server  | Idle keep-alive (no-op since the per-socket idle timer subsystem retired in Phase 8) |
| `POST /rt/tables/:tableId/watch`                        | client → server  | Spectator presence — bound to caller's SSE session                       |
| `DELETE /rt/tables/:tableId/watch`                      | client → server  | Stop spectating                                                          |
| `POST /rt/tournaments/matches/:id/table`                | client → server  | Discover/seat the playable table for a tournament match                  |
| `POST /rt/pong/rooms`                                   | client → server  | Create a pong room                                                       |
| `POST /rt/pong/rooms/:slug/join`                        | client → server  | Join a pong room                                                         |
| `POST /rt/pong/rooms/:slug/input`                       | client → server  | `{ direction }`                                                          |

## Session lifecycle

1. Client opens `GET /api/v1/events/stream` with channel-prefix filter. Server responds with a `session` SSE frame carrying `{ sseSessionId }`.
2. Client stores the id (`landing/src/lib/rtSession.js`) and attaches `X-SSE-Session: <id>` to every subsequent `/rt/*` POST.
3. When the client closes the stream (tab close, navigation), the server starts a 3 s debounce. If no fresh stream arrives for the same userId in that window, `sseSessions.dispose` fires and `events.js` cleans up presence + invokes `disconnectForfeitService.handleDisconnect()` for every table the session was joined to.
4. PvP forfeit window after dispose: 60 s. A reconnecting player who joins back inside that window cancels the timer.

## Backpressure / replay

- Server appends every event to a Redis Stream (`appendToStream` in `backend/src/lib/eventStream.js`); the SSE broker fans the stream out to live clients and remembers the last id so reconnects (Last-Event-ID) replay missed events for ~5 min (configurable via stream MAXLEN).
- Per-user 8-connection cap caps blast radius from a tab-storm.
- Heartbeat comments every 30 s defeat proxy idle timeouts.
