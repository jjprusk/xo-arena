---
slug: gym-and-ml-training
title: The Gym and ML training
category: bots
tags: [gym, training, ml, q-learning, dqn, alphazero, sessions]
status: PUBLISHED
admin_only: false
---

# The Gym and ML training

The **Gym** is where you actually train machine-learning bots — bots whose behavior is *learned* rather than tier-labeled like Quick Bots. Open it from the main nav at `/gym`.

## Layout — 8 tabs

The Gym is organised into 8 tabs (lazy-loaded so cold-open is fast):

| Tab | What it's for |
|---|---|
| **Train** | Start a new training session: pick a bot, an algorithm, hyperparameters, and number of episodes. |
| **Analytics** | Per-session metrics — win rate, average reward, exploration vs exploitation curves, learning rate decay. |
| **Evaluation** | Test a trained bot against a benchmark opponent without affecting its weights. |
| **Explainability** | Step through positions and see why the bot picked each move — value estimates, action probabilities, attention. |
| **Checkpoints** | Snapshots of model weights during training. Roll back if a session went sideways. |
| **Sessions** | Your full training history with status, episodes, completion, ELO before/after. |
| **Export** | Download your trained model (JSON weights + config) for offline analysis. |
| **Rules** | Manage rule-based fallback policies — heuristics the bot uses when the model is unsure. |

The Gym also has a **Guide** sub-page at `/gym/guide` — a searchable markdown handbook with PDF download.

## Algorithms

Six RL algorithms ship in the codebase. **Q-Learning** is the algorithm exposed in the v1 training UI; the others are framework-ready but gated until later phases:

| Algorithm | Status | What it is |
|---|---|---|
| **Q-Learning** | **User-facing in v1** | Tabular Q-Learning over board states. Stable, fast to train. |
| **SARSA** | Framework-ready | On-policy variant of Q-Learning. |
| **Monte Carlo** | Framework-ready | Episode-by-episode value estimates from full game returns. |
| **DQN** | Framework-ready | Deep Q-Network — neural Q estimator. |
| **Policy Gradient** | Framework-ready | Directly learns a policy over moves. |
| **AlphaZero** | Framework-ready | MCTS + neural net, self-play. Most powerful, slowest. |

Training a bot with a non-default algorithm pays the **+10 TC** "first non-default algorithm" discovery reward (idempotent — first time only).

## Training session lifecycle

1. **Pick your bot** — a bot you own. New skills attach to it; existing skills update if you re-train.
2. **Pick algorithm + hyperparameters** — learning rate, epsilon schedule, episodes. Defaults are sane.
3. **Start session** — the platform queues episodes. You can watch live metrics in Analytics or close the tab and check back.
4. **Completion** — the trained weights become a `BotSkill` row. If this is your bot's first skill in that game, `User.botModelId` repoints to it automatically. New training runs auto-update primary skill.

Sessions are bounded by your activity tier:

| Tier | Max episodes per session |
|---|---|
| Bronze | 1,000 |
| Silver | 5,000 |
| Gold | 20,000 |
| Platinum | 50,000 |
| Diamond | 100,000 |

Limits are admin-tunable.

## Cost

ML training costs **nothing** in v1 — same earn-only economy as the rest of the platform. The activity tier gates the *size* of the session you can run, not whether you can run one.

## Multi-skill bots

A bot can carry one skill per game. Your XO bot might have a Q-Learning skill *and* (when Pong is fully released) a separate Pong AlphaZero skill. Each is its own `BotSkill` row. The bot's **primary skill** is the one shown in the Bot Directory and used in random matchmaking; the primary auto-updates when a new training run completes, and you can repoint it manually from the bot's profile.

## Checkpoints and rollback

During training the platform snapshots model state at regular intervals into `MLCheckpoint` rows. From the Checkpoints tab you can roll a bot back to any past snapshot — useful if a long session went off the rails near the end.

## Explainability

The Explainability tab loads a position and shows:

- The **value estimate** (how good is this position?).
- The **policy** (which move would the bot pick, with probabilities).
- For neural-net models, attention or activation diagnostics.

Use it to debug why your bot keeps losing in certain positions — often it points to a hole in the training distribution.

## Tier-bump vs ML — when to use which

Use a **Quick Bot** (tier bump) when you want a deterministic, named-difficulty bot fast. Use **Gym training** when you want a bot that learns a *non-minimax style* — the only way to actually beat Magnus and the only way to enter a tournament with a meaningful chance of winning against high-tier opponents.
