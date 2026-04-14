<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# XO Arena — Machine Learning Feature: Development Plan

**Date:** 2026-03-19
**Status:** Draft
**Phases:** ML-1 through ML-7

Each phase produces a shippable increment. Phases are ordered by value-to-effort ratio: a working, playable Q-learning model (Phase 1) is the anchor. Later phases add analytics, evaluation, and more sophisticated algorithms without blocking the core feature.

Complexity key: **S** = hours, **M** = 1–2 days, **L** = 3–5 days.

---

## Phase ML-1 — Foundation (Core Q-Learning + Basic Dashboard)

**Goal:** A working Q-learning model that can be trained via the dashboard and used as a playable AI opponent in existing gameplay.

**Deliverables:**
- Prisma schema for ML tables + migration applied
- Q-learning engine with full training loop
- ML service with CRUD, training orchestration, Socket.io integration
- ML implementation registered in AI Registry
- ML REST routes
- Frontend dashboard: model list, training form, live progress panel

---

### Tasks

**1. Prisma schema — ML tables (ML-1 core)**

Add the following to `schema.prisma`: `MLModel`, `TrainingSession`, `TrainingEpisode`, and all required enums (`MLAlgorithm`, `MLModelStatus`, `TrainingMode`, `SessionStatus`, `EpisodeOutcome`). Do not add Phase 4+ tables yet. Run `npx prisma migrate dev --name add_ml_foundation`.

Complexity: **S**

---

**2. Q-learning engine — `backend/src/ai/qLearning.js`**

Implement a `QLearningEngine` class with:
- Constructor: accepts `config` (α, γ, ε params) and optionally a serialized Q-table to hydrate from.
- `getState(board)` — encodes a 9-cell board array as a 9-char string.
- `chooseAction(stateKey, legalMoves, epsilon)` — ε-greedy selection; initializes state entry to `[0,...,0]` if unseen.
- `update(stateKey, action, reward, nextStateKey, nextLegalMoves)` — applies Bellman update.
- `runEpisode(opponentFn, mlPlayer, epsilon)` — plays one full game, returns `{ outcome, totalMoves, avgQDelta, trajectory }`.
- `serialize()` — returns the Q-table as a plain object for DB storage.

Use `getWinner`, `isBoardFull`, `getEmptyCells`, `opponent` from the existing `gameLogic.js`.

Complexity: **M**

---

**3. ML service — `backend/src/services/mlService.js`**

Implement:
- `createModel(data)` — insert MLModel, return record.
- `getModel(id)` — fetch with stats.
- `listModels()` — return summary list.
- `updateModel(id, data)` — patch name/description/config.
- `deleteModel(id)` — Prisma cascade deletes children.
- `resetModel(id)` — clear qtable, reset totalEpisodes.
- `cloneModel(id, name, description)` — copy qtable + config into new record.
- `startTrainingSession(modelId, sessionData)` — create session, enqueue or start immediately.
- `cancelSession(sessionId)` — add to `cancelledSessions` Set, mark DB status CANCELLED.
- `runTrainingLoop(sessionId)` — full training loop per design spec: batch inserts, setImmediate yield, progress emission, epsilon restoration, checkpointing.
- `getOrHydrateEngine(modelId)` — fetch from `modelCache` or load from DB and instantiate algorithm class.
- `invalidateCache(modelId)` — remove from `modelCache`.

Accepts `io` (Socket.io server instance) as a constructor/init argument.

Complexity: **L**

---

**4. ML implementation — `backend/src/ai/mlImplementation.js`**

Create an AI Registry adapter:

```js
export const mlImplementation = {
  id: 'ml',
  name: 'Machine Learning',
  description: 'Trained reinforcement learning model',
  supportedDifficulties: [],
  async move(board, difficulty, player, options) {
    const { modelId } = options
    // Load from mlService cache; call engine.chooseAction with epsilon=0 (greedy)
  }
}
```

