# TensorFlow.js Migration Plan

## Overview

Replace the hand-rolled `NeuralNet` (forward pass, backprop, Adam optimizer) in the
**frontend vendor AI package** with `@tensorflow/tfjs`, gaining WebGL-accelerated training
for DQN and AlphaZero models. Tabular algorithms (Q-Learning, SARSA, Monte Carlo,
Policy Gradient) are unaffected.

No existing model weights need to be migrated.

---

## Architecture Context

```
frontend/src/vendor/ai/          ← TARGET: replace NeuralNet here
  neuralNet.js                     hand-rolled MLP (forward, backward, Adam)
  dqn.js                           uses NeuralNet for online + target networks
  alphaZero.js                     uses NeuralNet for policy + value networks
  qLearning.js, sarsa.js, ...      untouched (Q-table lookups)

frontend/src/lib/mlInference.js  ← TARGET: replace inference NeuralNet here
  NeuralNet (inference-only copy)  used for in-browser move selection

packages/ai/src/neuralNet.js     ← NOT CHANGED
  backend training + evaluation    still used by mlService.js for benchmarks,
                                   bot games, and ELO evaluation
```

**Key constraint:** the backend uses `packages/ai/src/` directly and cannot use
`@tensorflow/tfjs` (would require `@tensorflow/tfjs-node` native bindings). The two
copies are independent — migrating the frontend vendor copy does not touch the backend.

**Serialization compatibility:** To keep the backend inference working without changes,
the TF.js frontend must continue reading and writing the existing DB weight format:
`{ layerSizes: number[], weights: number[][], biases: number[][] }` (weights flattened
per layer). A thin serialization adapter handles this. No DB schema changes required.

---

## What Changes / What Doesn't

| Component | Change |
|-----------|--------|
| `frontend/src/vendor/ai/neuralNet.js` | Replaced with TF.js wrapper |
| `frontend/src/vendor/ai/dqn.js` | Network operations → TF.js; replay buffer, epsilon logic unchanged |
| `frontend/src/vendor/ai/alphaZero.js` | Network operations → TF.js; MCTS logic unchanged |
| `frontend/src/lib/mlInference.js` | `NeuralNet.fromJSON` + `forward()` → `tf.loadLayersModel` + `model.predict()` |
| `frontend/src/services/trainingService.js` | No structural changes; episode runners unchanged |
| `packages/ai/src/` (backend) | **No changes** |
| DB schema | **No changes** |
| Backend routes | **No changes** |
| Tabular engines | **No changes** |

---

## Phases

### Phase 0 — Setup & Infrastructure (0.5 days)

**Install:**
```bash
cd frontend && npm install @tensorflow/tfjs
```

**Create `frontend/src/vendor/ai/tfUtils.js`** — shared adapter utilities:

- `createTfModel(layerSizes)` — builds a `tf.Sequential` with ReLU hidden layers and
  linear output, matching the current architecture exactly
- `weightsToTf(model, dbWeights)` — loads a DB-format weight object into a TF.js model
  via `model.setWeights([...tf.tensor2d(...)])`
- `weightsFromTf(model)` — extracts a TF.js model's weights back to DB format so the
  backend's `NeuralNet.fromJSON()` can still consume them
- `syncTargetNetwork(online, target)` — copies online weights to target without
  creating gradients (`tf.tidy` + `target.setWeights(online.getWeights())`)

**Establish memory management contract** (documented in the file):
- All inference calls wrapped in `tf.tidy()`
- Tensors held across calls (replay buffer states, model references) use `tf.keep()` 
  and are explicitly `.dispose()`d on eviction or session end
- The training loop does a `tf.memory()` assertion after every 1,000 episodes during
  development to catch leaks early

---

### Phase 1 — DQN Engine (2–3 days)

**File:** `frontend/src/vendor/ai/dqn.js`

Replace the two `NeuralNet` instances (`_online`, `_target`) with TF.js models built
via `createTfModel(layerSizes)`.

**Key change — training step:**

The current `trainStep()` manually computes the Bellman target and calls
`net.backward()` / `net.update()`. With TF.js this becomes:

```js
// Pseudocode — actual implementation uses tf.variableGrads or optimizer.minimize
const loss = optimizer.minimize(() => {
  return tf.tidy(() => {
    const qOnline = onlineModel.apply(stateBatch)        // [batch, 9]
    const qTarget = targetModel.predict(nextStateBatch)  // [batch, 9] — no gradient

    // Adversarial Bellman: nextState encoded from opponent perspective,
    // so maxNextQ is negated (current agent wants to minimise opponent's best move)
    const maxNextQ  = qTarget.max(1).neg()
    const tdTargets = rewards.add(maxNextQ.mul(1 - done).mul(gamma))

    // Only update the Q-value for the taken action
    const actionMask   = tf.oneHot(actions, 9)
    const prediction   = qOnline.mul(actionMask).sum(1)
    return tf.losses.meanSquaredError(tdTargets, prediction)
  })
}, true)
loss.dispose()
```

**Target network sync** — `syncTargetNetwork()` from `tfUtils.js`; called every
`targetUpdateFreq` steps exactly as today.

**Replay buffer** — no change to the circular buffer structure. Stored states are plain
JS arrays (not tensors) to avoid holding GPU memory across episodes. Converted to
tensors only inside `trainStep()` within `tf.tidy()`.

**Serialization:**
- `loadQTable(dbWeights)` → `weightsToTf(onlineModel, dbWeights.online)` +
  `weightsToTf(targetModel, dbWeights.target)`
- `toJSON()` → `{ online: weightsFromTf(onlineModel), target: weightsFromTf(targetModel) }`

**Dispose:**
- Add `dispose()` method: `onlineModel.dispose(); targetModel.dispose()`
- Called in `trainingService.js` when a session ends or is cancelled

**Testing milestones:**
- DQN training run of 1,000 episodes completes without error
- `tf.memory().numTensors` is stable (not growing) across 1,000 episodes
- Win rate vs. minimax matches pre-migration baseline (>60% after 5,000 episodes)
- Benchmark: wall-clock time for 1,000 episodes before vs. after

---

### Phase 2 — AlphaZero Engine (2–3 days)

**File:** `frontend/src/vendor/ai/alphaZero.js`

Replace `_policyNet` and `_valueNet` with TF.js models. Policy output uses
masked softmax (implemented in JS over `model.predict()` output); value output
uses `tanh` (set as the final layer activation).

**Key challenge — MCTS memory pressure:**

MCTS runs `numSimulations` (default 50) per move. Each simulation calls both networks.
That's 100 `model.predict()` calls per move, each allocating tensors. Without careful
cleanup, a single training episode leaks thousands of tensors.

Each network call inside `_simulate()` must be wrapped:
```js
const [policy, value] = tf.tidy(() => {
  const input = tf.tensor2d([encodeBoard(board, mark)])
  const p = policyModel.predict(input).dataSync()   // sync — needed for MCTS tree walk
  const v = valueModel.predict(input).dataSync()
  return [Array.from(p), v[0]]
})
```

`dataSync()` blocks the GPU pipeline momentarily — this is intentional here because
MCTS is inherently sequential. Alternatives (batching all MCTS evaluations) would
require restructuring the tree traversal and are out of scope.

**Performance note:** For the current `[9, 64, 32, 9]` networks, each `model.predict()`
on a `[1, 9]` input may have higher overhead than a pure-JS forward pass due to
WebGL kernel dispatch latency for tiny matrices. Benchmark this explicitly. If AlphaZero
training is slower after migration, consider keeping AlphaZero on the custom JS stack
and deferring its migration until it trains on a larger game.

**Training (policy and value loss):**

Both networks train after each self-play episode using collected `(board, policy_target,
value_target)` tuples. Use `optimizer.minimize()` with standard cross-entropy (policy)
and MSE (value) losses inside `tf.tidy()`.

**Serialization:** same pattern as DQN:
- `loadQTable({ policyNet, valueNet })` → `weightsToTf` for each
- `toJSON()` → `{ policyNet: weightsFromTf(...), valueNet: weightsFromTf(...) }`

**Testing milestones:**
- `tf.memory().numTensors` stable across a full self-play episode
- AlphaZero training run of 500 episodes completes without OOM
- Win rate benchmark matches pre-migration baseline
- Wall-clock comparison: if > 20% slower, flag for review before merging

---

### Phase 3 — Frontend Inference (1 day)

