---
slug: bot-training-concepts
title: Bot training concepts — Brains, epsilon, gamma, and modes
category: training
tags: [training, brain, epsilon, gamma, exploration, curriculum, modes]
status: PUBLISHED
admin_only: false
---

# Bot training concepts — Brains, epsilon, gamma, and modes

Every bot in AI Arena is powered by an **AI model** called its **Brain**. The Brain is the learning algorithm — it determines how the bot thinks, how it learns from experience, and how strong it can become.

You choose your Brain when you create the bot. Training the bot means running its Brain through many games (called **episodes**) and letting it learn. This doc covers the concepts that apply to *all* Brain types. See the per-algorithm docs (Q-Learning, SARSA, etc.) for the specifics of each Brain.

## The six Brain types

| Brain | Style | Best for |
|---|---|---|
| **Q-Learning** | Tabular, off-policy | Fast, reliable, great starting point |
| **SARSA** | Tabular, on-policy | Conservative, less exploitable play |
| **Monte Carlo** | Tabular, episode-level | Clean credit assignment, no bias |
| **Policy Gradient** | Tabular softmax | Unpredictable, human-like play |
| **DQN** | Neural network | Generalises unseen board states |
| **AlphaZero** | Neural network + MCTS | Strongest ceiling, lookahead search |

All six are user-facing in the Gym's Train tab today.

The first four ("tabular") learn an explicit table mapping board state → action value. They run in your browser, fast and private. The last two ("neural") use a neural network and run as server-side training jobs.

## Episodes — the unit of training

An **episode** is one full game your bot plays. Each episode produces learning updates that adjust the bot's Brain. You configure how many episodes to run per session in the Train tab. Typical totals:

- Q-Learning / SARSA: 5,000–10,000 episodes
- Monte Carlo / Policy Gradient: 10,000–20,000
- DQN: 25,000–35,000
- AlphaZero: 10,000–15,000 (each episode is much slower)

## Epsilon (ε) — exploration vs exploitation

**Epsilon controls the probability of choosing a random move instead of the bot's current best move.**

