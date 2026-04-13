# Socket & Resource Leak Instrumentation Plan

## Overview

Add lightweight observability to detect and diagnose resource leaks across four layers: socket connections, event listeners, rooms, and Redis connections. All instrumentation is counter-based — increment on obtain, decrement on release. Counters are always current, not sampled. Overhead is negligible: an integer increment/decrement on events that are already firing.

---

## The Four Layers

| Layer | Obtain event | Release event | Steady-state expectation |
|-------|-------------|---------------|--------------------------|
| Socket connections | `io.on('connection')` | `socket.on('disconnect')` | Matches `io.sockets.sockets.size` |
| Event listeners | `socket.on(event, handler)` | `socket.off(event, handler)` or `disconnect` cleanup | 1 per event type per socket; never accumulates |
| Rooms | `roomManager.createRoom()` | `roomManager.destroyRoom()` | One room per active game; zero when idle |
| Redis connections | `createClient()` + `connect()` | `client.quit()` | Exactly 2 in tournament service (publisher + subscriber); 1 in backend |

A counter that only increments (release never fires) is a leak. A counter that goes negative is a double-release bug.

---

## Risk Areas

### Frontend

| Risk | Location | Details |
|------|----------|---------|
| Duplicate socket listeners | `AppLayout.jsx` | `feedback:new`, `accomplishment` listeners attach on every effect re-run. Cleanup functions exist but must be verified as re-renders grow. |
| Socket not disconnected on sign-out | `socket.js` | `disconnectSocket()` is defined but not called during sign-out flow. Listeners from previous session may persist. |
| Stacking listeners on reconnect | `socket.js` `getSocket()` | Singleton pattern means listeners accumulate if `socket.on()` is called multiple times without matching `socket.off()`. |

### Backend

| Risk | Location | Details |
|------|----------|---------|
| Stale rooms | `socketHandler.js` / `roomManager.js` | Rooms not cleaned up on unexpected disconnect hold references indefinitely. |
| Listener accumulation | `socketHandler.js` | Per-socket event handlers registered in `io.on('connection')` must be cleaned up on `disconnect`. |
| Memory growth | General | No baseline or alerting on `process.memoryUsage()` — leaks are invisible until the container is restarted. |

### Tournament Service (new)

| Risk | Location | Details |
|------|----------|---------|
| Redis connection growth | `redis.js` (tournament service) | New connections must not be created per match or per event type. Exactly 2 connections at steady state. |
| Subscriber leak | Redis subscriber client | If the service restarts uncleanly, the old subscriber may remain open on the Redis server until its TCP timeout expires. Graceful shutdown must explicitly unsubscribe and quit. |

---

## Implementation Plan

### Layer 1 — Socket Connections (Backend)

**File:** `backend/src/realtime/socketHandler.js`

Wrap the existing `io.on('connection')` and `disconnect` handlers with counter increments:

```js
let _socketCount = 0

export function getSocketCount() { return _socketCount }

io.on('connection', socket => {
  _socketCount++
  // ... existing handler ...
  socket.on('disconnect', () => {
    _socketCount--
  })
})
```

`io.sockets.sockets.size` already provides this count — `_socketCount` serves as an independent cross-check and as the source for the health endpoint and log snapshot.

---

### Layer 2 — Event Listeners (Backend + Frontend)

**Backend — `backend/src/realtime/socketHandler.js`**

Track listener count per socket. Wrap every `socket.on()` call with a shared helper that increments a per-socket counter, and verify the counter reaches zero on `disconnect`:

```js
function trackedOn(socket, event, handler) {
  if (!socket._listenerCount) socket._listenerCount = 0
  socket._listenerCount++
  socket.on(event, handler)
  return () => {
    socket._listenerCount--
    socket.off(event, handler)
  }
}
```

Call the returned cleanup function in the `disconnect` handler. On disconnect, assert `socket._listenerCount === 0` and log a warning if not.

**Frontend — `frontend/src/lib/socket.js`**

Add an optional debug helper enabled via `VITE_DEBUG_SOCKET=true`:

```js
export function logSocketListeners() {
  if (import.meta.env.VITE_DEBUG_SOCKET !== 'true') return
  const s = getSocket()
  const events = ['accomplishment', 'feedback:new', 'connect', 'disconnect', 'pvp:*']
  console.table(
    Object.fromEntries(events.map(e => [e, s.listeners(e).length]))
  )
}
```

Call `logSocketListeners()` in `AppLayout.jsx` at the end of each sign-in `useEffect` to confirm listener counts are 1, not accumulating.

**Also:** Call `disconnectSocket()` during sign-out (wherever `signOut()` is called in `AppLayout` or auth handlers) to fully tear down the socket between sessions.

