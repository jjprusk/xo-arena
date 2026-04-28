<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Future Ideas

Deferred features and improvements that are worth revisiting but not currently prioritized.

## Known bugs (must fix — not deferred)

These are **bugs**, not future ideas. Listed here for tracking; should be picked up before the next ship cycle.

### Disconnect-forfeit UX — survivor bounced to `/tables` instead of seeing a "you win" screen

**Surfaced by:** Phase 8 SSE+POST migration QA (see `Realtime_Migration_Postmortem.md`).

**Symptom:** When one player closes their tab mid-game, the server-side disconnect detection fires correctly: `pagehide` POSTs the forfeit, the table flips to COMPLETED, and `dispatchTableReleased` emits a `table.released` bus event. The surviving player's tab receives the event but `TableDetailPage` treats `lifecycle: cancelled` / `abandoned` by navigating to `/tables`. Net effect: the survivor sees a "table released" toast in the guide drawer and lands on the Tables list, with no "Opponent forfeited — you win" celebration screen and no Rematch button.

**Why it's user-visible:** the realtime path is doing its job — seat freed, ELO updates, tournament series progresses — but the survivor's view of the moment is wrong. Looks abrupt and broken.

**Fix outline:**

- In `useGameSDK.js`, the `kind: 'forfeit'` SSE state already sets `phase = 'finished'` and emits a synthetic move event with `winner` populated. The XO game component should already render the win/loss screen — verify it does.
- The bounce comes from `TableDetailPage`'s `useEventStream({ channels: [`table:${id}:lifecycle`] })` handler reacting to `kind === 'cancelled'` with `navigate('/tables')`. When the table was ACTIVE before the forfeit, suppress the navigation — let the `state` channel's `kind: 'forfeit'` drive the UI to the win screen and offer Rematch.
- Server side, consider whether forfeit *should* be emitted as a lifecycle `cancelled` at all, or only as a `state` `forfeit`. Likely: drop the `dispatchTableReleased` call in the forfeit path on free-play tables (keep it for tournament/admin), so the survivor isn't fighting two competing event shapes.

**Effort:** ~1–2 hours. Touch points: `landing/src/pages/TableDetailPage.jsx` (lifecycle handler), `backend/src/services/tableFlowService.js::forfeitGame` (release-event semantics), and the XO game component's finished-state render path. Add a Playwright test that closes one tab mid-game and asserts the survivor lands on the win screen.

### Admin log viewer — empty even with traffic

**Surfaced by:** Phase 8 QA — pre-existing, not caused by the realtime migration.

**Symptom:** `/admin/logs` renders the filter UI and the empty-state message, but no entries appear even when toggling **Live tail** and generating backend log activity in another tab. The "this was always broken" entry — never landed correctly.

**Likely causes (need to dig):**

- The REST list endpoint may be filtering by a default `level` set that excludes everything actually being logged.
- The pruner may be running aggressively and deleting rows faster than the page can fetch them.
- The frontend's `useEventStream` subscription for `admin:logs:entry` may not be matching what `routes/logs.js` actually appends. Phase 8 confirmed the server side is publishing on `admin:logs:entry`; verify the page's `eventTypes` list contains that exact name and the `onEvent` handler routes it to the list state.
- Live-tail toggle may be wired to the legacy SystemConfig `realtime.admin.via` flag whose default no longer matters post-Phase-8.

**Fix outline:**

- Check the `/api/v1/logs` GET in dev with admin auth and a wide level filter — confirm rows exist in the DB.
- If rows exist, the issue is purely client-side: walk the LogViewerPage subscription against the channel/event-type names emitted by `routes/logs.js`.
- Add a Playwright test that posts a synthetic log entry (via the public POST `/api/v1/logs`) and asserts a row appears in the admin viewer within 2 s.

**Effort:** ~2–3 hours including the test.

---

### Idle-timeout subsystem retired in Phase 8 — never rebuilt for SSE+POST

**Surfaced by:** Phase 8 QA (2026-04-28) — user stepped away from a live game with the browser tab open and was never warned, never auto-forfeited.

**Symptom:** A signed-in user can leave a tab open mid-game indefinitely. No "Still there?" warning fires, no idle forfeit lands, no presence change. Cleared by `backend/src/realtime/socketHandler.js` (`resetIdleForUserInTable` + `clearAllIdleTimersForTable` are no-op stubs documented as "Idle subsystem retired in Phase 8"). The client still sends `/idle/pong` on `visibilitychange`/`focus` and `pagehide` forfeits, but there is nothing on the server to actually fire the warning or the kick.

**Fix outline:**

