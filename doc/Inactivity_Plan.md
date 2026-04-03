# Inactivity Timer Plan

## Goals

1. **In-game idle warning + auto-forfeit** — warn a player who hasn't moved on their turn, then forfeit if they don't respond
2. **Boot idle users from rooms** — remove players and spectators who go silent for too long
3. **Admin visibility** — `lastActiveAt` timestamp tracked per user, surfaced in the admin users table

---

## Schema Change

Add one field to `User`:

```prisma
lastActiveAt  DateTime?
```

Migration backfills `null` for all existing users (no default — null means "never recorded").

---

## Activity Tracking

**What counts as activity:**
- Any authenticated REST API request (middleware touch)
- Any Socket.io event from a connected client (move, room join, heartbeat)

**Write strategy — Redis buffer, Postgres flush:**
- On activity: write `lastActiveAt` to Redis (`SET user:active:{id} {timestamp} EX 300`)
- Background job (`setInterval`, every 60s): flush Redis activity timestamps to Postgres in a batch update
- This avoids a Postgres write on every socket event

---

## Per-Room Idle Timer (Server-Side)

Managed in `roomManager.js`. Timers are keyed by room + player.

**Flow:**
1. On each move, reset the active player's idle timer
2. After `idleWarnAt` seconds with no move on their turn, emit `idle:warning` to that player with seconds remaining
3. After `idleForftAt` seconds total, server triggers the existing forfeit flow

**Thresholds** — stored in `SystemConfig` (already exists), configurable by admin:
- `game.idleWarnSeconds` — default 120 (2 min)
- `game.idleForfeitSeconds` — default 180 (3 min)
- `game.spectatorIdleSeconds` — default 600 (10 min, then boot from room)

---

## Frontend Changes

**`idle:warning` socket event** — server sends `{ secondsRemaining: N }`:
- Show a countdown overlay on the game board ("Move or you'll forfeit in Ns")
- Any move dismisses it
- Overlay escalates visually as time runs low (e.g. turns red under 30s)

**`idle:forfeit` socket event** — server forfeits the player:
- Reuse the existing forfeit/game-over UI

**Spectator boot** — server emits `room:kicked` with reason `'idle'`:
- Show a brief toast ("You were removed for inactivity") and navigate away

---

## Admin Visibility

- Add `lastActiveAt` column to the admin users table
- Show as relative time ("3 min ago", "2 days ago") or "Never"
- Add to the existing online status filter (Online / Offline / Inactive > 7 days)

---

## Out of Scope

- Tournament-specific idle rules (handled separately when tournaments are built)
- AI/bot games — bots respond instantly, idle timers don't apply
- Bot-vs-bot games — server-driven, no human idle concern

---

## Implementation Order

1. Schema + migration (`lastActiveAt`)
2. Activity middleware + Redis buffer + Postgres flush job
3. Admin display
4. Server-side per-room idle timer in `roomManager`
5. `idle:warning` + `idle:forfeit` socket events
6. Frontend countdown overlay
7. Spectator idle boot + `room:kicked` handling
8. SystemConfig defaults + admin controls
