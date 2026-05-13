---
slug: gym-and-ml-training
title: The Gym and ML training
category: bots
tags: [gym, training, ml, q-learning, dqn, alphazero, training-job, version-history]
status: PUBLISHED
admin_only: false
---

# The Gym and ML training

The **Gym** is where you train machine-learning bots — bots whose behavior is *learned* rather than tier-labeled like Quick Bots. Open it from the main nav at `/gym`.

## Two categories of training

AI Arena's ML architecture splits algorithms into two categories that train very differently:

- **Tabular (browser-trained, XO only)** — runs entirely in your browser. Instant feedback, fully private (weights never leave your device until you save). Available for XO; disabled for games with larger state spaces. Algorithms: **Q-Learning**, **SARSA**, **Minimax**, **Rule-based**.
- **Neural (server-trained)** — you submit a training job; the server runs it and notifies you when ready. Required for games whose state spaces are too large for a browser to learn (Connect 4, Pong). Algorithms: **DQN**, **AlphaZero**, **Policy Gradient**, **Monte Carlo**.

So XO bots can use *either* paradigm. A learnable XO bot might be Q-Learning (tabular, in-browser) or AlphaZero (neural, server). Pong and future games are server-only.

In v1's Gym UI, **Q-Learning is the primary user-facing algorithm** with the most polished surface. DQN, AlphaZero, and Policy Gradient ship to the training UI as we validate each — your bot can still use them via the architecture, but the surface to *launch* a job for those is rolled out progressively.

## Layout — 8 tabs

The Gym is organised into 8 tabs (lazy-loaded so cold-open is fast):

| Tab | Purpose |
|---|---|
| **Train** | Submit a training job: pick a bot, an algorithm, hyperparameters, and episodes. |
| **Analytics** | Per-session metrics — win rate, reward curves, exploration vs exploitation, learning-rate decay. |
| **Evaluation** | Test a trained bot against a benchmark opponent without affecting its weights. |
| **Explainability** | Step through positions and see why the bot picked each move — value estimates, policy probabilities, attention. |
| **Checkpoints** | Mid-training snapshots; roll back if a long session went sideways. |
| **Sessions** | Your full training history with status, episodes, completion, ELO before/after. |
| **Export** | Download model weights (JSON + config) for offline analysis. |
| **Rules** | Manage rule-based fallback policies — heuristics the bot uses when the model is unsure. |

The Gym also has a **Guide** sub-page at `/gym/guide` — a searchable markdown handbook with PDF download.

## Training-job lifecycle

Server-side neural training jobs are tracked as `TrainingJob` records and go through these states:

`QUEUED` → `RUNNING` → `COMPLETED` (or `FAILED`, `CANCELLED`)

After completion, jobs eventually become `PRUNED` once you exceed the version-history retention (default 5 per skill).

While running, the UI polls the job status every **5 seconds**. The progress bar reflects `TrainingJob.progress` (0–100%); ETA shows "estimating…" until ~10% complete, then a countdown like "~12 min remaining". A **Cancel** button is available throughout.

**One active job per user globally** — this is a concurrency constraint, not per-skill. If you want to train a different bot, wait for the current job to finish or cancel it.

## Version history

Every completed (non-pruned) training run becomes a version of the corresponding `BotSkill`. The Sessions tab shows your full history per skill:

| Version | Algorithm | Epochs | Completed | Action |
|---|---|---|---|---|
| v3 | AlphaZero | 50,000 | 2026-05-12 | Use this version |
| v2 | Q-Learning | 20,000 | 2026-04-30 | Use this version |
| v1 | Q-Learning | 5,000 | 2026-04-20 | (auto-active) |

Click **Use this version** to swap any prior version back as the bot's active skill. The first-ever completed run becomes the active version automatically; subsequent runs go to the list and require a manual swap.

**Pruning**: when your version count exceeds the admin-configurable max (default 5 per skill), the oldest are auto-deleted — their bytes are removed and the record is marked `PRUNED`. Pruning is irreversible; export anything you want to keep.

## Tier-gated session size

Sessions are bounded by your activity tier:

| Tier | Max episodes per session |
|---|---|
| Bronze | 1,000 |
| Silver | 5,000 |
| Gold | 20,000 |
| Platinum | 50,000 |
| Diamond | 100,000 |

Limits are admin-tunable in SystemConfig.

## Cost

ML training is **free** in v1 — same earn-only economy as the rest of the platform. Your activity tier gates the *size* of the session you can run, not whether you can run one.

Discovery reward: training with a non-default algorithm (anything other than the platform's default starter) for the first time pays **+10 TC** ("first non-default algorithm" — idempotent).

## Multi-skill bots

A bot can carry one skill per game. Your XO bot might have a Q-Learning skill *and* (when Pong fully releases) a separate Pong AlphaZero skill. Each is its own `BotSkill` row. The bot's **primary skill** is the one shown in the Bot Directory and used in random matchmaking; the primary auto-updates when a new training run completes, and you can repoint it manually.

Multi-skill is **shipped today** — backend, profile UI, Gym sidebar drilldown, identity-scoped bot pickers in tournaments. Today you see only one skill per bot in practice (since Pong's training UI isn't wired yet), but the structure is live and ready for future games.

## Checkpoints and rollback

During training the platform snapshots model state at regular intervals into `MLCheckpoint` rows. From the Checkpoints tab you can roll a bot back to any past snapshot — useful if a long session went off the rails near the end. Checkpoints are mid-training; version history (above) is end-of-training.

## Explainability

The Explainability tab loads a position and shows:

- The **value estimate** (how good is this position?).
- The **policy** (which move would the bot pick, with probabilities).
- For neural-net models, attention or activation diagnostics.

Use it to debug why your bot keeps losing in certain positions — often it points to a hole in the training distribution.

## Quick Bot vs ML training — when to use which

Use a **Quick Bot** when you want a deterministic, named-difficulty bot fast. It's a minimax engine at a chosen tier; no learning happens. It's how Curriculum step 4 introduces "training" to first-timers.

Use **Gym training** when you want a bot that learns a *non-minimax style* — the only way to actually beat Magnus and the only way to enter a tournament with a meaningful chance of winning against high-tier opponents.

A Quick Bot will draw a Master forever. A well-trained Q-Learning bot won't.
