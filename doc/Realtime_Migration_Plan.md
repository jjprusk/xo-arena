# Realtime Migration Plan — Socket.io → SSE + HTTP POST

**Drafted:** 2026-04-27 · **Owner:** the user (deployer) · **Repo:** `xo-arena`

## Goal & shape

Replace all bidirectional realtime in xo-arena with two simple primitives that already work:

- **Server → client:** the existing SSE pipeline (`events:tier2:stream` → `sseBroker` → `/api/v1/events/stream`).
- **Client → server:** authenticated `POST` routes under `/api/v1/rt/*`, each carrying an `X-SSE-Session: <sseSessionId>` header so the server can attribute the call to a live connection.

This collapses three moving parts (socket.io adapter, redis-adapter pub/sub, in-memory `_socketToTable` keyed by `socket.id`) into one (Redis stream + REST). The SSE infra is the only piece that has actually been stable.

End-state deletions (Section 7) total **~2,450 lines** removed plus three npm dependencies.

## Why this migration

Recent commits (`d0b03e0 fix(socket): redis-adapter lazyConnect + observability + dev backlog drain`, plus several days of related work) reflect ongoing instability in the Socket.io + `@socket.io/redis-adapter` stack. Audit of the codebase shows:

- **Nothing in xo-arena requires WebSocket-class realtime.** No per-frame data, no binary frames, no datagram use case. Even `pong:input` is a discrete direction-change event, not continuous paddle streaming.
- **The existing SSE broker is well-built** (`backend/src/lib/sseBroker.js`, 152 lines): one shared Redis `XREAD BLOCK` loop, channel-prefix + per-user filtering, native `Last-Event-ID` reconnect replay, liveness tracking.
- **The Socket.io surface is mostly fan-out** — ~30 distinct server→client emit types across `socketHandler.js` (2152 lines), all of which map cleanly to SSE channels. The ~20 client→server handlers are all comfortable POST shapes.
- **WebTransport was considered and rejected.** Server-side Node ecosystem is immature, Safari support is partial as of 2026-04, and Fly.io edge handling of WebTransport sessions to backend apps is not a paved path. The frustration that's steering us toward novelty would be replaced by worse frustration.

## Cross-cutting decisions

These have to be settled before Phase 1 — they shape every other phase.

### C1. Session identity (`sseSessionId` replaces `socket.id`)

- On `GET /api/v1/events/stream`, mint a `sseSessionId = nanoid()` server-side.
- Send it as the **first SSE frame** on the stream: `event: session\ndata: {"sseSessionId":"…"}\n\n`. (`useEventStream` adds an `addEventListener('session', …)` and stashes it.)
- Client puts it into a module-level holder (`landing/src/lib/rtSession.js`) and on every `fetch` to `/api/v1/rt/*` adds `X-SSE-Session: <id>`.
- Backend keeps a **single** map `sseSessionId → { userId, res, joinedTables: Set, joinedPongRooms: Set, lastSeenAt, … }`. Lives in `backend/src/realtime/sseSessions.js` (new). `sseBroker.register()` is extended to accept the sessionId so the same map is the source of truth.
- `req.on('close', …)` on the SSE stream is the one and only "this user went away" signal — replaces every `socket.on('disconnect')` path.
- POSTs that arrive with an unknown/expired sessionId return `409 sse-session-required`. Client reaction: reopen SSE, retry POST once.

### C2. Channel-prefix namespace (server → client)

Every channel name is `<scope>:<id>:<topic>`, prefix-filterable by the existing `?channels=` query param. Document this in `doc/Realtime_Channels.md` (new) and reference from `Table_Paradigm.md`.

