<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# AI Arena — Platform Implementation Plan

> **Related:** See `Platform_Architecture.md` for the decisions and rationale behind this plan.

> Phases are sequential; items within a phase can run in parallel unless noted.

---

## Phase 1 — Foundation: SDK + botInterface + XO Refactor

> **Goal:** Establish the game contract and bot contract, publish XO as the reference implementation, validate both loading paths. Nothing else is built on the platform until this phase is complete.

### 1.1 Game SDK contract

- [x] Define the `GameContract` TypeScript interface (`meta` + default component export)
- [x] Define all `meta` fields including `supportsBots`, `supportsTraining`, `supportsPuzzles`, `builtInBots`
- [x] Define the `GameSDK` interface: `submitMove`, `onMove`, `signalEnd`, `getPlayers`, `getSettings`, `spectate`, `getPreviewState`, `getPlayerState`
- [x] Implement the platform-side SDK provider (creates the `sdk` object passed into every game)
- [x] Write SDK developer documentation (contract spec, method signatures, example usage) — `doc/Game_SDK_Developer_Guide.md`

### 1.2 botInterface contract

- [x] Define the `BotInterface` TypeScript interface
- [x] Define all methods: `makeMove`, `getTrainingConfig`, `train`, `serializeState`, `deserializeMove`
- [x] Define `personas` array structure
- [x] Define `GymComponent` prop contract (what the platform passes in)
- [x] Define `puzzles` array structure
- [x] Implement the platform-side bot dispatcher (calls `botInterface.makeMove()` server-side for bot turns)
- [x] Write botInterface developer documentation — covered in `doc/Game_SDK_Developer_Guide.md`

### 1.3 GitHub Packages registry

- [x] Create `@callidity` npm scope on GitHub Packages — GitHub org `callidity` created
- [x] Configure CI to authenticate with GitHub Packages for publish and install — `ci.yml` updated with `registry-url` + `NODE_AUTH_TOKEN`
- [x] Document the publish workflow for internal use — `.github/workflows/publish-packages.yml`
- [x] Add `.npmrc` configuration to all relevant packages — root `.npmrc` + `packages/sdk/.npmrc`; game packages get their own `.npmrc` when created

### 1.4 XO refactor into `@callidity/game-xo`

- [x] Extract XO game logic into a standalone package under `packages/game-xo/`
- [x] Implement full `meta` export including `supportsBots: true`, `supportsTraining: true`, `supportsPuzzles: true`, `builtInBots`
- [x] Refactor XO game component to receive `{ session, sdk }` props only — remove all direct platform calls
- [x] Replace direct socket calls with `sdk.submitMove` / `sdk.onMove`
- [x] Replace game-over logic with `sdk.signalEnd`
- [x] Implement `sdk.getPreviewState()` — lightweight board snapshot
- [x] Implement `sdk.spectate()` — live move feed for spectators
- [x] Implement focused vs chrome-present rendering modes — derived from `session.isSpectator`
- [x] Add escape affordance for focused mode (floating "Back to Arena" button)
- [x] Implement `botInterface.makeMove()` — wraps existing minimax and ML bot logic
- [x] Implement `botInterface.personas` — existing named bot personalities
- [x] Implement `botInterface.getTrainingConfig()`, `train()`, `serializeState()`, `deserializeMove()`
- [x] Migrate GymComponent into the package as `botInterface.GymComponent`
- [x] Migrate puzzle content into the package as `botInterface.puzzles`
- [ ] Publish `@callidity/game-xo` to GitHub Packages — requires `CALLIDITY_NPM_TOKEN` secret (fine-grained PAT with write:packages on callidity org); see doc/Registry_Switch_Guide.md
- [x] Verify platform loads XO via `React.lazy(() => import('@callidity/game-xo'))` — bundled path (builds clean, 37KB separate chunk)
- [ ] Deploy `@callidity/game-xo` as a standalone local test service — deferred to Phase 7 (requires importmap for shared React instance; documented in Registry_Switch_Guide.md)
- [ ] Verify platform loads XO via dynamic URL import — deferred to Phase 7
- [ ] Confirm `/* @vite-ignore */` import works, CORS headers correct, SDK props cross the bundle boundary correctly — deferred to Phase 7 (importmap prerequisite)
- [x] Document the registry switch mechanism — `doc/Registry_Switch_Guide.md`
- [x] Run full regression — all XO functionality works through both loading paths (bundled path verified: PvP, win/draw/loss detection, marks, scores, reactions, forfeit, rematch; split-out URL path deferred to 1.4 outstanding items)
- [x] Move `ruleBasedImplementation` from `backend/src/ai/ruleBased.js` into `packages/ai` so rule-based bot personas work in `botInterface.makeMove()`

