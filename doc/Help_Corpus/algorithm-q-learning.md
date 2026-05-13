---
slug: algorithm-q-learning
title: Q-Learning Brain — training a Q-Learning bot
category: training
tags: [q-learning, training, tabular, off-policy, brain]
status: PUBLISHED
admin_only: false
---

# Q-Learning Brain

Q-Learning is the **recommended starting Brain** for new bot trainers. It's fast, debuggable, and reaches a competitive policy in a few thousand episodes.

## How Q-Learning thinks

Q-Learning is **tabular, off-policy temporal-difference (TD) control**. It maintains an explicit table mapping every (board state, action) pair to a Q-value — an estimate of "how good is taking this action from this state".

After every move, Q-Learning updates the Q-value using the **best possible next action** (regardless of what's actually played next). This "off-policy" property is what makes it fast: even random exploration moves yield greedy-policy learning.

For tic-tac-toe, there are ~5,478 reachable board states. Q-Learning covers them all within a few thousand episodes.

## Recommended settings

Set these in the Train tab:

| UI label | Value | Notes |
|---|---|---|
| Decay schedule | **Exponential** | Default. Best for Q-Learning. |
| Rate | **0.995** | Reaches ε≈0.05 by ~590 episodes. |
| Epsilon min | **0.05** | 5% residual exploration after decay. |
| Reset ε to 1.0 at start | **checked** | Always start fully random in session 1. |
| Learning rate (α) | 0.3 | Hardcoded; not in UI. Auto-Tuner can sweep it. |
| Discount factor (γ) | 0.9 | Hardcoded; not in UI. Auto-Tuner can sweep it. |

## Session recipe

| Session | Episodes | Mode | Opponent | Purpose |
|---|---|---|---|---|
| 1 | 2,000 | Self-play | — | Bootstrap all states |
| 2 | 3,000 | Self-play | — | Converge Q-table |
| 3 | 2,000 | vs Minimax | Curriculum (novice → master) | Polish vs deterministic play |

**Total: ~7,000 episodes.**

For session 2, uncheck "Reset ε to 1.0" so epsilon continues decaying from where session 1 left it. Same for session 3.

## Expected results

| Episodes | vs Random | vs Easy Minimax | vs Hard Minimax |
|---|---|---|---|
| 500 | 50–60% | 20–30% | <5% |
| 2,000 | 75–85% | 50–65% | 10–20% |
| 5,000 | 85–92% | 70–80% | 30–50% |
| 8,000+ | 90–95% | 80–90% | 50–65% |

These numbers are from the platform's reference training runs and are typical for a well-configured Q-Learning bot.

## Tips

- **Self-play is ideal for session 1** because it trains both X and O perspectives simultaneously.
- **Switch to curriculum minimax** once the bot reaches ~80% vs random — strategic refinement is faster against deterministic opponents.
- **If the Q-table stalls** (win rate plateaus for 2,000+ episodes), lower α to 0.1 via the Auto-Tuner and run 2,000 more episodes. Aggressive learning rates can overwrite good values at low epsilon.
- **Q-Learning vs SARSA** — at inference time (ε=0), both algorithms become identical greedy agents. The difference is in how they explored during training. Q-Learning learns the bolder, off-policy strategy faster.

## When Q-Learning plateaus

Tabular methods like Q-Learning have a hard ceiling: once every state is well-estimated, more episodes don't help. If your Q-Learning bot caps at ~80% vs hard minimax and you want to go higher, **switch to DQN or AlphaZero** — not more Q-Learning episodes.

## Off-policy vs on-policy

- **Off-policy** (Q-Learning) — updates Q toward `max(Q(s', a'))` regardless of the action actually taken next. Learns the *greedy* policy even while exploring randomly.
- **On-policy** (SARSA) — updates Q toward `Q(s', a_actually_chosen)`. Learns the *exploration-aware* policy.

Q-Learning's off-policy nature is why it converges ~20% faster than SARSA. The tradeoff is that it can produce slightly riskier play that an exploiting opponent might punish — though in practice, at low ε, this difference disappears.

## Use the Explainability tab

After training, open the Gym → Explainability tab and load a position. For Q-Learning, you'll see the Q-value for each move. A well-trained Q-Learning bot should have clearly higher Q-values for the strongest moves (center on an empty board; blocking moves when threatened).

If the Q-values are flat across most cells, the Q-table didn't converge — try more episodes or sweep α.