| Prefix | Channels under it | Replaces socket event |
|---|---|---|
| `table:<id>:` | `state`, `presence`, `reaction`, `idle`, `lifecycle` | `table:presence`, `room:guestJoined`, `room:cancelled`, `room:abandoned`, `room:playerDisconnected`, `room:playerReconnected`, `game:start`, `game:moved`, `game:forfeit`, `room:spectatorJoined`, `game:reaction` |
| `room:<slug>:` | `created` (one-shot to creator) | `room:created`, `room:created:hvb`, `room:joined` |
| `tournament:<id>:` | already in use; add `room:ready`, `series:complete`, `match:score` | `tournament:room:ready`, `tournament:series:complete`, `tournament:match:score` |
| `pong:<slug>:` | `state`, `lifecycle` | `pong:state`, `pong:started`, `pong:abandoned`, `pong:created`, `pong:joined` |
| `user:<id>:` | `notif`, `idle`, `room:created`, `kicked`, `guide:journeyStep`, `guide:coaching_card`, `ml:progress` | `idle:warning`, `room:kicked`, `error`, `guide:journeyStep`, `guide:coaching_card`, `guide:hook_complete`, `guide:curriculum_complete`, `ml:*` |
| `support:` | `feedback:new` | `feedback:new` |
| `admin:logs:` | `entry` | `log:entry` |
| `ml:session:<id>:` | `progress`, `complete`, `cancelled`, `error`, `curriculum_advance`, `tournament_complete` | All `ml:*` events scoped per session |

`appendToStream()` already takes `(channel, payload, { userId })`. For per-table fanout we set `userId: '*'`; for per-user routing we set `userId: <id>` (broker filters by `userId`). The single Redis stream + sseBroker handles all of it without any new infra.

### C3. POST route surface (client → server)

All under `/api/v1/rt/*`, all behind `requireAuth` **or** a guest-token middleware (mirrors current `authToken` payload field — guest play needs to keep working). Required header on every request: `X-SSE-Session`.

| POST route | Body | Replaces |
|---|---|---|
| `POST /rt/tables` | `{ kind: 'pvp'\|'hvb', botUserId?, botSkillId?, spectatorAllowed?, tournamentMatchId? }` | `room:create`, `room:create:hvb` |
| `POST /rt/tables/:slug/join` | `{ role: 'player'\|'spectator' }` | `room:join` |
| `POST /rt/tables/:slug/cancel` | `{}` | `room:cancel` |
| `POST /rt/tables/:slug/move` | `{ cellIndex }` | `game:move` |
| `POST /rt/tables/:slug/forfeit` | `{}` | `game:forfeit` |
| `POST /rt/tables/:slug/leave` | `{}` | `game:leave` |
| `POST /rt/tables/:slug/rematch` | `{}` | `game:rematch` |
| `POST /rt/tables/:slug/reaction` | `{ emoji }` | `game:reaction` |
| `POST /rt/tables/:slug/idle/pong` | `{}` | `idle:pong` |
| `POST /rt/tables/:tableId/watch` | `{}` | `table:watch` |
| `DELETE /rt/tables/:tableId/watch` | — | `table:unwatch` |
| `POST /rt/tournaments/matches/:id/room` | `{}` (mints PvP slug) | `tournament:room:join` |
| `POST /rt/pong/rooms` | `{ slug }` | `pong:create` |
| `POST /rt/pong/rooms/:slug/join` | `{}` | `pong:join` |
| `POST /rt/pong/rooms/:slug/input` | `{ direction }` | `pong:input` |
| `POST /rt/ml/sessions/:id/watch` | `{}` | `ml:watch` |
| `DELETE /rt/ml/sessions/:id/watch` | — | `ml:unwatch` |
| `POST /rt/support/join` | `{}` | `support:join` |

Each endpoint resolves the user from `req.auth`, looks up the `sseSessionId` from `X-SSE-Session`, and (for table/pong/etc handlers) calls into a refactored `tableService` / `pongService` that does the same DB work + `appendToStream(...)` the old socket handler did. **The handler logic moves; it is not rewritten.**

### C4. Rate limiting

New attack surface vs WebSocket. Add `express-rate-limit` (or matching pattern already in repo) per route group:

- `move` / `reaction` / `pong/input`: 60 req/10s per session.
- `tables` / `pong/rooms` create: 10/min per user.
- All others: 30/min per session.