---

### Layer 3 — Rooms (Backend)

**File:** `backend/src/realtime/roomManager.js`

Add obtain/release counters around room creation and destruction:

```js
let _roomCount = 0

export function getRoomCount() { return _roomCount }

function createRoom(...) {
  _roomCount++
  // ... existing logic ...
}

function destroyRoom(roomId) {
  _roomCount--
  // ... existing logic ...
}
```

Log a warning if `_roomCount` goes negative (double-destroy bug) or if a room has been alive longer than a configurable max age with no active sockets (stale room detection).

---

### Layer 4 — Redis Connections (Backend + Tournament Service)

**File:** `backend/src/lib/redis.js` (and equivalent in tournament service)

Wrap `createClient` calls with a module-level counter:

```js
let _redisConnectionCount = 0

export function getRedisConnectionCount() { return _redisConnectionCount }

function createTrackedClient(opts) {
  const client = createClient(opts)
  client.on('connect', () => { _redisConnectionCount++ })
  client.on('end', () => { _redisConnectionCount-- })
  return client
}
```

At steady state: backend = 1, tournament service = 2. Any value above steady state indicates a connection was opened and not closed. Log a warning if the count exceeds the expected maximum.

---

### Phase 1 — Backend: Snapshot Buffer + Periodic Health Logging

**File:** `backend/src/realtime/socketHandler.js`

Every 60 seconds, record a snapshot and append it to an in-memory circular buffer (last 20 entries = last 20 minutes). The buffer is the source of truth for the health endpoint and leak detection — not a database, just module-level state.

```js
const SNAPSHOT_BUFFER_SIZE = 20
const _snapshots = []  // circular, newest last

function takeSnapshot() {
  const snap = {
    ts: Date.now(),
    sockets: getSocketCount(),
    rooms: getRoomCount(),
    redisConnections: getRedisConnectionCount(),
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }
  _snapshots.push(snap)
  if (_snapshots.length > SNAPSHOT_BUFFER_SIZE) _snapshots.shift()

  checkForLeaks(snap)

  logger.info(snap, 'Resource health snapshot')
}

setInterval(takeSnapshot, 60_000)

export function getSnapshots() { return [..._snapshots] }
export function getLatestSnapshot() { return _snapshots.at(-1) ?? null }
```

---

### Phase 2 — Backend: Leak Detection

**File:** `backend/src/realtime/socketHandler.js`

After each snapshot, check whether any counter has increased in every one of the last N consecutive readings (default N=3 — three minutes of uninterrupted growth). If so, emit a warning log and set a module-level alert flag that the health endpoint exposes.

```js
const LEAK_WINDOW = 3  // consecutive rising snapshots = alert
const _alerts = {}     // { sockets: true, rooms: false, ... }

function checkForLeaks(latest) {
  const window = _snapshots.slice(-LEAK_WINDOW)
  if (window.length < LEAK_WINDOW) return

  for (const key of ['sockets', 'rooms', 'redisConnections', 'memoryMb']) {
    const rising = window.every((s, i) => i === 0 || s[key] > window[i - 1][key])
    if (rising && !_alerts[key]) {
      _alerts[key] = true
      logger.warn({ key, window }, `Resource leak detected: ${key} has risen for ${LEAK_WINDOW} consecutive snapshots`)
      notifyAdmins(key)  // see below
    }
    if (!rising && _alerts[key]) {
      _alerts[key] = false  // auto-clear when the counter stabilises
      logger.info({ key }, `Resource alert cleared: ${key} is no longer climbing`)
    }
  }
}

export function getAlerts() { return { ..._alerts } }
```

**Admin notification on leak:** When a new alert fires, write a `UserNotification` row for every user with role `ADMIN` using the existing notification infrastructure. This delivers an in-app alert even if no admin is on the health page.

```js
async function notifyAdmins(key) {
  const admins = await getAdminUserIds()   // query Users where role = ADMIN
  await Promise.all(admins.map(userId =>
    createNotification({
      userId,
      type: 'system_alert',
      title: 'Resource leak detected',
      body: `Counter "${key}" has risen for ${LEAK_WINDOW} consecutive snapshots. Check the health dashboard.`,
    })
  ))
}
```

---

### Phase 3 — Backend: Admin Health Endpoint

**File:** `backend/src/routes/admin.js`

Add `GET /api/v1/admin/health/sockets` (requires admin auth). Returns the latest snapshot, the rolling history, and the current alert state:

```json
{
  "latest": {
    "ts": 1712345678000,
    "sockets": 12,
    "rooms": 3,
    "redisConnections": 1,
    "memoryMb": 148
  },
  "history": [
    { "ts": 1712345618000, "sockets": 11, "rooms": 3, "redisConnections": 1, "memoryMb": 146 },
    { "ts": 1712345678000, "sockets": 12, "rooms": 3, "redisConnections": 1, "memoryMb": 148 }
  ],
  "alerts": { "sockets": false, "rooms": false, "redisConnections": false, "memoryMb": false },
  "uptime": 3600
}
```

---

### Phase 4 — Frontend: Resource Health Page

**File:** `frontend/src/pages/admin/AdminHealthPage.jsx`
**Route:** `/admin/health` (guarded by `AdminRoute`)

A dedicated admin page that polls the health endpoint every 15 seconds and displays:

- **Counter tiles** — one tile per counter (Sockets, Rooms, Redis Connections, Memory). Each tile shows the current value and a status indicator: green (stable), amber (rising but not yet alerting), red (alert active).
- **History table** — the last 20 snapshots in a scrollable table with timestamps, one row per snapshot, columns for each counter. Values that increased from the previous row are highlighted.
- **Alert banner** — if any alert is active, a red banner appears at the top of the page with the affected counter names and a link to the log viewer.

Status color logic per counter:
- Green: value is stable or decreasing across the last 3 snapshots
- Amber: value has risen in 1–2 of the last 3 snapshots  
- Red: alert is active (`alerts[key] === true`)

**Dashboard link:** Add a "Resource Health" quick link card to `AdminDashboard.jsx` alongside the existing quick links. If any alert is active (determined by a separate lightweight poll or a shared context), show a red dot on the card.

---

### Phase 5 — Frontend: Listener Count Assertion in Tests

**Files:** Extend `AppLayout` tests or add `AppLayout.sockets.test.jsx`

Assert that mounting and unmounting `AppLayout` does not leave lingering listeners on the socket mock:

```js
it('cleans up accomplishment listener on unmount', () => {
  const { unmount } = render(<AppLayout />)
  const socket = getSocket()
  expect(socket.listeners('accomplishment')).toHaveLength(1)
  unmount()
  expect(socket.listeners('accomplishment')).toHaveLength(0)
})
```

---

### Phase 6 — Stress Tests (Local)

**File:** `e2e/tests/stress.spec.js`

Runs against the local docker-compose stack (`BASE_URL=http://localhost:5173`, health endpoint at `http://localhost:3000`). Not part of CI — run manually before instrumentation-related releases.

The test sequence:

1. **Baseline** — call `GET /api/v1/admin/health/sockets` and record starting counters for all four layers.

2. **Connection churn** — open N browser contexts (e.g. 20) simultaneously, navigate each to `/play`, wait for socket connections to establish, then close all contexts abruptly (simulating crash/network drop rather than graceful disconnect).

3. **Room churn** — open host + guest pairs, start games, then abruptly close one side mid-game. Repeat across several pairs concurrently.

4. **Drain period** — wait a short interval (e.g. 5 seconds) for the backend's disconnect cleanup to fire.

5. **Counter assertions** — call the health endpoint again and assert:
   - `sockets` has returned to the baseline value (± connected admin browser)
   - `rooms` has returned to zero or baseline
   - `redisConnections` is unchanged (should be 1 throughout)
   - `memoryMb` has not grown by more than a configurable threshold (e.g. 20 MB)
   - `alerts` object has no active alerts

6. **Leak simulation** — deliberately open connections without a corresponding close (hold the context open but stop responding). Wait for 4 snapshot intervals (> 3 minutes) and assert the health endpoint reports `alerts.sockets = true` and that an admin notification was created.

All tests run locally against `docker compose up`. The stress suite is excluded from the standard CI run via a Playwright project tag (`--project=stress`) but can be run on demand:

```
cd e2e && npx playwright test stress --project=chromium
```

---

## Out of Scope

- Buffer leak detection (no evidence of unbounded buffers in the current codebase)
- APM / distributed tracing (Datadog, Sentry, etc.) — separate concern

---

## Success Criteria

- All four counters are stable at steady state (no monotonic growth over a 30-minute idle period)
- Socket connection counter matches `io.sockets.sockets.size` at all times
- Listener counter reaches exactly zero on every socket disconnect
- Room counter reaches zero when no games are active
- Redis connection counter is exactly 1 in backend, exactly 2 in tournament service at steady state
- `GET /api/v1/admin/health/sockets` returns live data with no auth bypass
- Leak detection fires within 3 minutes (3 snapshot intervals) of a leak starting
- Alert auto-clears when the leaking counter stabilises — no manual intervention required
- All active admins receive an in-app notification when a new alert fires
- `/admin/health` page reflects current alert state within 15 seconds
- No memory growth trend visible in `memoryMb` across a 30-minute idle period
