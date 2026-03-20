# XO Arena — ML Feature Checklist

Tracks every task from the ML Development Plan. `Done` = implementation complete. `Tested` = tests passing.

| # | Task | Done | Tested |
|---|------|------|--------|
| **ML Phase 1 — Foundation** | | | |
| ML-01 | Prisma schema — `MLAlgorithm` enum | | |
| ML-02 | Prisma schema — `MLModelStatus` enum | | |
| ML-03 | Prisma schema — `TrainingMode` enum | | |
| ML-04 | Prisma schema — `SessionStatus` enum | | |
| ML-05 | Prisma schema — `EpisodeOutcome` enum | | |
| ML-06 | Prisma schema — `MLModel` model | | |
| ML-07 | Prisma schema — `TrainingSession` model | | |
| ML-08 | Prisma schema — `TrainingEpisode` model | | |
| ML-09 | Prisma migration applied (`add_ml_foundation`) | | |
| ML-10 | `QLearningEngine` class — constructor + Q-table hydration | | |
| ML-11 | `QLearningEngine.getState()` — board → 9-char string encoding | | |
| ML-12 | `QLearningEngine.chooseAction()` — ε-greedy over legal moves | | |
| ML-13 | `QLearningEngine.update()` — Bellman update rule | | |
| ML-14 | `QLearningEngine.runEpisode()` — full game loop, returns outcome + avgQDelta | | |
| ML-15 | `QLearningEngine.serialize()` — returns plain Q-table object | | |
| ML-16 | `mlService.createModel()` | | |
| ML-17 | `mlService.getModel()` | | |
| ML-18 | `mlService.listModels()` | | |
| ML-19 | `mlService.updateModel()` | | |
| ML-20 | `mlService.deleteModel()` (cascade) | | |
| ML-21 | `mlService.resetModel()` — clear qtable, reset totalEpisodes | | |
| ML-22 | `mlService.cloneModel()` — copy qtable + config | | |
| ML-23 | `mlService.getOrHydrateEngine()` — cache load with lazy DB fallback | | |
| ML-24 | `mlService.invalidateCache()` | | |
| ML-25 | `mlService.startTrainingSession()` — create session, enqueue or run | | |
| ML-26 | `mlService.cancelSession()` — add to cancelledSessions, update DB | | |
| ML-27 | Training loop — epsilon restoration formula on continue | | |
| ML-28 | Training loop — batch episode inserts every 50 episodes | | |
| ML-29 | Training loop — setImmediate yield every 50 episodes | | |
| ML-30 | Training loop — progress emission every max(50, iterations/20) episodes | | |
| ML-31 | Training loop — SELF_PLAY mode (both X and O perspectives) | | |
| ML-32 | Training loop — VS_MINIMAX mode (ML as X, Minimax as O) | | |
| ML-33 | Training loop — session completion: update model.qtable + totalEpisodes + status | | |
| ML-34 | Training loop — emit `ml:complete` on finish | | |
| ML-35 | Training loop — emit `ml:error` on unhandled exception | | |
| ML-36 | `mlImplementation.js` — AI Registry adapter with async `move()` | | |
| ML-37 | Register `mlImplementation` in `registry.js` | | |
| ML-38 | Update AI move route to pass `modelId` + make handler async | | |
| ML-39 | ML routes — `GET /ml/models` | | |
| ML-40 | ML routes — `POST /ml/models` | | |
| ML-41 | ML routes — `GET /ml/models/:id` | | |
| ML-42 | ML routes — `PATCH /ml/models/:id` | | |
| ML-43 | ML routes — `DELETE /ml/models/:id` | | |
| ML-44 | ML routes — `POST /ml/models/:id/clone` | | |
| ML-45 | ML routes — `POST /ml/models/:id/reset` | | |
| ML-46 | ML routes — `POST /ml/models/:id/train` | | |
| ML-47 | ML routes — `GET /ml/models/:id/sessions` | | |
| ML-48 | ML routes — `GET /ml/sessions/:id` | | |
| ML-49 | ML routes — `GET /ml/sessions/:id/episodes` (paginated) | | |
| ML-50 | ML routes — `POST /ml/sessions/:id/cancel` | | |
| ML-51 | ML routes — `GET /ml/models/:id/qtable` | | |
| ML-52 | ML routes — `requireAuth` on all write endpoints | | |
| ML-53 | ML routes — iterations cap validation (max 100,000) | | |
| ML-54 | Register `/ml` route in `index.js` | | |
| ML-55 | Pass `io` instance to `mlService.init(io)` in `index.js` | | |
| ML-56 | `socketHandler.js` — `ml:watch` handler (join room) | | |
| ML-57 | `socketHandler.js` — `ml:unwatch` handler (leave room) | | |
| ML-58 | Frontend — `MLDashboardPage.jsx` two-panel layout (desktop) | | |
| ML-59 | Frontend — `MLDashboardPage.jsx` stacked layout (mobile) | | |
| ML-60 | Frontend — model list: name, algorithm, ELO, episodes, status badge | | |
| ML-61 | Frontend — `ModelCreateModal.jsx` with algorithm selector + config fields | | |
| ML-62 | Frontend — delete model with confirmation dialog | | |
| ML-63 | Frontend — reset model with confirmation dialog | | |
| ML-64 | Frontend — `TrainingForm.jsx` (mode, iterations, difficulty) | | |
| ML-65 | Frontend — `LiveProgressPanel.jsx` (progress bar, counters, epsilon display) | | |
| ML-66 | Frontend — Socket.io `ml:watch` on session start | | |
| ML-67 | Frontend — Socket.io `ml:progress` handler updates live panel | | |
| ML-68 | Frontend — Socket.io `ml:complete` handler | | |
| ML-69 | Frontend — Socket.io `ml:error` handler | | |
| ML-70 | Frontend — add ML nav link in desktop sidebar (admin section) | | |
| ML-71 | Frontend — add `/admin/ml` route in `App.jsx` | | |
| ML-72 | Frontend — `api.js` ML model CRUD methods | | |
| ML-73 | Frontend — `api.js` training session methods | | |
| ML-74 | Tests — `qLearning.test.js` unit tests (state, action, update, episode) | | |
| ML-75 | Tests — `mlService.test.js` CRUD tests | | |
| ML-76 | Tests — `ml.test.js` route integration tests (status codes, auth, validation) | | |
| **ML Phase 2 — Analytics & Explainability** | | | |
| ML-77 | Analytics tab — session selector dropdown | | |
| ML-78 | Analytics tab — win rate line chart with rolling average smoothing | | |
| ML-79 | Analytics tab — confidence interval band on win rate chart | | |
| ML-80 | Analytics tab — epsilon decay curve chart | | |
| ML-81 | Analytics tab — avg Q-delta convergence chart | | |
| ML-82 | `QValueHeatmap.jsx` — 3×3 colored grid by Q-value | | |
| ML-83 | `QValueHeatmap.jsx` — highlight chosen move cell | | |
| ML-84 | Explainability tab — board position input (click to set cells) | | |
| ML-85 | Explainability tab — Q-value heatmap from local Q-table lookup | | |
| ML-86 | Explainability tab — ranked legal moves list with Q-value labels | | |
| ML-87 | Explainability tab — decision confidence display (top Q gap) | | |
| ML-88 | In-game decision confidence — backend adds `qValues + confidence` to move response | | |
| ML-89 | In-game decision confidence — frontend confidence bar (Settings-gated) | | |
| ML-90 | Analytics tab — session comparison overlay (two sessions on same axes) | | |
| ML-91 | Backend — `GET /ml/models/:id/opening-book` endpoint | | |
| ML-92 | Analytics tab — opening book annotated 3×3 board | | |
| ML-93 | Data tab — "Export sessions CSV" button + backend `format=csv` support | | |
| ML-94 | Data tab — "Export episodes CSV" button + backend `format=csv` support | | |
| ML-95 | Data tab — "Export Q-table JSON" button | | |
| **ML Phase 3 — Model Management & Versioning** | | | |
| ML-96 | Prisma schema — `MLCheckpoint` model | | |
| ML-97 | Prisma migration applied (`add_ml_checkpoints`) | | |
| ML-98 | Training loop — save checkpoint every `checkpointEvery` episodes | | |
| ML-99 | ML routes — `POST /ml/models/:id/checkpoint` (manual trigger) | | |
| ML-100 | ML routes — `GET /ml/models/:id/checkpoints` | | |
| ML-101 | ML routes — `POST /ml/models/:id/checkpoints/:cpId/restore` | | |
| ML-102 | `CheckpointList.jsx` — sortable list in Settings tab | | |
| ML-103 | Checkpoint restore UI — restore button + confirmation dialog | | |
| ML-104 | Clone model UI — "Clone" button opens modal | | |
| ML-105 | Backend — `GET /ml/models/:id/export` JSON download | | |
| ML-106 | Backend — `POST /ml/models/import` from JSON body | | |
| ML-107 | Frontend — export model button (file download) | | |
| ML-108 | Frontend — import model button (file picker + upload) | | |
| ML-109 | Explainability tab — checkpoint diff viewer (two Q-table selectors) | | |
| ML-110 | Explainability tab — Q-value delta histogram chart | | |
| ML-111 | Explainability tab — top 20 changed states as before/after heatmap pairs | | |
| **ML Phase 4 — Evaluation & Benchmarking** | | | |
| ML-112 | Prisma schema — `MLEloHistory` model | | |
| ML-113 | Prisma schema — `MLBenchmarkResult` model | | |
| ML-114 | Prisma schema — `MLTournament` model | | |
| ML-115 | Prisma migration applied (`add_ml_evaluation`) | | |
| ML-116 | `updateElo()` function — standard ELO formula (K=32) | | |
| ML-117 | ELO update on head-to-head game completion | | |
| ML-118 | Backend — `GET /ml/models/:id/elo-history` endpoint | | |
| ML-119 | `EloChart.jsx` — ELO over time with delta annotations | | |
| ML-120 | Backend — `POST /ml/models/:id/benchmark` background job | | |
| ML-121 | Backend — `GET /ml/benchmark/:id` result endpoint | | |
| ML-122 | Benchmark job — 1,000 games vs random, easy, medium, hard | | |
| ML-123 | Benchmark job — emit `ml:benchmark_complete` on finish | | |
| ML-124 | `BenchmarkScorecard.jsx` — win/draw/loss grouped bar chart | | |
| ML-125 | Benchmark UI — "Run benchmark" button + last-run timestamp | | |
| ML-126 | Backend — `POST /ml/models/:id/versus/:id2` head-to-head endpoint | | |
| ML-127 | Head-to-head — ELO update for both models after run | | |
| ML-128 | Evaluation tab — head-to-head panel with model selector | | |
| ML-129 | Backend — `POST /ml/tournament` round-robin runner | | |
| ML-130 | Backend — `GET /ml/tournament` latest results endpoint | | |
| ML-131 | `TournamentTable.jsx` — sortable ranking table | | |
| ML-132 | Statistical significance — two-proportion z-test + p-value in benchmark/head-to-head response | | |
| ML-133 | Frontend — p-value "not significant" warning badge | | |
| ML-134 | Forgetting detection — mini-benchmark after each training session | | |
| ML-135 | Forgetting detection — emit `ml:regression_detected` + model card warning badge | | |
| **ML Phase 5 — Advanced Training** | | | |
| ML-136 | `SarsaEngine` class — on-policy update using actual next action | | |
| ML-137 | `SarsaEngine.runEpisode()` — carry forward chosen action to next step | | |
| ML-138 | Tests — `sarsa.test.js` unit tests | | |
| ML-139 | `MonteCarloEngine` class — episode trajectory buffer | | |
| ML-140 | `MonteCarloEngine.runEpisode()` — backward return propagation | | |
| ML-141 | `MonteCarloEngine` — first-visit vs every-visit config flag | | |
| ML-142 | Tests — `monteCarlo.test.js` unit tests | | |
| ML-143 | Curriculum learning — rolling window win rate tracking | | |
| ML-144 | Curriculum learning — auto-escalate difficulty on threshold breach | | |
| ML-145 | Curriculum learning — emit `ml:curriculum_advance` event | | |
| ML-146 | Frontend — curriculum progress badge in Live Progress Panel | | |
| ML-147 | Frontend — Socket.io `ml:curriculum_advance` handler | | |
| ML-148 | Early stopping — per-window win rate history + patience counter | | |
| ML-149 | Early stopping — emit `ml:early_stop` and halt loop | | |
| ML-150 | Frontend — Socket.io `ml:early_stop` handler + session summary display | | |
| ML-151 | Training queue — full queue management in `mlService.js` | | |
| ML-152 | Training queue — `processNextInQueue()` called on session end/cancel | | |
| ML-153 | Training form — queue display (pending sessions list) | | |
| ML-154 | Training form — cancel queued session button | | |
| ML-155 | Hyperparameter search — config space parsing + combination generation | | |
| ML-156 | Hyperparameter search — mini training sessions per config | | |
| ML-157 | Hyperparameter search — best config selection + full training start | | |
| ML-158 | Frontend — hyperparameter search UI in Training form | | |
| ML-159 | `PolicyGradientEngine` class — softmax policy + sampling | | |
| ML-160 | `PolicyGradientEngine.runEpisode()` — trajectory collection + REINFORCE update | | |
| ML-161 | Tests — `policyGradient.test.js` unit tests | | |
| **ML Phase 6 — Deep Learning** | | | |
| ML-162 | `NeuralNet` class — configurable layer sizes, weight initialization | | |
| ML-163 | `NeuralNet.forward()` — forward pass with ReLU/linear/sigmoid/softmax activations | | |
| ML-164 | `NeuralNet.backward()` — backpropagation with gradient accumulation | | |
| ML-165 | `NeuralNet.update()` — SGD weight update | | |
| ML-166 | `NeuralNet.serialize()` / `NeuralNet.fromJSON()` | | |
| ML-167 | Tests — `neuralNet.test.js` (forward pass correctness, gradient check) | | |
| ML-168 | `DQNEngine` class — online + target network instances | | |
| ML-169 | `DQNEngine` — experience replay buffer (circular array) | | |
| ML-170 | `DQNEngine.runEpisode()` — interact, push to buffer, sample batch, backprop | | |
| ML-171 | `DQNEngine` — target network copy every `targetUpdateFrequency` episodes | | |
| ML-172 | `DQNEngine.serialize()` — both network weight arrays | | |
| ML-173 | Tests — `dqn.test.js` unit tests | | |
| ML-174 | Frontend — DQN-specific config fields in Training form | | |
| ML-175 | `AlphaZeroEngine` class — value network + policy network | | |
| ML-176 | `AlphaZeroEngine` — MCTS with PUCT selection formula | | |
| ML-177 | `AlphaZeroEngine.runEpisode()` — self-play game + network training | | |
| ML-178 | `AlphaZeroEngine.serialize()` — both network weight arrays | | |
| ML-179 | Tests — `alphaZero.test.js` unit tests | | |
| ML-180 | Backend — `POST /ml/models/ensemble` virtual ensemble resolver | | |
| ML-181 | Ensemble — majority vote and weighted average Q-value modes | | |
| ML-182 | Frontend — ensemble creator UI (multi-model select + method toggle) | | |
| ML-183 | Backend — `POST /ml/models/:id/explain` network activation endpoint | | |
| ML-184 | Frontend — neural network visualizer panel in Explainability tab | | |
| **ML Phase 7 — Human Learning & Player Profiling** | | | |
| ML-185 | Prisma schema — `MLPlayerProfile` model | | |
| ML-186 | Prisma migration applied (`add_ml_player_profiles`) | | |
| ML-187 | Profile builder — record move patterns from VS_HUMAN games | | |
| ML-188 | Profile builder — update openingPreferences (first 2 moves) | | |
| ML-189 | Profile builder — compute and update tendencies (blocking rate etc.) | | |
| ML-190 | Profile builder — increment gamesRecorded on game end | | |
| ML-191 | Profile builder — async (non-blocking hot path) | | |
| ML-192 | Per-player Q-value adaptation — load profile on move request | | |
| ML-193 | Per-player Q-value adaptation — bias Q-values by player move frequencies | | |
| ML-194 | Per-player adaptation — `profileWeight` (λ) configurable per model | | |
| ML-195 | Real-time adaptation — heuristic reward on each human move | | |
| ML-196 | Real-time adaptation — in-memory Q-table update mid-game | | |
| ML-197 | Real-time adaptation — persist updated Q-table at game end | | |
| ML-198 | Backend — `GET /ml/models/:id/player-profiles` endpoint | | |
| ML-199 | Evaluation tab — Player Profiles sub-section (list + per-player stats) | | |
| ML-200 | Evaluation tab — per-player win rate computed from game history | | |
| ML-201 | Explainability tab — "Opponent model" panel with player selector | | |
| ML-202 | Explainability tab — Q-value shift heatmap (base vs adapted) | | |
