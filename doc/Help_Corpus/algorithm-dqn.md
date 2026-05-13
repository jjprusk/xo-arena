---
slug: algorithm-dqn
title: DQN Brain — training a Deep Q-Network bot
category: training
tags: [dqn, training, neural-network, replay-buffer, brain]
status: PUBLISHED
admin_only: false
---

# DQN Brain — Deep Q-Network

DQN is your **first step into neural-network RL**. Instead of an explicit Q-table, DQN uses a small neural network to estimate Q-values — which means it can **generalize** to board states it has never exactly seen during training.

## How DQN thinks

DQN ("Deep Q-Network") is **neural-network function approximation for Q-values**. The network architecture is a small MLP — `[9 input neurons → hidden layers → 9 output neurons]` for tic-tac-toe — that takes the board state as input and outputs a Q-value for each cell.

Two key components keep DQN stable during training:

- **Experience replay buffer** — a circular memory of past `(board_state, action, reward, next_board_state, done)` tuples. Training samples random mini-batches from this buffer instead of the most recent episode. This breaks temporal correlation between consecutive experiences and stabilizes learning.
- **Target network** — a second copy of the Q-network whose weights are synced periodically. Updates use the target network for bootstrapped Q-value estimates; this prevents the "chasing your own tail" instability when a single network both produces and consumes Q estimates.

DQN runs as a **server-side training job** — unlike tabular methods which run in your browser, DQN requires more compute and is dispatched to a worker.

## DQN Train tab controls

DQN has more controls than tabular Brains:

| UI label | Default | Description | Configurable? |
|---|---|---|---|
| **Batch** | 32 | Samples per gradient step | Yes |
| **Replay buffer** | 10,000 | Experiences stored for sampling | Yes |
| **Target update** | 100 | Steps between target-network syncs | Yes |
| **Network architecture** | [32] | 1–3 hidden layers, each 8/16/32/64/128 neurons | Yes |
| **Gamma (γ)** | 0.90 | Discount factor (0.85 / 0.90 / 0.95 / 0.99) | Yes |
| Decay schedule | Exponential | Epsilon decay curve | Yes |
| Rate | 0.9999 | Per-episode decay multiplier | Yes |
| Epsilon min | 0.05 | Minimum epsilon floor | Yes |
| Reset ε to 1.0 at start | checked | Restart exploration on session boot | Yes |
| Learning rate (α) | 0.001 | Adam optimizer step size | Hardcoded |

**Architecture changes reset weights.** If you change the layer layout (e.g., `[32]` → `[64, 64]`) the Train tab shows an amber warning — existing trained weights are discarded and training restarts fresh with the new shape. The model's stored architecture is updated after the next session completes.

## Recommended settings

| UI label | Value | Notes |
|---|---|---|
| Network architecture | **[64, 64]** | Two hidden layers, 64 neurons each. Best quality/speed tradeoff for tic-tac-toe. |
| Gamma (γ) | **0.95** | Plans further ahead than the 0.90 default. |
| Decay schedule | **Exponential** | Required for multi-session DQN. |
| Rate | **0.9999** | Reaches ε≈0.05 by ~29,950 episodes across all sessions. |
| Epsilon min | **0.05** | |
| Reset ε to 1.0 at start | **checked** (session 1 only) | Uncheck for sessions 2+. |
| Batch | **32** | Default; increase to 64 for `[128, 128]` nets. |
| Replay buffer | **10,000** | Good for 30k-episode runs. |
| Target update | **100** | Default; do not lower below 50. |

## Why Exponential decay for DQN

Linear and Cosine decay spread ε from start to floor *evenly across one session's episodes* — the Rate field is hidden because the schedule doesn't need it. For a 10k-episode session starting at ε=1.0 with floor=0.05, Linear would reach the floor at episode 10,000 — leaving sessions 2–4 with no exploration at all.

**Exponential at Rate 0.9999 carries exploration smoothly across 30,000+ episodes**, which matches DQN's multi-session recipe. Use Linear or Cosine only for a one-and-done single session.

## Session recipe

The **ε start → end** column shows predicted values based on Exponential 0.9999 decay — not inputs you configure. ε start is determined by the previous session's stored end state. The only epsilon control you set is the "Reset ε to 1.0" checkbox.

