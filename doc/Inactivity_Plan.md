# Inactivity Timer Plan

## Goals

1. **Idle warning + auto-remove** — warn any room participant who has gone quiet, then remove them if they don't respond: abandon the room if the absent participant is a player, boot them silently if a spectator
2. **Admin visibility** — `lastActiveAt` timestamp tracked per user, surfaced in the admin users table

---

## Schema Change

Add one field to `User`:

```prisma
lastActiveAt  DateTime?
```

Migration backfills `null` for all existing users (no default — null means "never recorded").

---

## Activity Tracking

**What counts as activity (silently resets the idle timer):**
- Making a move (players only)

**What does NOT reset the timer:**
- Mouse movement, scrolling, or other client-side events — too noisy to track server-side and not worth the complexity. The "Still Active?" popup is the intended escape valve for waiting/watching participants.

**Write strategy for `lastActiveAt` — Redis buffer, Postgres flush:**
- On any authenticated REST API request or Socket.io event: write `lastActiveAt` to Redis (`SET user:active:{id} {timestamp} EX 300`)
- Background job (`setInterval`, every 60s): flush Redis activity timestamps to Postgres in a batch update
- This avoids a Postgres write on every socket event

---

## Per-Room Idle Timer (Server-Side)

> **Important distinction:** The activity tracking above (Redis → Postgres `lastActiveAt`) is solely for admin visibility. The per-room idle timer below is purely in-memory inside `roomManager` — it does not read from or write to Redis. These are two independent systems that happen to serve different goals.

Managed in `roomManager.js`. A **single session-level idle timer** runs for every room participant — players and spectators alike — regardless of whose turn it is. This uniform approach eliminates the need to track turn state in the idle logic and solves the spectator case without heartbeats.

**Note:** This is separate from the existing per-move chess-clock forfeit timer (used in timed game modes). Both coexist — the chess clock counts down the active player's move budget; the idle timer detects AFK across the whole session.

**Flow:**
1. On each move, reset the moving player's idle timer
2. After `idleWarnSeconds` of no interaction, emit `idle:warning` to that participant — show a "Still Active?" popup with a countdown
3. If they click "Still Active?" → client emits `idle:pong`, server resets the timer, popup dismisses. Server must listen for `idle:pong` in `roomManager` as a valid reset trigger alongside a move.
4. If they don't respond within `idleGraceSeconds` of the warning being issued:
   - **Player** → abandon and clean up the room. Notify all participants with `room:abandoned` (reason: `'idle'`). No ELO change, no game record written.
   - **Spectator** → emit `room:kicked` (reason: `'idle'`) to that socket only and remove them from the room. Room continues for other participants.

**Simultaneous AFK guard:** If both players' timers fire at the same time, the first `room:abandoned` tears down the room. `roomManager` must check the room still exists before acting on any subsequent timer — ignore silently if already cleaned up.

> **Why abandon rather than forfeit for players?** An AFK player didn't choose to lose — they lost connectivity or were distracted. Penalising them with an ELO loss and recording a win for the opponent would skew ratings. Room abandonment is a clean no-result outcome.

**Thresholds** — stored in `SystemConfig` (already exists), configurable by admin:
- `game.idleWarnSeconds` — default 120 (2 min): time since last activity before the "Still Active?" popup appears
- `game.idleGraceSeconds` — default 60 (1 min): time from warning issued before removal if no response
- `game.spectatorIdleSeconds` — default 600 (10 min): warn threshold for spectators; grace period reuses `idleGraceSeconds`

---

## Frontend Changes

**`idle:warning` socket event** — server sends `{ secondsRemaining: N }`:
- Show a "Still Active?" popup with a countdown timer
- User clicks "Still Active?" → emit `idle:pong` to server, dismiss popup, timer resets
- Countdown escalates visually as time runs low (turns red under 30s)
- Making a move also dismisses the popup (move itself resets the server timer)
- If the opponent makes a move (turn changes), automatically dismiss the popup — the turn transition is a natural activity signal. Listen for the existing move/turn-change socket event on the frontend and close the popup if visible.

**`room:abandoned` socket event** — server sends `{ reason: 'idle', absentUserId }`:
- AFK player: show "You were removed from the room due to inactivity" and navigate to lobby
- Opponent: show toast "Your opponent left due to inactivity — no result recorded" and navigate to lobby
- Spectators: silently navigate away (room is gone)
- No game-over screen, no ELO update, no result recorded

**`room:kicked` socket event** — server sends `{ reason: 'idle' }` (spectator only):
- Show a brief toast ("You were removed for inactivity") and navigate away
- Room continues unaffected for remaining participants

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
3. Admin display (`lastActiveAt` column + filter)
4. SystemConfig defaults seeded (`game.idleWarnSeconds`, `game.idleGraceSeconds`, `game.spectatorIdleSeconds`) + admin controls on the general Admin page
5. Server-side session-level idle timer in `roomManager` + `idle:warning` / `room:abandoned` / `room:kicked` socket events
6. Frontend "Still Active?" popup + `idle:pong` response
7. Frontend `room:abandoned` and `room:kicked` handling
