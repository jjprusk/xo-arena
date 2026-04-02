# AI Arena — Credits & Activity Tiers Plan

## Overview

Credits are a **lifetime activity score** earned through gameplay engagement. They accumulate
permanently and unlock higher platform limits and capabilities as users hit thresholds. Credits
are never purchased, never expire, and cannot be transferred.

The system is designed to reward genuine participation, not grinding. Each credit type captures
a different dimension of engagement. A combined **Activity Score** (weighted sum) determines the
user's tier, which governs their default platform limits.

> **Admin overrides always win.** The per-user `botLimit` and `mlModelLimit` fields on the User
> record take precedence over tier-derived limits. Admins can exempt specific users from the
> credit system entirely.

---

## Cross-Game Design Principle

The credit system is **game-agnostic by design**. It must work identically for XO Arena today
and any future game (chess, checkers, etc.) without modification to the credit service itself.

This mirrors the feedback system's `appId` pattern:

- Every game that emits credit-earning events passes an `appId` (e.g., `"xo-arena"`, `"chess"`)
  alongside participant and outcome data.
- The credit service never imports or queries game-specific tables directly. Instead, game
  routes call a standardized hook: `creditService.recordGameCompletion(event)`.
- The `Game` table (and any future game's equivalent) carries an `appId` column so credits
  can be reported, filtered, and displayed per-game.
- Activity Score and tiers are **global** across all games — a user's engagement on any game
  counts toward the same tier.
- Capability limits (bots, ML models) are currently global but are structured to accommodate
  per-game pools when a second game ships.

**Phase 5 must be implemented as a generic hook**, not as a direct modification to
`xo-arena/routes/games.js`. Any future game calls the same hook without touching the credit
service internals.

---

## Universal Exclusion

**Games involving built-in AI opponents never earn any credits** (HPC, BPC, or TC). Credits
require real participants — human players or trained user-owned bots competing against each other.

---

## Credit Types

### 1. Human Play Credits (HPC)
Earned when a **human user plays a completed PvP game** (user vs. user, both sides human).

- **+1 HPC** per completed game (win, loss, or draw all count)
- Both participants earn independently
- Game must reach a terminal state (no abandoned/disconnected games)
- Source: `Game` rows where `mode = 'pvp'` and both `player1Id` and `player2Id` are non-bot users

### 2. Bot Play Credits (BPC)
Earned when **any of the user's bots participates in a completed game against an external opponent**.

- **+1 BPC** per completed game involving one of the user's bots (as either player)
- Credits accrue to the **bot's owner**, not the bot
- The opponent must be **external** — i.e., not the owner themselves and not another bot owned by the same user
- Qualifying opponents: other human users, bots owned by a different user
- Non-qualifying (no BPC): owner playing their own bot, two bots with the same `botOwnerId` playing each other, either participant being a built-in AI
- Source: `Game` rows where `player1Id` or `player2Id` is a bot with `botOwnerId = user.id`, and the other participant is neither `user.id` nor a bot with `botOwnerId = user.id`

### 3. Tournament Credits (TC)
Earned when **the user or any of their bots enters a tournament**.

- **+1 TC** per tournament entry (user registration or bot entry)
- Credits awarded at time of entry, not at completion — partial participation still counts
- A single tournament where the user enters themselves AND one bot = +2 TC
- Source: tournament participant records (to be defined when Tournament feature ships)

---

## Activity Score Formula

```
ActivityScore = HPC + BPC + (TC × tcMultiplier)
```

`tcMultiplier` defaults to **5** and is admin-configurable via system config key
`credits.tcMultiplier`. Tournament credits are worth more than play credits because they
represent higher commitment: bracket registration, scheduled participation, and competitive
stakes.

### Example calculations

| User | HPC | BPC | TC | Activity Score | Tier |
|------|-----|-----|----|----------------|------|
| New user | 0 | 0 | 0 | 0 | 🥉 Bronze |
| Casual player | 20 | 5 | 0 | 25 | 🥈 Silver |
| Active bot owner | 30 | 80 | 0 | 110 | 🥇 Gold |
| Tournament regular | 15 | 30 | 10 | 95 → with TC×5: **95** | 🥇 Gold |
| Power user | 200 | 300 | 40 | 700 | 💠 Platinum |

---

## Tiers

Tier thresholds are fully admin-configurable. The table below shows the **default values**
stored under `credits.tiers` system config.

| Tier | Name | System Config Key | Default Min Score | Icon |
|------|------|-------------------|-------------------|------|
| 0 | Bronze | *(baseline)* | 0 | 🥉 |
| 1 | Silver | `credits.tiers.silver` | 25 | 🥈 |
| 2 | Gold | `credits.tiers.gold` | 100 | 🥇 |
| 3 | Platinum | `credits.tiers.platinum` | 500 | 💠 |
| 4 | Diamond | `credits.tiers.diamond` | 2,000 | 💎 |

Tiers are recalculated on-demand (not cached) from live credit counts. There is no
"level up" event — users simply cross thresholds as they play.

---

## Capabilities by Tier

All per-tier capability values are admin-configurable via system config. A value of `0`
means unlimited. The per-user `botLimit` override on the User record takes precedence over
tier defaults.

> **No separate ML model limit.** Each bot has exactly one model (its brain). The bot limit
> is therefore the effective model limit — a user with 8 bots needs at most 8 models.
> ML model count is not independently capped. The tier system governs compute usage
> (episodes, concurrent sessions) rather than the model count itself.

### Bot Limits

| Tier | System Config Key | Default |
|------|-------------------|---------|
| Bronze (0) | `credits.limits.bots.bronze` | 3 |
| Silver (1) | `credits.limits.bots.silver` | 5 |
| Gold (2) | `credits.limits.bots.gold` | 8 |
| Platinum (3) | `credits.limits.bots.platinum` | 15 |
| Diamond (4) | `credits.limits.bots.diamond` | 0 (unlimited) |

### Training Episodes Per Session

| Tier | System Config Key | Default |
|------|-------------------|---------|
| Bronze (0) | `credits.limits.episodesPerSession.bronze` | 1,000 |
| Silver (1) | `credits.limits.episodesPerSession.silver` | 5,000 |
| Gold (2) | `credits.limits.episodesPerSession.gold` | 20,000 |
| Platinum (3) | `credits.limits.episodesPerSession.platinum` | 100,000 |
| Diamond (4) | `credits.limits.episodesPerSession.diamond` | 0 (unlimited) |

The existing `ml.maxEpisodesPerSession` system config acts as an **absolute ceiling** across
all tiers — the effective cap is the lower of the two.

### Lifetime Episodes Per Bot

| Tier | System Config Key | Default |
|------|-------------------|---------|
| Bronze (0) | `credits.limits.episodesPerBot.bronze` | 10,000 |
| Silver (1) | `credits.limits.episodesPerBot.silver` | 50,000 |
| Gold (2) | `credits.limits.episodesPerBot.gold` | 250,000 |
| Platinum (3) | `credits.limits.episodesPerBot.platinum` | 1,000,000 |
| Diamond (4) | `credits.limits.episodesPerBot.diamond` | 0 (unlimited) |

### Concurrent Training Sessions

| Tier | System Config Key | Default |
|------|-------------------|---------|
| Bronze (0) | `credits.limits.concurrentSessions.bronze` | 1 |
| Silver (1) | `credits.limits.concurrentSessions.silver` | 2 |
| Gold (2) | `credits.limits.concurrentSessions.gold` | 3 |
| Platinum (3) | `credits.limits.concurrentSessions.platinum` | 5 |
| Diamond (4) | `credits.limits.concurrentSessions.diamond` | 0 (unlimited) |

---

## Future Credit Types (Candidates)

These are not implemented yet but are expected to be slotted in as the platform grows.
The formula and tier thresholds should be revisited when any of these are added.

| # | Name | Description |
|---|------|-------------|
| 4 | Win Credits (WC) | +1 per win in any mode (rewards skill, not just participation) |
| 5 | Streak Credits (SC) | +N per N-game win streak (rewards sustained performance) |
| 6 | Rating Milestone Credits (RMC) | +5 each time user's ELO crosses a 100-point boundary above 1200 |
| 7 | Training Credits (TRC) | +1 per 1,000 completed training episodes (rewards ML investment) |
| 8 | Social Credits (SOC) | +2 per referred user who reaches Player tier |

If Win Credits (WC) are added, the formula candidate is:
```
ActivityScore = HPC + BPC + (TC × 5) + (WC × 0.5)
```
Win credits are worth half a play credit to avoid skewing the score toward raw volume of wins
over breadth of participation.

---

## Accomplishment Notifications

Whenever a user crosses a tier threshold or earns a notable accomplishment, they receive a
**celebratory popup**. The popup fires immediately if the user is currently logged in, or is
queued and shown the next time they log in.

### Trigger Events

| Event | Example message |
|-------|-----------------|
| Tier upgrade | "You've reached **🥇 Gold**! Your bot limit is now 8." |
| First HPC | "First PvP game recorded — human play credits are now tracking." |
| First BPC | "Your bot played its first external game — bot play credits are now tracking." |
| First TC | "You entered your first tournament — tournament credits are now tracking." |
| Credit milestone | "You've earned 100 activity points!" *(at 100, 500, 2000)* |

More accomplishment types (first win, first bot created, ELO milestones, etc.) can be added
without schema changes — they're just new trigger conditions evaluated at the same hook points.

### Delivery Mechanism

**Immediate (user is online):**
When a credit-earning event completes on the backend, check whether the user's tier or any
accomplishment state changed. If so, push a notification payload via the existing Socket.IO
connection. The frontend listens for an `accomplishment` event and renders the popup.

**Deferred (user is offline):**
Undelivered notifications are stored in a `UserNotification` table (see schema below). On
login (after `/users/sync` completes), the frontend calls `GET /api/v1/users/me/notifications`
and displays any pending popups in sequence, then marks them delivered.

**Email (user is offline + opted in):**
If the user is offline at the time the notification is queued AND they have opted in to
achievement emails, an email is sent via Resend immediately after the `UserNotification` row
is inserted. The email is celebratory in tone — e.g., a bot winning a tournament match while
the user was away. Email is never sent for notifications that were delivered in real time via
Socket.IO (user was online and already saw the popup).

User opt-in is controlled by a `emailAchievements` boolean preference (default `false`).
Users can toggle this in their profile settings. No email is sent unless explicitly opted in.

### Schema

```prisma
model UserNotification {
  id          String    @id @default(cuid())
  userId      String
  type        String    // e.g. "tier_upgrade", "first_hpc", "credit_milestone"
  payload     Json      // { tier, message, icon, ... } — flexible per type
  createdAt   DateTime  @default(now())
  deliveredAt DateTime?
  emailedAt   DateTime? // set when achievement email is sent; null if not sent
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, deliveredAt])
  @@map("user_notifications")
}
```

A `deliveredAt = null` row is pending. The frontend marks rows delivered by calling
`POST /api/v1/users/me/notifications/:id/deliver` (or a batch variant).

User preference field on the `User` model:
```prisma
emailAchievements  Boolean  @default(false)
```

### Frontend Popup

- Displayed as a **modal overlay** centered on screen, above all other content (z-index above nav)
- Shows tier icon, tier name, a short headline, and a one-line description of what unlocked
- Single "Got it" dismiss button; also dismisses on backdrop click or Escape
- If multiple notifications are queued, show them **one at a time** in chronological order
  (next appears after current is dismissed)
- Do not show more than one popup per page load for non-tier events (batch credit milestones
  into a single "You hit several milestones!" summary if more than 2 are pending at once)

### Deduplication

Before inserting a `UserNotification`, check whether an undelivered notification of the same
`type` + same key payload value (e.g., `tier = 2`) already exists for the user. If so, skip
the insert — avoids duplicate popups if the trigger fires more than once before delivery.

---

## Implementation Notes

### Credit Storage
Credits are **stored as integer counters on the `User` record** and incremented atomically
when a qualifying event is recorded. The `activityScore` and tier are derived from those
three numbers on the fly — trivial math, no query needed.

Three new columns on `User`:
- `creditsHpc  Int  @default(0)` — Human Play Credits
- `creditsBpc  Int  @default(0)` — Bot Play Credits
- `creditsTc   Int  @default(0)` — Tournament Credits

`activityScore` is never stored — it is always computed as:
```
activityScore = creditsHpc + creditsBpc + (creditsTc × tcMultiplier)
```

A `GET /api/v1/users/:id/credits` endpoint returns `{ hpc, bpc, tc, activityScore, tier,
tierName, tierIcon, nextTier, pointsToNextTier }` by reading the three columns and applying
the formula. Fast, no joins.

The `tcMultiplier` is read from system config key `credits.tcMultiplier` (default `5`) so
admins can tune it without a code deploy.

**Important:** Credits are permanent and non-reversible by design. If a game row is deleted
(e.g., admin cleanup), the counters are not decremented — this is intentional and consistent
with credits being a lifetime engagement record.

### Applying Limits
When checking bot creation or training episode limits:
1. Look up per-user override (`botLimit`, `mlModelLimit`) — if set, use it directly.
2. Otherwise compute the user's tier from credits, look up the tier table, and apply
   the tier default.
3. System config globals still act as the absolute ceiling for episodes per session.

### Admin Exemptions
- `isExempt` flag (already in `bots.js` for `botLimit`) can be extended to cover all tier limits.
- Users with `baRole = 'admin'` or a `UserRole` of `admin` are exempt from all credit limits.

### System Config Keys (Full Reference)

All credit system parameters live under the `credits.*` namespace in the `system_config` table
and are editable via the admin panel. Defaults apply when a key is absent.

| Key | Default | Description |
|-----|---------|-------------|
| `credits.tcMultiplier` | `5` | Tournament credit weight in Activity Score formula |
| `credits.tiers.silver` | `25` | Min score for Silver tier |
| `credits.tiers.gold` | `100` | Min score for Gold tier |
| `credits.tiers.platinum` | `500` | Min score for Platinum tier |
| `credits.tiers.diamond` | `2000` | Min score for Diamond tier |
| `credits.limits.bots.bronze` | `3` | Bot limit for Bronze |
| `credits.limits.bots.silver` | `5` | Bot limit for Silver |
| `credits.limits.bots.gold` | `8` | Bot limit for Gold |
| `credits.limits.bots.platinum` | `15` | Bot limit for Platinum |
| `credits.limits.bots.diamond` | `0` | Bot limit for Diamond (0 = unlimited) |
| `credits.limits.episodesPerSession.bronze` | `1000` | Episodes/session for Bronze |
| `credits.limits.episodesPerSession.silver` | `5000` | Episodes/session for Silver |
| `credits.limits.episodesPerSession.gold` | `20000` | Episodes/session for Gold |
| `credits.limits.episodesPerSession.platinum` | `100000` | Episodes/session for Platinum |
| `credits.limits.episodesPerSession.diamond` | `0` | Episodes/session for Diamond (0 = unlimited) |
| `credits.limits.episodesPerBot.bronze` | `10000` | Lifetime eps/bot for Bronze |
| `credits.limits.episodesPerBot.silver` | `50000` | Lifetime eps/bot for Silver |
| `credits.limits.episodesPerBot.gold` | `250000` | Lifetime eps/bot for Gold |
| `credits.limits.episodesPerBot.platinum` | `1000000` | Lifetime eps/bot for Platinum |
| `credits.limits.episodesPerBot.diamond` | `0` | Lifetime eps/bot for Diamond (0 = unlimited) |
| `credits.limits.concurrentSessions.bronze` | `1` | Concurrent training for Bronze |
| `credits.limits.concurrentSessions.silver` | `2` | Concurrent training for Silver |
| `credits.limits.concurrentSessions.gold` | `3` | Concurrent training for Gold |
| `credits.limits.concurrentSessions.platinum` | `5` | Concurrent training for Platinum |
| `credits.limits.concurrentSessions.diamond` | `0` | Concurrent training for Diamond (0 = unlimited) |

### Schema Changes Required
None for the initial three credit types (HPC, BPC, TC) — all are computed from existing data.

When Tournament ships, ensure the tournament participant table has `userId` and `botId` fields
so TC can be queried directly.

---

## Decisions

1. **Retroactive credits** — **No.** The platform has no meaningful user base yet. Credits
   accrue from the day the system launches; historical games are not back-filled.

2. **Display to users** — **Yes.** Show tier, Activity Score, HPC/BPC/TC breakdown, and a
   progress bar to the next tier on the Profile page (below Quick Stats). Users should always
   know where they stand and what moves them forward.

3. **TC multiplier** — **5× as default, admin-configurable.** Stored under the system config
   key `credits.tcMultiplier` (default `5`). Admins can tune it via the existing system config
   admin panel. Revisit the value once tournament participation data is available.

4. **Bot opponent earns BPC** — **No.** BPC is a reward for bot owners only. The human
   opponent chose to play a bot; they earn HPC if the game qualifies under HPC rules, but do
   not receive BPC for being the other side in a bot game.

5. **Caching strategy** — **Live computation to start.** Credits are computed on demand from
   existing game tables. Add a `userCredits` denormalized cache only if query latency becomes
   measurable in practice. Tic-tac-toe rows are small; even tens of thousands of games should
   resolve in a single fast `COUNT`.

---

## Implementation Plan

Implementation is broken into 6 phases. Each phase is independently deployable and leaves
the system in a working state. Phases build on each other in strict order.

---

### Phase 1 — Schema: credit columns + UserNotification table

**Goal:** Add credit counter columns to `User` and the persistence layer for accomplishment
notifications.

**Changes:**
- `backend/prisma/schema.prisma` — add three columns to the `User` model:
  ```prisma
  creditsHpc  Int  @default(0)
  creditsBpc  Int  @default(0)
  creditsTc   Int  @default(0)
  ```
- `backend/prisma/schema.prisma` — add `UserNotification` model:
  ```prisma
  model UserNotification {
    id          String    @id @default(cuid())
    userId      String
    type        String
    payload     Json
    createdAt   DateTime  @default(now())
    deliveredAt DateTime?
    user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@index([userId, deliveredAt])
    @@map("user_notifications")
  }
  ```
- Add `userNotifications UserNotification[]` relation to the `User` model
- Generate and run migration: `20260330000000_add_credits_and_notifications`

**Tests:** None required — schema only.

**Completion check:** Migration succeeds; `users` table has `creditsHpc`, `creditsBpc`,
`creditsTc` columns all defaulting to 0; `user_notifications` table exists.

---

### Phase 2 — Backend: Credit calculation service

**Goal:** A single backend service that computes HPC, BPC, Activity Score, and tier for any
user. All limit lookups flow through here. No game-recording changes yet.

**New file:** `backend/src/services/creditService.js`

Key exports:
```js
// Returns { hpc, bpc, tc, activityScore, tier, nextTier, pointsToNextTier }
async function getUserCredits(userId)

// Returns the tier-derived limit for a given capability, respecting per-user overrides
// and the absolute ml.* system config ceiling where applicable.
// capability: 'bots' | 'episodesPerSession' | 'episodesPerBot' | 'concurrentSessions'
async function getTierLimit(userId, capability)

// Returns the tier number (0–4) for a given activity score
async function getTierForScore(score)
```

**Implementation notes:**
- `getUserCredits` reads `creditsHpc`, `creditsBpc`, `creditsTc` directly from the `User`
  row — a single `findUnique` with `select`, no joins or counts
- `activityScore` computed inline: `hpc + bpc + (tc × tcMultiplier)`
- TC: column exists and starts at 0; incremented when Tournament feature ships
- All threshold and limit values read from `getSystemConfig` with hardcoded defaults
- `getTierLimit` checks per-user `botLimit` / `mlModelLimit` overrides first; falls back to
  tier-derived value; applies `ml.*` absolute ceiling for episode caps
- `getTierForScore` reads the four `credits.tiers.*` config keys and returns the highest
  tier whose threshold the score meets

**Tests:** `backend/src/services/__tests__/creditService.test.js`
- `getUserCredits` returns correct shape from user row values
- Tier thresholds (boundary values: score = 24, 25, 99, 100, etc.)
- `getTierLimit` returns per-user override when set, tier default otherwise
- `activityScore` formula applies `tcMultiplier` correctly

**Completion check:** All tests pass; `getUserCredits` returns correct results against a
seeded test DB.

---

### Phase 3 — Backend: Credits API endpoint + notification service

**Goal:** Expose credits via REST. Add the notification helper used in later phases.

#### 3a — Credits endpoint

**New route:** `GET /api/v1/users/:id/credits`
- Calls `getUserCredits(userId)` from Phase 2
- Public endpoint (no auth required) — same pattern as `/users/:id/stats`
- Returns `{ hpc, bpc, tc, activityScore, tier, tierName, tierIcon, nextTier, pointsToNextTier }`
- Register in `backend/src/index.js` (or `app.js`) alongside other user routes

#### 3b — Notification service

**New file:** `backend/src/services/notificationService.js`

Key exports:
```js
// Compute credits before and after an event; queue notifications for any tier
// upgrade or first-credit milestone that occurred. Deduplicates before insert.
async function checkAndNotify(userId, previousCredits)

// Insert a UserNotification row if no undelivered row with the same type+key exists.
// If the user is offline AND has emailAchievements=true, sends an achievement email
// via Resend and sets emailedAt on the row.
async function queueNotification(userId, type, payload)
```

Notification types to handle:
- `tier_upgrade` — payload: `{ tier, tierName, tierIcon, unlockedLimits }`
- `first_hpc` — payload: `{ message }`
- `first_bpc` — payload: `{ message }`
- `first_tc` — payload: `{ message }`
- `credit_milestone` — payload: `{ score, message }` (triggers at 100, 500, 2000)

**Email delivery logic in `queueNotification`:**
1. Insert the `UserNotification` row
2. Check whether the user has an active Socket.IO connection (is online)
3. If offline AND `user.emailAchievements === true`:
   - Send achievement email via Resend using an `achievementEmail` template
   - Set `emailedAt = now()` on the row
4. Never send email if the user is online (they'll see the popup immediately)

#### 3c — Notification delivery endpoints

Add to `backend/src/routes/users.js`:
- `GET /api/v1/users/me/notifications` — returns all undelivered `UserNotification` rows for
  the authenticated user, ordered by `createdAt`
- `POST /api/v1/users/me/notifications/deliver` — body `{ ids: string[] }` — sets
  `deliveredAt = now()` for all listed IDs belonging to the user (batch)
- `PATCH /api/v1/users/me/settings` — update user preferences including `emailAchievements`

**Tests:**
- Credits endpoint returns correct shape
- `queueNotification` deduplicates correctly
- Deliver endpoint marks rows delivered and ignores IDs belonging to other users
- Achievement email sent when user is offline and opted in
- Achievement email not sent when user is online (even if opted in)
- Achievement email not sent when user is offline but not opted in

**Completion check:** `GET /api/v1/users/:id/credits` returns live data; notification rows
can be inserted and marked delivered via the API.

---

### Phase 4 — Backend: Wire credit checks into limit enforcement

**Goal:** Replace the current flat `bots.defaultBotLimit` and `ml.*` checks with
tier-aware lookups from `getTierLimit`. No new user-facing behavior yet — limits just
become dynamic.

**Files to modify:**

`backend/src/routes/bots.js`
- Bot creation check: replace `user.botLimit ?? defaultLimit` with
  `await getTierLimit(userId, 'bots')` (which already handles the per-user override internally)
- Bot list response: replace `bots.defaultBotLimit` default with the same call
- Remove the direct `getSystemConfig('bots.defaultBotLimit', 5)` call (now inside `getTierLimit`)

`backend/src/services/mlService.js`
- `startTraining` / `startAlphaZeroTraining`: replace `getSystemConfig('ml.maxEpisodesPerSession')`
  with `getTierLimit(createdBy, 'episodesPerSession')` — the tier limit IS the per-session cap;
  the absolute `ml.maxEpisodesPerSession` ceiling is applied inside `getTierLimit`
- `createModel`: replace `getSystemConfig('ml.maxEpisodesPerModel')` with
  `getTierLimit(createdBy, 'episodesPerBot')` for the new model's `maxEpisodes` field
- Concurrent session check: replace `getSystemConfig('ml.maxConcurrentSessions')` with
  `getTierLimit(createdBy, 'concurrentSessions')`

**Tests:**
- Bot creation blocked at correct tier limit
- Episode cap enforced at tier limit (not global cap) for a Bronze user
- Admin-exempt user (`BOT_ADMIN` role) bypasses bot limit

**Completion check:** Creating a bot/model as a Newcomer hits the tier-derived limit, not the
old flat default; existing unit tests still pass.

---

### Phase 5 — Backend: Generic game-completion hook + XO Arena wiring

**Goal:** Implement a game-agnostic credit hook that any game calls after recording a
completed game. Wire it into XO Arena's game routes as the first consumer. Future games call
the same hook without modifying the credit service.

#### 5a — Generic hook in `creditService.js`

Add a new export:

```js
// Called by any game route after a game is committed to the DB.
// appId: string — e.g. "xo-arena", "chess"
// participants: array of { userId, isBot, botOwnerId | null }
// mode: "pvp" | "pvc" | "bvb" (player-vs-player, player-vs-computer, bot-vs-bot)
async function recordGameCompletion({ appId, participants, mode })
```

Internally this function:
- Applies the Universal Exclusion rule (built-in AI → no credits)
- Determines HPC earners: non-bot participants in a qualifying PvP game
- Determines BPC earners: bot owners whose bot played an external opponent
- Increments the appropriate counter atomically:
  `db.user.update({ data: { creditsHpc: { increment: 1 } } })`
- Snapshots credits before each increment, then calls `checkAndNotify` with the
  pre-increment snapshot

The function never references XO Arena-specific tables, columns, or game IDs. It operates
entirely on the normalized `participants` array passed by the caller.

#### 5b — XO Arena wiring

**File to modify:** `backend/src/routes/games.js`
- After the game row is committed, build the `participants` array from the existing game
  record and call `creditService.recordGameCompletion({ appId: 'xo-arena', participants, mode })`
- Wrap in `try/catch` — a credit failure must never block the game response
- Fire-and-forget after `res.json()`

**File to modify:** `backend/src/realtime/socketHandler.js`
- Add handler for `accomplishment` server→client event
- When `checkAndNotify` produces new notifications AND the user has an active socket
  connection, emit `accomplishment` with the notification payload immediately

#### 5c — `Game` table: add `appId`

Add `appId String @default("xo-arena")` to the `Game` model in `schema.prisma`. Backfill
via migration default. This field is used for per-game credit reporting and future filtering.

**Tests:**
- `recordGameCompletion` with `appId: "xo-arena"` increments HPC for both players in a PvP game
- `recordGameCompletion` with `appId: "chess"` applies identical rules — service is unaware of game type
- Bot game (external opponent) increments BPC for bot owner only
- Non-qualifying game (own bot, built-in AI) produces no increment
- `checkAndNotify` is a no-op if tier and milestones haven't changed
- A credit service failure does not affect the game response (error swallowed)

**Completion check:** Playing a qualifying XO Arena PvP game produces a `UserNotification`
row; `GET /api/v1/users/me/notifications` returns it; a future game calling the same hook
with a different `appId` works identically.

---

### Phase 6 — Frontend: Credits display + notification popup

**Goal:** Show the user their tier and credits on the Profile page. Show accomplishment
popups immediately (via Socket.IO) or on next login (via pending notifications fetch).

#### 6a — Profile page credits section

**File:** `frontend/src/pages/ProfilePage.jsx`

Add a new section between "Quick Stats" and "My Bots":
- Tier badge (icon + name, e.g., "▲ Player")
- Activity Score with a progress bar showing `score / nextTierThreshold`
- Three mini-stats: HPC / BPC / TC counts
- "Points to next tier: N" label (hidden at Legend tier)
- Fetch from `GET /api/v1/users/:id/credits` in the existing parallel `Promise.allSettled`
  load block

**File:** `frontend/src/lib/api.js`
- Add `api.users.credits(id)` → `api.get(\`/users/${id}/credits\`)`

#### 6b — Accomplishment popup component

**New file:** `frontend/src/components/ui/AccomplishmentPopup.jsx`

- Modal overlay (fixed, z-50, backdrop blur)
- Shows tier icon (large), tier name, headline, description of what unlocked
- "Got it" button + Escape key + backdrop click to dismiss
- Queue-aware: accepts an array of notifications, shows one at a time, advances on dismiss
- Batches non-tier notifications: if > 2 non-tier items are pending, collapses them into a
  single "You hit several milestones!" card

#### 6c — Notification fetch on login

**File:** `frontend/src/components/layout/AppLayout.jsx`
- After the existing `/users/sync` call succeeds, fetch `GET /api/v1/users/me/notifications`
- If any pending notifications exist, store them in a React state and render
  `<AccomplishmentPopup>`
- After the user dismisses, call `POST /api/v1/users/me/notifications/deliver` with the
  shown IDs

**File:** `frontend/src/lib/api.js`
- Add `api.users.notifications(token)` and `api.users.deliverNotifications(ids, token)`

#### 6d — Real-time accomplishment via Socket.IO

**File:** `frontend/src/store/pvpStore.js` (or wherever the main socket listener lives)
- Listen for `accomplishment` event from the server
- On receipt, append the notification to the same queue used in 6c
- The `<AccomplishmentPopup>` in AppLayout will pick it up automatically

#### 6e — Profile settings: achievement email opt-in

**File:** `frontend/src/pages/ProfilePage.jsx` (or a Settings page if one exists)
- Add a "Notifications" section with a toggle: **"Email me about achievements when I'm offline"**
- Default: off
- On toggle, call `PATCH /api/v1/users/me/settings` with `{ emailAchievements: true/false }`
- Brief explainer text: *"Get a celebratory email when your bot wins a tournament match or
  you reach a new tier while you're not signed in."*

#### 6f — Admin panel: Credits config section

**File:** `frontend/src/pages/admin/AdminMLPage.jsx` (or a new `AdminCreditsPage.jsx`)
- New "Credits & Tiers" section in the admin panel
- Displays and allows editing of all `credits.*` system config keys (the 30 keys from the
  reference table above)
- Same pattern as the existing ML limits section: read from `GET /api/v1/admin/limits`,
  edit inline, save via `PUT /api/v1/admin/limits`
- Backend: extend the existing admin limits GET/PUT endpoints to include `credits.*` keys

**Tests:**
- Profile page renders credits section with correct tier and progress bar
- `AccomplishmentPopup` renders one notification at a time, advances queue on dismiss
- Batching logic collapses > 2 non-tier items

**Completion check:** Signed-in user sees their tier on their Profile page; playing a PvP
game and refreshing shows updated counts; accomplishment popup appears on next login if
a milestone was crossed.

---

### Phase Summary

| Phase | What ships | Key files | Done |
|-------|------------|-----------|------|
| 1 | DB schema | `schema.prisma`, migration | [x] |
| 2 | Credit calculation logic | `creditService.js` | [ ] |
| 3 | Credits API, notification service, delivery endpoints | `users.js`, `notificationService.js` | [ ] |
| 4 | Tier-aware limit enforcement (replaces flat defaults) | `bots.js`, `mlService.js`, `ml.js` | [ ] |
| 5 | Generic game-completion hook + XO Arena wiring + `appId` on `Game` | `creditService.js`, `games.js`, `socketHandler.js`, `schema.prisma` | [ ] |
| 6 | Frontend: profile display, popup, admin config UI | `ProfilePage.jsx`, `AppLayout.jsx`, `AccomplishmentPopup.jsx` | [ ] |

Phases 1–4 are entirely backend and can be deployed without any visible user change.
Phase 5 starts producing notification rows. Phase 6 makes everything visible.

**Adding a new game:** once Phase 5 ships, any new game route earns credits by calling
`creditService.recordGameCompletion({ appId: '<game-id>', participants, mode })` after
committing its game record. No other changes required.
