# Chunk 3 — Phase A Findings

**Date:** 2026-04-27
**Status:** Investigation complete; no code changes yet.
**Scope:** Audit every code path that should release a seat or transition a Table to COMPLETED, plus the in-memory presence layer, before scoping behavioural fixes.

---

## Executive summary

Three classes of bugs explain the V1 acceptance non-slug symptoms:

1. **Seats are never freed.** Every release path flips `Table.status`, but **no path** ever updates `seats[i].status` from `'occupied'` back to `'empty'`. Once a player sits, their seat is structurally permanent in the JSON blob until the row itself is deleted by GC. This alone explains "seats stuck occupied".

2. **The graceful-close path doesn't exist on the frontend.** `PlayPage.jsx` has **no `pagehide`/`beforeunload`** handler, no `navigator.sendBeacon`, and the "Leave table" button in `PlatformShell.jsx:433` is **never wired** by `PlayPage` (it doesn't pass `onLeave`). Safari closes a tab → no socket message → opponent waits for the 60 s disconnect-timer **plus** the 3 min idle window before the table abandons. This is the Safari/Chrome divergence.

3. **In-memory state and DB state drift.** GC sweeps delete or COMPLETE Table rows but **never** clean `_socketToTable`, `_disconnectTimers`, `_spectatorSockets`, or `_tableWatchers`. The maps hold pointers to dead rows until the next disconnect. The most degenerate path is `DELETE /api/v1/admin/tables/:id` — admin force-stop leaves *all* in-memory state stale.

A structured `table.released{reason}` event (chunk 3 plan §B) **does not exist anywhere yet** — every COMPLETED transition currently fires a different one-off socket event (`game:moved` / `game:forfeit` / `room:abandoned` / `room:cancelled`) or no event at all.

---

## Inventory: all 14 sites that write `status: 'COMPLETED'`

Per agent grep across `backend/src/`:

| # | File:line | Path | Clears seats | Clears socket maps | Calls deleteIfGuestTable | Fires bus event |
|---|---|---|---|---|---|---|
| 1 | socketHandler.js:286 | Idle timeout phase 2 | ✗ | ✓ (unregister) | ✓ | `table.completed` |
| 2 | socketHandler.js:491 | Room-create StrictMode cleanup | ✗ | ✓ | ✓ | ✗ |
| 3 | socketHandler.js:644 | HvB room transition cleanup | ✗ | ✓ (full) | ✓ | ✗ |
| 4 | socketHandler.js:1094 | `room:cancel` (FORMING) | ✗ | ✓ (all sockets) | ✓ | ✗ |
| 5 | socketHandler.js:1156 | `game:move` win/draw | ✗ | ✗ (deferred) | ✗ (intentional, for Rematch) | ✗ |
| 6 | socketHandler.js:1285 | `game:forfeit` | ✗ | ✗ | ✓ | ✗ |
| 7 | socketHandler.js:1621 | Disconnect → FORMING host left | ✗ | ✓ | ✓ | ✗ |
| 8 | socketHandler.js:1665 | Disconnect → both players gone | ✗ | ✓ | ✓ | ✗ |
| 9 | socketHandler.js:1696 | Disconnect → 60 s forfeit timer | ✗ | partial | ✓ | ✗ |
| 10 | botGameRunner.js:374 | Demo bot game finishes | ✗ | n/a | n/a | ✗ |
| 11 | admin.js:1474 | `DELETE /api/v1/admin/tables/:id` | ✗ | **✗ all stale** | ✗ | `table.deleted` |
| 12 | tableGcService.js:114 | GC `deleteOldCompleted` (delete row) | n/a | ✗ | n/a | ✗ |
| 13 | tableGcService.js:144 | GC `sweepDemos` (delete row) | n/a | ✗ | n/a | `table.deleted` |
| 14 | tableGcService.js:198 | GC `abandonIdleActive` (mark COMPLETED) | ✗ | ✗ | ✗ | `room:abandoned` (socket only) |

`mlService.js:462,579` and `skillService.js:503,620` also write `status: 'COMPLETED'` but on `MlSession`/`SkillTraining`, not `Table` — out of scope.

---

## Path-by-path notes

### Backend active paths

- **`socket.on('disconnect')`** (`socketHandler.js:1570–1715`). Three sub-branches (FORMING / COMPLETED / ACTIVE). Only branch that calls `broadcastTablePresence()`. ACTIVE branch starts a 60 s forfeit timer instead of completing immediately. **Never** calls `socket.leave('table:…')` in the main flow — stale socket.io room membership.
- **`room:leave`** — does not exist on the server. The `game:leave` handler at `socketHandler.js:1299` is a one-line relay (`socket.to(...).emit('game:opponent_left')`); zero cleanup.
- **`game:move` completion** — *intentionally* defers `deleteIfGuestTable` so Rematch works (`socketHandler.js:1173–1177` comment). But `game:forfeit` (line 1291) deletes immediately. **Inconsistent timing**.
- **`game:forfeit`** — deletes guest tables immediately; doesn't broadcast presence; no bus event.
- **Admin `DELETE`** — flips status, dispatches `table.deleted`, but leaves `_socketToTable` / `_disconnectTimers` populated. Stale timers continue to fire (safe — guarded by `if (t.status !== 'ACTIVE') return`, but wasteful).

### Frontend paths