### 1.5 Replay and live view abstraction

- [x] Design game state reconstructor (applies move array to initial state in sequence) — `useReplaySDK.reconstructStates()`
- [x] Update game renderer to accept either live socket feed or recorded move array — `useReplaySDK` provides same `{ session, sdk }` interface as `useGameSDK`
- [x] Implement replay controls: play/pause, step forward/back, scrub, variable speed — `ReplayPage` + `ReplayControls`
- [x] Implement live view mode: input disabled, observer status signalled in UI — derived from `session.isSpectator: true`; `ReplayPage` delivers via fake spectate SDK
- [ ] For Pong (future): confirm sampled snapshot approach (100ms intervals) works within this abstraction — deferred until Pong spike (1.8)
- [x] Test: replay a completed XO game end-to-end — play a game, visit `/replay/:id`

### 1.6 Replay retention infrastructure

- [x] Add `moveStream` storage to game records (separate from result) — `Json?` field on `Game`; populated by roomManager + socketHandler + botGameRunner
- [x] Add `isTournament Boolean` flag to game records — backfilled from `tournamentId IS NOT NULL`
- [x] Implement admin-configurable TTL settings (casual TTL, tournament TTL, default 90 days) — `SystemConfig` keys `replay.casualRetentionDays` / `replay.tournamentRetentionDays`
- [x] Build scheduled purge job — deletes expired move streams, retains game results permanently — `replayPurgeService.js`, 24h interval
- [x] Migrate existing `replayRetentionDays` from `Tournament` model to new admin TTL config — defaults set to 90 days in SystemConfig
- [x] Remove `replayRetentionDays` field from `Tournament` model — migration `20260413120000_replay_stream`
- [x] Add retention settings to admin panel — `ReplayConfigPanel` in `AdminDashboard`

### 1.7 Schema migration — Skills, per-game ELO, terminology

**MLModel --> BotSkill**
- [x] Rename `MLModel` Prisma model to `BotSkill`
- [x] Add `botId String` field (userId of the owning bot)
- [x] Add `gameId String` field
- [x] Add unique constraint on `(botId, gameId)`
- [x] Rename `qtable Json` field to `weights Json`
- [x] Add `algorithm String` field — records which algorithm produced the weights so `makeMove` can deserialize correctly (e.g. `'qlearning'`, `'alphazero'`)
- [x] Migrate existing `MLModel` records — set `gameId = 'xo'`, set `botId` from `createdBy`, set `algorithm = 'qlearning'`
- [x] Remove `eloRating` from `BotSkill` (ELO moves to `GameElo`)
- [ ] Run and verify migration against staging DB

**Per-game ELO**
- [x] Create `GameElo` model: `{ userId, gameId, rating Float, gamesPlayed Int }`
- [x] Migrate existing `eloRating` values from `User` to `GameElo` entries for XO (humans and bots)
- [x] Migrate existing `eloRating` values from old `MLModel` to `GameElo` entries
- [x] Remove `eloRating` field from `User` model
- [x] Update all ELO read/write logic to use `GameElo`
- [x] Update leaderboard and profile pages to display per-game ratings

**Terminology rename throughout codebase**
- [x] Rename `mlService.js` --> `skillService.js`, update all imports
- [x] Replace "brain" / "model" with "skill" in all UI copy, API responses, and comments
- [x] Rename API routes: `/api/ml/*` --> `/api/skills/*` (both mounted; `/api/ml` kept for backward compat)
- [x] Update admin panel labels
- [x] Update Gym UI — algorithm display, checkpoint display, ELO references removed from BotSkill

### 1.8 Pong real-time spike

