# XO Arena — Machine Learning Feature: Technical Design

**Date:** 2026-03-19
**Status:** Draft
**Scope:** ML AI research platform — Phase ML-1 through ML-7

---

## 1. Overview & Goals

### Purpose

XO Arena's ML feature adds a reinforcement learning research environment directly inside the application. Rather than shipping a single trained model, the platform exposes the full training lifecycle: create named models, run training sessions under multiple modes, inspect learning curves, compare models head-to-head, and deploy the best-performing model as a playable AI opponent.

### Goals

- Provide a first-class Q-learning (tabular RL) implementation usable as a playable AI with no configuration.
- Support six algorithm families (Q-Learning, SARSA, Monte Carlo, Policy Gradient, DQN, AlphaZero-style) so they can be trained and benchmarked side-by-side.
- Give practitioners full transparency: Q-value heatmaps, convergence charts, checkpoint diffs, and decision confidence during live gameplay.
- Keep the system self-contained inside the existing Express/Prisma/Socket.io stack — no separate Python services required for tabular and small neural-network variants.

### Scope Boundaries

- Training runs server-side in Node.js. The frontend is a read-mostly dashboard.
- Tic-tac-toe is the only game. The state space is small enough (~5,500 reachable positions) for all tabular methods.
- Deep learning variants (DQN, AlphaZero) use a pure-JS neural network implementation — no TensorFlow.js or ONNX dependency in Phase 1.
- The feature is additive: existing Minimax AI, gameplay routes, and Socket.io room logic are unchanged except for minor async extensions.

---

## 2. System Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                  │
│                                                                 │
│  ┌──────────────────┐   ┌──────────────────────────────────┐   │
│  │  Game Board       │   │  MLDashboardPage (/admin/ml)     │   │
│  │  (existing)       │   │                                  │   │
│  │  + QValue overlay │   │  ModelList │ TrainingForm        │   │
│  │  + confidence     │   │  LiveProgressPanel              │   │
│  │    indicator      │   │  Charts (Recharts)              │   │
│  └────────┬─────────┘   └──────────────┬───────────────────┘   │
│           │ REST /ai/move               │ REST + Socket.io       │
└───────────┼─────────────────────────────┼───────────────────────┘
            │                             │
            ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Backend (Node.js)                     │