Keyed on `sseSessionId` for hot paths, `userId` for create paths. Document caps in `doc/Realtime_Channels.md`.

### C5. Idle / forfeit / disconnect

Today: `socket.on('disconnect')` reads `_socketToTable`, looks at status, starts a 60-s forfeit timer, etc.

After: `sseSessions.onClose(sessionId)` is the single hook. `req.on('close', () => sseSessions.dispose(sessionId))` calls it. The function does exactly the same DB work as today's disconnect handler, indexed via `joinedTables: Set` on the session record instead of `_socketToTable`.

Idle pings: `POST /rt/tables/:slug/idle/pong` resets the timer just like `socket.on('idle:pong')` does. The phase-1 warn becomes `appendToStream('user:<id>:idle', {warningMs}, {userId})`; the phase-2 abandon stays a per-table `appendToStream('table:<id>:lifecycle', {kind:'abandoned'}, {userId:'*'})`.

A "did the user really leave or just have a bad reload?" gate is **already** built in: SSE EventSource auto-reconnects within ~2 s, so `req.on('close')` followed by a fresh `/events/stream` from the same user within a grace window can be treated as a reconnect. Add a 3-second `dispose()` debounce: if a new SSE arrives for the same userId before 3 s elapses, cancel the disposal. This is materially **better** than current Socket.io behavior, where the 60-s reconnect window is hardcoded at the gameplay level only.

### C6. Auth

- **SSE GET:** existing `requireSessionCookie` in `routes/events.js` works untouched. Guest-token cookie path needs verification (see Risk R3).
- **POST /rt/\*:** existing `requireAuth` + a small `requireSseSession` middleware that resolves `X-SSE-Session` against `sseSessions` and 409s if missing. Internal-secret routes (already used by tournament service) continue to bypass.

### C7. Feature flag

One server-side flag, `realtime.transport` in `SystemConfig`, values `socketio | dual | sse`. `dual` (Phase 1-N) keeps both running side-by-side: SSE broker plus socket.io. The client decides via a one-shot `GET /api/v1/realtime/mode` call at app boot whether to open the EventSource only, the socket only, or both. Per-feature flags (`realtime.idle.via`, `realtime.notifications.via`, …) let us flip phases independently.

The flag lives in `SystemConfig` so toggling doesn't require a deploy — matches the existing `guide.v1.enabled` pattern.

## Phase ordering & timeline

Lowest-risk first, each phase ships independently behind its own sub-flag, with rollback = flip flag back to `socketio`. Total **6-9 working days** spread across 8 phases — roughly one phase per half-day-to-day.

| # | Phase | Effort | Risk |
|---|---|---|---|
| 0 | Cross-cutting groundwork (sseSessions, mode flag, rt router skeleton, channel doc) | 0.5 d | low |
| 1 | Idle ping/warning (proof of concept) | 0.5 d | very low |
| 2 | Notifications (`guide:journeyStep`, `coaching_card`, `hook_complete`, `curriculum_complete`) | 0.5 d | low |
| 3 | Tournament bridge → pure SSE | 1 d | low |
| 4 | ML / Gym / admin logs / support / feedback | 0.5 d | low |
| 5 | Table presence + lifecycle (`table:watch`, presence broadcasts) | 1 d | medium |
| 6 | Pong (full migration including server tick) | 1 d | medium |
| 7 | Game moves & game-flow events (the core PvP loop) | 1.5 d | high |
| 8 | Rip out socket.io entirely (deletions, dep removal, doc) | 0.5 d | low |

## Day 1 — proof of concept (Phase 0 + Phase 1)

Concrete enough to start tomorrow. By end-of-day you have idle warnings flowing through SSE end-to-end, in `dual` mode, with both backends running.

### Morning (Phase 0 — groundwork)

1. Add `backend/src/realtime/sseSessions.js`:
    - `register(sessionId, { userId, res })`, `dispose(sessionId)`, `get(sessionId)`, `forUser(userId)`, `joinTable(sessionId, tableId)`, `leaveTable(sessionId, tableId)`, `tablesFor(sessionId)`.
    - 3-second debounce on `dispose()` keyed by `userId` so SSE reconnects don't trigger forfeit.
