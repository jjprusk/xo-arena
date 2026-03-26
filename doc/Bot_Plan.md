# XO Arena — Bot Players

Bots are synthetic players tied to a single AI model (ML, minimax, MCTS, rule-based, etc.). They participate in PvAI and AiVsAi games as named opponents, accumulate ELO ratings, and appear on the leaderboard alongside human players.

---

## Goals

- Give the leaderboard interesting, populated entries from day one (built-in AI personas)
- Let players challenge a specific named bot rather than picking an abstract difficulty level
- Create a persistent competitive benchmark: "can I beat Magnus the Minimax?"
- Allow ML models to have a public identity that improves over time
- Support spectating of bot vs bot games — users watching their favorite bots battle it out
- Lay the groundwork for tournaments

---

## Data Model

### Roles

```prisma
enum Role {
  ADMIN           // full platform access — implicitly has all permissions
  BOT_ADMIN       // manage all bots, set per-user bot limits
  TOURNAMENT_ADMIN // future
  // add roles here as the platform grows
}

model UserRole {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        Role
  grantedById String   // FK to User.id — who assigned the role
  grantedAt   DateTime @default(now())

  @@unique([userId, role])  // a user can only hold each role once
}
```

**Permission resolution:**
```js
// Pseudo-code — used everywhere a permission check is needed
function hasRole(user, role) {
  return user.roles.includes('ADMIN') || user.roles.includes(role)
}
```
`ADMIN` implicitly satisfies any role check. No need to also assign `BOT_ADMIN` to an admin user.

**Bot Admin capabilities:**
- Remove any user's bot from the system
- Set a per-user bot limit override (overrides the system default for that user)
- Access the bot management section of the admin panel

### Bots

Bots are rows in the existing `User` table with additional fields:

```prisma
model User {
  ...
  isBot        Boolean  @default(false)
  botModelId   String?  // FK to MLModel.id, or a built-in impl ID like 'minimax'
  botModelType String?  // 'ml' | 'minimax' | 'mcts' | 'rule_based'
  botOwnerId      String?  // FK to User.id — the user who created this bot; null for built-ins
  botActive       Boolean  @default(true)   // false = hidden from picker (soft disable)
  botCompetitive  Boolean  @default(false)  // true = eligible for leaderboard + tournaments
  botAvailable    Boolean  @default(false)  // true = available for tournament scheduling
  botInTournament Boolean  @default(false)  // true = registered in active tournament; blocks training
  botLimit        Int?     // per-user override; null = fall back to system default
  // botModelId has a unique constraint — one bot per model snapshot
  roles        UserRole[]
  ...
}
```

Bots become first-class users and inherit everything for free: ELO, leaderboard queries, profile pages, game history, stats. No new joins needed anywhere.

### Ownership & limits

- Each bot has a `botOwnerId` pointing to the user who created it.
- Built-in bots (Magnus, Rusty, etc.) are owned by the system/admin account (`botOwnerId = null`).
- **Effective limit:** `user.botLimit ?? systemConfig.defaultBotLimit` (default: **5**)
- Active and soft-disabled bots both count toward the limit — prevents gaming it by cycling bots.
- `ADMIN` and `BOT_ADMIN` roles are exempt from the limit.
- Bot admins can set `user.botLimit` to any value, including 0 (blocks a user from creating bots) or a higher number for trusted researchers.
- The system default is stored in a system config table — tunable without a deploy.