- Rebuild a per-`(tableId, sseSessionId)` idle timer keyed off `sseSessions` (we already track `joinedTables` per session).
- Reset on every `/rt/tables/:slug/idle/pong`, on every game move POST, and on any session-touch (`sseSessions.touch`).
- At 30 s, append `table:<id>:state` `{ kind: 'idle:warn', secondsRemaining }` so the existing client-side "Still there?" overlay surfaces.
- At 60 s, treat as disconnect: route through `disconnectForfeitService.handleDisconnect` (same code path the `pagehide` forfeit goes through) and append the forfeit lifecycle.
- Make sure session disposal cancels timers cleanly so a fresh tab in the same session inherits a clean slate.

**Effort:** ~3–4 hours including unit + Playwright tests for warn-then-recover and warn-then-forfeit.

---

### Journey CTA targets need a reusable `<Spotlight />` component

**Surfaced by:** Phase 8 QA (2026-04-28) — when the journey routes a user to `/bots/<id>?action=train-bot` (Curriculum step 4), the **Train your bot** button is a small outlined button buried below the bot header, ELO panel, Spar block, and Tournament availability. Users miss it.

**Stop-gap landed in this branch:** when `?action=train-bot` is in the URL, `BotProfilePage` scrolls the Train button into view and applies a `xo-spotlight-pulse` glow animation for ~6 seconds. Functional but ad-hoc — every CTA target page would have to repeat the same wiring.

**Proper fix:** a reusable `<Spotlight target={ref} duration={6000} />` overlay that:

- accepts a DOM ref to the target element
- draws a finger-pointer cursor (or a translucent ring) anchored to the target's bounding rect
- pulses + scrolls into view
- tears down on click of the target, on `?action` query change, or after `duration`
- works on mobile (no hover-only cues)

Then each journey-step destination just renders `<Spotlight target={...} />` when the matching `?action=*` query is present. Step 3 (`?action=quick-bot`) → wizard "Next" button. Step 4 (`?action=train-bot`) → Train button. Step 5 (`?action=spar`) → Spar tier picker / "Spar now". Step 6 (`?action=cup`) → Curriculum Cup card. Step 7 (`?action=cup-result`) → result row in tournament list.

**Effort:** ~3–4 hours including the component, the five wiring sites, and a Playwright test that asserts the spotlight is present after each journey link click.

---

### 2.3 Bot names show as "Hots" / "O" rather than the actual name

**Surfaced by:** Phase 8 QA (2026-04-28) — bots in some surfaces render their seat mark or a label like "Host" / "Hots" instead of `bot.displayName`.

**Locations to audit (non-exhaustive — user observed in §2.3 of the V1 acceptance script):**

