# Notification Bus — Implementation Plan

> **Status: READY TO BUILD**
> Requirements closed. See `notification_bus_requirements.md` for full design rationale.
>
> **Scope:** Core bus + event registry + durable scheduler + migrate existing notifications.
> Buddy list, challenge system, and SMS deferred to Future Ideas.

---

## What We're Building (and What We're Not)

### In scope
- `dispatch()` function — the single entry point for all notification events
- Event type registry — defines delivery mode, persistence rule, and message template per type
- `NotificationPreference` table — per-user opt-in per event type
- `ScheduledJob` table + periodic dispatcher — replaces `setInterval` in the tournament sweep; survives restarts
- Queue flush on reconnect — deliver unread persistent notifications when a user comes back online
- Migrate existing notification paths to use `dispatch()`:
  - `notificationService.js` (tier upgrades, credit milestones)
  - `tournamentBridge.js` (tournament lifecycle events)
  - `resourceCounters.js` (system alerts)

### Out of scope (deferred — see Future Ideas)
- Buddy list (`BuddyRelationship` table, `buddy.online` events)
- Challenge system (`challenge.received`, `challenge.broadcast`)
- SMS delivery (schema supports it; no provider selected)
- Notification inbox / history UI
- Push notifications (mobile/browser Push API)
- Per-tournament notification preferences
- Rate limiting / digest mode

---

## Codebase Reality Checks

These are gaps between the original plan and the actual codebase that must be handled during implementation.

### 1. Queue flush hook is `user:subscribe`, not a generic auth event

The plan originally said "socket authentication handler." In the real codebase the correct hook is the `user:subscribe` socket event in `socketHandler.js` — that is where `socket.join('user:{userId}')` happens and is the right place to flush undelivered notifications.

### 2. `tournamentBridge.js` owns `_pendingPvpMatches` — do not strip it bare

The bridge contains more than delivery logic. It owns `_pendingPvpMatches`, an in-memory map of in-flight PvP tournament matches keyed by `matchId`, with `getPendingPvpMatch()`, `setPendingPvpMatchSlug()`, and `deletePendingPvpMatch()` exported and imported by `socketHandler.js`. When refactoring the bridge to a thin Redis consumer, this match registry must be preserved exactly as-is — either kept in `tournamentBridge.js` or moved to its own `pendingPvpMatches.js` module. Do not accidentally delete it.

### 3. `emailAchievements` boolean must be migrated to `NotificationPreference` rows

The current email opt-in is a single `emailAchievements: Boolean` column on the `User` model. When seeding `NotificationPreference` rows for existing users, read each user's `emailAchievements` value and set `email: true` on `achievement.tier_upgrade` and `achievement.milestone` rows accordingly. Without this, all existing users silently lose their email opt-in on deploy.

### 4. `resultNotifPref` on `TournamentParticipant` is a separate, preserved preference

`tournamentBridge.js` checks `resultNotifPref` (`AS_PLAYED` vs `END_OF_TOURNAMENT`) per participant to decide whether to emit `match.result` immediately or batch at tournament end. This is a tournament-specific preference that is distinct from the global `NotificationPreference` table and must be preserved. The `dispatch()` path for `match.result` must check this column before emitting in real time. Do not route `match.result` through generic preferences without accounting for this.

### 5. Online check should use socket room membership, not a DB session query

`notificationService.js` currently calls `isUserOnline()` which queries `baSession` from the database to determine if a user is online. Once `user:{userId}` socket rooms exist (they already do via `user:subscribe`), the bus should instead check `_io.sockets.adapter.rooms.has('user:${userId}')` — instantaneous, no DB round-trip. The `isUserOnline()` helper should be replaced or bypassed in the bus.

### 6. Dedup logic from `queueNotification()` must be carried forward

The current `queueNotification()` deduplicates: it checks for an existing undelivered row of the same type+key before inserting. For example, only one undelivered `tier_upgrade` per tier value, only one per `credit_milestone` score. `dispatch()` must replicate this — otherwise users will receive duplicate persistent notifications when they reconnect after multiple events were queued.

### 7. `tournament:match:results:batch` socket event must survive the refactor