> Run in parallel with 1.4. Real-time architecture findings must be in hand before Connect4 is complete.

- [x] Build minimal Pong prototype using tight WebSocket loop (Socket.io)
- [x] Measure game feel, latency, and server load at simulated concurrent tables
- [x] Decision point: confirm WebSocket loop is sufficient or escalate to WebRTC evaluation — **WebSocket confirmed sufficient**
- [x] Document findings and recommended approach — `doc/Pong_Spike_Findings.md`

---

## Phase 2 — Platform Consolidation: Rebrand and Navigate

> **Goal:** The unified AI Arena identity, nav, and journey live on `landing/`. Frontend retirement is split out into Phase 3.0 since it's the natural prerequisite for the Tables-page work.

### 2.1 Unified visual identity

- [x] Remove XO-specific theming (mountain background, teal/blue per-site identity) — Colosseum background live; no per-site theming
- [x] Align to AI Arena design language (Colosseum + slate blue) — live on staging
- [x] Audit all hardcoded "XO Arena" strings — replace with "XO" or "AI Arena" — AppNav "XO Arena" → "XO", BotProfilePage "XO Arena (built-in)" → "AI Arena (built-in)", page title "AI Arena"
- [x] Verify shared `packages/nav` renders consistently — verified on staging, desktop + mobile

### 2.2 Primary navigation

- [x] Update nav to: Tables · Tournaments · Rankings · Profile · About — navItems.js updated, verified
- [x] Remove Games dropdown — confirmed gone
- [ ] Fold FAQ into About page (`/about#faq` or tabbed section) — FAQ content still on standalone `/faq` route; not yet folded into About
- [x] Update `packages/nav/src/navItems.js` with new structure — done
- [x] Verify desktop and mobile (hamburger) nav — verified on staging

### 2.3 Onboarding journey update

- [x] Audit all journey steps for references to old nav items, site names, or structural flows — all 8 step titles and hrefs are correct; all routes are internal
- [x] Update step copy and instructions to reflect new nav and AI Arena identity — `JourneyCard.jsx` STEPS titles confirmed correct; `JOURNEY_DEFAULT_SLOTS` step 7 slot corrected from `play_my_bot` → `tournaments` to match "Enter a tournament" step
- [x] Update any journey step that references "XO Arena" to "XO" or "AI Arena" — `JourneyCard.jsx` badge label updated
- [x] **Re-wire journey steps whose completion is triggered by a route visit** — `slotActions.js` XO-section slots converted to internal routes; `JourneyCard.jsx` steps 3, 4, 6 converted from external cross-site links to internal `<Link>`
- [x] Update site badges on journey cards if needed — all steps use `site: 'platform'` → "AI Arena" badge; correct
- [x] QA full journey flow end-to-end — verify every step can be completed

### 2.x QA Checklist

> Signed off 2026-04-15 against staging v1.3.0-alpha-1.06.

#### Core navigation

- [x] Landing home page loads with correct branding ("AI Arena" / "XO", no "XO Arena")
- [x] All 5 nav items visible and route correctly: Tables · Tournaments · Rankings · Profile · About
- [x] No broken links or 404s in the main nav
- [x] Mobile hamburger nav opens and all items are reachable

#### Cross-site links removed

- [x] Home page "Play" button routes to `/play` internally (no redirect to external site)
- [x] Profile page stats and bot links route internally
- [x] Journey card steps 3, 4, 6 route internally — no cross-site navigation
- [x] Guide slot actions route internally

#### Ported pages (new on landing)

- [x] `/gym` loads the Gym page
- [x] `/gym/guide` loads the Gym Guide page
- [x] `/puzzles` loads the Puzzle page
- [x] `/rankings` loads the Rankings page
- [x] `/stats` loads the Stats page
- [x] `/bots/:id` loads the Bot Profile page

#### Phase 2.1 — Branding

- [x] No "XO Arena" text visible anywhere in the UI
- [x] Home page, About page, and welcome modal use "AI Arena" / "XO" correctly

#### Phase 2.2 — Navigation

- [x] Nav shows: Tables · Tournaments · Rankings · Profile · About
- [x] No Games dropdown visible
- [x] FAQ content accessible via About page
- [x] Rankings nav item routes to `/rankings` on landing (not cross-site)