│                                                                 │
│  ┌───────────────┐   ┌──────────────────────────────────────┐  │
│  │  AI Registry  │   │  ML Routes  /api/v1/ml/*             │  │
│  │  (registry.js)│   │  (ml.js)                             │  │
│  │               │   └──────────────┬───────────────────────┘  │
│  │  minimax ──── │                  │                           │
│  │  mlImpl  ──── │──────────────────▼                           │
│  └───────────────┘   ┌──────────────────────────────────────┐  │
│                       │  MLService (mlService.js)            │  │
│                       │                                      │  │
│                       │  • CRUD (create/clone/reset/delete)  │  │
│                       │  • Training loop orchestration       │  │
│                       │  • In-memory Q-table/weight cache    │  │
│                       │    Map<modelId, AlgorithmInstance>   │  │
│                       │  • Cancelled sessions Set            │  │
│                       │  • Checkpoint scheduler              │  │
│                       │  • Socket.io progress emitter        │  │
│                       └──────────┬──────────┬───────────────┘  │
│                                  │          │                   │
│              ┌───────────────────▼──┐  ┌────▼─────────────┐    │
│              │  Algorithm Engines   │  │  Socket.io        │    │
│              │                      │  │  (socketHandler)  │    │
│              │  qLearning.js        │  │                   │    │
│              │  sarsa.js            │  │  room:            │    │
│              │  monteCarlo.js       │  │  ml:session:{id}  │    │
│              │  policyGradient.js   │  │                   │    │
│              │  dqn.js              │  │  ml:progress      │    │
│              │  alphaZero.js        │  │  ml:complete      │    │
│              │  neuralNet.js        │  │  ml:error         │    │
│              └──────────────────────┘  └───────────────────┘    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Prisma ORM                                              │  │
│  │  MLModel │ TrainingSession │ TrainingEpisode             │  │
│  │  MLCheckpoint │ MLBenchmarkResult │ MLEloHistory         │  │
│  │  MLTournament │ MLPlayerProfile                          │  │
│  └───────────────────────────────┬──────────────────────────┘  │
└──────────────────────────────────┼─────────────────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  PostgreSQL (Docker / │
                        │  AWS RDS in prod)     │
                        └──────────────────────┘
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| MLService | `backend/src/services/mlService.js` | Orchestrates training sessions, manages in-memory cache, emits Socket.io events |
| QLearningEngine | `backend/src/ai/qLearning.js` | Stateful class: holds Q-table, exposes `runEpisode()`, `chooseAction()`, `update()` |
| SarsaEngine | `backend/src/ai/sarsa.js` | On-policy variant; same interface as QLearningEngine |
| MonteCarloEngine | `backend/src/ai/monteCarlo.js` | Episode-buffered updates; no bootstrapping |
| PolicyGradientEngine | `backend/src/ai/policyGradient.js` | Softmax policy over state-action weights |
| DQNEngine | `backend/src/ai/dqn.js` | Neural network + replay buffer + target network |
| AlphaZeroEngine | `backend/src/ai/alphaZero.js` | MCTS + value/policy networks |
| NeuralNet | `backend/src/ai/neuralNet.js` | Pure-JS 3-layer network; forward pass + backprop |
| MLImplementation | `backend/src/ai/mlImplementation.js` | Adapter registered in AI Registry; async `move()` reads from in-memory cache |
| ML Routes | `backend/src/routes/ml.js` | REST endpoints; delegates to MLService |
| socketHandler | `backend/src/realtime/socketHandler.js` | Adds `ml:watch` / `ml:unwatch` handlers |
| MLDashboardPage | `frontend/src/pages/MLDashboardPage.jsx` | Admin dashboard; two-panel layout |

---

## 3. Database Schema

All new models are appended to `backend/prisma/schema.prisma`. New enums are listed first to satisfy Prisma's forward-reference requirement.

### New Enums

```prisma
enum MLAlgorithm {
  Q_LEARNING
  SARSA
  MONTE_CARLO
  POLICY_GRADIENT
  DQN
  ALPHA_ZERO
}

enum MLModelStatus {
  IDLE
  TRAINING
}

enum TrainingMode {
  SELF_PLAY
  VS_MINIMAX
  VS_HUMAN
}

enum SessionStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum EpisodeOutcome {
  WIN
  LOSS
  DRAW
}
```

### MLModel

Central record for a named model. The `qtable` Json column holds algorithm-specific weights (Q-table for tabular methods, network weights for DQN/AlphaZero). The `config` Json column holds hyperparameters.

```prisma
model MLModel {
  id            String        @id @default(cuid())
  name          String
  description   String?
  algorithm     MLAlgorithm
  qtable        Json          @default("{}")
  config        Json          @default("{}")
  status        MLModelStatus @default(IDLE)
  totalEpisodes Int           @default(0)
  eloRating     Float         @default(1000)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  sessions     TrainingSession[]
  checkpoints  MLCheckpoint[]
  benchmarks   MLBenchmarkResult[]
  eloHistory   MLEloHistory[]

  @@map("ml_models")
}
```

### TrainingSession

One training run. `config` captures the hyperparameters and mode settings active at the time so historical sessions remain reproducible. `summary` is written at completion (overall win/draw/loss totals, final epsilon, convergence).

```prisma
model TrainingSession {
  id            String        @id @default(cuid())
  modelId       String
  mode          TrainingMode
  iterations    Int
  status        SessionStatus @default(PENDING)
  config        Json
  summary       Json?
  startedAt     DateTime      @default(now())
  completedAt   DateTime?

  model    MLModel          @relation(fields: [modelId], references: [id], onDelete: Cascade)
  episodes TrainingEpisode[]

  @@index([modelId])
  @@index([status])
  @@map("training_sessions")
}
```

### TrainingEpisode

One game played during training. Written in batches of 50 via `createMany` to avoid per-episode DB round trips. `avgQDelta` measures convergence: the mean absolute change in Q-values updated during the episode.

```prisma
model TrainingEpisode {
  id         String         @id @default(cuid())
  sessionId  String
  episodeNum Int
  outcome    EpisodeOutcome
  totalMoves Int
  avgQDelta  Float
  epsilon    Float
  durationMs Int

  session TrainingSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([sessionId, episodeNum])
  @@map("training_episodes")
}
```

### MLCheckpoint

Immutable snapshot of model weights at a given episode count. Enables rollback and before/after Q-table diffs.

```prisma
model MLCheckpoint {
  id         String   @id @default(cuid())
  modelId    String
  episodeNum Int
  qtable     Json
  epsilon    Float
  eloRating  Float
  createdAt  DateTime @default(now())

  model MLModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@index([modelId])
  @@map("ml_checkpoints")
}
```

### MLBenchmarkResult

Results of a standardized 1,000-game benchmark per opponent type. Each `vsX` Json field holds `{ wins, losses, draws, winRate }`. `summary` holds aggregate stats and statistical significance flags.

```prisma
model MLBenchmarkResult {
  id       String   @id @default(cuid())
  modelId  String
  runAt    DateTime @default(now())
  vsRandom Json
  vsEasy   Json
  vsMedium Json
  vsHard   Json
  summary  Json

  model MLModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@index([modelId])
  @@map("ml_benchmark_results")
}
```

### MLEloHistory

Append-only log of ELO changes. `opponentId` is null when the opponent is a Minimax difficulty or random player.

```prisma
model MLEloHistory {
  id           String   @id @default(cuid())
  modelId      String
  eloRating    Float
  delta        Float
  opponentId   String?
  opponentType String
  outcome      EpisodeOutcome
  recordedAt   DateTime @default(now())

  model MLModel @relation(fields: [modelId], references: [id], onDelete: Cascade)

  @@index([modelId])
  @@map("ml_elo_history")
}
```

### MLTournament

A round-robin event across all active models (and optionally Minimax difficulties). `config` specifies participants and games-per-pair. `results` is a serialized ranking table written at completion.

```prisma
model MLTournament {
  id          String        @id @default(cuid())
  status      SessionStatus @default(PENDING)
  config      Json
  results     Json?
  startedAt   DateTime      @default(now())
  completedAt DateTime?

  @@map("ml_tournaments")
}
```

### MLPlayerProfile

Per-user behavioral model. `movePatterns` maps board-state keys to observed move frequencies. `openingPreferences` ranks first-move cells by frequency. `tendencies` holds derived statistics (e.g., aggression score, blocking rate).

```prisma
model MLPlayerProfile {
  id                 String   @id @default(cuid())
  userId             String   @unique
  movePatterns       Json     @default("{}")
  openingPreferences Json     @default("{}")
  tendencies         Json     @default("{}")
  gamesRecorded      Int      @default(0)
  updatedAt          DateTime @updatedAt

  @@map("ml_player_profiles")
}
```

---

## 4. Algorithm Design

### Shared Conventions

**State representation:** The board is encoded as a 9-character string. Each cell is mapped: `null → '.'`, `'X' → 'X'`, `'O' → 'O'`. Example: `"X.O.X.O.."`. This string is the Q-table key.

**Action space:** Integer indices 0–8 corresponding to board cells. Only legal (empty) moves are considered during action selection and updates.

**Reward structure:**

| Event | Reward |
|-------|--------|
| Win | +1.0 |
| Loss | −1.0 |
| Draw | +0.5 |
| Per step (non-terminal) | 0.0 |

**Epsilon-greedy exploration:** All tabular methods use ε-greedy action selection. With probability ε, choose a random legal move; otherwise choose `argmax Q(s, a)` over legal moves.

---

### 4.1 Q-Learning

**Concept:** Off-policy temporal-difference learning. The agent updates toward the best possible future value regardless of the policy used to collect data.

**Update rule:**

```
Q(s,a) ← Q(s,a) + α [ r + γ · max_{a'} Q(s',a') − Q(s,a) ]
```

Where:
- `α` = learning rate (default 0.3)
- `γ` = discount factor (default 0.9)
- `r` = immediate reward
- `s'` = next state after taking action `a`
- `max_{a'} Q(s',a')` = best Q-value over legal moves in `s'` (0.0 if terminal)

**Config parameters:**

```json
{
  "learningRate": 0.3,
  "discountFactor": 0.9,
  "epsilonStart": 1.0,
  "epsilonDecay": 0.995,
  "epsilonMin": 0.05
}
```

**Storage format (`qtable` Json field):**

```json
{
  "X.O.X.O..": [0.0, 0.0, 0.72, 0.0, 0.91, 0.0, 0.0, 0.0, 0.35],
  "...X.O...": [0.12, 0.0, ...]
}
```

Each key is a 9-char state string. The value is a 9-element array of Q-values indexed by cell position. Cells occupied by a piece retain their stored value but are never selected during action choice.

---

### 4.2 SARSA

**Concept:** On-policy TD learning. The update uses the actual next action `a'` chosen by the current policy rather than the greedy max, making it more conservative in risky positions.

**Update rule:**

```
Q(s,a) ← Q(s,a) + α [ r + γ · Q(s',a') − Q(s,a) ]
```

Where `a'` is the action that was actually taken in state `s'` (sampled from the ε-greedy policy), not the greedy best.

**Config parameters:** identical to Q-Learning.

**Storage format:** identical to Q-Learning — same `{ stateKey: [q0..q8] }` structure.

**Behavioral difference from Q-Learning:** SARSA tends to avoid states that lead to risky exploratory moves during training. For a solved game like tic-tac-toe the practical difference is small but measurable in early training.

---

### 4.3 Monte Carlo

**Concept:** Episode-based updates. No bootstrapping — the agent plays a full game to completion, then propagates the actual discounted return backward through every state-action pair visited.

**Return calculation:**

```
G_t = Σ_{k=0}^{T-t-1} γ^k · r_{t+k+1}
```

For tic-tac-toe with a single terminal reward, this simplifies to `G_t = γ^(T-t) · r_T` for each time step `t`.

**Update rule (every-visit MC):**

```
Q(s,a) ← Q(s,a) + α [ G_t − Q(s,a) ]
```

Applied once per `(s,a)` visit per episode (every-visit variant; first-visit also supported via config).

**Config parameters:**

```json
{
  "learningRate": 0.3,
  "discountFactor": 0.9,
  "epsilonStart": 1.0,
  "epsilonDecay": 0.995,
  "epsilonMin": 0.05,
  "firstVisitOnly": false
}
```

**Storage format:** identical to Q-Learning.

**Note:** MC requires storing the full episode trajectory before any update occurs. Memory usage is bounded at 9 moves per episode.

---

### 4.4 Policy Gradient (REINFORCE)

**Concept:** Directly parameterizes a stochastic policy π_θ(a|s) as a softmax distribution over learned weights. Gradient ascent on expected return.

**Policy:**

```
π_θ(a|s) = exp(θ_{s,a} / τ) / Σ_{a'} exp(θ_{s,a'} / τ)
```

Where `τ` is the softmax temperature (default 1.0).

**Update rule:**

```
θ_{s,a} ← θ_{s,a} + α · ∇_θ log π_θ(a|s) · G_t
         = θ_{s,a} + α · G_t · (1 − π_θ(a|s))   for the chosen action
         = θ_{s,a} − α · G_t · π_θ(a|s)          for all other legal actions
```

**Config parameters:**

```json
{
  "learningRate": 0.01,
  "discountFactor": 0.99,
  "temperature": 1.0,
  "epsilonStart": 0.0,
  "epsilonDecay": 1.0,
  "epsilonMin": 0.0
}
```

Policy Gradient does not use epsilon-greedy; exploration is inherent in the stochastic policy. The epsilon fields are set to zero but kept for interface consistency.

**Storage format (`qtable` field used as policy weights):**

```json
{
  "X.O.X.O..": [0.0, 0.0, 1.42, 0.0, 2.17, 0.0, 0.0, 0.0, 0.88]
}
```

Same structure as Q-Learning; values are raw logits (pre-softmax weights) rather than Q-values.

---

### 4.5 Deep Q-Network (DQN)

**Concept:** Replaces the Q-table with a small neural network `Q(s; w)`. Stabilized by two techniques: an experience replay buffer (breaks temporal correlations in training data) and a separate target network whose weights lag behind the online network (prevents oscillation in targets).

**Network architecture:**

```
Input layer:   9 neurons  (board state, encoded as +1/−1/0 per cell)
Hidden layer:  64 neurons (ReLU activation)
Hidden layer:  64 neurons (ReLU activation)
Output layer:  9 neurons  (one Q-value per cell; linear activation)
```

**State encoding:** Each cell is encoded as `+1` (ML player's mark), `−1` (opponent's mark), or `0` (empty).

**Loss function:**

```
L(w) = E[ (r + γ · max_{a'} Q(s',a'; w⁻) − Q(s,a; w))² ]
```

Where `w⁻` are the frozen target network weights.

**Config parameters:**

```json
{
  "learningRate": 0.001,
  "discountFactor": 0.99,
  "epsilonStart": 1.0,
  "epsilonDecay": 0.995,
  "epsilonMin": 0.05,
  "batchSize": 32,
  "replayBufferSize": 10000,
  "targetUpdateFrequency": 100
}
```

**Storage format (`qtable` field holds serialized network weights):**

```json
{
  "layers": [
    { "weights": [[...9 values...], ...64 rows], "biases": [...64 values] },
    { "weights": [[...64 values...], ...64 rows], "biases": [...64 values] },
    { "weights": [[...64 values...], ...9 rows],  "biases": [...9 values]  }
  ],
  "targetLayers": [ ... same structure ... ]
}
```

Total parameter count: (9×64) + 64 + (64×64) + 64 + (64×9) + 9 = 5,833 floats ≈ 47 KB as JSON.

---

### 4.6 AlphaZero-Style

**Concept:** Monte Carlo Tree Search (MCTS) guided by two neural networks: a value network `v(s)` predicting win probability from board state `s`, and a policy network `π(s)` predicting a probability distribution over moves. Trained exclusively by self-play.

**MCTS integration:**

Each MCTS simulation selects actions using the PUCT formula:

```
a* = argmax_a [ Q(s,a) + c_puct · π(s,a) · √N(s) / (1 + N(s,a)) ]
```

Where `N(s,a)` is the visit count for action `a` from state `s`, `N(s)` is the total visit count for state `s`, and `c_puct` is an exploration constant (default 1.0).

**Network architectures:**

- **Value network:** 9 → 64 → 32 → 1 (sigmoid output: win probability [0,1])
- **Policy network:** 9 → 64 → 32 → 9 (softmax output: move probabilities)

**Config parameters:**

```json
{
  "learningRate": 0.001,
  "discountFactor": 1.0,
  "numSimulations": 100,
  "cPuct": 1.0,
  "temperature": 1.0,
  "trainingMode": "SELF_PLAY"
}
```

AlphaZero-style models only support `SELF_PLAY` training mode.

**Storage format (`qtable` field):**

```json
{
  "valueNetwork": {
    "layers": [ ... weight matrices ... ]
  },
  "policyNetwork": {
    "layers": [ ... weight matrices ... ]
  }
}
```

---

## 5. Training Service Design

### Module

`backend/src/services/mlService.js`

### In-Memory Cache

```js
const modelCache = new Map()  // modelId → AlgorithmInstance
const cancelledSessions = new Set()  // sessionId → cancel flag
const trainingQueues = new Map()  // modelId → Array<sessionId>
```

The cache holds live algorithm instances (Q-table objects or neural network instances). It is populated lazily on first access (training or gameplay move) and invalidated when a training session completes or is cancelled.

### Training Loop Structure

```
async function runTrainingSession(sessionId) {
  1. Load model + session from DB; mark session RUNNING
  2. Hydrate or create AlgorithmInstance from model.qtable
  3. Restore epsilon: ε = max(εMin, εStart × decay^totalEpisodes)
  4. episodeBatch = []

  for episode = 1 to iterations:
    if cancelledSessions.has(sessionId): break

    result = await algorithmInstance.runEpisode(mode, config)
    episodeBatch.push(result)

    if episodeBatch.length >= 50:
      await prisma.trainingEpisode.createMany({ data: episodeBatch })
      episodeBatch = []
      await new Promise(resolve => setImmediate(resolve))  // yield event loop

    if episode % progressInterval === 0:
      io.to(`ml:session:${sessionId}`).emit('ml:progress', stats)

    if checkpointInterval && episode % checkpointInterval === 0:
      await saveCheckpoint(modelId, episode, algorithmInstance)

    if curriculumEnabled:
      await maybeCurriculum(sessionId, episode, rollingStats)

    if earlyStopEnabled:
      if checkEarlyStop(rollingStats): break

  5. Flush remaining episodeBatch
  6. Write session summary; mark session COMPLETED
  7. Update model.totalEpisodes, model.qtable, model.status = IDLE
  8. Invalidate modelCache entry
  9. io.to(...).emit('ml:complete', summary)
  10. processNextInQueue(modelId)
}
```

**Progress interval:** `max(50, Math.floor(iterations / 20))` — at most 20 progress events per session, minimum every 50 episodes.

**Epsilon restoration:** When continuing training on a partially-trained model, epsilon is not reset to `epsilonStart`. Instead:

```
ε = max(εMin, εStart × εDecay^totalEpisodes)
```

This ensures exploration continues to decay from where it left off rather than restarting from full randomness.

### Self-Play Mode

The ML model plays both X and O. Each side's perspective is treated as a separate trajectory. After each episode, both the X-perspective and O-perspective state-action-reward sequences are used to update the Q-table. This doubles the number of Q-table updates per episode.

### VS_MINIMAX Mode

The ML model always plays as X. The Minimax engine plays as O at the configured difficulty level. Difficulty is passed to the existing `minimaxImplementation.move()` function.

### Curriculum Learning

When `curriculumLearning: true` in the session config:

1. Track a rolling window of the last 200 episode outcomes.
2. If `wins / 200 > threshold` (default 0.70), escalate minimax difficulty by one level (EASY → MEDIUM → HARD).
3. Emit `ml:curriculum_advance` event on escalation.
4. If already at HARD, curriculum is complete; training continues at HARD.

### Early Stopping

When `earlyStop: { enabled: true, windowSize: 500, minImprovement: 0.01 }` in session config:

1. Track rolling win rate over `windowSize` episodes.
2. After each full window, compare to the previous window's win rate.
3. If improvement < `minImprovement` for `patience` (default 3) consecutive windows, emit `ml:early_stop` and halt.

### Training Queue

```
trainingQueues.get(modelId) = ['session-id-2', 'session-id-3']
```

When a session completes or is cancelled, `processNextInQueue(modelId)` dequeues and starts the next pending session. Sessions in the queue have status PENDING in the DB.

### Checkpointing

A checkpoint is saved every `config.checkpointEvery` episodes (default: every 1,000 episodes if `checkpointEvery` is set). Manual checkpoints can be triggered via the API at any time while a session is running.

---

## 6. Socket.io Events

### Room Naming

Each training session has a dedicated Socket.io room: `ml:session:{sessionId}`. The frontend dashboard joins this room when viewing a session.

### Server → Client Events

All events are emitted to room `ml:session:{sessionId}`.

#### `ml:progress`

Emitted periodically during training.

```json
{
  "sessionId": "clx...",
  "episode": 1500,
  "totalEpisodes": 10000,
  "winRate": 0.623,
  "lossRate": 0.241,
  "drawRate": 0.136,
  "avgQDelta": 0.0042,
  "epsilon": 0.472,
  "outcomes": {
    "wins": 934,
    "losses": 362,
    "draws": 204
  }
}
```

#### `ml:complete`

Emitted when training finishes (naturally or via early stopping).

```json
{
  "sessionId": "clx...",
  "summary": {
    "totalEpisodes": 10000,
    "finalWinRate": 0.712,
    "finalEpsilon": 0.088,
    "finalAvgQDelta": 0.0008,
    "durationMs": 14320
  }
}
```

#### `ml:error`

Emitted on unhandled error during training.

```json
{
  "sessionId": "clx...",
  "error": "Unexpected null board state at episode 4521"
}
```

#### `ml:curriculum_advance`

Emitted when curriculum learning escalates difficulty.

```json
{
  "sessionId": "clx...",
  "fromDifficulty": "EASY",
  "toDifficulty": "MEDIUM",
  "episode": 2200,
  "rollingWinRate": 0.71
}
```

#### `ml:early_stop`

Emitted when early stopping criterion is met.

```json
{
  "sessionId": "clx...",
  "episode": 7500,
  "reason": "Win rate improvement below 0.01 for 3 consecutive windows of 500 episodes"
}
```

### Client → Server Events

#### `ml:watch`

Joins the session room to receive progress events.

```json
{ "sessionId": "clx..." }
```

Handler: `socket.join('ml:session:' + sessionId)`

#### `ml:unwatch`

Leaves the session room.

```json
{ "sessionId": "clx..." }
```

Handler: `socket.leave('ml:session:' + sessionId)`

---

## 7. API Endpoints

All endpoints are mounted under `/api/v1/ml`. Write endpoints require `requireAuth` middleware. The `requireAuth` import already exists in the codebase.

### Models

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/ml/models` | Public | List all models with name, algorithm, ELO, totalEpisodes, status |
| POST | `/ml/models` | Auth | Create a model. Body: `{ name, description?, algorithm, config? }` |
| GET | `/ml/models/:id` | Public | Model detail including config, stats, last session summary |
| PATCH | `/ml/models/:id` | Auth | Update `name`, `description`, or `config`. Body: partial fields |
| DELETE | `/ml/models/:id` | Auth | Delete model and all related records (cascade) |
| POST | `/ml/models/:id/clone` | Auth | Fork model. Body: `{ name, description? }`. Copies qtable + config |
| POST | `/ml/models/:id/reset` | Auth | Clear qtable to `{}`, reset totalEpisodes to 0, reset epsilon to epsilonStart |
| GET | `/ml/models/:id/export` | Auth | Download model as JSON (name, algorithm, config, qtable) |
| POST | `/ml/models/import` | Auth | Upload JSON export to create a new model. Body: multipart or raw JSON |
| GET | `/ml/models/:id/elo-history` | Public | ELO rating over time. Query: `?limit=100` |
| POST | `/ml/models/:id/checkpoint` | Auth | Manually trigger a checkpoint snapshot |
| GET | `/ml/models/:id/checkpoints` | Public | List all checkpoints for a model |
| POST | `/ml/models/:id/checkpoints/:cpId/restore` | Auth | Restore model qtable from checkpoint |
| GET | `/ml/models/:id/player-profiles` | Auth | List MLPlayerProfile records the model has adapted to |
| POST | `/ml/models/:id/benchmark` | Auth | Start benchmark suite as background job. Returns `{ benchmarkId }` |
| GET | `/ml/benchmark/:id` | Public | Benchmark result detail |

**Create model request body:**

```json
{
  "name": "QLearner v1",
  "description": "Baseline Q-learning run",
  "algorithm": "Q_LEARNING",
  "config": {
    "learningRate": 0.3,
    "discountFactor": 0.9,
    "epsilonStart": 1.0,
    "epsilonDecay": 0.995,
    "epsilonMin": 0.05
  }
}
```

**Model list response shape:**

```json
[
  {
    "id": "clx...",
    "name": "QLearner v1",
    "algorithm": "Q_LEARNING",
    "status": "IDLE",
    "eloRating": 1024.5,
    "totalEpisodes": 50000,
    "createdAt": "2026-03-19T10:00:00Z"
  }
]
```

### Training Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/ml/models/:id/train` | Auth | Start a training session. Body: `{ mode, iterations, config? }` |
| GET | `/ml/models/:id/sessions` | Public | List sessions for a model. Query: `?limit&offset&status` |
| GET | `/ml/sessions/:id` | Public | Session detail with summary |
| GET | `/ml/sessions/:id/episodes` | Public | Paginated episode data. Query: `?page&pageSize` |
| POST | `/ml/sessions/:id/cancel` | Auth | Cancel a running session |
| GET | `/ml/models/:id/qtable` | Auth | Export Q-table JSON directly |

**Start training request body:**

```json
{
  "mode": "VS_MINIMAX",
  "iterations": 10000,
  "config": {
    "difficulty": "EASY",
    "curriculumLearning": true,
    "curriculumThreshold": 0.70,
    "earlyStop": {
      "enabled": true,
      "windowSize": 500,
      "minImprovement": 0.01,
      "patience": 3
    },
    "checkpointEvery": 1000
  }
}
```

### Evaluation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/ml/tournament` | Public | Latest tournament results |
| POST | `/ml/tournament` | Auth | Run a new round-robin tournament. Body: `{ modelIds?, includeMinmax? }` |
| POST | `/ml/models/:id/versus/:id2` | Auth | Head-to-head: `n` games between two models. Body: `{ games: 100 }` |

---

## 8. Frontend Architecture

### New Page

`frontend/src/pages/MLDashboardPage.jsx` mounted at route `/admin/ml`.

### Navigation

The ML Dashboard link is added to the admin section of the desktop sidebar, alongside the existing AI and Logs links. On mobile it is accessible via the admin menu (not a primary tab — admin tools are secondary navigation).

### Layout

**Desktop (≥768px):** Two-panel layout. Left panel (280px): model list with create/import actions. Right panel: model detail view with tabs.

**Mobile (<768px):** Single-column. Model list collapses to a select dropdown at the top; detail view renders below.

### Tab Structure (Model Detail)

| Tab | Contents |
|-----|----------|
| Train | Training form, live progress panel, queue management |
| Analytics | Session selector, win-rate chart, convergence chart, ELO chart, opening book |
| Evaluation | Benchmark scorecard, head-to-head table, tournament results |
| Explainability | Board input → Q-value heatmap, before/after diff viewer, decision confidence chart |
| Data | Episode table with search/filter, CSV export buttons |
| Settings | Config editor (hyperparameters), model metadata, danger zone (reset/delete) |

### Socket.io Integration

The dashboard reuses the existing `getSocket()` singleton from `frontend/src/lib/socket.js`. ML-specific event listeners are registered in a `useEffect` on component mount and cleaned up on unmount.

```js
useEffect(() => {
  const socket = getSocket()
  socket.emit('ml:watch', { sessionId: activeSessionId })
  socket.on('ml:progress', handleProgress)
  socket.on('ml:complete', handleComplete)
  socket.on('ml:error', handleError)
  socket.on('ml:curriculum_advance', handleCurriculum)
  socket.on('ml:early_stop', handleEarlyStop)
  return () => {
    socket.emit('ml:unwatch', { sessionId: activeSessionId })
    socket.off('ml:progress', handleProgress)
    // ...
  }
}, [activeSessionId])
```

### State Management

Local `useState` is sufficient — the ML dashboard is self-contained and its state does not need to be shared with other pages. No Zustand store additions are required.

### Charts Library

Recharts is already installed. The following chart components are used:

- `<LineChart>` — win rate over episodes, ELO over time, epsilon decay curve
- `<AreaChart>` — win rate with confidence interval band
- `<BarChart>` — benchmark scorecard (win/draw/loss per opponent)

### Custom Components

| Component | File | Description |
|-----------|------|-------------|
| QValueHeatmap | `components/ml/QValueHeatmap.jsx` | 3×3 grid rendering Q-values as colored cells; accepts `board` + `qValues` props |
| EloChart | `components/ml/EloChart.jsx` | ELO over time with delta annotations |
| ConvergenceChart | `components/ml/ConvergenceChart.jsx` | Avg Q-delta per episode with smoothing |
| EpisodeTable | `components/ml/EpisodeTable.jsx` | Paginated sortable episode data table |
| TrainingForm | `components/ml/TrainingForm.jsx` | Mode, iterations, difficulty, curriculum, early-stop controls |
| LiveProgressPanel | `components/ml/LiveProgressPanel.jsx` | Progress bar, running counters, real-time charts |
| CheckpointList | `components/ml/CheckpointList.jsx` | Sortable list with restore and diff actions |
| BenchmarkScorecard | `components/ml/BenchmarkScorecard.jsx` | Win/draw/loss bars per opponent type |
| TournamentTable | `components/ml/TournamentTable.jsx` | Round-robin results ranking table |
| ModelCreateModal | `components/ml/ModelCreateModal.jsx` | Algorithm + config form |

---

## 9. Performance Considerations

### Q-Table Size

Tic-tac-toe has approximately 5,478 reachable board positions. Each Q-table entry holds 9 float values. At ~30 bytes per entry (JSON with key + array), a fully populated Q-table is under 200 KB. This is well within Postgres Json column limits and acceptable for in-memory caching.

### Neural Network Weights (DQN)

Parameter count: (9×64) + 64 + (64×64) + 64 + (64×9) + 9 = 5,833 floats. Two copies (online + target network) = 11,666 floats ≈ 93 KB as JSON. This is similarly well within limits.

### Event Loop Management

The training loop yields to the Node.js event loop every 50 episodes via `setImmediate`. This prevents training from blocking Socket.io message handling and HTTP request processing. A 10,000-episode session completes in roughly 1–3 seconds for tabular methods and 5–15 seconds for DQN.

### Batch Database Writes

Episode records are accumulated in memory and flushed to the DB every 50 episodes using `prisma.trainingEpisode.createMany()`. This reduces DB round trips from 10,000 per session to ~200.

### In-Memory Cache

Algorithm instances are kept in `modelCache` (Map) after first load. During gameplay, `mlImplementation.js` reads the Q-table from cache rather than the DB on every move request. Cache is invalidated at session completion and on model reset/restore.

### ELO Updates

ELO recalculation is a single arithmetic operation followed by one `prisma.mLModel.update()` call. It adds negligible latency to game completion.

### Benchmark Suite

A full benchmark (1,000 games × 4 opponent types = 4,000 games) runs as a background job triggered by POST `/ml/models/:id/benchmark`. The job completes in approximately 2–5 seconds for tabular methods and 10–20 seconds for DQN. The endpoint returns immediately with a `benchmarkId`; the dashboard polls or subscribes for completion.

---

## 10. Security & Validation

### Authentication

All write operations (create, train, cancel, reset, delete, clone, checkpoint, restore) require `requireAuth` middleware. Read endpoints (model list, session detail, episode data) are public to allow linking from external tools.

### Input Validation

- `algorithm` must be a valid `MLAlgorithm` enum value.
- `mode` must be a valid `TrainingMode` enum value.
- `iterations` is capped at 100,000 per session. Requests above this limit return HTTP 422.
- `modelId` is validated to exist before any training operation begins; returns HTTP 404 if not found.
- Config hyperparameters are validated for type (number) and reasonable range (e.g., `learningRate` must be in (0, 1]).

### Concurrency Control

Only one active training session per model is permitted at a time. Before starting a new session, `mlService` checks that `model.status !== 'TRAINING'`. If the model is already training, the new session is queued (status: PENDING) rather than rejected.

### Session Cancellation

Cancellation uses cooperative checking: the training loop checks `cancelledSessions.has(sessionId)` at the start of each 50-episode batch. Only authenticated users may cancel a session. A future version will restrict cancellation to the user who started the session.

### Data Isolation

All ML tables cascade-delete from `MLModel`, so deleting a model removes all associated sessions, episodes, checkpoints, benchmark results, and ELO history atomically via Prisma's `onDelete: Cascade`.
