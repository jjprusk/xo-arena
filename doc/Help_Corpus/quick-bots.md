---
slug: quick-bots
title: Training a Quick Bot
category: bots
tags: [bots, quick-bot, training, minimax]
status: PUBLISHED
admin_only: false
---

# Training a Quick Bot

A **Quick Bot** is the fastest way to get a bot of your own. It takes about thirty seconds and costs a small amount of credits.

## What a Quick Bot actually is

Under the hood, a Quick Bot is a minimax engine — the same algorithm the built-in bots use — with a tier label that controls how deeply it searches. Higher tiers search more positions, which makes the bot harder to beat but slower per move.

"Training" a Quick Bot does not change any weights. It sets the tier and assigns the resulting tier-and-game combination to your bot. This is intentional: a fast, predictable, low-credit option for players who want a bot without committing to a full ML training run.

## Tiers (XO)

- **Tin** — searches 2 plies. Beatable by a careful human.
- **Bronze** — 3 plies.
- **Silver** — 4 plies.
- **Gold** — 5 plies.
- **Platinum** — full game-tree search. Will never lose if you let it play perfectly.

Pong has its own tier progression with similar gating.

## Training flow

1. From your profile, click **Train a Quick Bot**.
2. Pick a game, pick a tier, confirm the credit cost.
3. The bot is ready immediately. It appears in your bot list and on the Bot Directory.

If you already have a Quick Bot and want to raise its tier, click **Re-train** on its profile. Re-training costs the credit difference between tiers, not the full new tier cost.

## When to use Quick Bots vs ML training

Quick Bots are great for:

- Filling a tournament slot with a known-strength opponent.
- Practicing against a specific tier.
- First-time bot owners who want to see the system before committing to ML.

For actual ML — bots that learn from experience — see the training guide.
