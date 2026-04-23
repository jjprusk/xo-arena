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
- [x] Fold FAQ into About page (`/about#faq` or tabbed section) — About page has "Help" section linking to `/faq`; FAQ no longer in primary nav, accessed through About
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

- [x] Build Tables page at `/tables` — `5a6f5a2`; TablesPage.jsx with status + game filters, empty state
- [x] Live list of open public tables — private tables hidden from list, accessible by direct URL only — `5a6f5a2`; `api.tables.list()` excludes private by default, `GET /tables/:id` always works
- [x] Table card shows: game type, table icon, status, players seated, spectator count, `previewState` thumbnail — `5a6f5a2` + `90289c5`; card shows game label, seat strip (filled/empty dots), status badge, seated count; spectator count lands on TableDetailPage via `table:presence`; previewState thumbnail deferred to 3.5 (needs game-specific renderer + the rendered table surface from Phase 3.5)
- [x] `forming` state: table card shows empty seats waiting to fill — `5a6f5a2`; seat strip dots show filled vs outline
- [x] Create table flow: choose game, set private/public, configure settings — `5a6f5a2`; `CreateTableModal` with game picker + private/public toggle
- [x] Join table flow: click table — sit down (if seat available) or spectate — `5a6f5a2`; TableDetailPage shows seats + `Take a seat` / `Leave seat` buttons
- [x] Empty state: helpful prompt when no tables are open — `5a6f5a2`; signed-in users see "Create table" CTA, guests get "sign in" prompt
- [x] Real-time updates — table list reflects new tables, seat changes, status changes without page refresh — `90289c5`; both pages subscribe to `guide:notification` + debounced refetch; table events routed out of the user notification stack
- [x] Bot-vs-bot tables always appear in public list — bot tables are just regular tables with bot user IDs seated; not filtered out by the list
- [x] **Instrument critical resources in admin health.** — `084ac0f`; 5 new tiles on AdminHealthPage (Tables Forming/Active/Completed/Stale + Table Watchers), backed by `takeTablesSnapshot()` in resourceCounters.js. Stale-FORMING surfaced as a metric (not yet a leak alert — legitimate for private tables waiting to be shared). Other critical resources were already covered (notif queue depth, scheduler pending/running/failed, dispatcher heartbeat, pending PvP match map).
- [x] **Post-3.2 polish (pre-3.5).** Landed after the initial Tables page shipped, while 3.3 was in flight:
  - `ListTable` refactor so the list scales to 100+ tables with sticky header + fitViewport scroller
  - Mobile: truncate long game names instead of wrapping so rows stay one line
  - Symmetric seat click on detail page: empty seat → take it; own occupied seat → leave it
  - Server placement honors `seatIndex` on join (previously always picked first empty seat)
  - Creator-only delete for non-tournament, non-ACTIVE tables (`DELETE /api/v1/tables/:id`) + `table.deleted` bus event + client redirect
  - Creator can see their own private tables in `/tables`; other users still cannot
  - `ShareTableButton` (icon + full variants) on list row and detail page — copies `/tables/:id` URL with clipboard + execCommand fallback
  - Loading skeleton replaced by a single centered spinner (quieter on filter changes)

### 3.3 Platform shell and game loading — complete

> Signed off 2026-04-16 against local dev; will verify on staging at the next `/stage`.