Register it in `registry.js`: `registry.register(mlImplementation)`.

Update the AI move route (`routes/ai.js`) to pass `modelId` from the request body to the implementation's `move()` call. Make the route handler async.

Complexity: **S**

---

**5. ML routes — `backend/src/routes/ml.js`**

Implement all Phase 1 endpoints:

- `GET /ml/models` — `mlService.listModels()`
- `POST /ml/models` — `mlService.createModel(body)`
- `GET /ml/models/:id` — `mlService.getModel(id)`
- `PATCH /ml/models/:id` — `mlService.updateModel(id, body)`
- `DELETE /ml/models/:id` — `mlService.deleteModel(id)`
- `POST /ml/models/:id/clone` — `mlService.cloneModel(id, body)`
- `POST /ml/models/:id/reset` — `mlService.resetModel(id)`
- `POST /ml/models/:id/train` — `mlService.startTrainingSession(id, body)`
- `GET /ml/models/:id/sessions` — paginated session list
- `GET /ml/sessions/:id` — session detail
- `GET /ml/sessions/:id/episodes` — paginated episodes
- `POST /ml/sessions/:id/cancel` — `mlService.cancelSession(id)`
- `GET /ml/models/:id/qtable` — return `model.qtable` as JSON

Apply `requireAuth` to all write operations.

Complexity: **M**

---

**6. Register ML route and pass `io` to service — `backend/src/index.js`**

Two changes:
1. Import `mlRouter` from `./routes/ml.js` and add `'/ml': mlRouter` to `registerRoutes`.
2. After `attachSocketIO(server)` resolves, pass the `io` instance to `mlService.init(io)`.

Complexity: **S**

---

**7. Socket.io — add ML handlers — `backend/src/realtime/socketHandler.js`**

Add two handlers inside the `connection` callback:

```js
socket.on('ml:watch', ({ sessionId }) => socket.join(`ml:session:${sessionId}`))
socket.on('ml:unwatch', ({ sessionId }) => socket.leave(`ml:session:${sessionId}`))
```

Complexity: **S**

---

**8. Frontend — MLDashboardPage skeleton — `frontend/src/pages/MLDashboardPage.jsx`**

Implement:
- Two-panel layout (model list left, detail right on desktop; stacked on mobile).
- Model list: name, algorithm badge, ELO, total episodes, status pill, create button.
- Model detail: basic info + placeholder tabs (Train active, others disabled until Phase 2+).
- Training form (Train tab): mode selector, iterations input, difficulty selector (for VS_MINIMAX), start button, cancel button.
- Live progress panel: progress bar, win/draw/loss counters, current epsilon display.
- Socket.io: `ml:watch` on session start, handlers for `ml:progress`, `ml:complete`, `ml:error`.
- Create model modal with algorithm selector and config fields.
- Delete and reset actions with confirmation dialogs.

Complexity: **L**

---

**9. Frontend — wire into admin nav and App.jsx**

- Add `<NavLink to="/admin/ml">ML</NavLink>` in the desktop sidebar admin section next to AI and Logs.
- Add `<Route path="/admin/ml" element={<MLDashboardPage />} />` in `App.jsx`.
- Wrap route in the existing admin-only guard (or add one if absent).

Complexity: **S**

---

**10. Frontend — ml API methods — `frontend/src/lib/api.js`**

Add functions:
- `mlListModels()`, `mlCreateModel(data)`, `mlGetModel(id)`, `mlUpdateModel(id, data)`, `mlDeleteModel(id)`
- `mlCloneModel(id, data)`, `mlResetModel(id)`, `mlStartTraining(id, data)`, `mlCancelSession(id)`
- `mlGetSessions(id, params)`, `mlGetSession(id)`, `mlGetEpisodes(sessionId, params)`, `mlExportQtable(id)`

Complexity: **S**

---

**11. Tests**

