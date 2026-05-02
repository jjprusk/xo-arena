# Connect 4 — Ship Checklist

Phase 3.8 (Multi-Skill Bots) reshaped the platform so a second game lands as
*additive rows*, not a redesign. This doc is the minimum punch-list to ship
Connect 4 plus two optional spikes that should be evaluated before (or during)
the work.

## Prerequisites

- Phase 3.8 done on `main` (Sprints A + B + C).
- `xo-*-prod` healthy.

## Required steps

1. **Game package** — create `packages/game-connect4/` conforming to the SDK
   contract in `packages/sdk/`:
   - Board logic + win detection (4-in-a-row on 6×7).
   - `GameComponent` (play surface).
   - `GymComponent` (training surface, mirrors `packages/game-xo/` shape).
   - AI engines: at minimum `minimax` (deterministic baseline). Q-learning /
     DQN come for free via `@xo-arena/ai` if state encoding is provided.
2. **Publish** `@callidity/game-connect4` to GitHub Packages.
3. **Game registry** — add one line to `landing/src/lib/gameRegistry.js`:
   ```js
   { id: 'connect4', label: 'Connect 4', minPlayers: 2, maxPlayers: 2 },
   ```
4. **Seed** — append one `BotSkill` row per built-in bot for
   `gameId: 'connect4'` in `backend/prisma/seed.js` (mirrors the existing XO
   block at ~L161). Run `prisma migrate deploy` then re-seed.
5. **Verification pass** — Phase 4.2 checklist from
   `doc/Platform_Implementation_Plan.md`:
   - `React.lazy` loads the package on demand.
   - Tables page: create table, join, play.
   - Gym + Puzzles tabs render.
   - Replay end-to-end.
   - `GameElo` rows accrue separately from XO ELO.
6. **e2e** — extend the `e2e/tests/open-items.spec.js` §11i lifecycle case
   to cover Connect 4 alongside XO (create bot → add Connect 4 skill → play
   PvB).

## Optional spikes — evaluate before / during the work

These are *not* blocking, but each could save weeks if it's the right call.
Both deserve a short spike (≤ 1 day) before deciding.

### Spike A — TensorFlow.js on the front end

**Question:** Is pure-JS training fast enough for Connect 4's 6×7 state space,
or do we need TF.js (with WebGL / WASM backends) to keep training tractable in
the browser?

**Trigger:** Phase 4.3 in the Platform Plan flags this as conditional. The
existing migration plan lives at `doc/TensorflowJS_Migration_Plan.md`.

**Spike output:** Benchmark XO vs Connect 4 episodes/sec on the existing
pure-JS engines (DQN especially). If Connect 4 falls below ~100 eps/s on a
mid-range laptop, plan the TF.js move *before* shipping. If it stays above
that, defer until a third game forces it.

### Spike B — Move ML training to the backend

**Question:** Should training shift off the browser to a backend worker?
Today all tic-tac-toe models train in the front end (`useTraining` orchestrates
episodes locally; `finishTrainingFromFrontend` POSTs the resulting weights).
This works for XO but has known costs:

- The browser tab must stay open for hours-long runs.
- Mobile / low-end devices can't realistically train.
- We can't run cluster-scale evaluations or batch self-play across bots.

**Trigger:** Connect 4 will increase per-episode cost; if Spike A pushes us to
TF.js, the marginal cost of running training in a Node TF.js worker (or
Python service) is small compared to running it in every user's tab.

**Spike output:** Prototype a backend training worker that consumes the same
`TrainingSession` row, runs N episodes in a Node process, and writes weights
back via the existing completion path. Compare wall-clock + ops cost vs the
browser path. Decision: keep both (browser for short demos, backend for real
runs), or fully migrate.

## Out of scope

- New tournament formats, ladder changes, payments — Connect 4 is purely
  additive.
- Game-SDK changes — if the contract needs to grow, that's a separate doc.