When a tournament completes, the bridge flushes all pending `match.result` notifications for `END_OF_TOURNAMENT` participants in a single batch, emitting a `tournament:match:results:batch` socket event with an array of `matchId`s. This custom event is not routed through `guide:notification` and must be explicitly preserved in the refactored bridge. It is not replaced by `dispatch()`.

---

## Schema Changes

### 1. Add `readAt` to `UserNotification`

```prisma
model UserNotification {
  id          String    @id @default(cuid())
  userId      String
  type        String
  payload     Json
  createdAt   DateTime  @default(now())
  deliveredAt DateTime?
  readAt      DateTime?   // NEW — user dismissed/acknowledged
  emailedAt   DateTime?
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 2. Add `NotificationPreference`

```prisma
model NotificationPreference {
  id        String  @id @default(cuid())
  userId    String
  eventType String
  inApp     Boolean @default(true)
  email     Boolean @default(false)
  sms       Boolean @default(false)   // future — always false for now
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, eventType])
}
```

### 3. Add `ScheduledJob`

```prisma
model ScheduledJob {
  id          String             @id @default(cuid())
  type        String
  payload     Json
  runAt       DateTime
  status      ScheduledJobStatus @default(PENDING)
  attempts    Int                @default(0)
  maxAttempts Int                @default(3)
  lastError   String?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@index([status, runAt])
}

enum ScheduledJobStatus {
  PENDING
  RUNNING
  DONE
  FAILED
}
```

---

## New Files

```
backend/src/lib/
  notificationBus.js       — dispatch(), event registry, delivery routing
  scheduledJobs.js         — periodic dispatcher, job CRUD helpers
