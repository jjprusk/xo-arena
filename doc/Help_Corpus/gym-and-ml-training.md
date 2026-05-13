---
slug: gym-and-ml-training
title: The Gym and ML training — overview
category: bots
tags: [gym, training, ml, brains, overview]
status: PUBLISHED
admin_only: false
---

# The Gym and ML training — overview

The **Gym** is where you train AI Arena bots — bots whose behavior is *learned* through play, rather than just labeled with a difficulty like Quick Bots. Open it from the main nav at `/gym`.

This doc is the entry-point. For the *concepts* (Brain, epsilon, gamma, training modes), see **Bot training concepts**. For *specific algorithms*, see the per-Brain docs (Q-Learning, SARSA, Monte Carlo, Policy Gradient, DQN, AlphaZero). For *evaluation*, see **Benchmarking your bot**. For *problems*, see **Bot training — troubleshooting**.

## Brains — the six trainable algorithms

Every bot in AI Arena has a **Brain** — its learning algorithm. You pick the Brain when you create the bot. AI Arena offers six Brain types, all user-facing in the Gym today:

| Brain | Style | Best for |
|---|---|---|
| **Q-Learning** | Tabular, off-policy | Fast, reliable starting point |
| **SARSA** | Tabular, on-policy | Conservative, less exploitable |
| **Monte Carlo** | Tabular, episode-level | Clean credit assignment, no bias |
| **Policy Gradient** | Tabular softmax | Unpredictable, human-like play |
| **DQN** | Neural network | Generalizes to unseen states |
| **AlphaZero** | Neural network + MCTS | Strongest possible ceiling |

The first four ("tabular") learn an explicit table mapping board state → action value. They run entirely in your browser — fast, fully private, available for XO. The last two ("neural") use neural networks and run as **server-side training jobs**.

## Where to start

If you're new to bot training, the recommended path is:

1. **Create a bot** with a **Q-Learning Brain** (Profile → My bots → Create bot wizard).
2. **Run the Q-Learning session recipe** (7,000 episodes across 3 sessions). See the Q-Learning doc.
3. **Benchmark** the result in the Evaluation tab to see where it stands.
4. **Iterate**: try a different Brain on a second bot, compare via head-to-head.

You'll find that Q-Learning takes about 30 minutes wall-clock to fully train and produces a bot that beats Easy minimax around 80% of the time. From there, the journey extends in many directions — neural Brains, hyperparameter sweeps via the Auto-Tuner, multi-skill bots, tournaments.

## Layout — 8 tabs

The Gym is organized into 8 tabs (lazy-loaded for fast cold-open):

| Tab | Purpose |
|---|---|
| **Train** | Submit a training session: pick a bot, an algorithm, hyperparameters, and episodes. |
| **Analytics** | Per-session metrics — win rate, reward curves, exploration progress, learning-rate decay. |
| **Evaluation** | Benchmark a trained bot against the 5 minimax tiers; run head-to-head between two bots. |
| **Explainability** | Step through positions and see why the bot picked each move — value estimates, policy probabilities, attention. |
| **Checkpoints** | Mid-training snapshots; roll back if a long session went sideways. |
| **Sessions** | Your full training history with status, episodes, completion, ELO before/after. |
| **Export** | Download model weights (JSON + config) for offline analysis. |
| **Rules** | Manage rule-based fallback policies — heuristics the bot uses when the model is unsure. |

The Gym also has a **Guide** sub-page at `/gym/guide` — the searchable bot-training handbook (this is the canonical PDF you can download). The handbook covers what's in this corpus and serves as a printable reference.

## Two training paradigms

AI Arena's ML architecture splits learning into two categories:

- **Tabular (browser-trained, XO only)** — Q-Learning, SARSA, Monte Carlo, Policy Gradient run **in your browser**. Instant feedback, fully private (weights never leave your device until you save). Disabled for games with larger state spaces (e.g., Connect 4, Pong) where a browser can't hold the state table.