**File:** `frontend/src/lib/mlInference.js`

The inference path loads exported weights from the backend and runs forward passes for
in-game move selection. This is the path used during actual PvP / PvBot games.

**`loadModel(modelId, fetchFn)`:**
```js
const data = await fetchFn(modelId)      // existing DB format
const engine = parseModel(data)          // returns { type, tfModel(s), config }
modelCache.set(modelId, engine)
```

`parseModel()` for neural types calls `createTfModel(layerSizes)` + `weightsToTf()`.

**`getLocalMove(modelId, board, mark)`:**
```js
// DQN
return tf.tidy(() => {
  const input = tf.tensor2d([encodeBoard(board, mark)])
  const qvals = engine.model.predict(input).dataSync()
  return legalMoves.reduce((best, i) => qvals[i] > qvals[best] ? i : best, legalMoves[0])
})

// AlphaZero: same pattern with MCTS using tf.tidy per simulation call
```

**`evictModel(modelId)`:**
```js
const engine = modelCache.get(modelId)
if (engine?.dispose) engine.dispose()   // disposes TF.js model(s)
modelCache.delete(modelId)
```

**WebGL warm-up:** The first `model.predict()` call triggers WebGL context
initialization (~200–500ms). Add a silent warm-up call after `loadModel()` completes
so the latency doesn't hit the first in-game move.

---

### Phase 4 — Testing & Validation (1 day)

**Automated tests** (`frontend/src/services/__tests__/trainingService.test.js`):
- Mock TF.js with `vi.mock('@tensorflow/tfjs')` — tests should not require WebGL
- Assert engine construction, serialization round-trip, and session completion
- Assert `tf.memory().numTensors` returns to baseline after training + dispose

**Manual benchmarks** (record results in this doc):

| Metric | Baseline | Post-migration | Target |
|--------|----------|----------------|--------|
| DQN 1,000 episodes (ms) | TBD | TBD | ≤ baseline |
| AlphaZero 500 episodes (ms) | TBD | TBD | ≤ +20% |
| Frontend bundle (gzipped KB) | TBD | TBD | document delta |
| First-move latency after loadModel (ms) | TBD | TBD | ≤ 600ms |
| Tensor count growth per 1,000 DQN episodes | 0 | TBD | 0 |
| Tensor count growth per 100 AZ episodes | 0 | TBD | 0 |

**Win-rate regression:** run the existing benchmark suite (`api.ml.startBenchmark`)
against a freshly trained DQN and AlphaZero model. Results must be within 5% of
pre-migration baseline at equivalent episode counts.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AlphaZero slower due to per-simulation tensor overhead | Medium | Medium | Benchmark in Phase 2; keep AZ on custom stack if > 20% regression |
| `tf.tidy` leak in MCTS loop | High | High | Memory assertion after every 1,000 episodes during dev; tensor count logged |
| WebGL unavailable (headless test env, some mobile) | Low | Low | TF.js falls back to CPU backend automatically; add `await tf.setBackend('cpu')` in test setup |
| Bundle size impact unacceptable | Low | Medium | Measure in Phase 4; TF.js supports tree-shaking if only ops package is imported |
| Serialization adapter bug causes silent weight corruption | Medium | High | Round-trip test: serialize → deserialize → compare outputs on fixed input |

---

## Out of Scope

- Migrating `packages/ai/src/` (backend package) — no benefit without `@tensorflow/tfjs-node`
- Migrating tabular engines — they are dictionary lookups with no matrix operations
- Switching to `model.fit()` batch training API — DQN requires custom Bellman targets that need the lower-level gradient API
- Convolutional or attention architectures — separate feature, not part of this migration
- Moving training back to the backend

---

## Effort Summary

| Phase | Description | Effort |
|-------|-------------|--------|
| 0 | Setup, tfUtils adapter, memory contract | 0.5 days |
| 1 | DQN engine migration | 2–3 days |
| 2 | AlphaZero engine migration | 2–3 days |
| 3 | mlInference.js | 1 day |
| 4 | Testing & benchmarks | 1 day |
| **Total** | | **6–8 days** |

Phase 2 (AlphaZero) carries the most uncertainty. If the benchmark regression threshold
is breached, Phase 2 can be deferred without blocking Phases 1, 3, and 4.
