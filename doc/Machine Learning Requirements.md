# Machine Learning AI — Requirements

## Overview

Add a machine learning AI bot to XO Arena as a research and experimentation platform. The ML AI runs alongside the existing Minimax engine and is selectable in normal gameplay. Multiple named models can exist simultaneously, each with its own training history, configuration, and performance record.

---

## 1. Algorithms

The system supports multiple RL algorithm types so they can be compared side-by-side:

| Algorithm | Description |
|-----------|-------------|
| **Q-Learning** | Tabular reinforcement learning. Fast, interpretable. Default. |
| **SARSA** | On-policy variant of Q-learning. More conservative updates. |
| **Monte Carlo** | Episode-based updates. No bootstrapping. |
| **Policy Gradient** | Directly optimizes a policy function. |
| **Deep Q-Network (DQN)** | Neural network replaces the Q-table. Includes experience replay and target networks. |
| **AlphaZero-style** | MCTS combined with a neural network, trained via self-play. |

Each model specifies its algorithm at creation time. Ensemble voting (combining predictions from multiple models) is also supported.

---

## 2. Model Management

- **Multiple named models** — create any number of models with a name, description, and algorithm type
- **Model cloning** — fork an existing trained model as a starting point for a new experiment
- **Reset** — clear a model's Q-table/weights back to the untrained baseline
- **Version history** — every training session acts as a checkpoint; roll back to any point
- **Import / Export** — download model weights as JSON; re-upload to restore on any instance
- **Delete** — remove a model and all associated training history

---

## 3. Training Modes

Each training session specifies a mode:

| Mode | Description |
|------|-------------|
| **Self-play** | Model plays both X and O, learning from both perspectives |
| **vs Minimax** | Model plays against the Minimax engine at a chosen difficulty |
| **vs Human** | Model learns from real games played by human users |

Additional training controls:

- **Iterations** — number of episodes per session (configurable)
- **Curriculum learning** — auto-escalate opponent difficulty (Easy → Medium → Hard) as win rate improves
- **Training queue** — schedule multiple sessions to run back-to-back unattended
- **Early stopping** — halt training when win rate plateaus over a configurable window
- **Checkpoints** — save model state every N episodes for later restoration
- **Hyperparameter search** — grid or random search over learning rate, discount factor, and epsilon decay; auto-select best config
- **Real-time adaptation** — update model weights mid-game as human moves are observed (not just after game ends)
- **Player profiling** — track per-player move patterns; model adapts its strategy to individual opponents over time

---

## 4. Configuration Parameters

Per-model configuration (with sensible defaults):

| Parameter | Description | Default |
|-----------|-------------|---------|
| `learningRate` (α) | Step size for Q-value updates | 0.3 |
| `discountFactor` (γ) | Weight of future rewards | 0.9 |
| `epsilonStart` | Initial exploration rate | 1.0 |
| `epsilonDecay` | Multiplicative decay per episode | 0.995 |
| `epsilonMin` | Minimum exploration rate | 0.05 |
| `batchSize` | For DQN experience replay | 32 |
| `replayBufferSize` | DQN replay memory capacity | 10,000 |
| `temperature` | Softmax temperature for move selection | 1.0 |

---

## 5. Evaluation & Benchmarking

- **ELO rating** — each model receives an ELO score updated after every head-to-head result
- **Benchmark suite** — one-click evaluation: 1,000 games vs each Minimax difficulty and vs random play; produces a standardized scorecard
- **Tournament mode** — round-robin across all models and Minimax difficulties; generates a full ranking table
- **Head-to-head comparison** — run any two models directly against each other and report win/draw/loss
- **Statistical significance** — flag whether a win-rate change is meaningful vs noise (p-value reported)
- **Forgetting detection** — after new training, test whether the model regressed on previously mastered scenarios

---

## 6. Explainability

- **Move explanation** — after each move, display Q-values for all legal cells and highlight the deciding factor
- **Decision confidence** — show the gap between the top Q-value and the next-best alternative
- **Q-value heatmap** — for any board position, render a 3×3 heatmap of Q-values across all cells
- **Before / after diffs** — compare Q-table snapshots from two checkpoints to visualize exactly what changed
- **Strategy visualization** — show how the model's preferences evolve across training sessions
- **Opening book analysis** — rank first-move and response patterns by win rate; display as a decision tree

---

## 7. Dashboard

A dedicated ML Dashboard page (admin) with the following sections:

### 7a. Model Management Panel
- List of all models with name, algorithm, ELO, total episodes, status badge
- Create, clone, reset, delete, import, export actions

### 7b. Training Controls
- Select model, mode, iterations, difficulty (for vs Minimax)
- Configure curriculum schedule and queue
- Start / cancel training
- Live progress during training (see §7c)

### 7c. Live Training View (real-time via WebSocket)
- Progress bar (episodes completed / total)
- Running win / draw / loss counters
- Live charts updating as training progresses:
  - Win rate over episodes (line chart with rolling average)
  - Epsilon decay curve
  - Avg Q-delta (convergence indicator)
- Current epsilon value

### 7d. Analytics (per model + session)
- Session selector and comparison
- Win rate over episodes with confidence interval band
- Learning curve with smoothing control
- Q-value convergence chart
- Move preference heatmap (average Q-values per cell)
- ELO history chart
- Forgetting detection report
- Opening book decision tree
- Head-to-head comparison table (vs all other models and Minimax difficulties)
- Tournament results table

### 7e. Explainability Panel
- Board position input → Q-value heatmap
- Move explanation for any recorded game
- Decision confidence over time (per session)
- Before/after Q-table diff viewer

### 7f. Data Table
- All training sessions with sortable columns: mode, iterations, win rate, avg Q-delta, duration, status
- Drill-down into individual episodes
- Full-text search and filter by date range, mode, outcome

### 7g. Export
- Export session data as CSV
- Export episode data as CSV
- Export Q-table / model weights as JSON
- All data also accessible via REST API (see §8)

---

## 8. API

All ML data is accessible via REST endpoints for external systems:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ml/models` | List all models |
| POST | `/api/v1/ml/models` | Create a model |
| GET | `/api/v1/ml/models/:id` | Model detail + stats |
| PATCH | `/api/v1/ml/models/:id` | Update name/description/config |
| DELETE | `/api/v1/ml/models/:id` | Delete model |
| POST | `/api/v1/ml/models/:id/clone` | Clone model |
| POST | `/api/v1/ml/models/:id/reset` | Reset to untrained baseline |
| POST | `/api/v1/ml/models/:id/train` | Start a training session |
| GET | `/api/v1/ml/models/:id/sessions` | List training sessions |
| GET | `/api/v1/ml/models/:id/qtable` | Export Q-table as JSON |
| GET | `/api/v1/ml/models/:id/benchmark` | Run benchmark suite |
| GET | `/api/v1/ml/sessions/:id` | Session detail + summary |
| GET | `/api/v1/ml/sessions/:id/episodes` | Paginated episode data |
| POST | `/api/v1/ml/sessions/:id/cancel` | Cancel running session |
| GET | `/api/v1/ml/tournament` | Latest tournament results |
| POST | `/api/v1/ml/tournament` | Run a new tournament |

---

## 9. Gameplay Integration

- ML models appear in the AI implementation selector alongside Minimax
- When a human plays against an ML model, the game outcome automatically feeds back into the model's training (if human-learning is enabled on that model)
- Move explanations are optionally shown in-game (toggled in Settings)
- Decision confidence is shown as a subtle indicator during AI turns