#### Phase 2.3 — Journey

- [x] Journey opens correctly for new users
- [x] All journey steps can be completed end-to-end
- [x] No journey step links to the old frontend domain

#### Auth flows

- [x] Sign-in modal opens
- [x] Google OAuth sign-in works end to end
- [x] Signed-in state persists on refresh

#### Settings

- [x] Settings page loads when signed in
- [x] Notification preference toggle saves
- [x] Flash alerts toggle saves
---

## Phase 3 — Frontend Retirement, Tables Page, Platform Shell

> **Goal:** Retire the legacy XO frontend service, then ship the Tables page (the new front door) and the platform shell that loads any registered game.

### 3.0 Retire the XO frontend service

> **Prerequisite:** Phase 2 complete — landing fully owns the unified AI Arena UI; XO loads correctly through the platform shell on landing.

- [x] Confirm `@callidity/game-xo` loads and plays correctly via the platform shell — verified end-to-end on staging at v1.3.0-alpha-1.06
- [x] Confirm Gym and Puzzles render correctly via `botInterface.GymComponent` and `botInterface.puzzles` — Gym, Gym Guide, and Puzzles all render on landing
- [x] Remove `frontend/` service from the monorepo — deleted in `a4ad867`, 193 files / 41 MB
- [x] Remove `frontend` service from Fly.io (`xo-frontend-staging`, `xo-frontend-prod`) — both destroyed via `flyctl apps destroy` on 2026-04-15
- [x] Remove `frontend` from `docker-compose.yml` — `73067c8`
- [x] Remove `frontend` deploy steps from `.github/workflows/deploy-staging.yml` and `deploy-prod.yml` — `dc61aa7`
- [x] Update e2e smoke tests — drop `BASE_URL=https://xo-frontend-staging.fly.dev` from the harness — `a79abe5`; playwright baseURL now defaults to LANDING_URL
- [x] Update all remaining internal references from XO frontend URL to AI Arena URL — landing/server.js `/xo` proxy removed (`10e1dc2`); landing/Dockerfile `VITE_XO_URL` arg removed; generate-training-guide-pdf.yml re-pointed to `landing/public/`
- [x] Final QA: staging and prod both verified clean at v1.3.0-alpha-1.07+ with 12/12 smoke tests passing

### 3.1 Table data model (backend) — complete

> Signed off 2026-04-15 against staging v1.3.0-alpha-1.08.

- [x] Create `Table` Prisma model with all required fields — `85bd20d`; TableStatus enum (FORMING/ACTIVE/COMPLETED), seats Json, previewState Json, isPrivate, isTournament; indexes on status, gameId, createdById, isTournament
- [x] Run and verify migration — `20260416000403_phase3_tables` applied to local dev DB; Prisma Client regenerated
- [x] Add table CRUD endpoints (create, list, get, join, leave) — `bd5eacc`; 5 routes on `/api/v1/tables`; 26 vitest cases (create validation, list filters, auth gate, get-one-private, join idempotency, leave idempotency)
- [x] Private table share link — table accessible at `/tables/[id]`; private tables excluded from default list but reachable by direct URL (GET `/api/v1/tables/:id` always works)
- [x] Add notification bus events: `table.created`, `player.joined`, `spectator.joined`, `table.empty` — `ddf3969`; 4 event types in REGISTRY + PREF_DEFAULTS; wired into create/join/leave routes + spectator.joined from presence
- [x] Add presence tracking per table (who is watching) — `8b75e17`; `tablePresence.js` module (addWatcher/removeWatcher/getPresence) + `table:watch`/`table:unwatch` socket events + disconnect cleanup; 12 unit tests
- [x] Update tournament service to set `isTournament: true` on generated tables — `8be204e` (Option A: Tables alongside TournamentMatch); tournamentBridge creates Table row at match:ready, marks COMPLETED at match:result; 8 tests. Phase 3.4 commits to collapsing the dual-write.

### 3.2 Tables page (frontend)

