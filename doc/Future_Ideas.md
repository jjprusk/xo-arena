# Future Ideas

Deferred features and improvements that are worth revisiting but not currently prioritized.

---

## Real-Time Presence / Inactivity Detection

**What:** Make the admin "online" indicator reflect actual user presence rather than just session validity. When a user's screensaver activates (tab becomes hidden), they should transition to "away" or "offline" within ~90 seconds.

**Why deferred:** Currently online status is based on BetterAuth session existence, which doesn't change when the user goes idle. No client-side inactivity tracking exists.

**What it would take:**
- **Frontend:** emit a socket heartbeat every ~60s; pause it via `visibilitychange` when the tab is hidden (`document.visibilityState === 'hidden'`). On hide, emit `user:away`; on show, emit `user:active`.
- **Backend:** track `onlineAt` per connected socket with a short TTL (~90s). If no heartbeat arrives within the TTL, consider the user offline. This is separate from session validity.
- The `activityService` already tracks `lastActiveAt` via Redis — this could be extended or reused for the presence signal.

**Complexity:** Medium (~1 day). Accurate presence requires careful handling of tab switching, multiple tabs, and mobile backgrounding.

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

## Persist Game State Through Deploys (Redis-backed Rooms)

**What:** Store active room and game state in Redis so that a Railway deploy (or any container restart) does not drop in-progress games. Currently all room state lives in the `roomManager`'s in-memory map — a restart silently kills any active session.

**Why deferred:** Traffic is low enough that deploys rarely hit active games. A graceful SIGTERM drain window partially mitigates this for short deployments.

**What it would take:**
- **Redis room store:** serialize `roomManager` room state (board, turn, player sockets, timestamps) to a Redis hash on every state change. On startup, rehydrate in-memory state from Redis.
- **Socket reconnection:** when a client reconnects after a brief drop, look up their room by session/user ID and re-join them to the recovered room rather than showing an error.
- **Expiry:** set a TTL on room keys (e.g. 1 hour) so abandoned rooms don't accumulate.
- **Bot games:** bot game runner state would need the same treatment, or bot games could simply be restarted on reconnect (acceptable since they're not PvP).

**Complexity:** Medium (~1–2 days). Redis is already used for the activity/presence service, so the infrastructure is in place. The main work is wiring the roomManager writes/reads through Redis and handling the reconnect flow on the frontend.

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

## Configurable Guide

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
