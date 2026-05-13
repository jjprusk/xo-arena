---
slug: algorithm-alphazero
title: AlphaZero Brain — training an AlphaZero bot
category: training
tags: [alphazero, mcts, training, neural-network, brain]
status: PUBLISHED
admin_only: false
---

# AlphaZero Brain

AlphaZero is the **strongest possible Brain** on AI Arena, given enough training time. It combines Monte Carlo Tree Search (MCTS) lookahead with two neural networks — and consistently produces the highest win rates against perfect minimax play.

## How AlphaZero thinks

AlphaZero uses **MCTS guided by two neural networks**:

- **Policy network** `[9 → 64 → 32 → 9]` with softmax output — predicts which move to play.
- **Value network** `[9 → 64 → 32 → 1]` with tanh output — predicts who's winning from this position.

Each move runs `numSimulations` MCTS rollouts to build a visit-count distribution over moves, then picks based on that distribution. After each episode, both networks train on the collected examples.

**Key advantages:**

- **Lookahead built-in** — MCTS considers multiple future paths before each move; not just the immediate Q-value.
- **No epsilon** — exploration is naturally handled by the PUCT formula inside the tree search. There is no "Exploration" section for AlphaZero in the Train tab.
- **Strongest ceiling** of all six Brains, with sufficient episodes.

AlphaZero runs as a **server-side training job** — episodes are slow because of the per-move MCTS rollouts.

## AlphaZero Train tab controls

| UI label | Default | Description | Configurable? |
|---|---|---|---|
| **Simulations** | 50 | MCTS rollouts per move. Higher = stronger but slower. | Yes |
| **PUCT** | 1.5 | Exploration constant in tree search. Higher = more exploration. | Yes |
| **Temperature** | 1.0 | Randomness in move selection from visit counts. | Yes |
| Learning rate (α) | 0.001 | Shared α for policy + value nets | Hardcoded |
| Discount factor (γ) | 0.99 | Future reward weighting | Hardcoded |

AlphaZero **has no epsilon** — exploration is naturally built into the PUCT tree search. There is no epsilon control in the Train tab for this Brain.

## Recommended settings

| UI label | Value | Notes |
|---|---|---|
| Simulations | **100** | Double the default for much stronger search. |
| PUCT | **1.5** | Default is good; increase to 2.0 for more exploration early. |
| Temperature | **1.0** | Reduce to 0.5 after 5,000 episodes for more decisive play. |
| Learning rate (α) | 0.001 | Hardcoded. |
| Discount factor (γ) | 0.99 | Hardcoded; higher than tabular default because AZ plans further ahead. |

## Session recipe

| Session | Episodes | Simulations | Temperature | Purpose |
|---|---|---|---|---|
| 1 | 3,000 | 50 | 1.0 | Fast bootstrap — build initial policy/value estimates |
| 2 | 5,000 | 100 | 1.0 | Deeper search, refine both nets |
| 3 | 5,000 | 100 | 0.5 | More decisive play, sharpen value net |
| 4 | 2,000 | 200 | 0.1 | Near-deterministic fine-tuning |

**Total: ~15,000 episodes.**

**AlphaZero episodes are 5–10× slower than tabular** episodes because each move runs MCTS. Plan for the longer wall-clock time.

## Expected results

| Episodes | vs Random | vs Easy | vs Hard |
|---|---|---|---|
| 1,000 | 60–72% | 35–50% | 10–20% |
| 5,000 | 78–87% | 60–75% | 35–50% |
| 10,000 | 87–93% | 75–85% | 55–70% |
| 15,000+ | 92–97% | 82–90% | 65–80% |

AlphaZero reaches competency **faster per-episode** than any other Brain because MCTS provides strong implicit lookahead from the start. The total episode count is lower, but wall-clock time is higher.

## The three knobs explained

### Simulations

The number of MCTS rollouts the bot runs **per move**. More rollouts means deeper, broader tree search and stronger play — at the cost of wall-clock time.

- **50** — default; fast enough to fill the experience buffer.
- **100** — strong middle ground; recommended for sessions 2–3.
- **200** — near-perfect search for tic-tac-toe; reserved for final fine-tuning.

Doubling Simulations roughly doubles per-episode wall-clock time.

### PUCT

The exploration constant in the **PUCT formula** that decides which child of the tree to visit next. Higher PUCT = more exploration; lower = more exploitation.

- **1.5** — balanced default.
- **2.0** — try this if the bot gets stuck in repetitive patterns early.
- **0.5–1.0** — more deterministic; suitable late in training.

### Temperature

Controls how the final move is sampled from the MCTS visit counts.

- **Temperature = 1.0** — proportional sampling (a move visited twice as often is chosen twice as often). Adds diversity.
- **Temperature = 0.5** — slight bias toward most-visited.
- **Temperature = 0.1** — almost always picks the most-visited child. Near-deterministic.

Reduce Temperature over training for sharper, more decisive policy.

## Tips

- **Self-play only.** AlphaZero is designed exclusively for self-play; it has no concept of an external opponent function.
- Start with **Simulations = 50** to fill the experience buffer quickly, then increase to 100+ as networks gain accuracy.
- AlphaZero's policy network outputs **move probabilities**, not Q-values. The Explainability tab shows these — a strong AZ bot will show clear high-probability cells for center and corner openings.
- **No epsilon controls** — the "Reset ε to 1.0" checkbox is hidden. Exploration comes from PUCT + Temperature.

## When to pick AlphaZero

- You want the **strongest possible bot**.
- You're willing to invest **wall-clock time** (sessions are slow).
- You're curious about **state-of-the-art RL** — AZ is the same algorithm family that produced superhuman Go and chess players.

## When to pick something else

- **Tight wall-clock budget** — DQN trains 5–10× faster per episode.
- **Browser-only** — AlphaZero is server-side training.
- **Maximum unpredictability vs humans** — Policy Gradient's softmax sampling is more variable than AZ's near-deterministic late-game play.

## AlphaZero vs DQN — when each wins

| Property | AlphaZero | DQN |
|---|---|---|
| Episodes to competent | 5,000–15,000 | 25,000–35,000 |
| Wall-clock per episode | Slow (MCTS) | Fast |
| Strongest ceiling | **Higher** | High |
| Generalization to new boards | Excellent (NN + MCTS) | Good (NN) |
| Browser-trainable | No | No |
| Best for tic-tac-toe? | Yes for ceiling | Yes for episode budget |

If you have hours of wall-clock time, train AlphaZero. If you have lots of episodes but limited time per episode, train DQN. Both produce strong bots.
