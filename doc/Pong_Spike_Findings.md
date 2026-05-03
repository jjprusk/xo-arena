<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Pong Real-Time Spike — Findings

> Phase 1.8 output. Feeds into Phase 4.2 decision point and Phase 6 architecture.

**Test date:** 2026-04-13  
**Environment:** localhost, two browser tabs, Docker dev stack

---

## Results

### 1. Input responsiveness
**Excellent.** Input latency was barely perceptible. Paddle response felt immediate despite the round-trip to the server.

### 2. Ball movement smoothness
**Excellent.** Client-side `requestAnimationFrame` interpolation between 30fps server ticks produced visually smooth motion — better than expected for a server-authoritative loop at 33ms tick intervals.

### 3. Tab throttling
Not tested in this spike. Browsers throttle `requestAnimationFrame` in background tabs; behaviour under throttling should be assessed in a follow-up or staging test.

### 4. Disconnect handling
**Works correctly.** Closing one tab mid-game immediately shows "Game ended — opponent disconnected." with a "New Game" button on the remaining player's screen. The `pong:abandoned` socket event and server cleanup are functioning as designed.

---

## Architecture Validated

The spike confirms the **tight WebSocket loop (Socket.io) is sufficient** for Pong:

- **Server-authoritative game loop** at ~30fps (`setInterval` at 33ms) — no cheating surface, clean state ownership
- **Client interpolation** between ticks with `requestAnimationFrame` — smooth rendering without needing higher tick rates
- **`submitMove({ direction })`** works for continuous real-time input — the opaque `move` payload in the SDK contract accommodates this without breaking the interface
- **`onMove(handler)`** works as a high-frequency stream (30fps) rather than discrete events — compatible with the existing SDK contract
- **`session.playerIndex`** addition to the session object is the only SDK extension needed for real-time seat assignment

---

## SDK Contract Amendments Needed for Phase 6

| Field / Method | Current Contract | Real-Time Requirement |
|---|---|---|
| `submitMove(move)` | `move: unknown` (opaque) | Already accommodates `{ direction: 'up' \| 'down' \| null }` — no change needed |
| `onMove(handler)` | Discrete move events | Works as high-frequency state stream — no change needed |
| `session.playerIndex` | Not in base contract | Add `playerIndex: number \| null` to `GameSession` type |
| `session.seatIndex` | — | Consider aliasing `playerIndex` as `seatIndex` for clarity in multi-team games |

---

## Recommendation

**Proceed with WebSocket loop for Phase 6 Pong.** No WebRTC escalation needed.

The spike prototype (`packages/game-pong/`, `backend/src/realtime/pongRunner.js`) is removable — it is self-contained and not wired into the main game registry. It can serve as a reference implementation for Phase 6.

---

## Open Questions for Phase 6

- **Reconnection:** If a player's connection drops briefly and reconnects, does the server resume their session or treat them as a new joiner?
- **Bot paddle AI:** `makeMove()` on a real-time game needs a different signature — likely a continuous direction signal rather than a discrete cell index.
- **Replay storage:** Sampled snapshots at 100ms intervals should be sufficient for Pong replay. Confirm storage cost at scale before committing.
- **Tab throttling:** Validate interpolation behaviour when a tab is backgrounded mid-game.

---

## Tournament series format — support "First to N" alongside "Best of N"

When Pong's tournament flow lands, take the opportunity to generalise the series-format field. Today the schema has a single `bestOfN` integer interpreted as "Best of N" everywhere, and for XO (a solved game with frequent draws) we needed a pragmatic `gamesPlayed >= bestOfN` cap plus an X-wins tiebreaker to prevent infinite-draw stalls.

**Why it matters:** Best-of-N and First-to-N collapse only for draw-free games. For games where draws happen (XO, Checkers, Chess, Connect 4) only First-to-N is semantically coherent; for draw-free games (Pong, race-to-N-points) either works. The current "Best of 1" XO tournaments are misleading — a single XO game between optimal players is a draw, so the match has no natural winner.

**Proposed design (do as part of Pong tournament wiring):**

- Add `Tournament.seriesFormat: 'BEST_OF' | 'FIRST_TO'` enum, default `BEST_OF` for back-compat.
- Keep the existing `bestOfN` int as the count (rename to `seriesCount` in a follow-up if desired).
- Add a per-Game default in the game registry metadata: XO → `FIRST_TO`, Pong → `BEST_OF`. Admin can override per tournament.
- Match-completion branches on the enum:
  - `BEST_OF`: majority wins, cap at N games (current behaviour).
  - `FIRST_TO`: play until someone reaches N wins; draws don't count. Safety cap (e.g. 10 games) records a drawn match if neither side reaches N.
- UI flips the label ("First to 2 wins" vs "Best of 3"). Bracket cells should hide the `1 – 0` score when `seriesFormat=BEST_OF && bestOfN=1` — it reads like a running count.

**Effort:** ~50 lines across schema migration, tournament-creation form, game registry metadata, and match-completion check. Files touched: `packages/db/prisma/schema.prisma`, `landing/src/pages/admin/AdminTournamentsPage.jsx`, `backend/src/lib/tournamentBridge.js`, `backend/src/realtime/socketHandler.js::recordPvpGame` (the `seriesDone` calculation).
