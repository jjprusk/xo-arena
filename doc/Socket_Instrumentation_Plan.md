# Socket & Resource Leak Instrumentation Plan

## Overview

Add lightweight observability to detect and diagnose socket listener leaks, stale rooms, and memory growth in both the frontend and backend. No behavioral changes — instrumentation only.

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

---

## Implementation Plan

### Phase 1 — Frontend: Socket Debug Mode

**File:** `frontend/src/lib/socket.js`

Add an optional debug helper, enabled via `VITE_DEBUG_SOCKET=true`:

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

### Phase 2 — Backend: Periodic Health Logging

**File:** `backend/src/realtime/socketHandler.js`

Add a `setInterval` (60 s) inside the `io.on('connection')` bootstrap (or in the module initializer) that logs:

```js
setInterval(() => {
  logger.info({
    connectedSockets: io.sockets.sockets.size,
    activeRooms: roomManager.getRoomCount(),        // add getRoomCount() to roomManager
    memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'Socket health snapshot')
}, 60_000)
```

**File:** `backend/src/realtime/roomManager.js`

Add `getRoomCount()` — returns the current number of active rooms in the manager's internal map.

---

### Phase 3 — Backend: Admin Health Endpoint

**File:** `backend/src/routes/admin.js` (or a new `adminHealth.js`)

Add `GET /api/v1/admin/health/sockets` (requires admin auth):

```json
{
  "connectedSockets": 12,
  "activeRooms": 3,
  "memoryMb": 148,
  "uptime": 3600
}
```

This makes the live counts queryable from the admin dashboard or Railway logs without needing container access.

---

### Phase 4 — Frontend: Listener Count Assertion in Tests

**Files:** `AppLayout.phase3.test.jsx` (extend) or a new `AppLayout.sockets.test.jsx`

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

## Out of Scope

- Buffer leak detection (no evidence of unbounded buffers in the current codebase)
- APM / distributed tracing (Datadog, Sentry, etc.) — separate concern
- WebSocket load testing — deferred until credits implementation is complete (see stress test deferral)

---

## Effort Estimate

| Phase | Effort |
|-------|--------|
| Phase 1 — Frontend debug mode + sign-out disconnect | Small (~1–2 hrs) |
| Phase 2 — Backend periodic health logging | Small (~1 hr) |
| Phase 3 — Admin health endpoint | Small (~1–2 hrs) |
| Phase 4 — Listener cleanup tests | Small (~1 hr) |
| **Total** | **~1 day** |

---

## Success Criteria

- No listener count above 1 per event type after a sign-in/sign-out cycle (verified via `logSocketListeners()` or test assertions)
- Backend health log shows stable `connectedSockets` and `activeRooms` counts under normal load
- `GET /api/v1/admin/health/sockets` returns live data with no auth bypass
- No memory growth trend visible in `memoryMb` across a 30-minute idle period