```

---

## Implementation Steps

### Phase 1 — Schema

- [ ] Add `readAt` to `UserNotification` in `schema.prisma`
- [ ] Add `NotificationPreference` model to `schema.prisma`
- [ ] Add `ScheduledJob` model + `ScheduledJobStatus` enum to `schema.prisma`
- [ ] Run migration: `docker compose run --rm backend npx prisma migrate dev --name notification_bus`

---

### Phase 2 — Event Registry + `dispatch()`

Create `backend/src/lib/notificationBus.js`.

**Event registry** — one entry per known type:

```js
const REGISTRY = {
  'tournament.published':            { mode: 'broadcast', persist: 'ephemeral',  email: false },
  'tournament.flash_announced':      { mode: 'broadcast', persist: 'ephemeral',  email: false },
  'tournament.registration_closing': { mode: 'cohort',    persist: 'persistent', email: false },
  'tournament.starting_soon':        { mode: 'cohort',    persist: 'persistent', email: false },
  'tournament.started':              { mode: 'cohort',    persist: 'persistent', email: false },
  'tournament.cancelled':            { mode: 'cohort',    persist: 'persistent', email: true  },
  'tournament.completed':            { mode: 'cohort',    persist: 'persistent', email: true  },
  'match.ready':                     { mode: 'personal',  persist: 'persistent', email: true,  systemCritical: true },
  'match.result':                    { mode: 'personal',  persist: 'persistent', email: false },
  'achievement.tier_upgrade':        { mode: 'personal',  persist: 'persistent', email: false },
  'achievement.milestone':           { mode: 'personal',  persist: 'persistent', email: false },
  'admin.announcement':              { mode: 'broadcast', persist: 'persistent', email: false },
  'system.alert':                    { mode: 'personal',  persist: 'persistent', email: false, systemCritical: true },
}
```

**Default preferences** — applied when no row exists for a user+eventType:

```js
const PREF_DEFAULTS = {
  'tournament.published':            { inApp: true,  email: false },
  'tournament.flash_announced':      { inApp: true,  email: false },
  'tournament.registration_closing': { inApp: true,  email: false },
  'tournament.starting_soon':        { inApp: true,  email: false },
  'tournament.started':              { inApp: true,  email: false },
  'tournament.cancelled':            { inApp: true,  email: true  },
  'tournament.completed':            { inApp: true,  email: true  },
  'match.ready':                     { inApp: true,  email: true  },
  'match.result':                    { inApp: true,  email: false },
  'achievement.tier_upgrade':        { inApp: true,  email: false },
  'achievement.milestone':           { inApp: true,  email: false },
  'admin.announcement':              { inApp: true,  email: false },
  'system.alert':                    { inApp: true,  email: false },
}
```

**`dispatch()` signature:**

```js
// targets: { userId } | { cohort: [userId, ...] } | { broadcast: true }
export async function dispatch({ type, targets, payload }) { ... }
```

**Dispatch logic (per target user):**
1. Look up event type in registry — log warning and return if unknown
2. Resolve target user IDs from `targets`
3. For each user:
   - Load their preference row, or fall back to `PREF_DEFAULTS`
   - If `inApp` off and not `systemCritical` → skip entirely
   - Check for existing undelivered row with same type+key before inserting (dedup — see Reality Check #6)
   - If `persist !== 'ephemeral'` → write `UserNotification` row
   - Emit `guide:notification` to `user:{userId}` socket room (always attempt)
   - Check online via `_io.sockets.adapter.rooms.has('user:${userId}')` (not a DB query — see Reality Check #5)
   - If `email` pref on, event `email: true`, and user not currently connected → call `notificationService.sendEmail()`
4. For `broadcast` mode: emit to all sockets; persist per-user only if `persist !== 'ephemeral'` and only for authenticated users

**Socket wiring** — pass `io` on startup to avoid circular import:
```js
let _io = null
export function initBus(io) { _io = io }
```

**`dispatch()` must never throw.** Producers assume fire-and-forget. Any DB error, socket error, or email failure inside `dispatch()` must be caught internally and logged — never propagated to the caller. Wrap the entire function body in try/catch.

**Broadcast persistence is O(users).** For `admin.announcement` (broadcast + persistent), writing one `UserNotification` row per authenticated user is acceptable now but becomes expensive as user count grows. Use a bulk `createMany()` insert, not a loop of individual `create()` calls, to keep it as fast as possible at current scale.

- [ ] Create `backend/src/lib/notificationBus.js` with registry, defaults, and `dispatch()`
- [ ] Export `dispatch` and `initBus`
- [ ] Call `initBus(io)` in `backend/src/index.js` after Socket.io is created
- [ ] Implement dedup check (existing undelivered row) before inserting `UserNotification`
- [ ] Use socket room membership for online check, not `isUserOnline()` DB query
- [ ] Wrap `dispatch()` body in try/catch — must never throw to callers
- [ ] Use `createMany()` for broadcast persistent notifications, not a per-user loop
- [ ] Unit test: `dispatch()` writes a `UserNotification` row for persistent personal events
- [ ] Unit test: `dispatch()` skips in-app delivery for opted-out users (non-critical)
- [ ] Unit test: `dispatch()` still delivers in-app for `systemCritical` events even when pref is off
- [ ] Unit test: `dispatch()` deduplicates — does not insert a second row if one exists undelivered
- [ ] Unit test: `dispatch()` does not throw when DB is unavailable — logs and returns

---

### Phase 3 — Durable Scheduler

Create `backend/src/lib/scheduledJobs.js`.

**Job handlers** — registered by type, each calls `dispatch()` or a service function:

```js
const HANDLERS = {
  'tournament.warn':  async ({ tournamentId, name, participantIds }) =>
    dispatch({ type: 'tournament.starting_soon', targets: { cohort: participantIds }, payload: { tournamentId, name } }),
  'tournament.start': async ({ tournamentId }) =>
    tournamentService.autoStart(tournamentId),
}
```

**Dispatcher loop** — runs every 30s:
1. Atomically claim `PENDING` jobs with `runAt <= now` and `attempts < maxAttempts` (set `status = RUNNING`, increment `attempts`)
2. Execute `HANDLERS[job.type](job.payload)` for each claimed job
3. On success → set `status = DONE`
4. On failure → if `attempts >= maxAttempts` set `status = FAILED` and dispatch `system.alert` to admins; else reset to `PENDING` for retry

**Exported helpers:**

```js
export async function scheduleJob({ type, payload, runAt })
export async function cancelJobs({ type, where })   // e.g. cancel by tournamentId in payload
export function startDispatcher()                    // starts the 30s interval; returns the interval ID
```

**Stuck RUNNING job recovery on startup.** If the backend crashes while a job is executing, it stays in `RUNNING` status permanently — the dispatcher skips it on every tick. On startup, before `startDispatcher()` begins, reset any jobs stuck in `RUNNING` back to `PENDING`:

```js
// In startDispatcher() preamble — run once before interval starts
await db.scheduledJob.updateMany({
  where: { status: 'RUNNING' },
  data:  { status: 'PENDING' },
})
```

**Multiple warning intervals need separate jobs.** The current `tournament:warning` event sends warnings at 60 min, 15 min, and 2 min before start — with different persistence rules (60-min and 2-min are persisted; 15-min is real-time only). A single `tournament.warn` job type is insufficient. Schedule three separate jobs per tournament:

| Job type | Offset from start | Persist? |
|---|---|---|
| `tournament.warn.60` | startTime − 60 min | Yes |
| `tournament.warn.15` | startTime − 15 min | No (socket only) |
| `tournament.warn.2`  | startTime − 2 min  | Yes |

Register a handler for each. `cancelJobs()` must cancel all three when a tournament is cancelled or rescheduled.

- [ ] Create `backend/src/lib/scheduledJobs.js`
- [ ] Reset stuck RUNNING jobs to PENDING on startup before dispatcher begins
- [ ] Call `startDispatcher()` in `backend/src/index.js` on startup; call `.unref()` on the returned interval so it doesn't block process exit
- [ ] Register `tournament.warn.60`, `tournament.warn.15`, `tournament.warn.2`, and `tournament.start` handlers
- [ ] Schedule all four jobs when a tournament is published; cancel all four on reschedule or cancellation
- [ ] Unit test: dispatcher claims and executes a PENDING job, marks DONE
- [ ] Unit test: failed job increments attempts; moves to FAILED after maxAttempts; dispatches system.alert
- [ ] Unit test: `cancelJobs()` removes pending jobs matching a tournamentId
- [ ] Unit test: startup recovery resets RUNNING jobs to PENDING

---

### Phase 4 — Migrate Existing Notification Paths

#### 4a — `notificationService.js`

Map old type strings to registry keys and route through `dispatch()`:

| Old type | New registry key |
|---|---|
| `tier_upgrade` | `achievement.tier_upgrade` |
| `credit_milestone`, `first_hpc`, `first_bpc`, `first_tc` | `achievement.milestone` |
| `system_alert` | `system.alert` |
| `tournament_match_ready` | `match.ready` |
| `tournament_match_result` | `match.result` |
| `tournament_starting_soon` | `tournament.starting_soon` |
| `tournament_completed` | `tournament.completed` |
| `tournament_cancelled` | `tournament.cancelled` |

Keep `sendEmail()` as an internal helper called by the bus — do not delete it.

**Seed `NotificationPreference` from `emailAchievements`:**

Write a one-time migration script (or run inline on first deploy) that reads `emailAchievements` from each `User` row and seeds `NotificationPreference` rows for `achievement.tier_upgrade` and `achievement.milestone` with `email` set accordingly. Without this, existing users lose their email opt-in silently.

**Update frontend type keys before deploying the backend migration.** `AccomplishmentPopup.jsx` maps `TYPE_TITLES` and `TYPE_ICONS` to the old type strings (`tier_upgrade`, `credit_milestone`, `first_hpc`, etc.). Once the bus is live it will emit new keys (`achievement.tier_upgrade`, `achievement.milestone`). Deploy the frontend update first or simultaneously — if the backend ships first, the popup will silently show blank titles for any notifications that arrive in the gap.

**Dry-run the `emailAchievements` seed before running it on staging.** Add a `--dry-run` flag that logs what rows would be created without writing to the DB. Review the output before committing.

- [ ] Replace `queueNotification()` calls with `dispatch()` using new type keys
- [ ] Write preference seed script with `--dry-run` mode; review output before running on staging
- [ ] Run preference seed for existing users from `emailAchievements`
- [ ] Update `AccomplishmentPopup.jsx` `TYPE_TITLES` and `TYPE_ICONS` to new registry keys **before or alongside** backend deploy
- [ ] Confirm accomplishment popup still fires end-to-end after migration

#### 4b — `tournamentBridge.js`

Refactor from a delivery layer to a thin Redis consumer. **Preserve `_pendingPvpMatches` and all its exports** — do not remove or relocate without updating `socketHandler.js` imports.

- [ ] Preserve `_pendingPvpMatches`, `getPendingPvpMatch()`, `setPendingPvpMatchSlug()`, `deletePendingPvpMatch()` — these are imported by `socketHandler.js` and must not be touched
- [ ] Replace direct `io.emit()` / `io.to(...).emit()` calls with `dispatch()` where applicable
- [ ] **Preserve `tournament:match:results:batch`** — the batch flush for `END_OF_TOURNAMENT` participants at tournament completion emits this custom socket event; it is not routed through `dispatch()` or `guide:notification`
- [ ] Preserve `resultNotifPref` check — `match.result` real-time delivery is gated on `AS_PLAYED` vs `END_OF_TOURNAMENT` per participant; this logic stays in the bridge
- [ ] When a tournament is published: call `scheduleJob({ type: 'tournament.warn', runAt: startTime - 15min })` and `scheduleJob({ type: 'tournament.start', runAt: startTime })`
- [ ] When a tournament's start time changes: `cancelJobs()` old jobs, create new ones
- [ ] When a tournament is cancelled: `cancelJobs()` all pending jobs for that tournament
- [ ] Remove the `setInterval`-based sweep from the tournament service — scheduler handles it now

#### 4c — `resourceCounters.js`

- [ ] Replace `notifyAdmins()` body with `dispatch({ type: 'system.alert', targets: { cohort: adminIds }, payload: { key, message } })`
- [ ] Remove the direct `db.userNotification.create()` calls from `resourceCounters.js`

---

### Phase 5 — Queue Flush on Reconnect

Add flush logic to the `user:subscribe` socket event handler in `socketHandler.js` — this is where `socket.join('user:{userId}')` already happens and is the correct reconnect hook.

```js
on('user:subscribe', async ({ authToken } = {}) => {
  const user = await resolveSocketUser(authToken)
  if (!user) return
  socket.join(`user:${user.id}`)

  // Flush undelivered persistent notifications
  const unread = await db.userNotification.findMany({
    where:   { userId: user.id, deliveredAt: null },
    orderBy: { createdAt: 'asc' },
    take:    20,
  })
  for (const n of unread) {
    socket.emit('guide:notification', { type: n.type, payload: n.payload })
  }
  if (unread.length > 0) {
    await db.userNotification.updateMany({
      where: { id: { in: unread.map(n => n.id) } },
      data:  { deliveredAt: new Date() },
    })
  }
})
```

- [ ] Add queue flush to `user:subscribe` handler in `socketHandler.js`
- [ ] Cap at 20 most recent undelivered notifications
- [ ] Integration test: user receives queued notification on reconnect after being offline

---

### Phase 6 — Preference API + Settings UI

**Backend endpoints:**

```
GET  /api/users/notification-preferences
     Response: [{ eventType, inApp, email }]  — all registry types, defaults filled in