| Session | Episodes | Mode | Opponent | ε start → end | Reset ε to 1.0 | Purpose |
|---|---|---|---|---|---|---|
| 1 | 10,000 | Self-play | — | 1.0 → ~0.37 | **checked** | Warm up replay buffer, learn move validity |
| 2 | 10,000 | Self-play | — | ~0.37 → ~0.14 | unchecked | Core policy learning |
| 3 | 10,000 | vs Minimax | Curriculum (novice → advanced) | ~0.14 → ~0.05 | unchecked | Strategic refinement |
| 4 | 5,000 | vs Minimax | Master | ~0.05 → ~0.05 | unchecked | Final hardening |

**Total: ~35,000 episodes.**

## Expected results

| Episodes | vs Random | vs Easy | vs Hard |
|---|---|---|---|
| 5,000 | 50–65% | 20–35% | <10% |
| 15,000 | 72–82% | 50–65% | 20–35% |
| 25,000 | 82–90% | 65–78% | 35–50% |
| 35,000+ | 88–93% | 75–85% | 50–65% |

DQN takes more episodes than Q-Learning but reaches a higher ceiling — neural-network generalization lets it handle positions the bot has never exactly seen.

## Understanding the replay buffer

The replay buffer is a **circular memory** storing past experiences. Each training step samples a random mini-batch from it — DQN does *not* train on the episode it just played.

**Why this matters:**

- **Breaks temporal correlation** — consecutive episodes are highly correlated (same opening, similar patterns). Random mini-batch sampling produces diverse batches, stabilizing gradient descent and preventing catastrophic forgetting.
- **Reuses rare experiences** — important positions (fork threats, game-ending states) can be revisited many times even if they're infrequent. Without the buffer, each experience is used once and discarded.

**Sizing the buffer:**

| Episodes trained | Buffer = 10,000 | Buffer = 20,000 |
|---|---|---|
| 5,000 | Buffer half full; all experiences available | Quarter full |
| 10,000 | Exactly full; oldest evicted | Holds all 10k |
| 30,000 | Only the most recent 10k kept | Most recent 20k |

A buffer **too small** for long runs means the network learns only from recent play — it can forget earlier lessons and oscillate. **Increase to 20,000–50,000 for sessions over 20,000 episodes.**

A buffer **too large** simply has empty slots early in training — harmless.

**When to tune:**

- Win rate oscillates wildly → buffer too small (increase).
- Bot forgets good moves it knew earlier → buffer too small.
- Training feels slow on a powerful machine → batch size is the knob to increase, not buffer size.

## Network architecture guide

The Train tab's layer builder lets you add 1–3 hidden layers, each 8 / 16 / 32 / 64 / 128 neurons. Changing the architecture resets weights.

| Architecture | Parameters | Training speed | Recommended for |
|---|---|---|---|
| `[32]` | ~380 | Fastest | Quick experiments |
| `[64]` | ~700 | Fast | Good single-layer baseline |
| `[64, 64]` | ~1,350 | Medium | **Best quality/speed tradeoff** |
| `[128, 64]` | ~2,700 | Slower | Diminishing returns for tic-tac-toe |

For tic-tac-toe, `[64, 64]` is the sweet spot — larger nets don't raise the ceiling, just take longer to train.

## Tips

- **Always use self-play for sessions 1–2.** Replay buffer fills faster; both X and O perspectives covered.
- **Use Exponential decay with Rate 0.9999.** Linear/Cosine decay collapses exploration within a single session, leaving subsequent sessions with no learning.
- **Minimum viable run is 15,000 episodes** — needs that many to fill and recycle the replay buffer enough for Bellman targets to stabilize.
- **If win rate is flat after 20,000 episodes**, change architecture to `[64, 64]` (weights reset, but new capacity helps more than extra episodes on a small net).
- **Use Gamma = 0.95**, not the default 0.90 — DQN can plan further ahead without instability in 9-move games.

## When to pick DQN

- You've **maxed out Q-Learning** and want to break the tabular ceiling.
- You want a bot that **generalizes** to unseen board patterns.
- You're ready to invest in **30k+ episodes** of training.

## When to pick something else

- **Small budget** — Q-Learning gets you 80% of the way for 1/5 the episodes.
- **Highest possible ceiling** — AlphaZero exceeds DQN's strength given enough wall-clock time.
- **Browser-only training** — DQN runs server-side; if you want offline-style local training, pick a tabular Brain.
