---
slug: algorithm-policy-gradient
title: Policy Gradient — training a Policy Gradient skill
category: training
tags: [policy-gradient, reinforce, training, tabular, softmax, algorithm]
status: PUBLISHED
admin_only: false
---

# Policy Gradient

Policy Gradient (PG) is the **stochastic** algorithm — its play is naturally unpredictable, making it harder for opponents (especially humans) to exploit. It learns a probability distribution over moves rather than a single "best move" per state.

## How Policy Gradient thinks

Policy Gradient uses the **REINFORCE** algorithm with a **tabular softmax policy**. Instead of learning Q-values and acting greedy, it directly learns **action preferences** θ(s, a) and samples each move from a softmax probability distribution over them.

Key difference from Q-Learning: the policy never fully "locks in" a single deterministic move. Even at inference time (when sampling is converted to selecting the highest-preference action), the learned *distribution* means PG bots can play differently against different opponents and won't be memorizable.

## Recommended settings

| UI label | Value | Notes |
|---|---|---|
| Decay schedule | **Cosine** | Smooth schedule suits PG's gradient updates. |
| Epsilon min | **0.05** | |
| Reset ε to 1.0 at start | **checked** | Controls fallback to random; PG uses softmax sampling internally. |
| Learning rate (α) | 0.01 | Hardcoded; lower than tabular default because PG is sensitive. Auto-Tuner can sweep. |
| Discount factor (γ) | 0.9 | Hardcoded. Auto-Tuner can sweep. |

**Note:** Policy Gradient does not show a **Rate** field when Cosine decay is selected.

## Why Cosine decay for Policy Gradient

PG's gradient updates can oscillate if epsilon shifts abruptly. The cosine schedule produces a smooth warmup/cooldown curve that matches REINFORCE's natural "explore broadly, then refine" lifecycle. Exponential or linear decay can introduce sharper transitions that destabilize the softmax distribution.

## Session recipe

| Session | Episodes | Mode | Opponent | Purpose |
|---|---|---|---|---|
| 1 | 5,000 | Self-play | — | Build preference distribution across states |
| 2 | 5,000 | Self-play | — | Reinforce high-return trajectories |
| 3 | 5,000 | vs Minimax | Curriculum (novice → advanced) | Sharpen vs deterministic opponent |
| 4 | 3,000 | vs Minimax | Master | Final polish |

**Total: ~18,000 episodes** — the most data-hungry tabular algorithm.

Uncheck "Reset ε to 1.0" for sessions 2–4.

## Expected results

| Episodes | vs Random | vs Easy | vs Hard |
|---|---|---|---|
| 2,000 | 35–50% | 10–20% | <5% |
| 8,000 | 60–72% | 40–55% | 10–20% |
| 15,000+ | 75–85% | 60–72% | 25–40% |

Note these are lower than Q-Learning at comparable episode counts — PG's strength is *unpredictability*, not *peak win rate against fixed opponents*.

## Why PG is unpredictable

After training, when the bot plays at inference, it picks the action with the **highest preference**. But the *distribution* of preferences across moves matters:

- A Q-Learning bot might assign Q-values like `[1.0, 0.1, 0.2, 0.0, …]` — clearly favoring one move.
- A PG bot might assign preferences like `[0.4, 0.3, 0.2, 0.1, …]` — soft preference for one but not overwhelming.

When two preferences are close, the bot can pick either depending on subtle training noise. Against the same opponent it might play differently each game. Against a human who's memorized the bot's preferred line, the bot can deviate.

This is why **PG bots make better opponents for human players** — they don't repeat themselves.

## Tips

- **Policy Gradient is the slowest tabular algorithm** but produces the most unpredictable play.
- **Learning rate is critical** — α > 0.05 causes the softmax distribution to oscillate wildly. If win rate bounces between sessions, use the Auto-Tuner to halve α.
- **Cosine decay works particularly well here** — it mirrors REINFORCE's natural lifecycle.
- The "Reset ε to 1.0" checkbox controls fallback-to-random behavior; the softmax sampling itself doesn't depend on epsilon — but the early-training warm-up does, so always check it for session 1.

## When to pick Policy Gradient

- You want a bot that's **hard to exploit** by repeat opponents.
- You're aiming for **leaderboard against humans** more than vs-Minimax benchmark scores.
- You want to **explore RL beyond Q-learning** and understand policy-based methods.

## When to pick something else

- You want **maximum win rate** vs fixed bots — Q-Learning or AlphaZero produces higher scores at lower episode counts.
- You have a **small episode budget** — PG needs ~18k episodes to reach its potential.
- You want **deterministic, reproducible play** — PG's stochasticity is a feature, not a bug, but if you need reproducibility, use Q-Learning.

## Use the Explainability tab

For PG, the Explainability tab shows **move probabilities** instead of Q-values. A well-trained PG bot will show:

- Clear high-probability moves for canonical strong openings (center, corners).
- **Spread** probability mass when multiple moves are nearly equivalent — this is the "unpredictability" signature.

If you see one move at 99% probability and all others near 0%, the bot has collapsed to deterministic play and lost its PG advantage. Lower α and run more episodes to re-spread the distribution.