PUT  /api/users/notification-preferences/:eventType
     Body: { inApp, email }
     → upsert NotificationPreference row
```

- [ ] Add `GET /api/users/notification-preferences` to the users router
- [ ] Add `PUT /api/users/notification-preferences/:eventType` to the users router
- [ ] Reject unknown `eventType` values (not in registry) with 400
- [ ] Unit test: GET returns full list with defaults for a user with no rows
- [ ] Unit test: PUT upserts; subsequent GET reflects the change

**Frontend — `SettingsPage.jsx`:**

- [ ] Add "Notifications" section below the existing Guide button toggle
- [ ] Fetch preferences on mount via `api.users.getNotificationPreferences()`
- [ ] Render a toggle row per event type with **In-App** and **Email** columns
- [ ] Group rows by category: Tournaments / Matches / Achievements / System
- [ ] Save on toggle change (immediate PUT, no save button)
- [ ] System-critical rows (`match.ready`, `system.alert`): disable the In-App toggle with a tooltip "Always on"

---

### Phase 7 — Instrumentation & Resource Monitoring

The notification bus introduces several new resources that can leak or stall. These must be tracked in the existing health snapshot system (`resourceCounters.js`) alongside sockets, rooms, Redis connections, and memory.

#### New resources to monitor

| Resource | What to watch | Leak signal |
|---|---|---|
| `UserNotification` queue | Count of rows where `deliveredAt IS NULL` | Grows indefinitely — flush is broken or users never reconnect |
| `ScheduledJob` PENDING | Count of PENDING jobs | Grows — dispatcher has stalled or is not running |
| `ScheduledJob` RUNNING | Count of RUNNING jobs older than 2× dispatch interval (60s) | Stuck jobs — handler threw but status never updated |
| `ScheduledJob` FAILED | Count of FAILED jobs | Handlers failing at max attempts — needs admin attention |
| `_pendingPvpMatches` map | Map size | Grows — matches complete without calling `deletePendingPvpMatch()` |
| Dispatcher heartbeat | Timestamp of last dispatcher tick | Stale — interval stopped (process issue or unhandled exception killed the loop) |
| Bus `dispatch()` call rate | Count per type per snapshot | Sudden spike or silence — unexpected event flood or producer stopped |

#### Implementation

Add a `takeBusSnapshot()` function (called from the existing `takeSnapshot()` in `resourceCounters.js`) that queries the DB for live counts and reads in-memory state:

```js
// In scheduledJobs.js — export heartbeat and map size for monitoring
export function getDispatcherHeartbeat() { return _lastTickAt }   // Date
export function getPendingPvpMatchCount() { return _pendingPvpMatches.size }
```

```js
// In notificationBus.js — export dispatch counters
export function getDispatchCounters() { return { ..._dispatchCounters } }  // { type: count }
```

```js
// In resourceCounters.js — extend takeSnapshot()
async function takeBusSnapshot() {
  const [queueDepth, pending, running, failed] = await Promise.all([
    db.userNotification.count({ where: { deliveredAt: null } }),
    db.scheduledJob.count({ where: { status: 'PENDING' } }),
    db.scheduledJob.count({ where: { status: 'RUNNING' } }),
    db.scheduledJob.count({ where: { status: 'FAILED'  } }),
  ])
  return {
    notifQueueDepth:     queueDepth,
    schedulerPending:    pending,
    schedulerRunning:    running,   // >0 for >60s = stuck job
    schedulerFailed:     failed,
    pvpMatchMapSize:     getPendingPvpMatchCount(),
    dispatcherLastTickAt: getDispatcherHeartbeat(),
    dispatchCounters:    getDispatchCounters(),
  }
}
```

**Dispatch a cleared alert when a leak resolves.** Currently when `_alerts[key]` flips back to `false`, only a log line is written. Admins have no in-app signal that the situation resolved. Add a `system.alert.cleared` dispatch (add this type to the registry) when an alert clears, so admins see the all-clear in the Guide panel alongside the original warning.

```js
// Add to registry
'system.alert.cleared': { mode: 'personal', persist: 'persistent', email: false, systemCritical: true },
```

- [ ] Add `system.alert.cleared` to the registry
- [ ] Dispatch it to admins in the `!rising && _alerts[key]` branch of `checkForLeaks()`

#### Leak detection rules (extend `checkForLeaks()`)

Add these to the existing leak detector alongside sockets, rooms, Redis, and memory:

| Counter | Alert condition |
|---|---|
| `notifQueueDepth` | Rises for `LEAK_WINDOW` consecutive snapshots AND depth ≥ 50 AND growth ≥ 10 |
| `schedulerRunning` | Any snapshot where value > 0 for more than 2 minutes (stuck job) |
| `schedulerFailed` | Any snapshot where value > 0 (always alert — failed jobs need attention) |
| `pvpMatchMapSize` | Rises for `LEAK_WINDOW` snapshots AND size ≥ 10 AND growth ≥ 3 |
| Dispatcher heartbeat | Last tick more than 90s ago (dispatcher has stalled) |

#### Admin health page

Extend `GET /api/admin/health` to include bus snapshot data and add rows to `AdminHealthPage.jsx`:

- [ ] `notifQueueDepth` — undelivered notification count (amber if > 20, red if > 100)
- [ ] `schedulerPending` — jobs waiting to run
- [ ] `schedulerRunning` — jobs currently claimed (red if any are stuck > 60s)
- [ ] `schedulerFailed` — jobs that exhausted retries (red if > 0)
- [ ] `pvpMatchMapSize` — in-flight PvP match registry size
- [ ] Dispatcher last tick timestamp — red if > 90s ago

#### Checklist

- [ ] Export `getDispatcherHeartbeat()` and heartbeat tracking from `scheduledJobs.js`
- [ ] Export `getPendingPvpMatchCount()` from `tournamentBridge.js`
- [ ] Export `getDispatchCounters()` from `notificationBus.js`; increment on every `dispatch()` call
- [ ] Add `takeBusSnapshot()` called from `takeSnapshot()` in `resourceCounters.js`
- [ ] Add bus leak rules to `checkForLeaks()`
- [ ] Include bus metrics in `GET /api/admin/health` response
- [ ] Add bus metric rows to `AdminHealthPage.jsx` with appropriate thresholds

---

## Full Checklist

### Schema
- [ ] `readAt` on `UserNotification`
- [ ] `NotificationPreference` model
- [ ] `ScheduledJob` model + `ScheduledJobStatus` enum
- [ ] Migration run and deployed

### Core Bus (`notificationBus.js`)
- [ ] Registry defined (14 event types, including `system.alert.cleared`)
- [ ] Default preferences defined
- [ ] `dispatch()` implemented with dedup and socket-room online check
- [ ] `dispatch()` wrapped in try/catch — never throws to callers
- [ ] Broadcast persistence uses `createMany()` not per-user loop
- [ ] `initBus(io)` wired on startup
- [ ] Unit tests (5)

### Scheduler (`scheduledJobs.js`)
- [ ] Dispatcher loop (30s polling, atomic claim)
- [ ] Startup recovery: reset RUNNING → PENDING before first tick
- [ ] `scheduleJob()`, `cancelJobs()`, `startDispatcher()` exported
- [ ] Heartbeat tracking (`_lastTickAt`) exported
- [ ] Four tournament job handlers registered (`warn.60`, `warn.15`, `warn.2`, `start`)
- [ ] Four jobs scheduled on tournament publish; all cancelled on reschedule/cancel
- [ ] `startDispatcher()` called on backend startup with `.unref()`
- [ ] Unit tests (4)

### Migrations
- [ ] `notificationService.js` → `dispatch()`, type keys updated
- [ ] `emailAchievements` → `NotificationPreference` seed (dry-run reviewed first)
- [ ] `AccomplishmentPopup.jsx` type keys updated — deployed before or with backend
- [ ] `tournamentBridge.js` → `dispatch()` + scheduled jobs; `_pendingPvpMatches` preserved; `tournament:match:results:batch` preserved; `resultNotifPref` logic preserved
- [ ] `resourceCounters.js` → `dispatch()` + `system.alert.cleared` on alert resolution

### Reconnect Flush
- [ ] Queue flush added to `user:subscribe` handler (not a generic auth hook)
- [ ] Cap at 20 most recent undelivered
- [ ] Integration test

### Preference API
- [ ] GET endpoint
- [ ] PUT endpoint with validation
- [ ] Unit tests (2)

### Settings UI
- [ ] Notifications section in `SettingsPage.jsx`
- [ ] Grouped toggle rows (In-App + Email)
- [ ] System-critical always-on indicator

### Instrumentation & Monitoring
- [ ] `getDispatcherHeartbeat()` exported from `scheduledJobs.js`
- [ ] `getPendingPvpMatchCount()` exported from `tournamentBridge.js`
- [ ] `getDispatchCounters()` exported from `notificationBus.js`
- [ ] `takeBusSnapshot()` wired into `takeSnapshot()`
- [ ] Bus leak rules added to `checkForLeaks()`
- [ ] `system.alert.cleared` dispatched when alert resolves
- [ ] Bus metrics in `GET /api/admin/health`
- [ ] `AdminHealthPage.jsx` updated with bus metric rows

---

## Deferred to Future Ideas

| Feature | Why deferred |
|---|---|
| Buddy list | Requires friend request flow; no immediate product need |
| Challenge system | Requires buddy list (1:1) or presence (broadcast); deferred together |
| SMS | Schema ready; just needs a provider selected and wired |
| Notification inbox | `readAt` tracked; UI work deferred until volume justifies it |
| Push notifications | No mobile app yet; browser Push API rarely used |
| Digest / rate limiting | Premature at current user volume |