- **Neural (server-trained)** — DQN, AlphaZero submit a **training job** to a server worker. The worker runs the job, you get notified when ready. Required for games whose state space is too large for browser training. The Sessions tab tracks job status (`QUEUED` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED`).

So XO bots can use *either* paradigm — your XO bot might be Q-Learning (browser) or AlphaZero (server). Pong and future games are server-only.

## Training-job lifecycle (neural Brains)

Server-side neural jobs are tracked as `TrainingJob` records:

`QUEUED` → `RUNNING` → `COMPLETED` (or `FAILED`, `CANCELLED`)

While running, the UI polls job status every **5 seconds**. The progress bar reflects `TrainingJob.progress` (0–100%); ETA shows "estimating…" until ~10% complete, then a countdown like "~12 min remaining". A **Cancel** button is available throughout.

**One active job per user globally** — this is a concurrency constraint, not per-skill. If you want to train a different bot, wait for the current job to finish or cancel it.

## Version history

Every completed (non-pruned) training run becomes a version of the corresponding bot **skill** (the platform's DB term for a Brain attached to a specific bot/game). The Sessions tab shows your full history per skill:

| Version | Algorithm | Epochs | Completed | Action |
|---|---|---|---|---|
| v3 | AlphaZero | 50,000 | 2026-05-12 | Use this version |
| v2 | Q-Learning | 20,000 | 2026-04-30 | Use this version |
| v1 | Q-Learning | 5,000 | 2026-04-20 | (auto-active) |

Click **Use this version** to swap any prior version back as the bot's active skill. The first-ever completed run becomes the active version automatically; subsequent runs go to the list and require a manual swap.

**Pruning**: when your version count exceeds the admin-configurable max (default 5 per skill), the oldest are auto-deleted — `PRUNED` status; bytes removed. Pruning is irreversible; export anything you want to keep.

## Tier-gated session size

Sessions are bounded by your activity tier:

| Tier | Max episodes per session |
|---|---|
| Bronze | 1,000 |
| Silver | 5,000 |
| Gold | 20,000 |
| Platinum | 50,000 |
| Diamond | 100,000 |

Limits are admin-tunable in SystemConfig. To run the full 35k-episode DQN recipe, you need Platinum tier (50k cap) or above. Most starter Brains (Q-Learning at 7k episodes) fit in Silver.

## Cost

ML training is **free** in v1 — same earn-only economy as the rest of the platform. Your activity tier gates the *size* of the session you can run, not whether you can run one.

Discovery reward: training with a non-default algorithm (anything other than the platform's default starter) for the first time pays **+10 TC** ("first non-default algorithm" — idempotent).

## The Auto-Tuner tab

For tabular Brains, the **Auto-Tuner** can sweep hyperparameters automatically:

- **α (learning rate)** — usually hardcoded at 0.3 (or 0.2 for MC); sweep to find your bot's optimum.
- **γ (discount factor)** — usually 0.9; sweep for sensitivity testing.
- **Epsilon-decay rate** — sweep to find the right exploration schedule.

Auto-Tuner runs many short training sessions in parallel and picks the best by benchmark score. Useful when your bot plateaus and you're not sure if the issue is hyperparameters.

## Multi-skill bots

A bot can carry one skill per game. Your XO bot might have a Q-Learning skill *and* (once Pong's training UI fully releases) a separate Pong AlphaZero skill. Each is its own skill record. The bot's **primary skill** is the one shown in the Bot Directory and used in random matchmaking; the primary auto-updates when a new training run completes, and you can repoint it manually from the bot's profile.

Multi-skill is **shipped today** — backend, profile UI, Gym drilldown, identity-scoped tournament pickers.

## Checkpoints and rollback

During training the platform snapshots model state at regular intervals into checkpoint records. From the **Checkpoints** tab you can roll a bot back to any past snapshot — useful if a long session went off the rails near the end. Checkpoints are mid-training; version history (above) is end-of-training.

## Explainability

The **Explainability** tab loads a position and shows:

- The **value estimate** for that position (how good is it for the bot to move?).
- The **policy** — which move would the bot pick, with probabilities or Q-values per cell.
- For neural Brains, attention or activation diagnostics.

Use it to debug why your bot keeps losing in certain positions — often it points to a hole in the training distribution.

## Quick Bot vs ML training — when to use which

Use a **Quick Bot** when you want a deterministic, named-difficulty bot fast. It's a minimax engine at a chosen tier; no learning happens. It's how Curriculum step 4 introduces "training" to first-timers.

Use **Gym training** when you want a bot that learns a *non-minimax style* — the only way to actually beat Magnus and the only way to enter a tournament with a meaningful chance of winning against high-tier opponents.

A Quick Bot will draw a Master forever. A well-trained Q-Learning bot won't.

## Where to go next

- **Concepts** — see "Bot training concepts" for epsilon, gamma, modes, curriculum.
- **Per-Brain deep-dives** — Q-Learning, SARSA, Monte Carlo, Policy Gradient, DQN, AlphaZero each have their own doc with settings, session recipes, and expected results.
- **Benchmarking** — see "Benchmarking your bot" for the 5-tier evaluation + ELO correlation.
- **Stuck?** — see "Bot training — troubleshooting" for diagnosis flowcharts.
