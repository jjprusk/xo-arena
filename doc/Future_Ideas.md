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
