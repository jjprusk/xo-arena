---
slug: quick-bots
title: Training a Quick Bot
category: bots
tags: [bots, quick-bot, minimax, beginner]
status: PUBLISHED
admin_only: false
---

# Training a Quick Bot

A **Quick Bot** is the fastest way to get a bot of your own. It takes about thirty seconds, costs nothing, and gives you a bot of a chosen difficulty.

## What a Quick Bot really is

Under the hood, a Quick Bot is a **minimax engine** — the same algorithm the built-in bots (Rusty/Copper/Sterling/Magnus) use — with a difficulty label that controls how it plays.

"Training" a Quick Bot does **not** change any weights or run any episodes. It's a tier-bump operation: you pick a difficulty and the platform assigns that difficulty to a bot record under your account. The behaviour is identical to the matching built-in bot for that tier.

This is intentional: a fast, predictable, zero-cost way to get a bot for first-time owners, tournament slot-filling, and Curriculum step 4.

## The four tiers (XO)

| Tier | Behaviour |
|---|---|
| **Novice** | Random valid moves. Beatable by a careful child. |
| **Intermediate** | Blocks immediate losses; takes immediate wins; otherwise random. |
| **Advanced** | Same as Intermediate, but 60% of the time plays the optimal minimax move. |
| **Master** | Full minimax search with transposition table. Never loses against optimal play. |

The same four tiers underpin the built-in bots: Rusty = Novice, Copper = Intermediate, Sterling = Advanced, Magnus = Master.

## Training flow

1. From the Gym (Train tab) or your Profile, click **Train a Quick Bot**.
2. Pick the game (currently XO; Pong is experimental).
3. Pick a tier.
4. Confirm. The bot is ready immediately and appears in your bot list and on the Bot Directory.

If you already have a Quick Bot for that game and bump it to a higher tier, the same bot record is updated — you don't get a second bot. Lowering is also allowed for testing.

## When to use Quick Bots vs ML training

Quick Bots are great for:

- Filling a tournament slot with a known-strength bot.
- Practicing against a specific tier offline-style.
- Anyone who wants a bot without committing to an ML training run.

If you want a bot that actually **learns** from experience and has a unique playing style, run a real training session in the Gym — see "Gym and ML training".

## A small caveat

Because Quick Bots and the matching built-in bots play identically, a Master Quick Bot in a tournament has the same chance against Magnus as Magnus has against itself: it's a forced draw. To start winning consistently you need an ML-trained bot that has learned a non-minimax style of play.