- `backend/src/ai/qLearning.test.js` — unit tests for `getState`, `chooseAction`, `update`, `runEpisode`. Verify: optimal move selection after sufficient training on fixed boards; Q-values converge monotonically; draw and loss rewards applied correctly.
- `backend/src/services/mlService.test.js` — CRUD tests using a test DB or Prisma mock: create, list, get, update, delete, clone, reset.
- `backend/src/routes/ml.test.js` — route-level integration tests (HTTP): all endpoints return correct status codes; auth guard rejects unauthenticated writes; validation rejects `iterations > 100000`.

Complexity: **M**

---

## Phase ML-2 — Analytics & Explainability

**Goal:** Rich charts and analysis tools so practitioners can understand what the model learned and how training progressed.

**Prerequisite:** Phase ML-1 complete and producing TrainingEpisode records.

---

### Tasks

**1. Analytics tab — session charts**

Implement the Analytics tab in model detail:
- Session selector dropdown (lists all sessions for the model).
- Win rate over episodes: `<LineChart>` with rolling-average smoothing (configurable window: 50/100/500). Render confidence interval band as shaded area.
- Epsilon decay curve: line chart from episode data.
- Avg Q-delta convergence chart: line chart showing how Q-value changes diminish as training matures.

Smoothing is computed client-side from the episode array. No new backend endpoints needed — episode data already returned by `GET /ml/sessions/:id/episodes`.

Complexity: **M**

---

**2. Q-value heatmap component — `QValueHeatmap.jsx`**

A 3×3 grid where each cell is colored by its Q-value (green = high, red = low, grey = occupied). Accepts:
- `board` — 9-element array (current position)
- `qValues` — 9-element array from `model.qtable[stateKey]`
- `highlight` — optional index of the chosen move

Used in the Explainability tab. Also rendered during live gameplay (toggled in Settings) by passing the current board state and fetching Q-values from `GET /ml/models/:id/qtable`.

Complexity: **M**

---

**3. Move explanation — Explainability tab**

Board position input: user can click cells to set up any board position. On each change:
1. Derive state key from board.
2. Lookup Q-values in the locally fetched Q-table.
3. Render `QValueHeatmap` + ranked list of legal moves with Q-value labels.

Decision confidence: display the gap between the top Q-value and the second-best legal move as a percentage.

Complexity: **M**

---

**4. Decision confidence in-game**