- **"Leave Table" button** — declared at `PlatformShell.jsx:433`, conditional on `onLeave` prop. `PlayPage.jsx:218–231` never passes `onLeave`. **Button is never visible during active play.**
- **`useGameSDK.js:150,153`** — `sdk.leave()` emits `game:forfeit` mid-game or `game:leave` post-game. Only fires when the user clicks Leave. Page unload doesn't reach it.
- **`socket.js:66–68`** — `visibilitychange` handler calls `reconnectIfDropped()`. Comment explicitly explains the prior disconnect-on-hide caused false room timeouts → it's a recovery hook, not a release hook.
- **`useGameSDK.js:587–594`** — `visibilitychange` on `'visible'` emits `idle:pong`. Pure auto-pong; no release.
- **`TableDetailPage.jsx`** — has a `pagehide` listener that emits `table:unwatch` (advisory only). This is the *only* `pagehide` in the project.
- **No `beforeunload` / `unload` / `sendBeacon`** anywhere.
- **No BFCache `pageshow` handler** — restore goes through the normal `visibilitychange` reconnect path.

### Passive paths (GC)

- **`deleteStaleForming`**, **`sweepDemos`**, **`deleteOldCompleted`** — delete the row but don't unregister sockets pointing at it. `_socketToTable[sid]` becomes a stale tableId until the next disconnect.
- **`abandonIdleActive`** — marks ACTIVE → COMPLETED via bulk `updateMany`, emits `room:abandoned`, but doesn't clear `_disconnectTimers`, `_idleTimers`, or `_socketToTable`. Doesn't call `broadcastTablePresence()` either.
- **`sweepStaleSpars`** / **`deleteOldSparGames`** — bot-runner / Game-row cleanup. Out of scope for the seat-release symptom.

### In-memory presence layer

- `_tableWatchers` (`tablePresence.js:18`) — populated by `table:watch`, drained by `table:unwatch`/disconnect. **Never drained when GC deletes the table.**
- `_socketToTable`, `_socketToUser`, `_spectatorSockets` (`socketHandler.js:50–60`) — same gap: drained on disconnect / room:cancel only.
- `_disconnectTimers` — drained on reconnect, timer-fire, or both-players-gone branch. Not touched by GC; orphaned timers are safe but waste a `db.table.findUnique` per orphan.
- `_idleTimers` — drained on disconnect, completion, room:cancel. Not touched by GC.
- `broadcastTablePresence(io, tableId)` is called only from disconnect, table:watch, and table:unwatch. **Not from any COMPLETED transition** — spectators never see status change in real time.

### Notification-bus events today

| Event type | Fired from | Has reason field? |
|---|---|---|
| `table.created` | tables.js | n/a |
| `table.deleted` | admin.js, tableGcService.js (×2) | no |
| `table.completed` | socketHandler.js:258 (idle abandon) | no |
| `player.joined` / `player.left` | tables.js | no |

No `table.released` event with `{disconnect, leave, game-end, gc-stale, gc-idle, admin, guest-cleanup}` reasons — that is brand new in chunk 3.

---

## Punch list (what chunk 3 has to fix)

### Required to close the V1 acceptance scenario

- **F1** Free seats on every COMPLETED transition. Add a small helper (`releaseSeats(table)` returns updated seats array with all `status: 'occupied' → 'empty'`) and call it from every site in the table above.
- **F2** Wire a graceful close on `pagehide` (and `visibilitychange === 'hidden'` on iOS where `pagehide` may not fire) in `PlayPage.jsx`. Send `game:forfeit` mid-game / `game:leave` post-game via `socket.emit` *or* `navigator.sendBeacon` to a new HTTP endpoint as a fallback.
- **F3** Wire `PlayPage.jsx` to pass `onLeave` to `PlatformShell.jsx`. The button exists; it just isn't connected.
- **F4** GC sweeps must clear in-memory state for the rows they touch: when GC deletes/completes a table, iterate `_socketToTable` and `unregisterSocket` any sockets pointing at it; clear matching `_disconnectTimers` / `_idleTimers`.
- **F5** Admin `DELETE` must also unregister sockets and clear timers for the affected table.

### Telemetry (per chunk-3 plan)

- **F6** Add `table.released{reason}` bus event with reasons ∈ `{disconnect, leave, game-end, gc-stale, gc-idle, admin, guest-cleanup}`. Fire from every site in the inventory table.
- **F7** Add a `table.released_total{reason}` counter to `resourceCounters.js` and surface in `/api/v1/admin/health/tables` (chunk 2 endpoint).
- **F8** Call `broadcastTablePresence()` from every COMPLETED transition (room:cancel, game:move, game:forfeit, admin DELETE, GC) so spectators see status change without a manual refresh.

### Smaller polish items (probably defer)

- **P1** Make `socket.leave('table:…')` symmetric across all release paths; today only the HvB transition does it.
- **P2** Reconcile guest-table deletion timing between `game:move` (deferred) and `game:forfeit` (immediate). Choose one rule and document it.
- **P3** Drop the diagnostic `console.log` calls in `landing/src/lib/socket.js` once the Safari hang is verified fixed.

---

## Scope recommendation

Three commits, smallest first, gateable on staging soak between them:

- **Commit 1 — F1, F2, F3.** The user-visible fix. Closes the "seats stuck" symptom and the Safari close gap. ~5 files changed, no new endpoints.
- **Commit 2 — F4, F5.** In-memory consistency. Pure backend cleanup; no UI surface. Lower bar to test.
- **Commit 3 — F6, F7, F8.** Telemetry + spectator broadcast. Builds on chunk 2's `/health/tables` endpoint. The per-reason distribution becomes the V1-acceptance success metric.

Polish (P1–P3) can ride along with whichever commit they touch.