- [x] Build platform game shell — wraps any loaded game, manages focused vs chrome-present mode — `459e665`; `landing/src/components/platform/PlatformShell.jsx`
- [x] Shell automatically detects active player status and sets rendering mode — `459e665`; `selectDefaultMode({isSpectator, phase})`: seated+playing → focused, otherwise → chrome-present
- [x] Focused mode: full viewport, chrome hidden, escape affordance visible — `459e665`; semi-transparent ← Back and ⤢ expand buttons top-corners
- [x] Chrome-present mode: nav + table context sidebar visible, game in content area — `459e665`; grid layout with game column + 260px sidebar
- [x] Table context sidebar: table info, seated players, spectator count, presence indicators — `459e665`; game title, status badge, watching count, seated players list with BOT badge
- [x] Game-specific tabs: Gym tab (if `supportsTraining: true`), Puzzles tab (if `supportsPuzzles: true`) — `459e665`; driven off meta flags, games opt in declaratively
- [x] Gym tab renders `botInterface.GymComponent` — implemented as deep-link to `/gym?gameId=xo` rather than embedding the GymComponent inside the shell. Rationale: the full Gym page at `/gym` already wraps `botInterface.GymComponent` with the platform training infrastructure (socket progress events, session store, etc.); re-embedding it inside the shell would duplicate that wiring. A future refinement could swap the shell's main area for an inline embed if the navigation feels disruptive — trivial change given the tab-link plumbing is already in place.
- [x] Puzzles tab renders `botInterface.puzzles` content — same link-based approach, deep-linked to `/puzzles?gameId=xo`.
- [x] Load game via `React.lazy(() => import('@callidity/game-xo'))` through shell — `2ab5600`; PlayPage's lazy import passes through the shell's Suspense boundary
- [x] Verify XO plays correctly through the new shell including Gym and Puzzles tabs — `2ab5600` routes /play through the shell; 13 component tests + 40 page tests cover the integration. TableDetailPage (`e110f28`) renders ACTIVE tables through the shell too, ready for Phase 3.4 to wire the game session in.

### 3.4 Retire in-memory Room layer (Tables become the only primitive) — complete

> Signed off 2026-04-18 against v1.3.0-alpha-1.13 (dev). QA checklist: `doc/QA_Phase_3.4.md`.

