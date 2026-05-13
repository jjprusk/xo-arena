---
slug: algorithm-monte-carlo
title: Monte Carlo Brain — training a Monte Carlo bot
category: training
tags: [monte-carlo, training, tabular, episode-level, brain]
status: PUBLISHED
admin_only: false
---

# Monte Carlo Brain

Monte Carlo is **the most explainable Brain**. It learns from *complete episode outcomes* rather than step-by-step updates — and its credit assignment is dead simple: every move in a winning game is credited, every move in a losing game is penalized.

## How Monte Carlo thinks

Monte Carlo (MC) is a **tabular, every-visit episode-level** method. Unlike TD methods (Q-Learning, SARSA) which update Q after each move, MC waits until the episode ends. Then it walks backward through every (state, action) pair the bot visited, propagating the **actual discounted return** from the end of the game.

Because MC uses real experienced outcomes — never estimated future values — it has **no bootstrapping bias**. The tradeoff is that updates are noisier (a single game's outcome can swing many state values) and convergence is slower than TD methods.

## Recommended settings

| UI label | Value | Notes |
|---|---|---|
| Decay schedule | **Linear** | Linear works best for MC — keep exploration wide. |
| Epsilon min | **0.05** | |
| Reset ε to 1.0 at start | **checked** | |
| Learning rate (α) | 0.2 | Hardcoded; lower than TD because MC updates are noisier. Auto-Tuner can sweep. |
| Discount factor (γ) | 0.9 | Hardcoded. Auto-Tuner can sweep. |

**Note:** Monte Carlo does not show a **Rate** field when Linear decay is selected — the decay spreads evenly across the session's episode count automatically.

## Why Linear decay for Monte Carlo

Monte Carlo benefits from staying **exploratory longer**. Each episode covers a unique trajectory (board state sequence), and MC's edge is the diversity of those trajectories. Exponential decay collapses exploration too early — many states never get visited. Linear decay keeps ε high until late in the session, broadening coverage.

## Session recipe

| Session | Episodes | Mode | Opponent | Purpose |
|---|---|---|---|---|
| 1 | 5,000 | Self-play | — | Wide exploration — many unique trajectories |
| 2 | 5,000 | Self-play | — | Reinforce good trajectories |
| 3 | 3,000 | vs Minimax | Curriculum (novice → master) | Tighten strategy |

**Total: ~13,000 episodes** — about 2× Q-Learning. MC is data-hungry.

Uncheck "Reset ε to 1.0" for sessions 2 and 3.

## Expected results

| Episodes | vs Random | vs Easy | vs Hard |
|---|---|---|---|
| 2,000 | 40–55% | 15–25% | <5% |
| 6,000 | 65–75% | 45–60% | 10–20% |
| 12,000+ | 80–88% | 65–75% | 30–45% |

MC's final policy quality is often **comparable to Q-Learning at 1.5–2× the episode count** — slower but unbiased.

## Why Monte Carlo's credit assignment is cleaner

In a winning game, every (state, action) pair the bot took gets credited with `+1 × γ^(steps_to_end)`. In a losing game, every pair gets `-1 × γ^(steps_to_end)`. There's no bootstrapping ("this state is good because the next state is good because the state after that is good…") — just real, observed outcomes propagated back.

This is also why MC is **easier to explain to a human**: "the bot remembers it won from this position and from this position before it, so both positions look good." TD methods, by contrast, can be opaque because their estimates depend on other estimates.

## Tips

- **Use Linear decay** — it's the key setting for MC. Exponential decay starves later episodes of exploration diversity.
- MC is the **most data-hungry algorithm** but also the most stable in its credit assignment. If you see weird "spiky" learning curves with TD methods, MC is a good sanity check — it should converge smoothly if the problem is well-posed.
- **Self-play sessions are critical** for MC because each side's trajectories teach both perspectives.
- If you want to **understand RL fundamentals**, MC is the algorithm to debug with. The Explainability tab shows Q-values that you can correlate directly with actual game outcomes from the Sessions tab.

## When to pick Monte Carlo

- You want a **bias-free learning baseline** to compare against TD methods.
- You're **teaching or learning RL** and want the most interpretable algorithm.
- You have **time to train** — episode count budget isn't tight.

## When to pick something else

- You want **fast convergence** — Q-Learning is 2× faster.
- You want **strong play vs Hard** — DQN or AlphaZero exceed MC's ceiling.
- You're training a **leaderboard bot** — Q-Learning at the same episode budget will win more games.

## Tabular ceiling

Like Q-Learning and SARSA, Monte Carlo is bounded by the size of its Q-table and the diversity of its trajectories. Past ~13,000 episodes you'll see diminishing returns. To break the tabular ceiling, switch to DQN or AlphaZero.
