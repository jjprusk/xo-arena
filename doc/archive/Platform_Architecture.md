<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# AI Arena — Platform Architecture

> **Related:** See `Platform_Implementation_Plan.md` for the phased implementation checklist derived from these decisions.

## Background

This document captures architectural decisions and open questions for evolving AI Arena from a single-game site into a multi-game platform. It emerged from a design discussion on 2026-04-13 and was reviewed externally (9.2/10).

**Game roadmap driving these decisions:**

| Game | Type | Status |
|---|---|---|
| XO | Board game (turn-based, 2-player) | Shipped |
| Connect4 | 2-player board game | Next |
| Poker | Card game, up to 7 players | Near-term |
| Pong | Real-time action | Near-term, architecturally distinct |
| Future games | TBD | Platform designed to grow |

---

## Decided

### 1. Unified branding
XO Arena as a separate brand is dropped. AI Arena is the single platform identity. The game is "XO" — not "XO Arena". Both sites share one visual language; per-site theming is removed.

### 2. The Colosseum model — tables
AI Arena is the Colosseum. Tables are where games are played. A table is set up for a specific game — an XO table, a Connect4 table, a poker table, a ping pong table. Players browse and create tables within AI Arena, then play at the table. No separate "room" concept is needed — the platform is the arena.

### 3. Primary navigation
**Tables · Tournaments · Rankings · Profile · About**

Tables replaces the Games dropdown as the primary entry point. FAQ folds into About.

### 4. Platform shell — landing service becomes the unified platform
The `landing/` service becomes the single AI Arena platform. The `frontend/` (XO game site) service is retired. All platform surfaces — Tables, Tournaments, Rankings, Profile, About, the game shell, Gym, and Puzzles — live within the landing service. Games load inline within this shell via `React.lazy`.

### 5. Game rendering — Option 1 with Game Contract / SDK
Games render as React components inline within AI Arena via `React.lazy`. The platform never navigates away. All games — first-party and third-party — implement a strict contract. A game package exports three things:

```js
export default GameComponent        // the playable game
export const meta = { ... }         // game metadata
export const botInterface = { ... } // AI/bot contract (see section 7)
export GymComponent                 // training UI — optional, if supportsBots: true
```

**Game metadata:**
- `id`, `name`, `minPlayers`, `maxPlayers`, `tableIcon`, `description`
- `supportsBots` — whether the game supports bot players
- `supportsTraining` — whether the game has a Gym
- `supportsPuzzles` — whether the game has puzzle content
- `builtInBots` — array of `{ id, name, description }` for bots shipped with the game

**Game SDK** — the only way a game communicates with the platform:

| Method | Purpose |
|---|---|
| `sdk.submitMove(move)` | Submit a player action |
| `sdk.onMove(callback)` | Receive moves (own or opponent's) |
| `sdk.signalEnd(result)` | Signal game over |
| `sdk.getPlayers()` | Who is at the table |
| `sdk.getSettings()` | Table config (time control, board size, etc.) |
| `sdk.spectate(callback)` | Subscribe to live move feed |
| `sdk.getPreviewState()` | Return lightweight board snapshot for Tables page thumbnails |
| `sdk.getPlayerState(playerId)` | Return game state visible to a specific player (required for hidden-information games like Poker) |

Games have no knowledge of auth, routing, sockets, or platform internals. XO must be fully refactored to use the SDK before any other game is built — it is the reference implementation and the SDK validation vehicle.

### 6. Games can be split to separate services at any time
The contract-based design makes splitting a game to its own deployment a one-line registry change:

```js
// Bundled (npm package, single site)
React.lazy(() => import('@aiarena/game-xo'))

// Split out (separate service, loaded by URL)
React.lazy(() => import(/* @vite-ignore */ 'https://games.aiarena.com/xo/bundle.js'))
```

This is done selectively per game. Initially all games are bundled — simpler, cheaper, no separate Fly service needed. Split out only when a game warrants it (traffic, team structure, scaling).

XO will be tested in both modes during Phase 1 to validate the mechanism before other games depend on it.

**Technical note:** Remote bundle loading requires `/* @vite-ignore */` on the dynamic import, CORS headers on the game service, and careful handling of the React context boundary — the game bundle has its own React instance and cannot share context with the platform directly. The SDK object is passed as a prop (not context) specifically to avoid this problem.

### 7. Bots and Skills

A **bot** is a persistent player identity that can learn and compete across multiple games. A **skill** is a trained model for one specific game. These are separate concepts.

- A bot is created first, without any skills
- Skills are trained onto a bot one game at a time — an XO skill, a Connect4 skill, etc.
- One skill per game per bot — enforced by a unique constraint on `(botId, gameId)`
- If a user wants a different algorithm for the same game, they create a new bot
- When the platform dispatches a bot's move, it looks up the bot's skill for the current game and calls `botInterface.makeMove(gameState, skill.weights)`

**Bot data model (existing `User` with `isBot: true`):**
No structural change — bots are already Users. The bot gains skills through training.

**Skill data model — replaces `MLModel`:**

| Field | Type | Notes |
|---|---|---|
| `id` | String | |
| `botId` | String | userId of the owning bot |
| `gameId` | String | Which game this skill is for |
| `algorithm` | Enum | Q_LEARNING, SARSA, DQN, MONTE_CARLO, POLICY_GRADIENT, ALPHAZERO |
| `weights` | Json | Trained weights — Q-table, neural net weights, etc. (replaces `qtable`) |
| `config` | Json | Hyperparameters used for this skill |
| `status` | Enum | IDLE, TRAINING, COMPLETE |
| `totalEpisodes` | Int | Training episodes completed |
| `checkpoints` | Relation | Saved weight snapshots at intervals |

> Unique constraint: `(botId, gameId)` — one skill per game per bot.
> ELO is not stored on the skill — it lives in `GameElo { userId, gameId, rating }` where userId is the bot's userId.

**Terminology throughout the platform:**
- "Skill" replaces "brain", "model", and "MLModel" in all UI copy and code
- `mlService.js` --> `skillService.js`
- `MLModel` Prisma model --> `BotSkill`
- `qtable` field --> `weights`
- "Train a model" --> "Train a skill"
- "Your models" --> "Your bots' skills"

### 8. AI model library — packages/ai
`packages/ai` is the platform-level shared AI library. All games import from it. It is not XO-specific — the algorithms are general-purpose and apply to any game with appropriate state adapters.

**Implemented models (all carry forward to the platform):**

| Model | Class | Key configurable options |
|---|---|---|
| Minimax | `minimaxImplementation` | Depth, alpha-beta pruning |
| Rule-based | `ruleBasedImplementation` | Heuristic weights |
| Q-Learning | `QLearningEngine` | Learning rate, discount factor, epsilon start/min/decay, decay method (exponential / linear / cosine) |
| SARSA | `SARSAEngine` | Same as Q-Learning |
| DQN | `DQNEngine` | Network layer sizes, hidden size, replay buffer size, batch size, target update frequency, learning rate, epsilon schedule, Adam optimizer |
| Neural Net | `NeuralNet` | Layer sizes (arbitrary depth and width), Adam optimizer toggle |
| Monte Carlo | `MonteCarloEngine` | Simulations per move, exploration constant |
| Policy Gradient | `PolicyGradientEngine` | Learning rate, discount factor, network architecture |
| AlphaZero | `AlphaZeroEngine` | Policy + value network layer sizes, MCTS simulations, cPuct, learning rate, temperature |

**All training configuration is fully parameterized.** Examples:
- AlphaZero network sizing: `POLICY_LAYERS` and `VALUE_LAYERS` are configurable arrays — any depth and width
- DQN: `layerSizes` accepts arbitrary layer config; `hiddenSize` shorthand for single-hidden-layer builds
- Epsilon decay: three strategies — `exponential`, `linear`, `cosine` — configurable across all RL agents
- Browser-side training: Web Worker loop for all models — training runs client-side without a server round-trip

**How games use the library:**
Games do not re-implement algorithms. They provide adapters:
- `serializeState(gameState) -> tensor` — how to represent the board as model input
- `deserializeMove(modelOutput) -> move` — how to interpret model output as a valid move
- `getLegalMoves(gameState) -> moves[]` — needed by MCTS, minimax, and masked softmax

XO's adapters encode a 3x3 board as a 9-element vector. Connect4 would encode a 6x7 board as a 42-element vector. The algorithms themselves are unchanged.

**`getTrainingConfig()` in botInterface** returns which models the game supports and what parameters are exposed in the Gym UI:

```js
getTrainingConfig() {
  return {
    models: ['qlearning', 'sarsa', 'dqn', 'montecarlo', 'alphazero', 'policygradient'],
    parameters: {
      alphazero: {
        policyLayers:    { type: 'layer-sizes', default: [9, 64, 32, 9]  },
        valueLayers:     { type: 'layer-sizes', default: [9, 64, 32, 1]  },
        numSimulations:  { type: 'int',         default: 50, min: 10, max: 500 },
        cPuct:           { type: 'float',       default: 1.5 },
        temperature:     { type: 'float',       default: 1.0 },
      },
      dqn: {
        layerSizes:      { type: 'layer-sizes', default: [9, 32, 9] },
        batchSize:       { type: 'int',         default: 32 },
        replayBufferSize:{ type: 'int',         default: 10000 },
        epsilonDecay:    { type: 'select',      options: ['exponential','linear','cosine'] },
      },
      // ... etc
    }
  }
}
```

The platform Gym UI renders controls for these parameters automatically. Admin functions — pausing runs, viewing progress, comparing model versions, adjusting hyperparameters mid-run — are platform concerns, not game concerns.

### 8. AI and bot architecture — botInterface contract
AI and bot support is what makes AI Arena unique. Every game that supports bots exports a `botInterface` alongside its game component. This is the complete AI contract for a game.

**The botInterface:**
```js
export const botInterface = {
  // Bot execution — called by platform server-side whenever a bot must move
  makeMove(gameState, config) -> move,

  // Built-in bot personas shipped with the game
  personas: [
    { id: 'minimax', name: 'Perfect Play', description: '...' },
    { id: 'random',  name: 'Random',       description: '...' },
  ],

  // Training
  getTrainingConfig()                        -> { parameters, defaults },
  train(state, episodes, config)             -> { weights, stats },
  serializeState(gameState)                  -> trainingInput,
  deserializeMove(modelOutput)               -> move,

  // Gym UI — the game's training environment, rendered by the platform shell
  GymComponent,

  // Puzzles (null if game has none)
  puzzles: [ ... ] | null,
}
```

**How bots interact with games:** Bots use the exact same SDK interface as human players. From the game's perspective there is no difference — both call `sdk.submitMove()` and receive `sdk.onMove()` callbacks. The platform dispatches bot moves server-side by calling `botInterface.makeMove()`. Games require no special bot handling.

**Platform provides (game-agnostic):**
- Bot user accounts (`isBot` flag, identity, management UI)
- Per-game ELO calculation and storage
- Training weight storage and versioning
- Training run scheduling and progress tracking
- Leaderboard integration across all games
- Tournament bot participation
- Bot-vs-bot table scheduling
- External bot developer registration and move dispatch

**Game provides (game-specific):**
- Bot logic (`makeMove`)
- Built-in bot personas
- Training algorithms and environment
- Gym UI component
- Puzzle content

**External bot developers** implement `makeMove(gameState, config) -> move` and deploy as an npm package or hosted endpoint. The platform calls it, rates it via ELO, and enters it in tournaments. External bot developers never touch game internals or platform internals.

**Gym and Puzzles in a multi-game world:** Gym and Puzzles are not XO-specific features — they are platform surfaces. The platform shell renders `GymComponent` and `puzzles` from whichever game package is active. Games that declare `supportsTraining: true` automatically get a Gym tab; games with `supportsPuzzles: true` get a Puzzles tab. The platform provides the chrome; the game provides the content.

### 8. Two game rendering modes
Mode is derived automatically from game state — no toggle, no user preference required.

- **Focused** — user is an active player in the current match. Full viewport, chrome hidden, small persistent escape affordance only.
- **Chrome present** — user is anyone else: spectator, replay viewer, bot owner watching, waiting for a seat. Platform chrome fully visible.

### 9. Game renderer treats live and historical data as interchangeable
The renderer accepts either a live socket feed (live view) or a recorded move array (replay). Both are treated as sequences of game states. This abstraction must be in place from the start.

For real-time games (Pong), replay stores sampled snapshots at fixed intervals (e.g. every 100ms) rather than discrete moves. The renderer treats these identically — a sequence of states — so no special casing is needed.

### 10. Replay retention is bounded
Move histories are not stored indefinitely. A configurable TTL (admin-controlled, default 90 days) governs expiry. A scheduled job purges expired move streams while retaining game results (winner, ELO delta, duration, participants) permanently.

The existing `replayRetentionDays` field on the `Tournament` model is superseded by this system. Its value is migrated to the new admin TTL config on deploy and the field is removed.

### 11. Journey must be updated
The onboarding journey references nav items, site names, and structural concepts that are all changing. It must be updated in lockstep with any nav or branding implementation. Particular care is required for any journey step whose completion is triggered by a route visit — if that route changes or disappears the step becomes permanently inskippable.

### 12. Table discovery
Tables are public by default. A private option is available at table creation time. Private tables are joined via share link — the table URL (`/tables/[id]`) is the invite mechanism. Bot-vs-bot tables are always public.

### 13. Table chat
Presence-only at launch. Chat is a planned future addition. The table data model includes `chatEnabled Boolean` from the start so chat can be activated without a schema migration.

### 14. Replay retention — separate TTLs for casual vs tournament
Tournament match streams are retained under a separate, longer admin-configurable TTL. Game records carry `isTournament Boolean` that the purge job uses to apply the correct policy.

### 15. SDK distribution — GitHub Packages (private npm registry)
Games and bot packages are distributed via GitHub Packages under the `@aiarena` scope. The registry is private initially. The platform loads games via dynamic import:

```js
React.lazy(() => import(`@aiarena/game-${gameId}`))
```

### 16. Game roadmap and sequencing

| Order | Game | Architectural prerequisite |
|---|---|---|
| 1 | XO | Reference SDK + botInterface implementation |
| 2 | Connect4 | SDK + botInterface + npm workflow proven via XO |
| 3 | Poker | Variable player count; `sdk.getPlayerState`; hidden information |
| 4 | Pong | Real-time architecture spike completed |

**Pong spike:** Evaluate tight WebSocket loop first — see Section 20, Tier 1. Spike completed during Phase 1, findings reviewed before Phase 6 begins. WebRTC / WebTransport are fallback options only if WebSocket latency proves inadequate; see `doc/Pong_Spike_Findings.md`.

**Poker flags:** Up to 7 players. Hidden information. Virtual chips only — no real money, ever.

### 17. Core table data model
All fields must be present from the start:

| Field | Type | Notes |
|---|---|---|
| `gameId` | String | Which game is played at this table |
| `status` | Enum | `forming \| active \| completed` |
| `createdBy` | String | userId of table creator |
| `minPlayers` | Int | From game metadata |
| `maxPlayers` | Int | From game metadata |
| `isPrivate` | Boolean | Private tables joined via share link |
| `chatEnabled` | Boolean | False at launch; future-proofed |
| `isTournament` | Boolean | Governs replay retention TTL |
| `seats` | Json | `[{ userId, status: "occupied \| empty" }]` |
| `previewState` | Json? | Lightweight snapshot via `sdk.getPreviewState()` |

> **Future:** `reserved` seat status for invite flows. `shareToken` field for private table links if `/tables/[id]` is insufficient.

### 18. Per-game ELO
Each game has its own ELO ladder. A new `GameElo` relation replaces the single `eloRating` field on `User`:

```
GameElo { userId, gameId, rating Float, gamesPlayed Int }
```

The existing `eloRating` on `User` is migrated to `GameElo` entries for XO on deploy and the field is removed. Rankings, leaderboards, and bot profiles all display per-game ratings.

### 19. XO subnav — Play, Gym, Puzzles, Stats
When `frontend/` is retired, XO's subnav items migrate as follows:

| Item | Fate |
|---|---|
| Play | Becomes "sit at an XO table" — the Tables page flow |
| Gym | Moves to platform shell as a game-specific tab, powered by `botInterface.GymComponent` |
| Puzzles | Moves to platform shell as a game-specific tab, powered by `botInterface.puzzles` |
| Stats | Moves to platform shell under the XO game context or the Rankings/Profile pages |

### 20. Real-time transport tiers

Real-time concerns split into three tiers by **latency class**, not by feature or game. Each tier has a distinct transport, failure model, and testing strategy. This segregation is the single most important decision for the platform's reliability profile.

**Tier 1 — Live gameplay (game-specific cadence).**
WebSocket, scoped to an active game. Connection opens when the player sits at an active table, closes when the game finishes or the player leaves. Each game declares its needs via the Game Contract:

| Game class | Rate | Reconnect policy |
|---|---|---|
| Turn-based (XO, Connect4, Poker) | ~1-10 msg/min | `pause` — game waits, server replays last N moves on reconnect |
| Real-time (Pong, future action games) | 30-60Hz, client-side prediction + server reconciliation | `resyncFromSnapshot` or `forfeit` — per-game choice |

WebSocket is sufficient for every game on the roadmap. Browser pong over WebSocket hits ~50ms RTT, which is adequate for paddle sports. WebRTC DataChannels or WebTransport are considered only if a future game genuinely needs sub-30ms (e.g. fighting games with rollback netcode) — revisit per game, not upfront. Raw UDP is not available to browsers; "use UDP" in browser-land means WebRTC or WebTransport, both of which trade one complexity for another.

**Tier 2 — Lobby, tournaments, notifications, presence (game-agnostic).**
REST is the source of truth. **Sockets are hints, not state.**

- Every piece of UI state in this tier has a canonical REST endpoint.
- SSE (Server-Sent Events) delivers lightweight "something changed" pings. Client calls the REST endpoint to reconcile.
- Backstop polling at 15-30s catches anything missed during reconnects, Safari throttling, or server restarts.
- Sequence IDs + server-side replay (5-minute ring buffer) cover events that fire during SSE reconnect gaps — SSE's built-in `Last-Event-ID` semantics handle this automatically.
- Clients never derive state directly from socket/SSE payloads. Payloads are `{ type: "tournament:changed", tournamentId: "X" }` at most — the real state comes from `GET /api/tournaments/X`.

This tier includes: tournament status, brackets, participants, match-ready signals, notifications, online presence, lobby / table lists, admin dashboards.

**Tier 3 — Background / offline (game-agnostic).**
Web Push for notifications that must reach the user when the tab isn't open:

- "Your tournament match is ready"
- "Your bot match completed"
- "Tournament you registered for starts in 5 minutes"

Replaces the current socket-delivered Guide notification path for the offline case. Tab-open notifications stay in Tier 2 (SSE → REST refetch).

**Core principle: sockets are transports, not sources of truth.** If a socket event is missed, the next refetch — triggered by timer, focus, visibility change, or reconnect — must converge the UI. No socket event carries information that isn't derivable from REST. This is the architectural pattern Discord, lichess, and chess.com have each written publicly about adopting after hitting the same bug classes we have.

**What this buys:**
- Reconnect handling stops mattering for Tier 2. A dropped event is invisible — the next poll or focus-trigger catches up.
- Tests become deterministic — REST is trivially testable; sockets are not.
- State drift bugs (today's "Play Match ghost", "9+ notifications stays stale", "tournament shows Registration after admin starts") become structurally impossible.
- macOS Space-switch / Safari throttle edge cases collapse from ~12 distinct failure modes to ~3 (all in Tier 1, scoped to active gameplay).

**What this costs:**
- Slightly more DB load from polling (20 queries/min per open page — negligible at current traffic).
- Some features react ~1-3s slower on the worst-case socket-miss path, versus ~100ms today on the happy path. Happy path is unchanged — SSE hint + REST refetch is <200ms perceived.
- One-time migration work — see addendum.

**See addendum at end of doc for the implementation plan.**

---

## Pending Decisions

### D8 — Spectator-first pivot: when and what triggers it
At what point does the platform shift emphasis from active play to spectating? Architecture supports both. Revisit after Connect4 ships.

**Possible triggers:**
- Bot-vs-bot match volume exceeds human-vs-human
- A meaningful portion of active users have bots running
- A second game ships and cross-game spectating becomes possible

---

## Implementation Order

1. **Design SDK + botInterface contracts** — foundational; nothing else starts until these are stable
2. **Refactor XO into `@aiarena/game-xo`** — validates full pipeline including both loading paths
3. **Pong real-time spike** — runs in parallel with XO refactor (Phase 1)
4. **Retire `frontend/` service** — landing becomes the unified platform
5. **Rebrand + nav** — unified AI Arena identity, 5-item nav
6. **Build Tables page and table data model** — new front door
7. **Build Connect4 as `@aiarena/game-connect4`** — proves SDK + botInterface reusability
8. **Build Poker** — hidden information extension, variable player counts
9. **Build Pong** — real-time architecture from spike findings

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SDK or botInterface becomes a breaking public API too early | Medium | High | Keep registry private until XO is fully refactored and stable |
| Table model missing fields found late | Low | Medium | All required fields defined in section 17 — implement from the start |
| Pong real-time performance surprises | Medium | High | WebSocket spike in Phase 1, findings reviewed before Phase 6 |
| Tables page live previews overload clients | Low-Medium | Medium | `previewState` is lightweight snapshot only |
| React context boundary when loading games via remote URL | Medium | Medium | SDK passed as prop not context; verify during Phase 1 split-out test |
| Per-game ELO migration breaks existing rankings | Low | Medium | Migrate XO ELO to `GameElo` in same deploy that removes `eloRating` field |
| Spectator-first pivot timing | Low | Medium | Revisit after Connect4 ships |

---

## Architectural Flags

- **TensorFlow.js migration** — current training uses a pure-JS engine (`packages/ai`). TF.js would unlock GPU acceleration, larger networks, and faster training for complex games. Evaluate during Connect4 development — if the 6x7 board (42 inputs vs XO's 9) makes training noticeably slow, spike on TF.js at that point. A migration plan already exists at `doc/TensorflowJS_Migration_Plan.md`. Do not introduce during Phase 1.

- **Pong is architecturally different** — real-time, not turn-based. Still Tier 1 WebSocket per Section 20 — higher message rate (30-60Hz) and different reconnect policy, but same transport. Spike in Phase 1.
- **Poker requires hidden information** — `sdk.getPlayerState` required before Poker ships.
- **botInterface is a public API** — treat it with the same care as the game SDK. Validate fully in XO before any other game builds on it.
- **Tournaments fit naturally** — a tournament is a special table configuration that auto-generates matches.
- **Notification bus new events** — `table.created`, `match.ready`, `player.joined`, `spectator.joined`, `table.empty` at minimum.
- **Tables page live previews** — `getPreviewState()` in the game contract; do not load full game bundles for thumbnails.
- **Journey route triggers** — any journey step triggered by a route visit must be re-wired when routes change. Do not rely on route existence without an explicit trigger migration task.

---

## Addendum: Tier 2 Transport Migration — Design and Implementation Plan

This addendum accompanies Section 20 and specifies how to move tournament state, notifications, and presence from the current socket-broadcast model to the socket-as-hint + REST-as-truth pattern.

### Goals
- Every piece of Tier 2 state has a canonical REST endpoint.
- SSE delivers lightweight change hints; clients never derive state from payloads.
- Reconnect gaps and browser-throttle edge cases are structurally absorbed by replay + polling.
- Game-active socket code (Tier 1) is untouched.

### Non-goals
- Replacing WebSocket for gameplay (Tier 1 is fine as-is).
- UDP / WebRTC / WebTransport (revisit per future game; not needed for the current roadmap).
- GraphQL subscriptions (adds protocol layer without solving semantic issues).
- Rewriting test infrastructure (this migration makes tests *easier* — REST is trivially testable).

### Event envelope shape

All Tier 2 SSE events use a minimal envelope. The payload is a **hint**, not state.

```json
{ "id": 4712, "channel": "tournaments", "type": "tournament:changed", "ref": "tournamentId:X" }
{ "id": 4713, "channel": "notifications", "type": "notification:new" }
{ "id": 4714, "channel": "presence", "type": "table:presence:changed", "ref": "tableId:Y" }
```

`id` is monotonic per stream. On reconnect the client sends `Last-Event-ID: 4713` and the server replays 4714+ from a 5-minute ring buffer (or emits `resync-required` if the client fell behind).

### Phase A — Harden REST layer (no client changes)

1. Audit current Tier 2 socket events. For each, confirm a REST endpoint returns the same authoritative state. Add any missing ones:
   - `GET /api/v1/notifications` (already exists — verify list semantics)
   - `GET /api/tournaments/:id` (exists)
   - `GET /api/tournaments?filter=...` (exists)
   - `GET /api/v1/presence/tables/:id` (new — returns current spectator/player list)
2. Add `If-Modified-Since` / ETag support where cheap to compute, for cheap polling.
3. Add monotonic sequence IDs to all tournament service broadcasts — emit into a Redis ring buffer (`events:stream:{channel}`) with a 5-minute TTL.
4. Add backend route `GET /api/v1/events/replay?channel=X&since=N` returning buffered events since sequence N. Used by SSE server-side for Last-Event-ID replay.

**Exit criteria:** every Tier 2 piece of state has a REST endpoint + a sequence-numbered event stream in Redis. No client changes yet.

### Phase B — SSE endpoint

1. New route: `GET /api/v1/events/stream?channels=notifications,tournaments,presence`.
2. Implements SSE with auto-retry, `Last-Event-ID` support, and per-user channel authorization (user only sees their own notifications).
3. Proxy configuration (Vite, landing `server.js`, Fly/nginx): `X-Accel-Buffering: no`, no gzip on `text/event-stream`, proper connection-close handling.
4. Rate limits: max 2 concurrent SSE streams per user (prevent tab spam).
5. Reverse-proxy compatibility tested early — SSE regressions through proxies are the most common deployment gotcha.

**Exit criteria:** a new browser tab can connect to `/api/v1/events/stream`, receive a heartbeat every 30s, and get replayed events on reconnect.

### Phase C — Feature-by-feature client migration

All migrations gated behind `VITE_TIER2_SSE` feature flag. The new path runs *alongside* the existing socket path until proven; the flag flips the client to SSE-only.

**C.1 — Notifications (simplest; list semantics, DB-backed).**
- Replace `useTournamentSocket`'s notification handlers with an SSE subscriber.
- On `notification:new` → call `GET /api/v1/notifications` → update Guide badge/list.
- Remove direct payload-to-state derivation — always refetch.
- Acceptance: Guide notification count always reconciles within 30s of reality, even after 10 minutes of tab sleep.

**C.2 — Tournament detail page.**
- Replace `useTournamentSocket` handlers on `TournamentDetailPage` with SSE.
- Any `tournament:*` event matching the current `tournamentId` triggers `load()`.
- Keep existing `load()` — it already does the right thing.
- Add backstop poll: every 20s while the tab is focused, paused on `document.hidden`.
- Acceptance: after admin starts tournament via API, the user's page shows the "Play Match" card within 2s without any manual reload. (This specifically fixes today's test flake.)

**C.3 — Tournament list page.**
- Same pattern. SSE event triggers list refetch.

**C.4 — Presence / online users.**
- Replace current socket room membership tracking with a REST heartbeat: client POSTs `/api/v1/presence/heartbeat` every 15s while focused.
- Server SSE emits `presence:changed` when a user's heartbeat expires or a new one starts.
- Acceptance: online count in the Guide sidebar reconciles within 30s of a user closing a tab.

**Exit criteria (Phase C):** all four Tier 2 features behave correctly with the feature flag on. Manual QA matches API-level expectations. Playwright tests for each added.

### Phase D — Retire socket Tier 2 channels ✅ Done

1. **Feature flag retired.** `VITE_TIER2_SSE` removed; SSE is the default and only Tier 2 transport for new Guide, tournament, and presence events.
2. **Client migrated.** `useTournamentSocket` deleted; `TournamentsPage`, `TournamentDetailPage`, `TablesPage`, `TableDetailPage`, and `AppLayout` all consume Tier 2 via `useEventStream`. `AppLayout` also REST-bootstraps undelivered `UserNotification` rows on sign-in (the replacement for the old socket reconnect flush).
3. **Backend dual-writes removed.** `notificationBus.dispatch` no longer calls `_io.emit('guide:notification')`; it writes a `UserNotification` row (when persistent) and appends to the Tier 2 Redis stream. `tournamentBridge.handleEvent` and `scheduledJobs` no longer emit `tournament:*` over socket.io — those are fanned out via the `tournament/redis.js::publish` → XADD pipeline that the SSE broker already reads.
4. **Socket surface area shrunk.** `socketHandler.user:subscribe` now just joins the `user:${id}` room (for journeyService's `guide:journeyStep`); the old presence tracking (`_onlineBySocket`, `broadcastOnlineUsers`, 30s broadcast timer, reconnect flush, disconnect grace-period removal) is gone. Online presence lives entirely in `presenceStore.js` / heartbeats.

**Remaining non-Tier-2 socket responsibilities:** gameplay rooms (`room:*`, `game:*`), table-room presence (`table:presence`), journey step nudges (`guide:journeyStep`). Everything else flows via REST + SSE.

### Phase E — Web Push (Tier 3) ✅ Done

VAPID keys live in `backend/.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`). The public key is exposed to the client via `VITE_VAPID_PUBLIC_KEY` in `docker-compose.yml` and via the unauthenticated `GET /api/v1/push/public-key` endpoint.

**Backend:**
- `PushSubscription` model (per-browser rows; unique on `endpoint`, cascade-deleted with user).
- `NotificationPreference` gains a `push: boolean` column (default `false` — opt-in).
- `backend/src/lib/pushService.js`: `sendToUser(userId, payload)` fans out to every subscription via `web-push`, auto-purges 404/410 endpoints, refreshes `lastUsedAt`. `buildPushPayload(type, payload)` maps bus events to `{ title, body, url }` for the SW.
- `backend/src/routes/push.js`: `GET /public-key`, `POST /subscribe`, `DELETE /subscribe`, `GET /subscriptions`.
- `notificationBus.dispatch` now calls `pushService.sendToUser` when: the REGISTRY entry has `push: true`, the `NotificationPreference.push` is true for that event type, AND the user has no active SSE client (`sseBroker.clientCountForUser === 0`). Push is a backup for offline; online users already got the SSE entry.
- Push-eligible events: `match.ready`, `tournament.starting_soon`, `tournament.started`, `tournament.cancelled`, `achievement.tier_upgrade`.

**Frontend:**
- `landing/public/sw.js`: handles `push` + `notificationclick`. Tag per event type collapses duplicates; click focuses an existing tab (or opens one) at the event's `url`.
- `landing/src/lib/pushSubscribe.js`: `subscribePush`, `unsubscribePush`, `hasActiveSubscription`, `isPushSupported`, `currentPermission`. Handles permission prompt, VAPID key fetch, SW registration, and REST registration.
- `SettingsPage`: "Push notifications" section with a per-browser enable toggle and per-event-type push preferences (stored on `NotificationPreference.push` via `PUT /users/notification-preferences/:eventType`).

**Tests:** `pushService.test.js` (12) + `push.test.js` (9) covering the VAPID config, send/purge, unknown types, auth, and validation. 996 backend + 46 landing, all green.

### Reconnect policy summary

| Transport | Scope | Reconnect strategy |
|---|---|---|
| WebSocket (Tier 1, game-active) | Active game room | Server re-sends last N moves on reconnect; client re-hydrates state. Reconnect during real-time games follows per-game `onDisconnect` policy. |
| SSE (Tier 2) | Per-user, all open tabs | `Last-Event-ID` replay from Redis ring buffer (5 min). Beyond 5 min → client does full REST resync. |
| REST polling (Tier 2 backstop) | Per-page | Timer + focus/visibility triggers. Always authoritative. |
| Web Push (Tier 3) | Background | Delivered via OS. User clicks → opens tab → Tier 2 takes over. |

### Testing strategy

- **Unit tests:** REST endpoints + sequence ID generation + ring buffer behavior.
- **Integration tests:** SSE endpoint with simulated client disconnect / Last-Event-ID replay.
- **E2E (Playwright):** the existing API-only `tournament-mixed.spec.js` already covers the end-to-end flow without needing UI timing. After Phase C.2, add one small UI smoke test that verifies "tournament:started SSE hint triggers page refetch" — no socket mocking needed.
- **Manual QA:** the manual scenarios we've been running (Space switch, long background, server restart) become pass/fail scripts against explicit acceptance criteria rather than vibe-checks.

### Effort estimate

| Phase | Rough effort |
|---|---|
| A — Harden REST + sequence IDs | 2-3 days |
| B — SSE endpoint + proxy config | 2 days |
| C.1 — Notifications migration | 1 day |
| C.2 — Tournament detail migration | 1 day |
| C.3 — Tournament list migration | 0.5 day |
| C.4 — Presence migration | 1-2 days |
| D — Socket Tier 2 cleanup | 0.5 day |
| E — Web Push (separate scope) | 2-3 days |

**Total for A-D: ~8-10 days of focused work, shippable in increments.** Phase E is an independent follow-up.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SSE buffering / proxy incompatibilities | Medium | Medium | Test through every proxy layer in Phase B; explicit `X-Accel-Buffering: no` and no-gzip |
| Redis ring buffer lost on restart | Low | Low | Events only replay back 5 min; full resync fallback always works |
| Backstop polling load on DB | Low | Low | Rate-limit per user; audit query cost in Phase A |
| Feature-flag divergence (old+new paths drift) | Medium | Medium | Keep flag window short (<2 weeks per feature); both paths share the REST endpoint so server side is identical |
| Discoverability — future devs use the wrong tier | Medium | Low | Decision tree in dev guide; lint rule forbidding direct socket payload-to-state in Tier 2 code |
| Pong reconnect story (Tier 1) conflates with Tier 2 refactor | Low | Medium | They're independent — this addendum explicitly excludes Tier 1 changes |