- **ε = 1.0** — fully random (pure exploration; the bot hasn't learned yet)
- **ε = 0.5** — 50/50 mix of random and best-known
- **ε = 0.05** — mostly greedy with small residual exploration
- **ε = 0.0** — fully greedy (no learning, only exploiting what's known)

Epsilon starts high so the bot tries many moves, then decays to a low floor so it locks in its best policy. The art is timing the decay.

**Rule of thumb:** ε should reach the floor (`epsilonMin`, usually 0.05) at roughly **80% of total planned episodes** — leaving the last 20% for pure exploitation.

### Decay schedules

The Train tab lets you pick how epsilon falls over time:

| Method | Formula | Best for |
|---|---|---|
| **Exponential** | `ε *= rate` each episode | Most algorithms (default). Required for multi-session DQN. |
| **Linear** | ε decreases evenly across N episodes | Monte Carlo, single-session fixed budgets |
| **Cosine** | Cosine curve from start → min | Policy Gradient — smooth warmup/cooldown |

When schedule is **Exponential**, the Train tab also shows a **Rate** field (the per-episode decay multiplier). Lower Rate = faster decay. Reference:

| Rate | Episodes to reach ε=0.05 (starting at ε=1.0) |
|---|---|
| 0.995 | ~590 |
| 0.999 | ~2,990 |
| 0.9995 | ~5,990 |
| 0.9999 | ~29,950 |
| 0.99995 | ~59,900 |

Pick a rate that lands ε≈0.05 around 80% of your total planned episodes across all sessions. For DQN's 30k+ episode arc, that means 0.9999.

### Reset epsilon at session start

The Train tab has a **"Reset ε to 1.0"** checkbox. The convention:

- **Session 1** of a fresh training run → check it (start fully exploratory).
- **Sessions 2+** → uncheck it (resume from where the previous session left epsilon).

This is the only epsilon control you set directly — the actual ε value at any moment is computed from the schedule and the cumulative episode count.

## Gamma (γ) — discount factor

Gamma controls how much the bot values **future** rewards versus immediate ones.

- **γ = 0.9** — standard; good for tic-tac-toe (short 9-move games).
- **γ = 0.95** — plans a bit further ahead; used by recommended DQN settings.
- **γ = 0.99** — very long-horizon planning; used internally by AlphaZero.

Lower γ → the bot plays for quick wins. Higher γ → it sacrifices short-term moves for long-term position.

**In the app:** γ is exposed in the **DQN Train tab** as the Gamma dropdown. For all other algorithms it's hardcoded (0.9 for tabular, 0.99 for AlphaZero). The **Auto-Tuner** tab can sweep γ for tabular algorithms.

## Learning rate (α)

Learning rate controls how aggressively the Brain updates per step.

- **Tabular methods**: α = 0.3–0.5 is safe. Higher = faster but noisier convergence.
- **Neural methods (DQN, AlphaZero)**: α = 0.001. Higher causes divergence.

**In the app:** α is **not exposed** in the Train tab for any algorithm. It's hardcoded (0.3 tabular, 0.001 neural). For tabular methods only, you can sweep α via the **Auto-Tuner** tab.

## Training modes

The Train tab lets you choose how the bot plays its episodes:

| Mode | What it does | Best for |
|---|---|---|
| **Self-play** | The bot plays both sides simultaneously. | All algorithms; best for tabular methods. Trains X and O perspectives at once. |
| **vs Minimax** | The bot plays against a deterministic built-in opponent (Rusty/Copper/Sterling/Magnus). | Polishing after self-play; curriculum training. |
| **Alternating** | The bot plays X for one episode, O for the next. | Ensuring symmetric learning for both perspectives. |

**Standard recipe:** self-play first (bootstrap all states); then vs-Minimax (curriculum) to refine against deterministic play.

## Curriculum training

Available in **vs Minimax** mode. When you enable Curriculum, the platform automatically advances opponent difficulty (novice → intermediate → advanced → master) once the bot wins **65% of the last 100 games**.

Start at **novice**. Jumping straight to master wastes early episodes against an opponent the bot cannot yet learn from — it will lose every game and update very little.

## Training charts — what they mean

The live Train panel shows two sets of lines for win / draw / loss rates:

- **Thick solid lines** — the *recent* rate for the current batch of episodes (resets each update interval). This is the most informative signal for whether the bot is *currently* learning.
- **Thin dashed lines** — the *cumulative* average since the session started.

If the recent line is climbing while the cumulative line rises slowly, the bot is genuinely improving — recent performance is being weighted down by early losses in the cumulative average. If **both** lines are flat, the bot isn't converging.

## Sessions

Long training runs are divided into **sessions** of a few thousand episodes each. The recommended recipe for each algorithm uses 3–4 sessions:

- **Session 1** — self-play, bootstrap.
- **Session 2** — self-play, converge.
- **Session 3** — vs Minimax, polish.
- **Session 4 (some algorithms)** — vs Minimax Master, harden.

Each session ends with a saved snapshot; you can roll back via the **Checkpoints** tab or compare versions via the **Sessions** tab. See the "Gym and ML training" doc for the version-history workflow.

## Which Brain should I pick?

- **If you want a strong bot fast** → Q-Learning. 7,000 episodes total; reaches ~85% vs random.
- **If you want the highest ceiling** → AlphaZero. 15,000 episodes but each is slow. Top win rates against perfect play.
- **If you want unpredictable, human-like play** → Policy Gradient. Stochastic; harder for opponents to memorize.
- **If you want a draw-y, defensive bot** → SARSA. Conservative play; rarely gambles.
- **If you want to learn how RL works conceptually** → Monte Carlo. Clean episode-level credit assignment; easiest to explain.
- **If you want to explore neural-net behavior** → DQN. The first step into "real" deep RL.

Detailed settings, session recipes, and expected results per algorithm are in the per-Brain docs.