During live gameplay against an ML model, after the AI move is returned from `POST /ai/move`:
- Backend includes `{ qValues, chosenCell, confidence }` in the response (add these fields to the ML implementation's response, gated by a `explain=true` query param).
- Frontend renders a subtle confidence bar below the board (toggled in Settings → AI explanations).

Complexity: **S**

---

**5. Session comparison overlay**

Allow selecting two sessions in Analytics tab and overlaying their win-rate charts on the same axes. Sessions rendered as different line colors with a legend. Useful for comparing hyperparameter configs.

Complexity: **S**

---

**6. Opening book analysis**

Add `GET /ml/models/:id/opening-book` endpoint. Backend iterates all Q-table entries where 8 or 9 cells are empty (first or second move), aggregates win rates by first-move cell, and returns a ranked list. Frontend renders this as an annotated 3×3 board with win-rate percentages per cell.

Complexity: **M**

---

**7. Export — CSV and JSON**

Data tab: add export buttons:
- "Export sessions CSV" — `GET /ml/models/:id/sessions?format=csv`
- "Export episodes CSV" — `GET /ml/sessions/:id/episodes?format=csv`
- "Export Q-table JSON" — links to existing `GET /ml/models/:id/qtable`

Backend: add `format=csv` handling to session and episode list endpoints using a simple CSV serializer.

Complexity: **S**

---

## Phase ML-3 — Model Management & Versioning

**Goal:** Full model lifecycle management including checkpoints, version diffs, and import/export.

**Prerequisite:** Phase ML-1 complete.

---

### Tasks

**1. Prisma schema — MLCheckpoint**

Add `MLCheckpoint` model to `schema.prisma`. Run migration: `npx prisma migrate dev --name add_ml_checkpoints`.

Complexity: **S**

---

**2. Checkpointing in training loop**

In `mlService.js`, add checkpoint saving inside the training loop: every `config.checkpointEvery` episodes (if set), call `saveCheckpoint(modelId, episode, engine)` which inserts an `MLCheckpoint` record with the current serialized Q-table, epsilon, and ELO.

Checkpoints are saved asynchronously (non-blocking) to avoid adding latency to the training loop.

Complexity: **S**

---

**3. Manual checkpoint endpoint and UI**

- `POST /ml/models/:id/checkpoint` — trigger an immediate checkpoint outside the scheduled interval.
- `GET /ml/models/:id/checkpoints` — list checkpoints sorted by `episodeNum` desc.
- Frontend: "Save checkpoint" button in the Train tab. `CheckpointList` component in the Settings tab.

Complexity: **S**

---

**4. Checkpoint restore**

- `POST /ml/models/:id/checkpoints/:cpId/restore` — copy `checkpoint.qtable` and `checkpoint.epsilon` into `model.qtable`; update `model.totalEpisodes = checkpoint.episodeNum`. Invalidate model cache.
- Frontend: restore button on each checkpoint row with a confirmation dialog.

Complexity: **S**

---

**5. Model cloning endpoint and UI**

The clone endpoint is implemented in Phase 1. Phase 3 adds the UI: a "Clone" button on the model card opens a modal to set the new model's name and description. After creation, the cloned model appears in the list.

Complexity: **S**

---

**6. Import and export**

- `GET /ml/models/:id/export` — return JSON: `{ name, description, algorithm, config, qtable, totalEpisodes, eloRating }`.
- `POST /ml/models/import` — accept raw JSON body matching the export format; create a new `MLModel` from it.
- Frontend: "Export" button on each model (downloads file); "Import" button in the model list header opens a file-picker dialog.

Complexity: **M**

---

**7. Version diff viewer**

A UI tool in the Explainability tab: select two checkpoints (or the live Q-table vs a checkpoint). The diff shows:
- Number of state keys added, removed, or changed.
- Distribution of Q-value deltas as a histogram (Recharts `<BarChart>`).
- Top 20 states with the largest Q-value change, rendered as `QValueHeatmap` pairs (before / after).

All computation is client-side using the two Q-table JSON objects fetched from the checkpoints.

Complexity: **M**

---

## Phase ML-4 — Evaluation & Benchmarking

**Goal:** Objective, reproducible performance measurement across all models. Comparable ELO ratings. Tournament mode.

**Prerequisite:** Phase ML-1 complete.

---

### Tasks

**1. ELO rating system**

Add `MLEloHistory` to `schema.prisma`. Run migration.

Implement `updateElo(winnerModelId, loserModelId, isDraw)` in `mlService.js` using the standard ELO formula (K=32). After any head-to-head game result, call this function. Results are written to `MLEloHistory` and `MLModel.eloRating` is updated atomically.

Complexity: **M**

---

**2. Benchmark schema — MLBenchmarkResult**

Add `MLBenchmarkResult` to `schema.prisma`. Run migration.

Complexity: **S**

---

**3. Benchmark suite implementation**

`POST /ml/models/:id/benchmark` starts a background job that runs 1,000 games against each of four opponents: random play, Minimax Easy, Minimax Medium, Minimax Hard. The ML model plays as X throughout.

Results are stored in `MLBenchmarkResult`. The response returns `{ benchmarkId }` immediately. A `ml:benchmark_complete` Socket.io event is emitted to `ml:session:benchmark-{benchmarkId}` on completion.

Complexity: **L**

---

**4. Benchmark scorecard UI — `BenchmarkScorecard.jsx`**

Rendered in the Evaluation tab. Shows win/draw/loss counts and win rate per opponent as a grouped bar chart. Includes a date of last run and a "Run benchmark" button. P-value is displayed if a previous result exists for comparison.

Complexity: **M**

---

**5. Head-to-head comparison**

`POST /ml/models/:id/versus/:id2` — runs N games (default 100, max 1,000) between two models. Returns `{ wins, losses, draws, winRate, pValue }`. ELO is updated for both models after the run.

Frontend: Evaluation tab includes a head-to-head panel with a model selector and a "Run" button.

Complexity: **M**

---

**6. Tournament mode**

Add `MLTournament` to `schema.prisma`. Run migration.

`POST /ml/tournament` accepts `{ modelIds: [...], includeMinmax: true, gamesPerPair: 50 }`. Runs all pairwise matchups. Results are stored as a ranking JSON. `TournamentTable.jsx` renders a sortable leaderboard.

Complexity: **L**

---

**7. Statistical significance**

For any win-rate comparison (benchmark result vs baseline, or two head-to-head runs), compute a two-proportion z-test and report the p-value. Flag results with p > 0.05 as "not statistically significant" in the UI with a warning badge.

All computation is server-side, returned inline with benchmark and head-to-head responses.

Complexity: **M**

---

**8. Forgetting detection**

After each training session completes, automatically re-run a mini-benchmark (100 games vs Hard Minimax instead of 1,000) and compare to the most recent full benchmark result. If win rate drops by more than 5 percentage points, emit a `ml:regression_detected` Socket.io event and display a warning badge on the model card.

Complexity: **M**

---

## Phase ML-5 — Advanced Training

**Goal:** SARSA, Monte Carlo, curriculum learning (full implementation), early stopping, training queue, and hyperparameter search.

**Prerequisite:** Phase ML-1 and Phase ML-2 complete.

---

### Tasks

**1. SARSA engine — `backend/src/ai/sarsa.js`**

Implement `SarsaEngine` class with the same interface as `QLearningEngine`. The key difference is that `update()` takes the actual next action `a'` chosen by the policy rather than using `max`. The training loop must pass the chosen action forward to the next step rather than re-selecting it.

Complexity: **M**

---

**2. Monte Carlo engine — `backend/src/ai/monteCarlo.js`**

Implement `MonteCarloEngine`. `runEpisode()` plays a full game, buffers the trajectory as `[(state, action)]`, then computes returns backward and applies updates at episode end. Support `firstVisitOnly` config flag.

Complexity: **M**

---

**3. Curriculum learning — full implementation**

Phase 1's training loop includes a `maybeCurriculum` stub. Phase 5 fills it in:
- Track a rolling window (deque of last 200 outcomes).
- If win rate exceeds `config.curriculumThreshold`, escalate difficulty.
- Emit `ml:curriculum_advance` event.
- Add curriculum progress display to the Live Progress Panel (current difficulty badge, win rate vs threshold indicator).

Complexity: **M**

---

**4. Early stopping — full implementation**

Fill in the `checkEarlyStop` stub from Phase 1:
- Maintain per-window win rate history.
- Compare current window to previous; track consecutive non-improving windows.
- When patience exceeded, emit `ml:early_stop`, flush episode batch, mark session COMPLETED.
- Display early stop reason in session summary UI.

Complexity: **S**

---

**5. Training queue**

Extend `mlService.js`:
- `trainingQueues` Map is already defined in Phase 1; Phase 5 fully implements queue management.
- `POST /ml/models/:id/train` when model is already training: create session with status PENDING, push to queue. Return `{ sessionId, queued: true }`.
- `processNextInQueue(modelId)` is called at end of each session.
- Frontend: Training tab shows a queue list (ordered sessions with pending badges). Allow reordering (drag-and-drop optional) and cancelling queued sessions.

Complexity: **M**

---

**6. Hyperparameter search**

`POST /ml/models/:id/train` with `{ mode: 'HYPERPARAMETER_SEARCH', searchSpace: { learningRate: [0.1, 0.3, 0.5], epsilonDecay: [0.99, 0.995] }, episodesPerConfig: 2000 }`.

Service generates all combinations (or a random sample if `randomSearch: true`), runs each as a mini training session, records final win rates, and selects the best config. The best config is applied to the model and a full training session is started.

All search sessions are associated with a parent session record for UI grouping.

Complexity: **L**

---

**7. Policy Gradient engine — `backend/src/ai/policyGradient.js`**

Implement `PolicyGradientEngine` (REINFORCE). Key differences from Q-Learning:
- No epsilon-greedy; exploration comes from sampling the softmax policy.
- `runEpisode()` collects trajectory, computes returns, applies gradient update at end.
- Action selection: sample from `softmax(weights[stateKey] / temperature)`.

Complexity: **M**

---

## Phase ML-6 — Deep Learning

**Goal:** Neural network-based algorithms (DQN, AlphaZero-style). Pure-JS implementation; no external ML frameworks.

**Prerequisite:** Phase ML-1 complete. Phase ML-5 recommended (for training infrastructure maturity).

---

### Tasks

**1. Pure-JS neural network — `backend/src/ai/neuralNet.js`**

Implement a minimal multi-layer perceptron:
- `constructor(layerSizes)` — e.g. `[9, 64, 64, 9]`
- `forward(input)` — returns activations at each layer
- `backward(lossGrad)` — backpropagation with gradient accumulation
- `update(learningRate)` — apply accumulated gradients (SGD)
- `serialize()` / `fromJSON(weights)` — for DB storage and cache hydration
- Activation functions: ReLU for hidden layers, linear for output (Q-values), sigmoid/softmax for value/policy networks

No external dependencies. Math is plain JS with nested arrays.

Complexity: **L**

---

**2. DQN engine — `backend/src/ai/dqn.js`**

Implement `DQNEngine`:
- Online network + target network (both instances of `NeuralNet`)
- Experience replay buffer (circular array of `{ state, action, reward, nextState, done }` tuples)
- `runEpisode()` — interact with opponent, push to replay buffer; after each move, sample a batch and run gradient descent; every `targetUpdateFrequency` episodes, copy online weights to target
- Board encoding: +1 / −1 / 0 per cell
- `serialize()` returns both network weight arrays

Complexity: **L**

---

**3. DQN config UI**

Add DQN-specific fields to the Training form when algorithm is DQN:
- Batch size (default 32)
- Replay buffer size (default 10,000)
- Target update frequency (default 100 episodes)

Complexity: **S**

---

**4. AlphaZero-style engine — `backend/src/ai/alphaZero.js`**

Implement `AlphaZeroEngine`:
- Value network: `NeuralNet([9, 64, 32, 1])` with sigmoid output
- Policy network: `NeuralNet([9, 64, 32, 9])` with softmax output
- MCTS: `numSimulations` rollouts per move using PUCT selection
- Self-play only: no VS_MINIMAX or VS_HUMAN support
- `runEpisode()` — self-play game; collect `(state, policy_target, value_target)` tuples; train both networks at episode end

Complexity: **L**

---

**5. Ensemble voting**

`POST /ml/models/ensemble` — accepts `{ modelIds: [...], method: 'majority' | 'weighted', weights?: [...] }`. Returns the ensemble as a virtual model for gameplay. During a move request:
- Call each model's `chooseAction()` (greedy)
- Aggregate votes (majority vote or weighted average of Q-values)
- Return winning action

The ensemble is not persisted as an MLModel record; it is resolved at request time.

Complexity: **M**

---

**6. Neural network visualizer**

Explainability tab: for DQN models, add a "Network activation" panel. User inputs a board state; the backend runs a forward pass and returns the activation values at each layer. Frontend renders each layer as a row of colored circles (activation magnitude → color intensity).

`POST /ml/models/:id/explain` — body: `{ board: [...] }`, response: `{ activations: [[layer0], [layer1], ...], qValues: [...] }`.

Complexity: **M**

---

## Phase ML-7 — Human Learning & Player Profiling

**Goal:** The ML model learns from and adapts to individual human players in real time.

**Prerequisite:** Phases ML-1 and ML-3 complete.

---

### Tasks

**1. Prisma schema — MLPlayerProfile**

Add `MLPlayerProfile` to `schema.prisma`. Run migration: `npx prisma migrate dev --name add_ml_player_profiles`.

Complexity: **S**

---

**2. Profile builder — record move patterns from real games**

When a human plays against an ML model in VS_HUMAN mode (or when `humanLearning: true` is set on the model):
- After each human move, look up or create an `MLPlayerProfile` for the authenticated user.
- Record the board state and human move in `movePatterns` (increment frequency counter for `stateKey → cellIndex`).
- Update `openingPreferences` if it is move 1 or 2.
- Increment `gamesRecorded` at game end.
- Compute and update `tendencies` (e.g., blocking rate = fraction of moves that blocked an opponent win threat).

This runs asynchronously after move processing, not in the hot path.

Complexity: **M**

---

**3. Per-player Q-value adaptation**

When the ML model is about to make a move against a known player, modify the Q-value selection:
- Load the player's `MLPlayerProfile` from DB (cached in memory per player per session).
- For each legal move, compute a bias: `bias[cell] = profile.movePatterns[stateKey][cell] / totalMovesFromState` (normalized frequency of player choosing that cell in this state).
- Adjusted Q-value: `Q'(s,a) = Q(s,a) + λ · bias[a]` where `λ` (profile weight, default 0.2) is configurable.
- Select action using `argmax Q'(s, a)`.

This biases the model to prefer cells the human often occupies, anticipating their next move.

Complexity: **M**

---

**4. Real-time adaptation — mid-game weight update**

After each human move (not waiting for game end):
- Run a partial Q-learning update using the observed state-action pair and a heuristic reward (e.g., −0.1 if the human just created a fork threat, +0.1 otherwise).
- Apply the update to the live in-memory engine instance (not persisted until game end).
- At game end, persist the updated Q-table.

This requires the game session to maintain a reference to the ML engine instance in memory, which is feasible since games are short.

Complexity: **L**

---

**5. Player profile dashboard**

The Evaluation tab of the ML Dashboard gains a "Player Profiles" sub-section:
- List of all `MLPlayerProfile` records for users who have played this model.
- Per-player: games recorded, most frequent openings (rendered as annotated board), blocking rate, model's win rate against that player.
- `GET /ml/models/:id/player-profiles` endpoint returns profile summaries with win rate computed from game history.

Complexity: **M**

---

**6. Opponent modeling UI**

Explainability tab: "Opponent model" panel. Select a player profile; the heatmap shows how the model's Q-values shift when adapting to that player (difference between base Q-values and adjusted Q-values for each state). This makes the adaptation strategy visible and debuggable.

Complexity: **M**

---

## Cross-Phase Notes

### Backward Compatibility

All changes are additive. Existing Minimax AI routes, game routes, Socket.io rooms, and the Prisma schema (User, Game, Move, AIError) are unchanged. The ML implementation (`id: 'ml'`) appears alongside Minimax in the AI Registry and is simply not selected unless the user explicitly chooses an ML model.

### Testing Strategy

Each phase ships with unit tests for the algorithm engines and integration tests for the routes. End-to-end tests (Phase 1 only: full training session via API) are added to the Vitest suite. The Husky pre-commit hook runs all tests.

### Migration Safety

Every schema addition uses a new, isolated migration file. No existing columns are modified. All new foreign key relations use `onDelete: Cascade` so data consistency is maintained without requiring manual cleanup.

### Performance Budget

Training a Q-learning model for 10,000 episodes should complete in under 3 seconds on the application server. DQN at 10,000 episodes should complete in under 30 seconds. These targets inform whether a pure-JS neural network is sufficient or whether background worker threads become necessary (not required for Phase 6 given tic-tac-toe's tiny state space).