2. Modify `backend/src/lib/sseBroker.js::register()` to accept and persist `sessionId`. Modify `backend/src/routes/events.js::router.get('/stream', …)` to mint the id with `nanoid()`, write the `event: session` first frame, register with `sseSessions`, and call `sseSessions.dispose(sessionId)` on `req.on('close')`.
3. Add `backend/src/routes/realtime.js` (skeleton): `Router()`, `requireSseSession` middleware, mounted at `/api/v1/rt`. Wire it in `index.js`.
4. Add `landing/src/lib/rtSession.js`: holds the active `sseSessionId`, exports `getSseSession()`, `setSseSession(id)`, `rtFetch(path, opts)` that injects `X-SSE-Session`, retries once on 409 by triggering an EventSource reconnect (close + reopen).
5. Modify `landing/src/lib/useEventStream.js`: `addEventListener('session', e => setSseSession(JSON.parse(e.data).sseSessionId))`. Also export the `KNOWN_EVENT_TYPES` so phases can extend it.
6. Add `SystemConfig` flag `realtime.transport` (default `socketio`).
7. Add `GET /api/v1/realtime/mode` returning `{ transport, perFeature: {...} }`.

### Afternoon (Phase 1 — idle ping)

1. Server: in the existing `makeIdleCallbacks(io)` block (`socketHandler.js:266-280`), make `onWarn` also `appendToStream('user:<userId>:idle', { secondsRemaining }, { userId })`. (Both transports running; flag-gated.) Add `POST /api/v1/rt/tables/:slug/idle/pong` that calls the same `resetIdleTimer` body the socket handler does. Extract that body into `tableService.handleIdlePong(userId, slug)` so both call sites share code.
2. Client: in `landing/src/lib/useGameSDK.js` line 581, when `realtime.transport !== 'socketio'` (read once at boot), POST to `/rt/tables/:slug/idle/pong` instead of `socket.emit('idle:pong')`. Listen for `user:<id>:idle` on the EventSource and translate to the existing `idle:warning` callback shape so downstream UI doesn't change.
3. Tests:
    - `backend/src/routes/__tests__/rt.idle.test.js` — POST hits `tableService.handleIdlePong`, idle timer resets.
    - `backend/src/realtime/__tests__/sseSessions.test.js` — register/dispose, debounce, table-join membership.
    - Run via `docker compose exec -T backend npx vitest run backend/src/realtime/__tests__/sseSessions.test.js`.
4. Set `realtime.idle.via = sse` for your dev account (`SystemConfig` row keyed per-user, or simpler: a header `X-RT-Mode: sse` for dev). Verify in browser devtools that POSTs go out and the warning still fires.
5. **Ship criterion for Day 1:** with flag set, idle warning round-trips entirely without socket.io being involved on either end. Toggling flag back goes back to socket.io. No regressions.

## Phase-by-phase detail

### Phase 1 — Idle ping

(see Day 1)

- **Channels:** `user:<id>:idle`.
- **POST:** `/rt/tables/:slug/idle/pong`.
- **Flag:** `realtime.idle.via`.
- **Tests:** sseSessions unit tests; `rt.idle.test.js`.
- **Ship:** dev verification + green vitest.
- **Rollback:** unset flag.

### Phase 2 — Notifications (guide + coaching cards + reward popups)

The notif path **already** writes to the SSE stream via `notificationBus.dispatch()`. What's missing is replacing the socket-only emit in `tournamentBridge.js:385` (`io.to('user:…').emit('guide:coaching_card', …)`) and the four guide events in `RewardPopup.jsx` / `CoachingCard.jsx` / `AppLayout.jsx`.