See [Appendix A](#appendix-a--option-b-separate-bot-table) for the alternative approach that was considered and rejected.

### `Game` schema changes

Currently PvAI games use `player2Id = null` and `aiImplementationId` to identify the AI opponent. With bots, `player2Id` points to the bot's `User.id`:

| Field | Before | After (bot game) |
|---|---|---|
| `player1Id` | human | human |
| `player2Id` | `null` | bot's `userId` |
| `aiImplementationId` | `'minimax'` | redundant — implied by bot |
| `mode` | `PVAI` | `PVBOT` |

Non-bot PvAI games (raw difficulty picker, no named bot) remain as `PVAI` and are unchanged. Named bot challenge games use `PVBOT`.

### ELO

`UserEloHistory.opponentType` currently stores `'ai_novice'` etc. With bots this becomes `'bot'` or `'human'`. Both the human and the bot's `eloRating` update after every game.

`MLModel.eloRating` already exists but is separate from `User.eloRating`. With the bot approach, a bot's ELO lives on its `User` row — the `MLModel.eloRating` can be retired or kept as a training-phase metric only.

---

## Bot Types & Eligibility

| | Picker (challenge) | Leaderboard | Tournaments |
|---|---|---|---|
| Built-in minimax | ✅ all users | ✅ | ✅ |
| User casual bot (any algorithm) | ✅ all users | ❌ | ❌ |
| User competitive bot (ML only) | ✅ all users | ✅ | ✅ |

**Casual bots:** users can create bots backed by any algorithm (minimax, MCTS, rule-based, ML). Visible to all users in the picker. Do not appear on the leaderboard or in tournaments. `botCompetitive = false`.

**Competitive bots:** ML model bots only. Appear on the leaderboard and are tournament-eligible. `botCompetitive = true`. Must be backed by a trained ML model owned by the user.

**Competitive flag:** set by the user at creation time (if using an ML model) or by a bot admin. Cannot be set on non-ML bots.

---

## Built-in Bot Personas

Four minimax bots covering the full difficulty spectrum, seeded on first deploy:

| Name | Difficulty | Competitive | Notes |
|---|---|---|---|
| Rusty | novice | ✅ | Entry-level benchmark |
| Copper | intermediate | ✅ | |
| Sterling | advanced | ✅ | |
| Magnus | master | ✅ | Unbeatable — the ultimate benchmark |

Built-in bots are owned by the system account, exempt from user limits, and always visible in the picker.

ML-trained competitive bots are published by their owners when a model is ready.

---

## Game Execution

Bot vs bot and human vs bot games run **server-side** — not browser-driven.

- The backend drives moves, persists game state, and broadcasts via the existing Socket.io room mechanism.
- Ensures reliable game recording (no tab-close data loss).
- Bot vs bot rooms appear in the room list and are joinable mid-game as spectators, using the existing spectator socket infrastructure.
- Required for tournaments: the backend can schedule and execute bot matches without any client present.

### Game Recording Flow

**Non-bot games (PVP, PVAI quick game):** frontend sends `POST /api/v1/games` at game end — unchanged from today.

**Bot games (PVBOT):** fully server-side. The backend drives moves, records the game, updates ELO for both sides, and writes `UserEloHistory` within a single transaction. The frontend receives the result via the existing Socket.io broadcast — no separate record call needed.

---

## Leaderboard Changes

Single leaderboard. A **"Show bots"** toggle (default off, persisted to localStorage) controls all bot visibility:
- **Off:** only human players shown, bot vs bot games excluded
- **On:** all players shown including bots and bot vs bot results

```js
// New — add isBot filter
const botWhere = includeBots ? {} : { isBot: false }
```

Bot entries get a visual badge (robot icon) in the leaderboard row and on their profile page.

---

## Mode Selection UX

Replace the current difficulty dropdown with a **bot picker** when the user wants to play vs a named opponent:

```
Play vs AI
  ○ Quick game (difficulty slider — existing flow)
  ● Challenge a bot
      [Magnus ★★★★  ELO 1842]
      [Monte   ★★★   ELO 1540]
      [Rusty   ★     ELO 980 ]
      [Q-Bot   ★★    ELO 1210]  ← ML model bot
```

The difficulty slider mode stays for casual play. The bot picker is opt-in.

---

## Bot Profile Pages

Bot profiles reuse the existing `/profile/:id` page with small additions:
- "Bot" badge next to the display name
- "Powered by: [model name + algorithm]" line
- "Model last updated: [date]" if the underlying model was retrained
- "Created by: [username]" link to owner's profile
- Win rate against humans vs against bots shown separately

### Owner actions (visible to bot owner and admins)

- **Create** — available from the user's own profile ("My Bots" section); triggers a create flow (name, model, avatar)
- **Disable / Enable** — checkbox toggle that sets `botActive`. Disabled bots are hidden from the bot picker but remain in all historical records and leaderboard history
- **Delete** — hard delete: removes the bot user row and all associated data, exactly as deleting a human user account. Requires a confirmation popup ("This is permanent and cannot be undone") before proceeding. Irrecoverable.

---

## Bot Management

### User — own bots only
Available from the "My Bots" section of their profile:
- Create, disable/enable, reset ELO, delete their own bots (within their limit)

### Bot Admin (`BOT_ADMIN` or `ADMIN` role)
Dedicated bot management panel:
- All user actions above, on any user's bots
- Delete any bot from the system
- Set per-user bot limit overrides (`user.botLimit`)
- View all bots across all users with owner info

### Role management (`ADMIN` only)
- Grant / revoke roles via the admin panel
- Audit log: every role grant shows who assigned it and when (`grantedById`, `grantedAt`)

---

## Open Items for Discussion

### 1. ~~GameMode enum~~ ✅ Resolved
Bot games use `PVBOT` mode — bots are treated like people, the same way `PVP` is distinct from `PVAI`. Makes filtering unambiguous on the leaderboard, stats page, and game history. `PVAI` remains for raw quick games before the bot system exists; once bots are live all games route through `PVBOT`.

### 2. ~~Bot vs bot games — do they count?~~ ✅ Resolved
Bot vs bot games count toward leaderboard ELO. A single **"Show bots"** toggle (default off) controls all bot visibility on the leaderboard — when off, all bot entries are hidden including bot vs bot results. When on, everything is visible. No separate bot vs bot toggle needed.

### 3. ~~ELO initialization~~ ✅ Resolved
Bots start at 1200 and drift naturally, same as any new user. Calibration games are queued automatically on first creation, ELO reset, and scratch retrain — see B-14a through B-14e for the full calibration design.

### 4. ~~Model retraining and ELO~~ ✅ Resolved
- **Additional training** (fine-tuning existing weights): ELO carries over — the bot is still the same model improving over time.
- **Retrained from scratch**: ELO resets automatically to 1200 — a fundamentally new model shouldn't inherit the old bot's rating.
- **Owner-triggered ELO reset**: allowed — wipes ELO to 1200 and queues calibration games (see B-24b). This is intentional: the owner is resetting their own bot, not gaming another player's rating.
- **Admin arbitrary reset**: not allowed — an admin overriding a specific bot's ELO to an arbitrary value is a vector for abuse.
- The bot profile shows "Model retrained from scratch on [date]" when a reset occurs so the ELO history break is transparent.

### 5. ~~One bot per model~~ ✅ Resolved
One bot per model, enforced by a unique constraint on `botModelId`. This preserves ELO integrity (one rating per model) and prevents tournament abuse (same weights can't enter a bracket twice). Escape hatch: bots can be renamed after creation — a different name or avatar doesn't require a new model.

### 6. ~~Bot visibility~~ ✅ Resolved
Bots are visible to all users including guests — profiles, leaderboard entries, and game history are public. A guest seeing a high-ELO bot is a hook to sign up and challenge it.

### 7. ~~Difficulty picker retirement~~ ✅ Resolved
The difficulty picker stays as a "Quick game" shortcut — selecting a difficulty silently maps to the corresponding built-in minimax bot (novice → Rusty, master → Magnus, etc.). All quick games are bot games under the hood: results are recorded and ELO updates for both sides. The bot picker is the explicit "I want a specific opponent" path. Both flows converge on the same game recording and ELO infrastructure.

### 8. ~~Owner account deletion~~ ✅ Resolved
When a user deletes their account, all their bots are deleted with them (cascade delete). Bots are an expression of the user's work and have no maintainer without their owner. Historical `Game` rows that referenced the bot as an opponent remain intact, same as any deleted user. Built-in bots (owned by the system account) are unaffected.

---

## Implementation Checklist

### Phase 1 — Schema & seed
| # | Task | Done |
|---|------|------|
| B-01 | Add `Role` enum and `UserRole` model to Prisma schema | ✅ |
| B-02 | Add `isBot`, `botModelType`, `botModelId` (unique), `botOwnerId`, `botActive`, `botCompetitive`, `botAvailable`, `botInTournament`, `botCalibrating`, `botLimit` to `User` | ✅ |
| B-03 | Add `PVBOT` to `GameMode` enum | ✅ |
| B-04 | Add `botLimit` (default 5) to system config table | ✅ |
| B-05 | Run migration | ✅ |
| B-06 | Seed system account (owner of built-in bots) | ✅ |
| B-07 | Seed built-in bots: Rusty (novice), Copper (intermediate), Sterling (advanced), Magnus (master) | ✅ |
| B-08 | `hasRole(user, role)` utility — `ADMIN` implicitly satisfies any role check | ✅ |

### Phase 2 — Game recording & ELO
| # | Task | Done |
|---|------|------|
| B-09 | Map difficulty picker selection to corresponding built-in bot (`player2Id`) | ✅ |
| B-10 | Backend: record `PVBOT` games with `player2Id` pointing to bot user row | ✅ |
| B-11 | Backend: update bot ELO after every `PVBOT` game | ✅ |
| B-12 | Backend: write `UserEloHistory` entries for both human and bot sides | ✅ |
| B-13 | Backend: auto-reset bot ELO to 1200 and queue calibration when ML model is retrained from scratch | ✅ |
| B-14 | Bot profile: show "Model retrained from scratch on [date]" when ELO resets | ✅ |
| B-14a | Add `calibrationGamesTotal` to system config (default: 12 — 3 rounds vs each of the 4 built-in bots) | ✅ |
| B-14b | Add `botCalibrating` boolean to `User` — set `true` when calibration is queued or in progress, cleared when all calibration games complete | ✅ |
| B-14c | Calibration scheduler: on trigger (first creation, ELO reset, scratch retrain), enqueue `calibrationGamesTotal` games against built-in bots in round-robin order (Rusty → Copper → Sterling → Magnus → repeat) | ✅ (trigger wired; actual game execution deferred to Phase 6) |
| B-14d | Bot picker: show a "Calibrating" badge on bots with `botCalibrating = true` — bot remains challengeable but ELO is marked as provisional | |
| B-14e | Tournament eligibility check (`botMinGamesPlayed`) counts calibration games — a freshly calibrated bot satisfies the threshold automatically if `calibrationGamesTotal >= botMinGamesPlayed` | |

### Phase 2b — Stats & game history UI
| # | Task | Done |
|---|------|------|
| B-15a | Stats page: add `PVBOT` as a distinct game mode filter alongside `PVP` and `PVAI` — users can view stats broken down per mode | ✅ |
| B-15b | Stats page: within `PVBOT`, show per-bot breakdown — wins/losses/draws against each named bot opponent | ✅ |
| B-15c | Stats page: `PVAI` (quick game) and `PVBOT` (named bot challenge) display separately — a user can see how they perform against abstract difficulty vs named opponents | ✅ |
| B-15d | Game history list: label each row clearly — `PVP` shows opponent username, `PVAI` shows difficulty level, `PVBOT` shows bot name with link to bot profile | ✅ (recent games tooltip updated; full history list deferred to Phase 3) |
| B-15e | Profile win/loss summary: display three separate counts — vs humans, vs quick AI, vs bots — so bot farming doesn't inflate a player's apparent competitive record | |
| B-15f | Bot profile game history: mirrors the above — shows each game played, opponent type (human or bot), result, and ELO change | |

### Phase 3 — Leaderboard & profiles
| # | Task | Done |
|---|------|------|
| B-15 | Leaderboard: add `includeBots` filter (default off) | ✅ |
| B-16 | Leaderboard: "Show bots" toggle, persisted to localStorage | ✅ |
| B-17 | Leaderboard: robot icon badge on bot rows | ✅ |
| B-18 | Bot profile page: "Bot" badge, "Powered by", "Created by", model update date | ✅ |
| B-19 | Bot profile page: win rate vs humans and vs bots shown separately | ✅ |
| B-20 | Bot profiles publicly visible to guests | ✅ |

### Phase 4 — Bot management & roles
| # | Task | Done |
|---|------|------|
| B-21 | User profile: "My Bots" section showing owned bots and bot count vs limit | ✅ |
| B-22 | Create bot flow: name, algorithm/model, avatar, competitive flag (ML only) | ✅ |
| B-22a | Bot name validation: block reserved names (built-in bot names: Rusty, Copper, Sterling, Magnus, plus any future built-ins) — return a clear error if attempted | ✅ |
| B-22b | Bot name deduplication: if the requested name is already taken, auto-append an incrementing suffix (`joe`, `joe1`, `joe2`, …) and inform the user of the adjusted name | ✅ |
| B-22c | Profanity filter: apply to bot names and usernames at creation and rename time. Use a configurable word list (server-side, not client-side) so it can be updated without a deploy | ✅ |
| B-23 | Enforce per-user bot limit (`user.botLimit ?? systemConfig.defaultBotLimit`) | ✅ |
| B-24 | Disable / Enable bot toggle (`botActive`) | ✅ |
| B-24a | Rename bot — update display name and avatar only; `botModelId` cannot be reassigned. Same naming rules as creation (reserved names, profanity filter) apply on rename | ✅ |
| B-24b | Reset ELO: owner-triggered reset — wipes bot's `eloRating` to 1200, clears `UserEloHistory` for the bot, and queues calibration games against built-in bots. Requires confirmation popup. Not available while `botInTournament = true`. | ✅ |
| B-25 | Delete bot: confirmation popup, cascade delete, irrecoverable | ✅ |
| B-26 | Cascade delete user's bots when user deletes their account | ✅ |
| B-26a | Block ML model deletion if a bot references it (`botModelId` FK) — return a clear error directing the user to delete the bot first | ✅ |
| B-27 | Admin panel: bot management section (view all bots, delete any, set per-user limits) | ✅ |
| B-28 | Admin panel: role management (grant/revoke roles, audit log) | ✅ |
| B-29 | `BOT_ADMIN` and `ADMIN` exempt from bot limit | ✅ |

### Phase 5 — Mode selection UX
| # | Task | Done |
|---|------|------|
| B-30 | Mode selection: "Quick game" path maps difficulty to built-in bot silently | |
| B-31 | Mode selection: "Challenge a bot" picker showing name, ELO, algorithm | |
| B-32 | Bot picker: casual and competitive bots listed, sorted by ELO | |
| B-33 | Bot picker: visible to guests (challenge flow requires sign-in) | |

### Phase 6 — Server-side execution & spectating
| # | Task | Done |
|---|------|------|
| B-34 | Backend-driven bot vs bot game execution (no browser required) | |
| B-35 | Bot vs bot rooms appear in the room list | |
| B-36 | Bot vs bot rooms joinable mid-game as spectators | |
| B-37 | Foundation in place for tournament scheduling | |

### Phase 7 — Tournament readiness
| # | Task | Done |
|---|------|------|
| B-38 | Add `botAvailable` boolean to `User` — bots must be marked available before tournament scheduling can slot them | |
| B-39 | Bot owner can toggle availability on/off from the bot profile page | |
| B-40 | Bot admin can override availability for any bot | |
| B-41 | Tournament scheduler checks `botAvailable` before slotting a bot into a bracket | |
| B-42 | Add `botMinGamesPlayed` threshold to system config — bots must have played at least N games before tournament eligibility (prevents unreliable 1200 ELO seeds) | |
| B-43 | Lock `botModelId` at tournament registration — the model snapshot at entry time competes, not a live pointer to current weights | |
| B-43a | Add `botInTournament` boolean to `User` — set true when a bot is registered in an active tournament, cleared when eliminated or tournament ends | |
| B-43b | Block all model training (fine-tune and from-scratch) while `botInTournament = true` — enforced at the API level with a clear error message to the owner | |
| B-44 | Auto-forfeit on bot error mid-game — a crash or model load failure forfeits the game cleanly, sets `botInTournament = false`, and eliminates the bot from the bracket rather than hanging it | |
| B-45 | **Bot vs Human tournaments** — flag: mixed-bracket tournaments (bots and humans in the same bracket) must be explicitly supported. Human players join via the normal lobby; bot moves are executed server-side on the bot's turn. ELO updates for both sides. The bracket and scheduling logic must handle both player types without distinguishing — since bots are `User` rows, this should work without special-casing once server-side execution is in place. Design note: clearly label bracket slots as "(Bot)" so human players know they may face automated opponents. | |

---

## Appendix A — Option B: Separate Bot Table

A `Bot` table separate from `User`, with its own FK relationships to games and leaderboard.

```prisma
model Bot {
  id         String  @id @default(cuid())
  userId     String  @unique  // FK to User
  modelId    String?          // FK to MLModel.id
  modelType  String           // 'ml' | 'minimax' | 'mcts'
  ...
}
```

Games would need a polymorphic or union player reference (`player1UserId` + `player1BotId`, with a constraint that exactly one is set). Leaderboard queries require a UNION across two tables. Profile pages need a separate route and component.

**Why not chosen:** All existing infrastructure assumes `player1Id`/`player2Id` are `User` FK refs. Option B requires forking every query that touches players — ELO updates, leaderboard, game history, profiles. The maintenance surface grows with every new feature. Option A achieves the same result with two extra column