- Seat-pod labels under the board (PlayPage / TableDetailPage's GameView).
- Demo Table spectator view — the seat shows "Host" instead of the bot's display name (e.g. "Sparky").
- Possibly the in-game scoreboard / spectator-side labels.

**Fix outline:**

- Walk every place that renders a seat label (`displayName`, `seat.displayName`, `mark`) and confirm it falls back through `seat.displayName → user.displayName → mark` in that order, never showing "Host" for a real bot.
- For demo tables, the runner already names seats with `botA.displayName` / `botB.displayName` (`backend/src/routes/tables.js:469-470`) — verify that survives `sanitizeTable` extras and the client's seat extraction.
- Add a Playwright check that the demo table's two seats render the curated bot names from `demoTableMatchups.js`, not "Host"/"Guest".

**Effort:** ~1–2 hours.

---

### 3.7a.5 — see "builtin polish" item

**Surfaced by:** Phase 8 QA (2026-04-28) — placeholder for the §3.7a.5 V1 acceptance item flagged "see builtin polish."

**Action:** locate the `builtin polish` reference in the V1 acceptance / requirements docs and pull the concrete sub-items into this entry. Likely candidates: built-in (system) bot avatars, naming, tier badges, or display in the rankings — none of which were directly retested in the Phase 8 cut.

**Effort:** unknown until the source item is unpacked.

---

## Status snapshot (last reviewed 2026-04-23)

| Item | Status |
|---|---|
| Real-Time Presence / Inactivity Detection | ✅ Mostly done (presence store + heartbeat live; away/active refinement open) |
| Multi-Game Bots (now Phase 3.8) | 🚧 In-plan (scheduled as Phase 3.8 of the Implementation Plan) |
| Real-Time Games Against Bots (Pong) | ⏳ Open (Phase 6) |
| Persist Game State Through Deploys | ❌ Obsolete (replaced by DB-backed `Table` rows in Phase 3.4) |
| Backend Logs in Admin Log Viewer | ⏳ Open |
| Guide Help Subsystem (Chat Interface) | ⏳ Open |
| Guide as Navigation (Command Palette) | ⏳ Open |
| Configurable Guide | ❌ Obsolete (iframe guide retired; premise gone) |
| Multi-Game Architecture | ✅ Largely done as the Game SDK (Phases 1.1–1.4) — remaining games are their own phases |
| Tier 2/3 instrumentation | 🟡 Partly done (3 counters live; rest in `doc/Observability_Plan.md`) |
| Recurring tournaments refactor (now Phase 3.7a) | 🚧 In-plan (scheduled as Phase 3.7a of the Implementation Plan, pre-prod window) |
| `table.released` per-reason soak monitor | ⏳ Open (post-prod-launch — needs real traffic to be meaningful) |

## Migration-sensitivity audit (2026-04-23)

Which of the items above actually benefit from shipping *before* prod has real users? Only schema/data-migration costs scale with user volume; UX features cost the same at 0 users or 10,000.

| Item | Migration-sensitive? | Verdict |
|---|---|---|
| Real-Time Presence | Done (✅) | — |
| Multi-Game Bots (Phase 3.8) | No — schema already anticipates it (`BotSkill (botId, gameId)` unique from Phase 1.7) | Do via 3.8 on the normal track |
| Pong (Phase 6) | No — new subsystems, no data migration | Ship when scheduled |
| Persist Game State | Obsolete (❌) | — |
| Backend Logs → DB | No — just starts writing more rows | Ship anytime |
| Guide Chat | No — UX feature | Ship anytime |
| Command Palette | No — UX feature | Ship anytime |
| Configurable Guide | Obsolete (❌) | — |
| Multi-Game Architecture | Done via SDK (✅) | — |
| Tier 2/3 instrumentation | No — counters, not schema | Ship anytime |
| **Recurring tournaments refactor** | **Yes — template vs occurrence split** | **Phase 3.7a (now)** |

Also folded into Phase 3.7a for the same "easier empty than later" reason (not in the original Future_Ideas list):

- Bot `displayName` uniqueness policy
- Public profile URL structure (reserve `/users/:username`)
- OAuth prod redirect URLs at providers
- Seeded built-in bot polish (avatars, bios, ELO ladder)

---

## Real-Time Presence / Inactivity Detection — ✅ MOSTLY DONE

**Status:** The core heartbeat-based presence was built during the Phase E tier-2 comms work. `backend/src/lib/presenceStore.js` tracks `onlineAt` with TTL; `landing/src/lib/useHeartbeat.js` is the client hook; `GET /api/v1/presence/online` + the `presence:changed` SSE channel expose the state.

**What's still open (small refinement, not blocking):** the hide/show behaviour uses default visibility — when a tab backgrounds, the heartbeat stops and the server evicts the user after the TTL. There's no explicit `user:away` transition and no distinction between "tab hidden" (may come back in seconds) and "tab closed" (likely gone for the day). Good enough for the admin "online" indicator in its current form.

---

## Multi-Game Bots

**What:** Allow a single bot to have trained models for multiple games (e.g., XO and chess). Today a bot is effectively XO-only — it holds one model. A multi-game bot would hold one model per supported game and compete on each game's leaderboard independently.

**Why deferred:** Requires a second game to exist on the platform first. The groundwork is already in place — the credits system is game-agnostic (`appId` field), the `Game` table has an `appId` column, and the Credits Plan explicitly notes "a bot can hold one model per supported game." Bot slot limits already govern agent count, not model count.

**What it would take:**
- Schema: `BotModel` table keyed by `(botId, appId)` to hold per-game weights and ELO separately from the bot's top-level record.
- Training UI: game selector when starting a training session in the Gym.
- Leaderboard: per-game filtering so a bot's XO ELO and chess ELO are tracked independently.
- Community bot matchmaking: players select a game, and only bots with a model for that game appear.

**Complexity:** Medium-to-large. Straightforward once a second game is added; no point building it for a single game.

---

## Real-Time Games Against Bots (e.g. Pong)

**What:** Support games with a continuous real-time loop — not turn-based. A classic example is Pong, where the bot controls a paddle and reacts to ball position in real time rather than waiting for a discrete move prompt.

**Why deferred:** The current architecture is designed around turn-based games (discrete moves, game recorded on completion). Real-time games require a fundamentally different loop: a shared simulation running at a fixed tick rate, input from both sides on every frame, and a bot that acts on continuous state rather than a board snapshot.

**What it would take:**
- **Game loop:** server-authoritative tick loop (e.g. 60Hz) running in the backend, or a client-side loop with the bot running in the browser. Client-side is simpler to start and avoids server compute overhead for solo bot games.
- **Bot model:** the AI input is a continuous state vector (ball position, velocity, paddle positions) rather than a discrete board encoding. Suitable algorithms: DQN or Policy Gradient trained on the continuous state space. The existing Gym infrastructure could be extended since DQN already trains on arbitrary state vectors.
- **Rendering:** a canvas or WebGL game loop on the frontend replacing the current board grid.
- **Recording:** game outcome (win/loss/score) still POSTed to `/games` at completion — credit and ELO hooks unchanged.
- **PvP extension:** two human players could also play real-time games against each other via the existing WebSocket infrastructure, with the server relaying inputs rather than authoritative state.

**Complexity:** Large. The game loop and rendering are new territory. The AI training pipeline is more reusable than it might seem — the Gym's episode-based training maps naturally to a real-time game where each episode is one full match.

---

## Persist Game State Through Deploys (Redis-backed Rooms) — ❌ OBSOLETE

**Status:** Superseded by Phase 3.4 — `roomManager` was retired. Active games are now `Table` rows in Postgres (`previewState Json` + `seats Json`), so game state survives deploys by design. Socket reconnection after a brief drop re-joins the table room via the `TableDetailPage` flow. The scenario this item was guarding against no longer exists.

**Residual concern worth tracking separately:** when a socket drops mid-game, `useGameSDK` needs to rebind the move stream — today there's a short window where a move could be emitted to a disconnected socket. This is a socket-reconnect concern, not a state-persistence one, and is better filed as a gameplay-robustness task if it ever surfaces.

---

## Backend Logs in Admin Log Viewer

**What:** Route backend (pino) logs into the database so the admin Log Viewer shows all four sources — `frontend`, `api`, `realtime`, and `ai` — instead of only frontend entries. Currently pino writes to stdout (visible in Railway's log stream) but never reaches the `logs` table, so the viewer is nearly empty in normal operation.

**Why deferred:** stdout logs are accessible via Railway's dashboard for now. The viewer is still useful for frontend errors. Wiring pino to the DB adds write pressure on every request.

**What it would take:**
- **Pino DB transport:** a custom pino transport (or `pino-transport` wrapper) that batches log entries and inserts them into the `logs` table, respecting the existing `pruneIfNeeded` limit. Use `source: 'api'`, `'realtime'`, or `'ai'` depending on origin.
- **Log level threshold:** only write INFO and above from the backend to avoid flooding the table with debug noise. DEBUG can remain stdout-only.
- **`setLogUserId` fix:** the current frontend logger has a broken `setLogUserId` (line 79 of `logger.js` does `Object.assign` on a string, which is a no-op) — userId is always null on log entries. Fix this so user context is captured.
- **Live tail:** backend log entries would flow through the existing `_io.to('admin:logs').emit('log:entry', ...)` path automatically once they're written to the DB.

**Complexity:** Small-to-medium (~half a day). The DB schema, ingestion endpoint, pruning, and live-tail socket are already in place — the missing piece is just the pino → DB bridge and the userId fix.

---

## Guide Help Subsystem (Chat Interface)

**What:** Wire up the "Ask Guide anything…" input at the bottom of the Guide panel so users can ask natural-language questions and get contextual answers from an LLM.

**Why deferred:** The panel footer placeholder exists but is not connected to any backend. Building it well requires deciding on context injection strategy, conversation persistence, and cost controls.

**What it would take:**
- **Backend endpoint:** `POST /api/guide/chat` — accepts `{ message, context }` and streams or returns an LLM response. Context should include the user's journey progress, current page, bot name/config, and recent activity so answers are relevant.
- **Conversation state:** local component state (or `guideStore`) to hold message history for the current session. No persistence needed initially.
- **UI:** replace the placeholder `div` in `GuidePanel.jsx:153–167` with a real `<textarea>` + send button, and a scrollable message thread above it inside the panel body.
- **Rate limiting / cost control:** per-user request throttle on the backend to prevent runaway LLM spend.

**Complexity:** Medium (~2 days). The panel, orb, and store are all wired up — chat is the only missing piece.

---

## Guide as Navigation System (Command Palette Evolution)

**What:** Add a ⌘K command palette — a keyboard-invokable search overlay (Spotlight / Linear-style) that lets users jump anywhere in the app by typing rather than clicking through the nav.

**Current navigation structure:**
- **Desktop:** a top header bar with Play, Gym, Puzzles, Rankings as primary links, plus Stats / Profile / About in-line. Admin links appear for admin users.
- **Mobile:** a fixed bottom tab bar (Play, Gym, Ranks, Stats, Profile) plus a hamburger menu that expands the full link list including Settings, FAQ, and About.
- **Guide button:** a pulsing "Guide" button sits next to the logo in the header and opens the Getting Started modal, whose cards navigate directly to destinations via `target="_top"` links. Users can hide this button in Settings.

The nav works fine but requires knowing where things live. There's no way to reach a page by typing its name, and no single surface that lists every destination at once.

**How the palette would work:**
- Press ⌘K (Ctrl+K on Windows) from anywhere to open a centered overlay with a search input and a list of destinations.
- The list pre-populates with the same links in `MENU_LINKS` — Play, Gym, Puzzles, Rankings, Stats, Profile, About, FAQ, Settings — plus admin links when applicable.
- Typing filters the list instantly. Enter or clicking an item navigates and closes the palette. Escape closes without navigating.
- A small ⌘K hint badge in the header (next to the Guide button) would make it discoverable.

**Relationship to the guide:** The guide is visual and onboarding-oriented — it shows the journey from new user to competitor. The palette is speed-oriented for returning users who already know what they want. They serve different moments and can coexist.

**Why deferred:** The existing nav covers current usage. The palette pays off most when users are frequent enough to remember keyboard shortcuts.

**Complexity:** Medium (~2 days). Purely frontend — a new React component with a `keydown` listener at the app root, no backend changes needed.

---

## Configurable Guide — ❌ OBSOLETE (premise gone)

**Status:** This item was written against the old iframe-based `public/getting-started.html` + 9-balloon SVG layout. That page no longer exists — it was retired during the Phase 2 nav restructure and the Phase 3.3 Guide panel rebuild. The Guide is now a React drawer (`landing/src/components/guide/GuidePanel.jsx`) with a journey card, slots grid, and notifications feed. Any future "configurable guide" work would be a fresh design against the new shell, not a continuation of this item. Leaving the original text below for archaeology:

---

**What:** Let users personalize the Getting Started guide through a "Configure Guide" panel in Settings. Three layers of configuration, in increasing complexity:

1. **Arrow toggle** — a switch to show or hide the dashed connector arrows between balloons. Some users find them helpful for understanding the progression; returning users who use the guide as a launcher find them visual noise.

2. **Balloon count** — a slider or stepper (1–9, the current maximum) controlling how many balloon positions are shown. Fewer balloons means a less cluttered guide focused on the actions the user actually uses. Hidden positions render empty — the layout stays fixed so the guide doesn't reflow.

3. **Balloon assignment** — a drag-and-drop configurator where the user picks which function occupies each position. A palette lists all available destinations (Play, Gym, Puzzles, Rankings, Stats, Profile, About, FAQ, Settings, plus the Feedback and Have Fun easter eggs). The user drags a destination from the palette onto a slot in a miniature preview of the guide layout. The resulting assignment is saved and the guide renders accordingly.

4. **Presets** — 3–4 named configurations selectable with a single click, shown at the top of the Configure Guide panel before the manual controls. Selecting a preset populates the arrow toggle, balloon count, and slot assignments all at once; the user can then fine-tune from there. Candidate presets:
   - **Default** — the current fixed layout (all 9 balloons, arrows on, original assignments). Restores the out-of-the-box experience.
   - **Onboarding** — arrows on, all balloons visible, ordered as a learning path (FAQ → Play → Training Guide → Create Bot → Train → Compete).
   - **Launcher** — arrows off, 5–6 balloons showing only the most-used destinations (Play, Gym, Leaderboard, Profile, Puzzles). Optimized for returning users who treat the guide as a quick-action menu.
   - **Minimal** — arrows off, 3 balloons (user-chosen or defaulting to Play, Gym, Profile). Maximum signal, minimum clutter.

**Balloon actions beyond simple navigation:**

Each balloon in the palette would be associated with an *action*, not just a URL. An action is a small descriptor like `{ to: '/profile', open: 'bots' }` or `{ to: '/gym', focus: 'model-name' }`. When the user clicks the balloon, the guide posts the action to the parent via `postMessage`; the parent closes the modal and calls React Router's `navigate(to, { state: action })`. The destination page reads `location.state` on mount and performs the side effect — opening an accordion, scrolling to a section, setting focus on an input, pre-selecting a tab, etc.

This means the palette of available destinations is really a palette of *actions*, each with a label, an emoji, a destination route, and an optional UI side effect. Examples:

- **Play** → `/play` (no side effect)
- **Train a bot** → `/gym` + open the training panel
- **My Bots** → `/profile` + open the My Bots accordion
- **Leaderboard** → `/leaderboard` (no side effect)
- **Create a bot** → `/profile` + open the My Bots accordion + focus the Create New Bot input
- **Puzzles** → `/puzzles` (no side effect)
- **Settings** → `/settings` (no side effect)
- **FAQ** → `/faq` (no side effect)

This approach requires that the destination pages handle incoming `location.state` gracefully — if no state is present, they render normally; if state carries an `open` or `focus` key, they apply it on mount. It also means the current `<a target="_top">` implementation in the guide HTML must be replaced with `onclick` handlers that `postMessage` the action instead, since `<a>` tags can only carry a URL.

**Current guide architecture and the key constraint:**

The guide is a self-contained static HTML file (`/public/getting-started.html`) rendered in an iframe inside `GettingStartedModal`. The parent React app communicates with it via URL params (`?hint=faq`) and `postMessage`. The guide currently has 9 balloon positions at fixed SVG coordinates and 6 dashed arrow paths.

Making the guide configurable means the iframe must receive a config object and render dynamically rather than statically. Two approaches:

- **Pass config via postMessage (lower effort, preserves current architecture):** The parent serializes the user's guide config and sends it to the iframe after load (the guide already fires `getting-started-ready` to signal it's listening). The guide JS reads the config and shows/hides arrows, shows/hides balloon slots, and swaps each slot's emoji, label, and `href`. The drag-and-drop configurator lives entirely in the React Settings page — it never needs to be inside the iframe.

- **Convert guide to a React component (higher effort, cleaner long-term):** Remove the iframe and rewrite the SVG as a React component that reads guide config directly from the prefs store. No postMessage coordination needed. Loses the ability to link to the guide standalone, but makes all three config layers straightforward React state.

The postMessage approach is the right starting point — it extends the existing communication channel without a rewrite.

**Persistence:** Guide config is a small JSON blob (arrow visibility, balloon count, slot assignments) stored as a new field in user preferences — same pattern as `showGuideButton`, persisted via `api.users.updatePreferences` and loaded at sign-in via `api.users.getHints`.

**What it would take:**
- **Schema:** add a `guideConfig` JSON column to the user preferences table. Default: arrows on, all 9 balloons, current fixed assignments.
- **Settings UI:** a "Configure Guide" section below the existing Guide button toggle — arrow switch, balloon count stepper, and a drag-and-drop canvas showing the 9 slot positions with a destination palette beside it.
- **Guide HTML:** replace hardcoded balloon content with a JS renderer that reads config from the `postMessage` payload and builds SVG elements dynamically. Arrow `<path>` elements toggled by CSS class; balloon `<a>` elements generated from the slot assignment array.
- **`GettingStartedModal`:** after the iframe fires `getting-started-ready`, post the saved guide config to it.

**Complexity:** Medium-to-large (~3–4 days total). Arrow toggle alone is small (~2 hours). Balloon count adds half a day. The drag-and-drop configurator UI, the dynamic SVG renderer in the guide HTML, and schema/persistence together account for most of the estimate.

---

## Multi-Game Architecture — ✅ LARGELY DONE (as the Game SDK)

**Status:** The Game Adapter pattern proposed here was implemented as the `GameSDK` contract in Platform Phases 1.1–1.4. `packages/sdk` defines `GameMeta`, `GameSDK`, and `botInterface`; `@callidity/game-xo` is the reference implementation; `PlatformShell` loads any `GameMeta`-conforming package via `React.lazy`. `roomManager` was retired in Phase 3.4 — `Table` rows + `previewState` + SDK adapters replaced it.

**What's left (tracked in `doc/Platform_Implementation_Plan.md`):**
- **Phase 4** — Connect4 (2p sit-down, validates the abstraction with a second game)
- **Phase 5** — Poker (adds hidden-info via `getPlayerState`, variable player counts)
- **Phase 6** — Pong (adds `tableArchetype: 'head-to-head'` + real-time loop)

The original analysis below remains a useful reference for the per-game rendering strategy (React vs Framer Motion vs Phaser), but the high-level adapter/registry work is done. Leaving below:

---

**What:** Evolve the platform to support additional game types — Connect 4, Checkers, card games, and real-time games like Pong — without rewriting the infrastructure that already works.

**What's already generic:**
The room lifecycle (create/join/disconnect/reconnect/close), socket event envelope (`game:start`, `game:moved`), ELO system, game recording, mountain name rooms, spectator system, and credits (`appId` already on the schema) are all game-agnostic today. They need no changes to support new games.

**What's XO-hardcoded today:**
`board: Array(9).fill(null)`, `makeMove({ cellIndex })`, `getWinner`/`WIN_LINES`/`isBoardFull` called directly inside `roomManager` and `botGameRunner`, `playerMarks: X|O`, and `winLine`. `GameBoard.jsx` (~600 lines) and `gameStore.js` are XO-specific. The AI registry calls `aiImpl.move(board, difficulty, currentTurn)` — an XO-shaped interface.

**The core abstraction: a Game Adapter**

Each game type registers an adapter that owns its rules. The room manager and bot runner stop knowing anything about game logic and delegate to it:

```js
{
  appId: 'connect4',
  initialState()                         // returns a fresh game state
  applyMove(state, move)                 // returns { state, terminal, winner }
  validateMove(state, move, playerMark)  // boolean
  serializeForClient(state)              // what gets emitted over the socket
}
```

`roomManager.makeMove()` currently calls `getWinner(room.board)` directly. With adapters it becomes `adapter.applyMove(room.gameState, move)`. The room carries a `gameType` field and the manager looks up the adapter from a registry — the same pattern as the existing AI registry. On the frontend, `GameBoard.jsx` splits into a generic `GameContainer` (socket connection, room management, scores, forfeit, spectator mode) and a game-specific renderer (`XOBoard`, `Connect4Board`, etc.) that receives standardized state and emits standardized moves.

**The four game types and what each requires:**

- **Connect 4** — most similar to XO. Different board shape (7×6), gravity mechanic (move is a column index, not a cell index), 4-in-a-row win detection. Fits the adapter interface cleanly. Good first target for proving the abstraction.

- **Checkers** — still turn-based and discrete, but move validation is complex (forced captures, multi-jump chains, kinging). The adapter interface handles it — `validateMove` and `applyMove` just do more work. Socket model is unchanged because state is fully visible to both players.

- **Card games** — turn-based discrete moves, but with hidden information (hand cards). The current socket broadcast model breaks here: the server can't emit full state to the room because each player should only see their own hand. The adapter interface needs a `serializeForPlayer(state, playerMark)` method, and the socket layer must emit per-player views (`io.to(socketId).emit()`) instead of broadcasting to the room. This is the meaningful socket architecture change for card games.

- **Pong / real-time** — fundamentally different. No turns, no discrete moves. Needs a `RealtimeGameRunner` with a server-authoritative tick loop (or client-side simulation with the server recording the final result). The existing `BotGameRunner._runGameLoop` async loop is the conceptual ancestor but would need to run at ~60Hz and push continuous state. See also: *Real-Time Games Against Bots* entry above.

**Rendering strategy and Phaser:**

No single renderer fits all game types:

| Game | Renderer |
|------|----------|
| XO | React (existing) |
| Connect 4 | React + CSS transitions |
| Checkers | React + CSS transitions |
| Card games | React + Framer Motion |
| Pong / real-time | Phaser (lazy-loaded) |

**Phaser** is a complete 2D game framework (WebGL/canvas, physics engine, 60Hz game loop, sprite management, input handling). It operates outside React's DOM model — you mount it imperatively in a `useEffect` and tear it down on cleanup. It's the right tool for real-time physics games (Pong) where it saves significant manual work on collision, velocity, and game loop management. It's overkill for turn-based games.

**PixiJS** is a lighter alternative (~400KB vs Phaser's ~1MB+): WebGL rendering without the physics engine. Better fit if a game needs smooth sprite rendering but not physics — certain card game animations, animated boards.

**Critical:** Phaser (or PixiJS) must be a **lazy-loaded, per-game dependency** — not a platform-wide import. A player loading Connect 4 should never download Phaser. The game adapter architecture supports this naturally: each game's renderer is its own bundle chunk, loaded only when that game is selected.

**Recommended evolution path:**

1. **Phase 1 — Extract and prove the adapter (Connect 4):** Move XO logic out of `roomManager` and `botGameRunner` into `XOGameAdapter`. Create the `gameAdapters` registry. Add `Connect4GameAdapter` and `Connect4Board.jsx`. Split `GameBoard.jsx` into `GameContainer` + `XOBoard`. This validates the abstraction without breaking anything.

2. **Phase 2 — Checkers:** Adapter interface unchanged; more complex `validateMove`/`applyMove`. No socket changes.

3. **Phase 3 — Card games:** Add `serializeForPlayer` to the adapter interface. Add per-player socket emission to the socket layer.

4. **Phase 4 — Real-time (Pong):** Separate architecture path. `RealtimeGameRunner`, canvas renderer via Phaser, tick loop. Plan independently once at least one more turn-based game exists.

**Complexity:** Phase 1 is medium (~3–4 days — the adapter extraction plus a working Connect 4). Each subsequent phase builds on it. The real-time phase is large and largely independent.

---

## Tier 2/3 transport — instrumentation (partly done)

The first three items (SSE client count, presence-store size, XREAD-loop heartbeat) are wired in `resourceCounters.js`. The remaining items below are tracked more fully in **`doc/Observability_Plan.md`** (SSE broker peak/age, Redis stream XLEN + consumer lag, Web Push delivery metrics). Treat this entry as the short form; work from the Observability Plan when picking up an observability sprint.

Open nice-to-haves — wire them in once real traffic lands or when push starts behaving oddly:

- **Push subscriptions count** — snapshot `db.pushSubscription.count()` to see how many device endpoints we're pushing to. Also useful for sizing UI in the admin health dashboard.
- **Push send metrics** — expose counters from `pushService`: `pushSent`, `pushFailed` (transient, non-404/410), `pushPurged` (dead endpoints). Surfaces success-rate and catches a VAPID misconfiguration quickly.
- **Redis Stream length** — `XLEN events:tier2:stream`. Bounded by MAXLEN=5000 so it'll always cap there, but tracking the value confirms trimming is working and gives a rough "events per minute" signal when cross-referenced with snapshot timestamps.

Low priority, mentioned for completeness:

- **`/api/v1/presence/heartbeat` QPS** — normal load is `(online users) / 15s`. A sudden 10× spike indicates a client-side retry-loop bug.
- **Dispatch → push fan-out counter** — how often `notificationBus.dispatch` actually lands a push vs skips because SSE was online. Useful for tuning which event types should have `push: true` in the REGISTRY.

**Effort:** each item is ~5–10 LOC in `resourceCounters.js` plus a small `export function` in the owning module (`pushService.js`, `tournament/src/lib/redis.js` for XLEN, etc.).

---

## Recurring tournaments — template vs occurrence semantic refactor

Today a recurring tournament is modelled as a single `Tournament` row with `isRecurring: true` that *also runs as the first occurrence*. When that row transitions to COMPLETED, the sweep creates child rows with `isRecurring: false` (the "occurrences"). The chain continues because `_nextOccurrenceStart` keeps advancing from the template's startTime and the dedup check keeps spawns unique.

This works and ships, but is awkward:

- The template is both a configuration row *and* a historical record of the first occurrence's results. You can't edit the template without risking weird side-effects on the past run.
- Admins conflate "cancel this occurrence" with "stop the whole series." The `recurrencePaused` flag added in this sweep addresses the second part but doesn't resolve the semantic mix.
- Querying "what recurring series exist?" means filtering tournaments by `isRecurring: true`, which excludes paused templates *and* all historical occurrences.

**Cleaner model (refactor deferred):**

- Add a `TournamentTemplate` table that holds the recurrence config (interval, end date, paused, seed bots, human subscriptions) but never itself runs.
- Every tournament row becomes a pure occurrence with `templateId?: string`.
- Admin create-recurring UI creates the template first, then the sweep spawns the first occurrence on `startTime`.
- Human subscriptions + seed bots attach to the template, not the first occurrence.
- `GET /api/tournaments` filters stay on `Tournament`; `GET /api/templates` becomes the admin view.

**Effort:** ~4–6 hours. Schema migration + data backfill (split existing templates into their config rows + preserved-as-occurrence rows) + rewriting the sweep + updating 3-4 UI surfaces. No functional gain for users in isolation — only worth doing when the current model actively causes a bug or a planned feature requires separating config from history.

---

## `table.released` per-reason soak monitor — ⏳ OPEN (defer until prod has traffic)

**Background:** Chunk 3 of the table-fixes sweep added a per-reason `table.released` counter to `/api/v1/admin/health/tables` (reasons: `disconnect`, `leave`, `game-end`, `gc-stale`, `gc-idle`, `admin`, `guest-cleanup`, plus `OTHER` catch-all). The shape of the per-reason histogram is the V1-acceptance success metric for "where do tables actually die" — does the disconnect bucket dominate (Safari hang regression) vs. the game-end bucket (healthy completion), is the `OTHER` bucket nonzero (typo'd reason at a call site), is `gc-idle` climbing (idle abandonment runaway), etc.

**Why deferred:** On staging the only traffic is manual QA — the per-reason distribution reflects the tester's clicks, not real user behaviour. Running a soak there would just measure the test, not the system. The metric's value scales with traffic.

**What to do post-prod:**

- Schedule a periodic poll of `/api/v1/admin/health/tables` (e.g. hourly via the same scheduler used for tournament sweeps, or a cron-driven Slack/Linear post). Diff against the previous reading and post the per-reason deltas.
- Alert thresholds (rough first cuts; tune from data):
  - `OTHER > 0` for any window → call-site typo, page on-call.
  - `disconnect / game-end > 0.5` over a 1-h window → Safari/network regression suspected; page on-call.
  - `gc-idle` rising > 5/hour while active sessions are non-zero → idle threshold misconfigured.
- Cross-reference with `tableCreateErrors.P2002` (should be ~0 post-chunk-1) and `gc.secondsSinceLastSuccess` (should be < 600s).

**Effort:** ~2 hours. Reuse the existing scheduler + a small `lib/healthDiff.js` to compute deltas. Pairs naturally with the rest of the Tier 2/3 instrumentation work (see entry above).

---