- [ ] Build Tables page at `/tables`
- [ ] Live list of open public tables — private tables hidden from list, accessible by direct URL only
- [ ] Table card shows: game type, table icon, status, players seated, spectator count, `previewState` thumbnail
- [ ] `forming` state: table card shows empty seats waiting to fill
- [ ] Create table flow: choose game, set private/public, configure settings
- [ ] Join table flow: click table — sit down (if seat available) or spectate
- [ ] Empty state: helpful prompt when no tables are open
- [ ] Real-time updates — table list reflects new tables, seat changes, status changes without page refresh
- [ ] Bot-vs-bot tables always appear in public list

### 3.3 Platform shell and game loading

- [ ] Build platform game shell — wraps any loaded game, manages focused vs chrome-present mode
- [ ] Shell automatically detects active player status and sets rendering mode
- [ ] Focused mode: full viewport, chrome hidden, escape affordance visible
- [ ] Chrome-present mode: nav + table context sidebar visible, game in content area
- [ ] Table context sidebar: table info, seated players, spectator count, presence indicators
- [ ] Game-specific tabs: Gym tab (if `supportsTraining: true`), Puzzles tab (if `supportsPuzzles: true`)
- [ ] Gym tab renders `botInterface.GymComponent` with platform training infrastructure
- [ ] Puzzles tab renders `botInterface.puzzles` content
- [ ] Load game via `React.lazy(() => import('@callidity/game-xo'))` through shell
- [ ] Verify XO plays correctly through the new shell including Gym and Puzzles tabs

### 3.4 Retire in-memory Room layer (Tables become the only primitive)