- **Files:** `tournamentBridge.js` (replace `io.to(...).emit(...)` with `appendToStream('user:<id>:guide:coaching_card', …, {userId})`); `journeyService.js` (`guide:journeyStep` → `appendToStream('user:<id>:guide:journeyStep', …, {userId})`); landing components switch from `socket.on(...)` to `useEventStream` callback dispatch by channel.
- **Channels:** `user:<id>:guide:coaching_card`, `user:<id>:guide:journeyStep`, `user:<id>:guide:hook_complete`, `user:<id>:guide:curriculum_complete`.
- **POST:** none (server-only fanout).
- **Flag:** `realtime.guide.via`.
- **Tests:** existing `tournamentBridge.coachingCard.test.js` and `tournamentBridge.notifPref.test.js` need to assert `appendToStream` was called instead of `io.to`. Add `landing/src/components/guide/__tests__/RewardPopup.viaSse.test.jsx` using a mock `useEventStream`.
- **Ship:** flip flag in dev, observe `guide:notification` events still pop, and `guide:coaching_card` now appears via SSE. Stage soak 30 min.
- **Rollback:** flip back. Both code paths coexist.

### Phase 3 — Tournament bridge

`tournamentBridge.js` listens on Redis pub/sub channels, then calls `dispatch(...)` (already SSE-clean) **and** `io.to(...).emit(...)` for a few events. The post-Phase-2 leftovers are: `tournament:room:ready`, `tournament:series:complete`, `tournament:match:score`. The first two come from `socketHandler.js:1480-1604` (the `tournament:room:join` handler) and `2108`; `match:score` is already routed through `appendToStream` at `socketHandler.js:2129`.

- **Files:** `tournamentBridge.js`, `socketHandler.js` (extract handler into `tournamentMatchRoomService.js`), new `POST /rt/tournaments/matches/:id/room`.
- **Channels:** `tournament:<id>:room:ready`, `tournament:<id>:series:complete`. Note: namespace by **tournament** id, not match id, so the Tournament page can subscribe with one `tournament:<tid>:` prefix and pick up everything.
- **POST:** `/rt/tournaments/matches/:id/room` returns `{ slug, mark, role }` synchronously and also broadcasts `tournament:<tid>:room:ready` so the partner gets it.
- **Flag:** `realtime.tournament.via`.
- **Tests:** `routes/__tests__/rt.tournamentMatchRoom.test.js`; existing `tournamentBridge.*.test.js` updated.
- **Frontend:** `TournamentDetailPage.jsx` lines 1141, 1228, 1307, 1598 — replace each `socket.once('tournament:room:ready', …)` + `socket.emit('tournament:room:join', …)` block with `await rtFetch('/rt/tournaments/matches/'+matchId+'/room', { method:'POST' })`. Optionally still listen on the SSE channel for the partner-side notification.
- **Ship:** stage 1-h soak with two browsers running a tournament series end-to-end.
- **Rollback:** flag.

### Phase 4 — ML / Gym / admin logs / support / feedback

All small, all server-only fanout (except `ml:watch`/`unwatch`/`support:join`/`feedback:new` which need POST routes for the watch).

- **Files:** `mlService.js:1672`, `routes/feedback.js:93`, `routes/logs.js:65`, `services/discoveryRewardsService.js`, plus the few socket handlers in `socketHandler.js:1636-1650`.
- **Channels:** `ml:session:<id>:*`, `admin:logs:entry`, `support:feedback:new`.
- **POSTs:** `/rt/ml/sessions/:id/watch` (DELETE for unwatch), `/rt/support/join` (or simply: subscribe to `support:` prefix is enough — no POST needed; gate read-side by role).
- **Flag:** `realtime.ml.via`, `realtime.admin.via`.
- **Tests:** `mlService.test.js` already mocks `setIO`; switch to `vi.spyOn(eventStream, 'appendToStream')`. Add `routes/__tests__/rt.mlWatch.test.js`.
- **Frontend:** `TrainTab.jsx`, `EvaluationTab.jsx`, `GymPage.jsx`, `SupportPage.jsx`, `LogViewerPage.jsx` — each replaces socket import with `useEventStream({ channels: ['ml:session:'+id+':'] })` + targeted `rtFetch` for watch/unwatch.
- **Ship:** verify a Quick Train run; verify a feedback submit hits the support page.
- **Rollback:** flag.