> **Goal:** Tables are THE source of truth for live game sessions. The in-memory `roomManager` and the dual-write between `Table` and `TournamentMatch` go away; the realtime layer reads/writes Tables directly.
>
> **Why this exists:** Phase 3.1 chose **Option A** (additive — tournament bridge creates `Table` rows alongside `TournamentMatch` so the Tables page lights up immediately). That left two intentional sources of truth for game session state: the `Table` row and the in-memory `Room` (created by `roomManager` and used by `socketHandler`'s `room:*` events). Phase 3.4 collapses them.

- [x] Make `Table` canonical for game session state — `Room` fields moved into `Table.previewState`; `lastActivityAt` added as indexed column
- [x] Table GC (idle cleanup) — `tableGcService` purges stale FORMING/COMPLETED/ACTIVE-idle tables on a periodic sweep
- [x] Admin table management page — `ListTable`-based view in admin panel; force-delete with `room:abandoned` broadcast and `reason: 'admin'`
- [x] Rewrite `socketHandler.js` `room:*` events to operate on `db.table` instead of `roomManager`
- [x] Delete dual-write code in `tournamentBridge.js`; `TournamentMatch` records bracket position only
- [x] Delete `roomManager` — removed from codebase
- [x] Migrate idle/abandonment timers to Table-aware service
- [x] Verify presence tracking works correctly with Tables as source of truth
- [x] Tournament-match flow QA — no regressions

### 3.4a Tournament QA + seed bots (parallel to 3.4) — complete

> Signed off 2026-04-18. Runs parallel to the Room→Table collapse; validates the tournament path and adds seed bot support.

- [x] Full tournament QA checklist (`doc/QA_Phase_3.4.md` Section 8) — lifecycle, BOT_VS_BOT automated path, HVH match play, ELO isolation, odd-player bracket, auto-cancellation
- [x] Tournament seed bots — admin-configured bot accounts auto-enrolled in every recurring tournament occurrence
  - `TournamentSeedBot` schema + migration (`tournament_seed_bots` table)
  - Tournament API: `GET/POST/DELETE /api/tournaments/:id/seed-bots`
  - Scheduler copies seed bots from template into each new occurrence (`checkRecurringOccurrences`)
  - `botGameRunner`: `seed:` botModelId prefix handled alongside `testbot:`/`builtin:`
  - 3 vitest cases covering enrollment, error recovery, empty-template case
  - QA checklist updated (Section 9 — 6 sub-sections)

### 3.5 Rendered table paradigm — minimum viable — complete

> **Goal:** Ship the Medium rendered table for 2p sit-down and 2p head-to-head. XO validates sit-down; shell is ready for head-to-head when Pong arrives. See `doc/Table_Paradigm.md` for the full design decisions.

- [x] Add `meta.tableArchetype` (`'sit-down' | 'head-to-head'`) + `meta.orientations` (`['horizontal', 'vertical']`) fields to `GameContract`. Defaults preserve existing behavior. _(`tableArchetype: 'sit-down'` shipped on the SDK contract and XO meta. The `'head-to-head'` union and `orientations` field are deferred to Phase 4/6 — only relevant when Connect4 / Pong land.)_
- [x] Evolve `PlatformShell` to render a `<TableSurface>` with positioned `<Seat>` slots. Board renders in the `<TableCenter>` rect.
- [x] Seats are avatar + name, spatially positioned (no more sidebar-only seated list for the primary rendering).
- [x] Forming → Playing transition: fade-in on the center when ACTIVE lands (Table_Paradigm §4.4 option B); respect `prefers-reduced-motion`.
- [x] Relative POV (§4.2): caller at bottom / near-end; opponents arranged relative to caller.
- [x] Spectator badge (§4.3): edge cluster with click-to-expand popover listing watcher names; sidebar list unchanged.
- [x] End-of-game seat indication (§4.5): winner glow, loser muted, plus small outcome banner.
- [x] Tournament context card in sidebar (§4.7) when `isTournament = true`.
- [x] **Active table preview thumbnail.** Render a mini `previewState` snapshot (e.g., a small XO board with current marks) on the Tables list page for ACTIVE tables. Deferred from Phase 3.2 — requires the game-specific renderer that the `<TableSurface>` component provides.
- [x] QA: XO still plays correctly via the new shell on both desktop and mobile. _(QA_Phase_3.4 closed 2026-04-22; archived at `doc/archive/QA_Phase_3.4.md`.)_

### 3.6 Multi-seat sit-down shell (infrastructure for Poker)

> **Goal:** Shell gains layouts for 3–8p sit-down tables and the per-seat render slot API for hidden-info games. No user-visible change from a gameplay standpoint — this is infrastructure so Poker can land cleanly in Phase 5.

- [ ] Seat position maps for 3/4/6/8p (round / oval) in the shell.
- [ ] Per-seat render slot API — game returns content per seat, shell positions it spatially.
- [ ] Per-seat visibility control via `getPlayerState(playerId)` — shell asks the game what to render for each seat from each viewer's POV.
- [ ] Responsive behavior: 8p oval on desktop, compact/rotated on portrait mobile.
- [ ] XO / Connect4 leave per-seat slots empty — no game-package changes required.

### 3.7 Rendered-table polish (optional, not blocking)

> Lands opportunistically after 3.5 and 3.6 once live use surfaces friction.

- [ ] Sit-down animation on seat claim (Table_Paradigm §4.4 option C).
- [ ] Showdown / chip / card animations for card games (per-game assets; arrives with Poker).
- [ ] **ELO in seat pod.** Shell fetches `GameElo` for each seated user on table load and displays the rating below the display name. Shell owns the fetch (not the game package) via a join on `GET /api/v1/tables/:id` or a dedicated enrichment endpoint. Deferred from 3.5 — display name + avatar is sufficient for the core paradigm.
- [ ] Any additional visual refinements from live use.

---

## Phase 3.8 — Multi-Skill Bots

> **Goal:** A bot is an identity (alter ego). Skills are what the bot knows how to play. One `User` row carrying `isBot: true` can hold multiple `BotSkill` rows (one per game). Users pick the bot; the game context chooses the skill.
>
> **Why this ships before Phase 4:** Connect4 is the forcing function — without this in place, "Rusty" would become a separate second bot for Connect4 instead of a second skill on the same bot. The schema already anticipates this (`BotSkill` is keyed `(botId, gameId)` unique from Phase 1.7); only the flows and UI need to catch up.
>
> **Decisions locked 2026-04-23:**
> - Name: *Multi-Skill Bots*.
> - Bot create is two-step: create the bot (name + avatar + competitive flag), then *Add a skill* separately. No implicit first-skill bundling.
> - Pickers are identity-scoped: user picks *Rusty* in Play or tournament registration; the game context determines which of Rusty's skills runs. No "Rusty (XO)" / "Rusty (C4)" duplicate entries.
> - `User.botModelId` stays as a nullable "primary/last-trained skill" pointer for UI convenience. Source of truth for skills is `BotSkill.findMany({ where: { botId } })`.

### 3.8.1 Schema + seed

- [ ] Confirm `BotSkill (botId, gameId)` unique + `BotSkill.botId` relation to `User` hold up for multi-skill. No new migration expected.
- [ ] Update the Prisma seed to give each built-in bot (Rusty/Copper/Sterling/Magnus) exactly one XO `BotSkill` — behaviour-preserving, but structured so a Connect4 skill can be appended in Phase 4 by adding one row per bot.
- [ ] Keep `User.botModelId` as a nullable pointer to the bot's *primary* (last-trained-or-selected) skill. Compute it at creation time, update it when the user trains or switches active skill.

### 3.8.2 Backend — bots + skills API

- [ ] `POST /api/v1/bots` — accepts `{ name, avatarUrl, competitive }` only. No algorithm/game at this step. Creates a skill-less bot. `botModelId` starts null.
- [ ] `POST /api/v1/bots/:botId/skills` — body `{ gameId, algorithm, modelType }`. Creates a BotSkill, sets `botModelId = newSkill.id` if it's the bot's first. Idempotent on `(botId, gameId)` — second call returns existing skill.
- [ ] `GET /api/v1/bots/:botId` — includes `skills: BotSkill[]` with per-skill ELO joined from `GameElo (userId=botId, gameId=skill.gameId)`.
- [ ] `DELETE /api/v1/bots/:botId/skills/:skillId` — removes one skill. If the deleted skill was `botModelId`, repoint to any remaining skill or null.
- [ ] Tournament registration: validate that the picked bot has a `BotSkill` for the tournament's `gameId`; return a clear 400 if not.
- [ ] `GET /api/v1/bots?gameId=X` — list helper for community bot pickers, filters to bots that have a skill for `X`.

### 3.8.3 Frontend — Profile / bot creation

- [ ] Profile "Create a bot" form: reduce to name + avatar + competitive flag. Submit → bot card appears with "No skills yet — Add a skill" affordance.
- [ ] Bot card shows skill pills (one per game with `{ gameLabel, algorithm, ELO, episodes }`) and an "+ Add skill" chip. Clicking a pill opens Gym focused on that `(botId, gameId)`.
- [ ] "Add a skill" modal: pick game (dropdown of games that don't already have a skill for this bot) + algorithm + optional starter config. Submits to `POST /bots/:botId/skills`.

### 3.8.4 Frontend — Gym

- [ ] Left sidebar shows bots; selecting a bot reveals its skills as a second-level picker (tabs or sub-list). Selecting a skill opens the existing Gym tabs scoped to that `(botId, gameId)`.
- [ ] "Add skill for this bot" affordance inside Gym for convenience — shares the Profile modal.
- [ ] When a training session completes, update `User.botModelId` to point at the just-trained skill so Profile "last-trained" stays current.

### 3.8.5 Frontend — Play + tournaments

- [ ] Community bot picker lists bots (Rusty, Copper, Sterling, Magnus + user's public bots) filtered server-side by `gameId`. No "Bot X for Game Y" duplicates.
- [ ] Starting a game with a community bot resolves the skill server-side from `(botId, gameId)` at match start — picker payload carries only `botId`.
- [ ] Tournament registration picks a bot; backend resolves `(botId, tournamentGameId)` and rejects registration if the bot has no skill for that game.
- [ ] Rankings page: already per-game via `GameElo`, but show the *bot identity* (not skill) as the leaderboard row, with the current game as implicit context.

### 3.8.6 QA + tests

- [ ] Vitest: `POST /bots` creates skill-less bot; `POST /bots/:id/skills` creates + repoints `botModelId`; duplicate skill returns 400; deleting the primary skill repoints.
- [ ] Vitest: tournament registration rejects bot lacking the tournament's skill.
- [ ] Playwright smoke.journey: add a case where a user creates a bot, adds an XO skill, enters XO match vs community bot — proves the two-step flow end-to-end.
- [ ] Manual: Rusty with an XO skill still plays a PvB match identically to v1.28.

---

## Phase 4 — Connect4

> **Goal:** Second game ships. Proves SDK + botInterface are reusable. Confirms npm workflow.
>
> **Prerequisite:** Phase 3.8 (Multi-Skill Bots) shipped. Connect4 adds one `BotSkill` per built-in bot for `gameId: 'connect4'` — the identity layer is already in place.

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

- [ ] **SDK prerequisite (deferred from 3.5):** extend `GameMeta.tableArchetype` union to include `'head-to-head'`, and add `meta.orientations: ('horizontal' | 'vertical')[]` for paddle axis. PlatformShell needs to render a head-to-head layout (opponents on opposite sides of the playfield, not across a table) when Pong's meta declares it.
- [ ] Create `packages/game-pong/`
- [ ] Implement game physics (ball, paddles, scoring)
- [ ] Implement `meta` export (minPlayers: 2, maxPlayers: 2, supportsBots: true, `tableArchetype: 'head-to-head'`, `orientations: ['horizontal', 'vertical']`)
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
- [ ] **Cross-tab session-switch banner.** When a user signs in as a different account in another tab (same browser/origin), the cookies + localStorage session cache are shared, so every other tab silently swaps to the new user on the next `useOptimisticSession` poll (≤60s). This is correct HTTP/cookie behavior — not fixable — but it is confusing. Detect when the polled `session.user.id` differs from the previously-cached id on the same tab, and surface a banner ("Signed-in account changed in another tab — now signed in as **B**. Refresh to continue.") instead of silently mutating the UI. Small polish; likely fits in 30 lines in `useOptimisticSession` + a banner component.
- [ ] **socket.io multi-machine routing on Fly.io.** As of 2026-04-16 staging has been manually scaled to 1 backend machine because socket.io polling transport + Fly.io round-robin load balancing causes a 400-Bad-Request cascade on every other poll (each polling request can land on a different machine, but only the issuing machine knows the SID). Current workaround: `flyctl scale count 1 -a xo-backend-staging`. Real fixes (pick one before scaling back to N machines in prod):
  - **Sticky sessions via `fly-replay`.** Add backend middleware that detects a polling request carrying an SID owned by a different instance and sets `fly-replay: instance=<owner>` so Fly's edge proxy re-routes. Requires tracking SID-to-instance-id mapping (e.g., via Redis with the existing adapter).
  - **Restore WebSocket transport.** `landing/src/lib/socket.js` forces `transports: ['polling']` because the landing express + http-proxy-middleware chain was dropping WS upgrades on Fly. Fix the landing proxy to forward `upgrade` + `connection` headers, re-enable WS on the client, and the multi-machine problem disappears (a WS stays on the machine it opened on). Lowest-risk long-term fix.
  - **Route `/socket.io` straight to backend from the edge** (skip landing proxy entirely). Requires a DNS/routing change; simplest if we move away from the double-proxy topology anyway.
