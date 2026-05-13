---
slug: gym-auto-tuner
title: The Auto-Tuner — hyperparameter sweeps
category: training
tags: [auto-tuner, hyperparameters, sweep, tuning, alpha, gamma]
status: PUBLISHED
admin_only: false
---

# The Auto-Tuner — hyperparameter sweeps

Hardcoded defaults work for most users. But when your bot plateaus, or you want the strongest possible skill, the **Auto-Tuner** can search the hyperparameter space for you. It's specifically for **tabular algorithms** (Q-Learning, SARSA, Monte Carlo, Policy Gradient) — neural algorithms (DQN, AlphaZero) have their own gradient-based optimization that the Auto-Tuner can't help with.

## What the Auto-Tuner does

It runs **many short training sessions in parallel**, each with a different combination of hyperparameter values, then picks the winner via benchmark score.

The hyperparameters it can sweep:

- **α** (learning rate) — usually hardcoded at 0.3 (or 0.2 for Monte Carlo)
- **γ** (discount factor) — usually hardcoded at 0.9
- **Epsilon decay rate** — controls how fast exploration falls off

Each sweep run is a real training session — same code path as a manual session — just shorter (typically 500-2,000 episodes) and run many times with varied settings.

## When to use it

- **Your bot plateaued.** Win rate isn't moving despite more training. Try sweeping α.
- **You're not sure if defaults are optimal for your situation.** Maybe your bot would benefit from γ = 0.85 instead of 0.9.
- **You want the strongest tabular bot possible.** Even small hyperparameter wins compound.
- **You're studying RL.** Watching the Auto-Tuner show you which hyperparameter values produce the best learning curves is excellent intuition-building.

## How to launch a sweep

1. Open the **Gym** → **Auto-Tuner** tab.
2. Pick a bot and its skill (the algorithm is inferred from the skill).
3. Pick **which hyperparameters to sweep**. You can sweep one at a time (single sweep) or multiple (grid sweep). For first runs, sweep just α.
4. For each swept parameter, pick the **range** (e.g., α from 0.1 to 0.5 in steps of 0.1 = five candidates).
5. Pick the **episodes per candidate** — how long each candidate trains. Shorter = faster sweep, less reliable results. 1,000-2,000 is a reasonable starting point.
6. Click **Start sweep**.

The platform runs N concurrent candidates (up to your tier's concurrent-session limit) and reports each one's benchmark score as it finishes.

## Reading sweep results

The Auto-Tuner reports a table:

| α | Final win rate vs Random | Final win rate vs Hard | Benchmark ELO |
|---|---|---|---|
| 0.1 | 75% | 8% | ~1,000 |
| 0.2 | 82% | 12% | ~1,100 |
| 0.3 | 88% | 22% | ~1,250 |
| 0.4 | 85% | 18% | ~1,200 |
| 0.5 | 80% | 14% | ~1,150 |

In this example, **α = 0.3 wins** — it produces the highest benchmark across all opponents. You'd take this value forward as the recommended setting for your full training run.

## Sweep design — single vs grid

**Single sweep** (one parameter): N candidates. Cheap. Best for initial calibration.

**Grid sweep** (two parameters): N × M candidates. Expensive but thorough. Use when you suspect a parameter interaction (e.g., the best α might depend on γ).

Beyond 2D grids, the search space explodes and sweeps become impractical. If you want to explore 3+ parameters, use **sequential 1D sweeps**: find the best α first, then sweep γ with α fixed at the winner, then sweep epsilon decay with both fixed, etc. This loses some accuracy (you can miss interaction effects) but is much cheaper.

## Sweep vs full training — when each makes sense

The Auto-Tuner is for **finding hyperparameter values**. The full multi-session recipe is for **building the actual skill**.

Workflow:

1. Pick an algorithm (e.g., Q-Learning).
2. Run an Auto-Tuner sweep on α (5 candidates × 1,000 episodes = 5,000 total episodes).
3. Take the winning α.
4. Run the **real** Q-Learning recipe (3 sessions × ~2,500 episodes = 7,000 total episodes) with the winning α applied.
5. Benchmark the result.

Total cost: ~12,000 episodes for a hyperparameter-optimized Q-Learning bot. Without the Auto-Tuner you'd just have run the 7,000-episode recipe with default α — and maybe gotten a slightly weaker bot.

## Concurrency and cost

Sweep candidates run in **parallel**, bounded by your tier's max-concurrent-sessions limit (admin-tunable in SystemConfig). For most users that's 1-2 concurrent. Bronze tier: 1. Higher tiers: more.

Each candidate is a real training session that counts toward your tier's max-episodes-per-session budget. A 5-candidate sweep × 1,000 episodes each = 5,000 episodes total, spread across however many can run concurrently.

Cost: **free** (no credit deduction in v1).

## Common results to expect

For Q-Learning on tic-tac-toe:

| Hyperparameter | Default | Sweep range | Typical winner | Typical improvement |
|---|---|---|---|---|
| α (learning rate) | 0.3 | 0.1 - 0.5 | 0.3 - 0.4 | Modest (~5% ELO) |
| γ (discount factor) | 0.9 | 0.85 - 0.99 | 0.9 - 0.95 | Small (~2% ELO) |
| ε decay rate | 0.995 | 0.99 - 0.999 | depends on episode budget | Moderate when wrong |

The biggest wins from sweeping are typically on **ε decay rate** when your default is mismatched to your episode budget. If you're training only 2,000 episodes total but using rate 0.999 (which keeps ε high until episode ~3,000), the bot never exploits. Sweeping rate finds the right balance.

## Limitations

- **Tabular only.** DQN and AlphaZero have hardcoded α = 0.001; the Auto-Tuner can't sweep them.
- **Short candidates.** Each candidate trains for less than a full recipe, so the comparison reflects "early-learning speed" not "final ceiling". A hyperparameter that wins on 1,000 episodes might not win on 10,000. For high-confidence picks, sweep at longer episode counts.
- **No automatic transfer.** The winning hyperparameter is shown but not auto-applied to your next manual training session. You set it yourself.
- **Single skill at a time.** You can sweep one (bot, skill) pair per session. No multi-bot batch sweeps.

## Bottom line

The Auto-Tuner is a productivity tool: it saves you from manually running 5 trial sessions to find the best α. Use it once per algorithm switch, take the winner, then train for real. Don't sweep on every session — the marginal gains aren't usually worth the time.

For most beginner-to-intermediate bot trainers, the **default hyperparameters are good enough**. Reach for the Auto-Tuner when you've explicitly hit a plateau and the troubleshooting flowchart points to "wrong hyperparameters" as the cause.