### Phase 5 — Table presence + lifecycle (no game moves yet)

The first phase to touch the heart of the table flow. We do **only** `table:watch`/`table:unwatch`/`table:presence`/`room:guestJoined`/`room:cancelled`/`room:abandoned`/`room:playerDisconnected`/`room:playerReconnected`/`room:spectatorJoined` — i.e., everything *around* the game except the moves themselves. Game moves still go over socket.io until Phase 7.

- **Files:** Extract `socketHandler.js:1652-1712` (`table:watch`, `table:unwatch`) into `tablePresenceService.js`. Same for the lifecycle emits in the disconnect handler. New POST routes mounted on `/rt/tables/:tableId/watch`. Replace every `io.to('table:'+id).emit('table:presence', …)` with `appendToStream('table:'+id+':presence', …, {userId:'*'})`.
- **Channels:** `table:<id>:presence`, `table:<id>:lifecycle` (all the room:* events as `kind` discriminators within one channel).
- **POSTs:** `/rt/tables/:tableId/watch`, `DELETE /rt/tables/:tableId/watch`, `/rt/tables/:tableId/spectator/join`.
- **Flag:** `realtime.tables.presence.via`.
- **Disconnect logic:** moves to `sseSessions.dispose(sessionId, { userId })` which calls `tablePresenceService.handleSessionGone(userId, sessionId)`. The 3-s debounce in C5 handles tab refreshes; longer absence triggers the existing `removeWatcherFromAllTables` logic and broadcasts.
- **Tests:** `routes/__tests__/rt.tableWatch.test.js`; updated `tableGcService.test.js` to assert `appendToStream` calls.
- **Frontend:** `TableDetailPage.jsx:75-91` and `useGameSDK.js`'s `room:*` listeners.
- **Ship:** open two browsers, watch a third's table, verify presence count flips correctly through join/leave/refresh/network drop.
- **Rollback:** flag.

### Phase 6 — Pong

Pong is small (one runner, one route group) but exercises the per-frame fanout pattern at scale (~30 Hz). Worth doing before game moves so we know the SSE write-path holds up.

- **Files:** `pongRunner.js` (replace `_io.to(slug).emit('pong:state', …)` with `appendToStream('pong:'+slug+':state', …, {userId:'*'})`); new `routes/realtime/pong.js` for create/join/input.
- **Channels:** `pong:<slug>:state`, `pong:<slug>:lifecycle`.
- **POSTs:** `/rt/pong/rooms`, `/rt/pong/rooms/:slug/join`, `/rt/pong/rooms/:slug/input`.
- **Concern:** XADD per tick is 30 writes/sec/room. With MAXLEN ~5000 trimming, a single 60-s game emits ~1800 entries. Verify with existing `getStreamLength()` instrumentation that the stream doesn't blow past target. **Optimization to evaluate, not require:** for `pong:<slug>:state`, skip the persistent stream and emit live-only via a new `sseBroker.broadcast(channel, payload, filter)` that bypasses XADD. (Current broker reads from XREAD only, so this is a small additive change — register a "live-only" path that fans out directly to matching clients.) Add only if Phase 6 shows replay-stream pressure.
- **Tests:** `routes/__tests__/rt.pong.test.js`; update `pongRunner.test.js` (if it exists; create one if not).
- **Ship:** end-to-end pong game between two browsers.
- **Rollback:** flag `realtime.pong.via`.

### Phase 7 — Game moves + game flow

The big one. Everything in `socketHandler.js` between the table:watch/unwatch handlers (`game:move`, `game:rematch`, `game:forfeit`, `game:leave`, `game:reaction`, `room:create`, `room:create:hvb`, `room:join`, `room:cancel`, `tournament:room:join`).

