# XO Arena — Bot Players

Bots are synthetic players tied to a single AI model (ML, minimax, MCTS, rule-based, etc.). They participate in PvAI and AiVsAi games as named opponents, accumulate ELO ratings, and appear on the leaderboard alongside human players.

---

## Goals

- Give the leaderboard interesting, populated entries from day one (built-in AI personas)
- Let players challenge a specific named bot rather than picking an abstract difficulty level
- Create a persistent competitive benchmark: "can I beat Magnus the Minimax?"
- Allow ML models to have a public identity that improves over time

---

## Data Model

### Option A — `isBot` flag on `User` (recommended)

Add two fields to the existing `User` table:

```prisma
model User {
  ...
  isBot        Boolean  @default(false)
  botModelId   String?  // FK to MLModel.id, or a built-in impl ID like 'minimax'
  botModelType String?  // 'ml' | 'minimax' | 'mcts' | 'rule_based'
  ...
}
```

Bots become first-class users and inherit everything for free: ELO, leaderboard queries, profile pages, game history, stats. No new joins needed anywhere.

### Option B — Separate `Bot` table with a `User` relation

```prisma
model Bot {
  id         String  @id @default(cuid())
  userId     String  @unique  // FK to User
  modelId    String?          // FK to MLModel.id
  modelType  String           // 'ml' | 'minimax' | 'mcts'
  ...
}
```

Cleaner schema separation but adds joins everywhere User is referenced.

**Recommendation: Option A.** The bot concept maps naturally onto a user; the extra fields are minimal.

### `Game` schema changes

Currently PvAI games use `player2Id = null` and `aiImplementationId` to identify the AI opponent. With bots, `player2Id` points to the bot's `User.id`:

| Field | Before | After (bot game) |
|---|---|---|
| `player1Id` | human | human |
| `player2Id` | `null` | bot's `userId` |
| `aiImplementationId` | `'minimax'` | redundant — implied by bot |
| `mode` | `PVAI` | `PVAI` (unchanged) |

Non-bot PvAI games (raw difficulty picker, no named bot) remain unchanged.

A new `GameMode` enum value may be worth adding: `PVBOT` — but this is an **open item** (see below).

### ELO

`UserEloHistory.opponentType` currently stores `'ai_novice'` etc. With bots this becomes `'bot'` or `'human'`. Both the human and the bot's `eloRating` update after every game.

`MLModel.eloRating` already exists but is separate from `User.eloRating`. With the bot approach, a bot's ELO lives on its `User` row — the `MLModel.eloRating` can be retired or kept as a training-phase metric only.

---

## Built-in Bot Personas

These would be created on first deploy via a seed script:

| Name | Model type | Notes |
|---|---|---|
| Magnus | minimax | Unbeatable at master level |
| Rusty | minimax | Novice difficulty |
| Monte | mcts | Monte Carlo search |
| Rulez | rule_based | Highest-ELO rule set |

ML-trained bots are created by admins when a model is ready to be "published" as a public opponent.

---

## Game Recording Changes

Currently the frontend records PvAI games after the game ends. With bots this must shift to the **backend** for reliability — a user closing the tab before the game records would leave the bot's record incomplete.

**Proposed flow:**
1. Frontend sends `POST /api/v1/games` at game end (same as today for non-bot games)
2. For bot games, the backend additionally updates the bot's ELO and writes to `UserEloHistory` for both sides
3. The frontend still initiates the record call — but the bot's side is handled server-side within the same transaction

---

## Leaderboard Changes

Single leaderboard. The existing query in `getLeaderboard()` needs one addition:

```js
// Current — no bot filter
const whereMode = mode === 'pvp' ? 'PVP' : ...

// New — add isBot filter
const botWhere = includeBots ? {} : { player1: { isBot: false } }
```

Frontend adds a toggle: **"Show bots"** (default off, persisted to localStorage).

Bot entries get a visual badge (e.g. a small robot icon) in the leaderboard row and on their profile page.

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
- Win rate against humans vs against bots shown separately

---

## Admin: Bot Management

Add to the existing admin panel:
- **Create bot** — name, avatar, link to MLModel or built-in implementation
- **Retire bot** — mark inactive (hidden from picker, stays in historical records)
- **Recalibrate ELO** — reset ELO and run N calibration games before re-exposing

---

## Open Items for Discussion

### 1. GameMode enum
Should bot games get their own `PVBOT` mode, or stay `PVAI`? Arguments:
- `PVBOT`: cleaner filtering on leaderboard, stats page, and future analytics
- Stay `PVAI`: simpler, backward-compatible, bot presence is already captured by `player2Id`

### 2. AiVsAi (bot vs bot) games — do they count?
If two bots play each other, should those games count toward leaderboard ELO? Options:
- Yes, always
- Yes, but filterable with a separate "bot vs bot" toggle
- No — only games with at least one human participant count

### 3. ELO initialization for new bots
Starting all bots at 1200 (human default) would be inaccurate. Options:
- Start at 1200 and let it calibrate naturally over many games
- Run N calibration games (vs known opponents) before the bot appears on the leaderboard
- Admin manually sets a starting ELO based on benchmark results (already tracked in `MLBenchmarkResult`)

### 4. Model retraining and ELO
When an ML model is retrained, the linked bot's ELO should NOT automatically reset (the persona persists). But should there be an option to reset? A retrained model might be worse than the original, making historical ELO misleading.

### 5. One bot per model vs many
Current recommendation is 1:1 (one bot per model snapshot). But should admins be able to create multiple bot personas from the same model (e.g. "Aggressive Q-Bot" and "Defensive Q-Bot" that use the same weights but different play-style configs)?

### 6. Bot visibility
Should bots be visible to all users or only to signed-in users? Should a user be able to view a bot's full game history?

### 7. Difficulty picker retirement
Once bots exist, is the raw difficulty picker (novice/intermediate/advanced/master) still needed, or does it become the "Quick game" path only? Keeping both creates UX complexity.

---

## Implementation Phases

### Phase 1 — Schema + seed (no UX changes)
- Add `isBot`, `botModelId`, `botModelType` to `User`
- Migration
- Seed built-in bot users (Magnus, Rusty, Monte, Rulez)
- Admin: create/retire bots

### Phase 2 — Game recording + ELO
- Backend updates bot ELO after every PvAI game that references a bot `player2Id`
- `UserEloHistory` entries written for both human and bot
- Frontend passes `botId` in game record payload when applicable

### Phase 3 — Leaderboard + profiles
- Leaderboard `includeBots` filter + "Show bots" toggle
- Bot badge on leaderboard rows and profile pages
- Bot profiles: "Powered by" line, model update date

### Phase 4 — Mode selection UX
- Bot picker in mode selection (alongside existing difficulty slider)
- Bot ELO displayed in picker
- "Challenge" flow locks `player2Id` to the chosen bot
