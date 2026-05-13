---
slug: algorithm-sarsa
title: SARSA Brain — training a SARSA bot
category: training
tags: [sarsa, training, tabular, on-policy, brain]
status: PUBLISHED
admin_only: false
---

# SARSA Brain

SARSA is Q-Learning's **conservative cousin**. Same tabular state-action representation, same overall pipeline — but updates Q using the action that *will actually be taken next*, not the max-value action. This produces a safer, less exploitable policy.

## How SARSA thinks

SARSA is **tabular, on-policy temporal-difference (TD) control**. The acronym stands for State-Action-Reward-State-Action — five components of each update.

After each move, SARSA updates Q toward `Q(s', a')` where `a'` is whatever action the bot actually picks next (which may be a random exploration move if ε is high). Because exploration noise affects the update, SARSA learns to *account for its own randomness*. This makes it cautious in early training and converges ~20% slower than Q-Learning.

The result: a policy that prefers draws over risky wins. Strong if you want a bot that's hard to exploit; weaker if you want raw win rate against fixed opponents.

## Recommended settings

| UI label | Value | Notes |
|---|---|---|
| Decay schedule | **Exponential** | Default. |
| Rate | **0.995** | Same as Q-Learning. |
| Epsilon min | **0.05** | Keep slightly higher than Q-Learning if needed; some setups use 0.08. |
| Reset ε to 1.0 at start | **checked** | Always start fully random in session 1. |
| Learning rate (α) | 0.3 | Hardcoded. Auto-Tuner can sweep it. |
| Discount factor (γ) | 0.9 | Hardcoded. Auto-Tuner can sweep it. |

## Session recipe

| Session | Episodes | Mode | Opponent | Purpose |
|---|---|---|---|---|
| 1 | 3,000 | Self-play | — | Explore all states under SARSA's cautious policy |
| 2 | 3,000 | Self-play | — | Converge |
| 3 | 2,000 | vs Minimax | Curriculum (novice → master) | Polish |

**Total: ~8,000 episodes** — about 1,000 more than Q-Learning because of slower convergence.

Uncheck "Reset ε to 1.0" for sessions 2 and 3.

## Expected results

| Episodes | vs Random | vs Easy | vs Hard |
|---|---|---|---|
| 1,000 | 45–55% | 15–25% | <5% |
| 4,000 | 70–80% | 55–65% | 15–25% |
| 8,000+ | 85–90% | 70–80% | 40–55% |

Note that vs Hard performance peaks slightly *lower* than Q-Learning at the same episode count — SARSA's conservative play means fewer wins, more draws. This is by design.

## SARSA vs Q-Learning at a glance

| Property | SARSA | Q-Learning |
|---|---|---|
| Update target | `Q(s', a_actual)` | `max(Q(s', a))` |
| On/off-policy | On | Off |
| Convergence speed | Slower (~20%) | Faster |
| Risk tolerance | Conservative | Bolder |
| Play style | Draw-y, defensive | Goes for the win |
| Exploitable? | Less so | Slightly more |
| At ε=0 inference | Same as Q-Learning (both become greedy) | Same as SARSA (both become greedy) |

That last row is important: **after training, when you deploy the bot at ε=0, SARSA and Q-Learning produce identical-looking greedy play** *if their Q-tables converged to the same values*. They usually don't quite — SARSA's table reflects its more cautious exploration — but the gap shrinks at inference time.

## When to pick SARSA

- You want a bot that **draws rather than gambles**.
- You're playing against **human opponents** who can punish risky moves.
- You care about **policy robustness** more than win-rate-against-random.

## When to pick Q-Learning instead

- You want **raw win rate** against weaker opponents.
- You're training a bot for **the leaderboard** where wins beat draws.
- You have a **small episode budget** (Q-Learning converges faster).

## Tips

- SARSA's slower convergence is mostly visible in early sessions. By 6,000+ episodes, the gap to Q-Learning narrows.
- If you want extra-conservative play, raise **Epsilon min** to 0.08 — keep more residual exploration to bias the policy further toward draws.
- The Auto-Tuner can sweep α; SARSA tolerates a slightly lower α (0.2) than Q-Learning.

## Use the Explainability tab

Like Q-Learning, the Explainability tab shows Q-values per move. A SARSA bot will typically have **flatter Q-values across non-losing moves** — it doesn't strongly prefer one good move over another comparable one. This is the "conservative policy" signature.