- **Approach:** Each handler becomes a thin POST route that calls into a service. The service is *the existing handler body* with three mechanical changes:
    - `socket` parameter → `{ userId, sessionId }`.
    - `socket.id` lookups → `sessionId` lookups via `sseSessions.tablesFor(sessionId)`.
    - `io.to('table:'+id).emit(name, payload)` → `appendToStream('table:'+id+':'+topic, { kind: name, ...payload }, { userId: '*' })` where `topic ∈ {state, lifecycle, reaction}`.
- **Files:** Extract big chunks into `services/tableFlowService.js`. Routes: `routes/realtime/tables.js`. Frontend: massive surgery in `useGameSDK.js` (lines 240-540) — replace every `socket.on('event', ...)` with a switch on the channel inside a single `useEventStream({ channels: ['table:'+slug+':', 'user:'+myId+':'] })` callback.
- **Channels:** `table:<id>:state` (`game:start`, `game:moved`, `game:forfeit`), `table:<id>:lifecycle` (`room:cancelled`, `room:abandoned`, `room:playerDisconnected/Reconnected`, `room:guestJoined`, `room:spectatorJoined`), `table:<id>:reaction`. Plus `user:<id>:room:created` for `room:created` / `room:created:hvb` / `room:joined` (those are personal, not table-scoped, since the table doesn't exist yet from the recipient's viewpoint).
- **POSTs:** the rest of section C3.
- **Tests** — the big lift. Add at minimum:
    - `routes/__tests__/rt.tableCreate.test.js` (PvP + HvB + tournament).
    - `routes/__tests__/rt.tableJoin.test.js` (player + spectator + private).
    - `routes/__tests__/rt.gameMove.test.js` (legal + illegal + bot follow-up + winning move + draw).
    - `routes/__tests__/rt.gameForfeit.test.js`.
    - `routes/__tests__/rt.gameRematch.test.js`.
    - `routes/__tests__/rt.disconnectForfeit.test.js` (start a game, dispose session, verify 60-s timer fires and emits forfeit on the SSE stream).
    - Existing `botGameRunner.test.js`, etc., updated to assert via `appendToStream` mock.
- **Ship criteria:** all of these pass in `docker compose exec -T backend npx vitest run`; manual two-browser PvP game completes end-to-end; HvB completes; reload-mid-game reconnects without forfeit; idle abandons correctly; tournament series completes.
- **Rollback:** `realtime.gameflow.via` flag flips it back to socket.io. Keep both branches in `useGameSDK.js` until Phase 8.

### Phase 8 — Tear out socket.io

Once Phase 7 has soaked in stage for 24-48 h with no regressions:

- Delete `backend/src/realtime/socketHandler.js` (~2150 lines).
- Delete `backend/src/lib/notificationBus.js::initBus`/`emitToRoom` (~5 lines).
- Delete the `_io` setters in `mlService.js`, `journeyService.js`, `discoveryRewardsService.js`, `routes/logs.js`, `lib/scheduledJobs.js`, `realtime/pongRunner.js`, `realtime/botGameRunner.js`.
- Delete `landing/src/lib/socket.js` (65 lines).
- Delete socket-import lines in `main.supported.jsx`, `AppLayout.jsx`, `useGameSDK.js` (`getSocket`/`connectSocket`/`disconnectSocket` calls), `usePongSDK.js`, `CoachingCard.jsx`, `RewardPopup.jsx`, `EvaluationTab.jsx`, `TrainTab.jsx`, `TournamentDetailPage.jsx`, `GymPage.jsx`, `TableDetailPage.jsx`.
- `npm uninstall socket.io @socket.io/redis-adapter` in backend, `npm uninstall socket.io-client` in landing.
- Delete the redis-adapter lazyConnect/backlog-drain logic added in `d0b03e0`.
- Update `CLAUDE.md` ("Express + Prisma + Socket.io" → "Express + Prisma + SSE+POST").
- Add `doc/Realtime_Channels.md` (channel namespace ref) + `doc/Realtime_Migration_Postmortem.md`.
- **Ship:** flip `realtime.transport = sse` in prod SystemConfig, deploy, watch `getStreamLength()` and `sseLastXreadAt` in `/admin/health`.