> **Goal:** Tables are THE source of truth for live game sessions. The in-memory `roomManager` and the dual-write between `Table` and `TournamentMatch` go away; the realtime layer reads/writes Tables directly.
>
> **Why this exists:** Phase 3.1 chose **Option A** (additive — tournament bridge creates `Table` rows alongside `TournamentMatch` so the Tables page lights up immediately). That left two intentional sources of truth for game session state: the `Table` row and the in-memory `Room` (created by `roomManager` and used by `socketHandler`'s `room:*` events). Phase 3.4 collapses them.

#### Tasks

- [ ] **Make `Table` canonical for game session state.** Move the fields currently held by in-memory `Room` (board, currentTurn, scores, round, etc.) into `Table.previewState` or dedicated columns where appropriate. Add fields if needed (e.g., `lastActivityAt` for idle GC).
- [ ] **Rewrite `socketHandler.js` `room:*` events to operate on `db.table`** instead of `roomManager`:
  - `room:create` → `db.table.create()` (already exists via REST; socket version stays for game-start ergonomics)
  - `room:join` → `db.table.update({ seats })`
  - `room:created`, `room:joined`, `room:guestJoined`, `room:cancelled`, `room:abandoned`, `room:kicked` → emitted from Table updates
  - `game:move`, `game:moved`, `game:forfeit` → update Table.previewState
- [ ] **Delete the dual-write code in `tournamentBridge.js`** that syncs `Table.status` from `TournamentMatch.status`. Reverse the data flow: `TournamentMatch` records bracket position only; `Table` is the live game session.
- [ ] **Update tournament queries that read `TournamentMatch.status`** for game-session info (e.g., "is the match in progress?") to read `Table.status` instead. Bracket position queries continue to read `TournamentMatch`.
- [ ] **Delete `roomManager` (or shrink to a thin Table cache)** — once `socketHandler` no longer references it, remove the in-memory state and the related types.
- [ ] **Migrate idle/abandonment timers** from `roomManager` to a Table-aware service (`idleSessionPurgeService` already exists for sessions; extend it for Tables).
- [ ] **Verify presence tracking from Phase 3.1** still works correctly when Tables are the source of truth (presence map keyed by `Table.id`, no roomId).
- [ ] **Tournament-match flow QA**: create match → players join → play to completion → bracket advances. No regressions vs pre-3.4 behavior.

#### Conversion notes (for whoever picks this up)

These are concrete things to look for and decisions already made by the time 3.4 starts:

1. **The Table row already exists for tournament matches.** Phase 3.1 / Option A wired `tournamentBridge.js` to call `db.table.create({ isTournament: true, … })` when a match becomes ready. So the data is in place — 3.4 doesn't need to backfill or migrate. It only needs to swap which side reads from which.
2. **The dual-write to look for.** Search for `// TODO Phase 3.4:` markers in `tournamentBridge.js` (added by Phase 3.1) — those flag every line that becomes net-deleted in 3.4.
3. **Schema diffs between `Room` (in-memory) and `Table` (DB).**
   - `Room` has: `slug`, `hostSocketId`, `playerMarks`, `board`, `currentTurn`, `scores`, `round`, `status`, `spectatorCount`, `displayName`, `isHvb`, `botUserId`, `botSkillId`, `botMark`.
   - `Table` has (after 3.1): `gameId`, `status` (FORMING/ACTIVE/COMPLETED), `seats`, `previewState`, `isPrivate`, `isTournament`, `chatEnabled`.
   - **Gap to close in 3.4**: most `Room` fields belong inside `previewState` (game-defined opaque blob) — they're already what `sdk.getPreviewState()` returns. The exceptions are `botUserId`/`botSkillId` (HvB metadata — add as nullable columns) and `lastActivityAt` (idle GC — add an indexed column).
4. **Don't break replay.** Game move stream is recorded via `Game` + `Move` Prisma models, independent of Room/Table. 3.4 must not touch that path.
5. **Spectator UX during the swap.** The `spectator.joined` bus event was registered in Phase 3.1 but not fired (presence wired against Table.id in 3.1). Once 3.4 lands, spectators are simply socket subscribers to a Table-keyed channel; no separate "room spectator" concept needed.
6. **Tournament-bridge events stay.** `match.ready`, `match.result`, `tournament.starting_soon`, etc. continue to fire from `tournamentBridge.js` — those are bracket-level events independent of how the underlying game session is persisted.
7. **Risk to watch.** Anyone who builds new tournament features between 3.1 and 3.4 might add code that joins `TournamentMatch` and `Table` for game-session state, treating both as canonical. PR review during that window should redirect such queries to read `Table` only.

#### Acceptance criteria

- `roomManager.js` deleted (or reduced to <50 lines as a Table-fetch helper).
- No `// TODO Phase 3.4:` markers remain in the codebase.
- Tournament match end-to-end flow passes existing tests (no behavior regression).
- A new e2e test creates a Table via REST, joins via socket, plays a complete game, asserts the result lands in `db.game` and `Table.status = COMPLETED` — proving Tables are the single source of truth.

---

## Phase 4 — Connect4

> **Goal:** Second game ships. Proves SDK + botInterface are reusable. Confirms npm workflow.

### 4.1 Connect4 game package

- [ ] Create `packages/game-connect4/`
- [ ] Implement game logic (gravity mechanic, win detection: horizontal/vertical/diagonal)
- [ ] Implement full `meta` export including bot/training support flags
- [ ] Implement full `GameSDK` contract
- [ ] Implement `botInterface` — minimax bot, training support
- [ ] Build `GymComponent` for Connect4 training
- [ ] Implement focused and chrome-present rendering modes
- [ ] Build game UI (6x7 board, column drop animation, win highlight)
- [ ] Publish `@callidity/game-connect4` to GitHub Packages
- [ ] Verify platform loads Connect4 via `React.lazy`
- [ ] Connect4 appears in Tables page (create table, join, play)
- [ ] Gym and Puzzles tabs work for Connect4
- [ ] Replay works end-to-end for Connect4
- [ ] Connect4 ELO tracked in `GameElo` (separate from XO ELO)

### 4.3 TensorFlow.js evaluation (conditional)

> Only if pure-JS training is noticeably slow for Connect4's 6x7 board. See `doc/TensorflowJS_Migration_Plan.md`.

- [ ] Benchmark training speed for Connect4 with pure-JS engine
- [ ] If acceptable: defer TF.js, note for Poker/Pong evaluation
- [ ] If too slow: spike on TF.js migration using existing plan, complete before Connect4 ships

### 4.2 Pong real-time spike results review

> Spike completed in Phase 1.8. This is the decision point.

- [ ] Review Phase 1.8 findings
- [ ] Confirm Pong architecture (WebSocket loop or WebRTC)
- [ ] Identify any SDK or botInterface changes needed for real-time games — resolve before Phase 6

---

## Phase 5 — Poker

> **Goal:** Third game ships. Introduces variable player counts, hidden information, and multi-player bot dynamics.

### 5.1 SDK extension — hidden information

- [ ] `sdk.getPlayerState(playerId)` is already in the contract — implement platform-side enforcement
- [ ] Platform SDK provider filters game state per player before delivering to each client
- [ ] Verify `@callidity/game-xo` and `@callidity/game-connect4` unaffected (public information games)

### 5.2 Table model — variable player count UX

- [ ] Verify `forming` status handles 2-7 seat tables correctly
- [ ] Update table creation UI to support configuring player count within game's min/max range
- [ ] `forming` state visible on Tables page — shows seats filled vs. waiting

### 5.3 Poker game package

- [ ] Create `packages/game-poker/`
- [ ] Implement Texas Hold'em rules (pre-flop, flop, turn, river, showdown)
- [ ] Implement virtual chip stack and betting rounds
- [ ] Implement `meta` export (minPlayers: 2, maxPlayers: 7, supportsBots: true)
- [ ] Implement `sdk.getPlayerState` — returns only what each player can see (hole cards hidden)
- [ ] Implement `botInterface.makeMove()` — bot poker strategy
- [ ] Implement `getPreviewState()` — community cards and pot size only
- [ ] Build game UI (table layout, hole cards, community cards, betting controls)
- [ ] Publish `@callidity/game-poker` to GitHub Packages
- [ ] Verify platform loads Poker via `React.lazy`
- [ ] Poker appears in Tables page with forming/waiting state
- [ ] Replay works — public actions only, folded hands not revealed
- [ ] Poker ELO tracked in `GameElo`

---

## Phase 6 — Pong

> **Goal:** First real-time game ships on the architecture validated by Phase 1.8 spike.

### 6.1 Real-time infrastructure

- [ ] Implement game loop based on spike findings (tight WebSocket or WebRTC)
- [ ] Server-authoritative state with client-side interpolation
- [ ] Sampled snapshot storage for replay (100ms intervals)
- [ ] Handle reconnection and latency gracefully

### 6.2 Pong game package

- [ ] Create `packages/game-pong/`
- [ ] Implement game physics (ball, paddles, scoring)
- [ ] Implement `meta` export (minPlayers: 2, maxPlayers: 2, supportsBots: true)
- [ ] Implement SDK contract adapted for real-time (continuous state updates)
- [ ] Implement `botInterface.makeMove()` — real-time paddle AI
- [ ] Implement `getPreviewState()` — current score and ball position
- [ ] Build game UI (canvas-based renderer, paddle controls)
- [ ] Publish `@callidity/game-pong` to GitHub Packages
- [ ] Verify platform loads Pong via `React.lazy`
- [ ] Pong appears in Tables page
- [ ] Spectator live view works
- [ ] Replay works via sampled snapshot sequence
- [ ] Pong ELO tracked in `GameElo`

---

## Phase 7 — External Developer Onboarding

> **Goal:** Open the platform to approved third-party game and bot developers.

- [ ] Publish `@callidity/game-sdk` as a standalone npm package (TypeScript types, helpers, full contract)
- [ ] Publish SDK + botInterface documentation publicly
- [ ] Write game developer guide: contract spec, SDK usage, botInterface implementation, publish workflow
- [ ] Write bot developer guide: `makeMove` contract, deployment options, ELO and tournament participation
- [ ] Define submission and review process for external games and bots
- [ ] Evaluate opening GitHub Packages scope or migrating to public npm registry
- [ ] Onboard first external developer (game or bot) as a pilot

---

## Cross-Cutting Items (any phase)

- [ ] Admin panel: replay TTL settings (casual + tournament), table management, bot management
- [ ] Rankings page: per-game ELO display, filter by game, human vs bot toggle
- [ ] Tournaments: verify `isTournament: true` set on generated tables, replay link from bracket view
- [ ] Mobile QA: Tables page, game shell focused/chrome modes, Gym, replay controls
- [ ] Performance: verify `React.lazy` chunking — each game is a separate bundle
- [ ] Bot leaderboard: per-game bot rankings, ELO history, training stats