**Lines removed (estimate):** 2150 (`socketHandler.js`) + 65 (`landing/lib/socket.js`) + ~150 across the various `setIO` call sites + ~80 in `tournamentBridge.js` for the `io.to` paths = **~2,450 lines deleted**. Three npm deps gone. Redis pub/sub keeps running (the tournament service uses it internally), but the redis-adapter — the actual source of multi-day pain — is gone.

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Long SSE connection hits a proxy idle timeout (Fly, Vite proxy, browser). | Already addressed: `/events/stream` writes a comment heartbeat every 30 s + sets `X-Accel-Buffering: no`. Verify the Fly proxy idle timeout (default 5 min) is comfortably above 30 s. Bump heartbeat to 20 s if any layer turns out to be tighter. |
| R2 | SSE reconnect storm after a backend restart — 100 tabs reopen at once. | Add jittered exponential backoff in `useEventStream` (currently no backoff; relies on EventSource default of 2 s + the `retry: 2000` server hint). Random `Math.random() * 3000` jitter on top of the 2 s baseline keeps the thundering herd in check. The per-user 8-connection cap also limits the per-account blast radius. |
| R3 | Guest play breaks: the existing socket flow accepts an `authToken: null` path, but the SSE endpoint requires `requireSessionCookie`. Guest users may not have a BA session. | Audit before Phase 5: confirm guests *do* get a BA session cookie when starting a guest game (the codebase already mints one — but verify in `landing/src/lib/auth.js` or wherever guest auth is wired). If not, add a guest-session middleware that mints a short-lived anonymous BA-equivalent session for the SSE GET. Same middleware applies to `/rt/*` POSTs. |
| R4 | Per-tick Pong XADDs (~30/s/room) bloat the replay stream and starve other writers. | Phase 6 measures via `getStreamLength()` first. If pressure shows, add the live-only `sseBroker.broadcast()` path (no XADD) for `pong:*:state`. The existing MAXLEN ~5000 trim is the hard ceiling. |
| R5 | A `POST /rt/tables/:slug/move` race: client posts move 1 and move 2 quickly; without the in-order delivery socket.io provides, server might apply 2 before 1. | The DB `Table.previewState` is the single source of truth and `currentTurn` enforces ordering; an out-of-turn POST returns 400. Server-side concurrency is already handled by Prisma transactions in the existing handler — preserved when we extract the function. Worst case, a stale-turn POST 400s and the client refetches state via `GET /api/v1/tables/:slug` (or via the next SSE state event). |
| R6 | The `X-SSE-Session` flow makes guest-tab open-in-second-window awkward (each tab has its own session). | This is actually an *improvement* over socket.io — today's `socket.id` is per-tab too. Sessions sharing a userId is fine; they each see their own personal events plus all broadcasts. |
| R7 | Migrating game moves last means PvP between two clients on different flag values doesn't work mid-rollout. | Make the flag table-scoped, not user-scoped, in Phase 7. When a table is created, the `realtime.gameflow.via` value at creation time is recorded on the row; both sides use whatever the host opened with. Roll the flag forward only after stage soak. |

## What you (the deployer) run

- Phase boundaries: each phase is one PR. After tests pass and you're satisfied with dev, you run `/dev` → `/stage` → `/promote`.
- Flag flips happen in `SystemConfig` rows — same way you flip `guide.v1.enabled`. No deploy needed for a flag flip.
- Claude never runs `/dev`, `/stage`, or `/promote`. After Phase 8, the soak window before flipping `realtime.transport = sse` in prod is your call.

## Critical files for implementation

- `backend/src/realtime/socketHandler.js`
- `backend/src/lib/sseBroker.js`
- `backend/src/routes/events.js`
- `backend/src/lib/notificationBus.js`
- `backend/src/lib/tournamentBridge.js`
- `landing/src/lib/useGameSDK.js`
- `landing/src/lib/useEventStream.js`
- `landing/src/lib/socket.js`
