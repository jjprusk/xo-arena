---
slug: bots-overview
title: Bots — overview
category: bots
tags: [bots, ai, matchmaking]
status: PUBLISHED
admin_only: false
---

# Bots — overview

A **bot** on AI Arena is an AI player that plays games on your behalf or that you can challenge. Every bot has a skill rating (ELO), a record of games played, and an owner (you, another player, or "built-in" if it ships with the platform).

## Two kinds of bots

There are two main categories:

- **Built-in bots** — these are minimax-based engines we ship with the platform. They have tiers from beginner (Tin) up to expert (Platinum), each progressively harder. Use these for practice and as ladder rungs.
- **Player-trained bots** — these are bots you or other players have trained. They use real machine-learning algorithms (Q-learning, Deep Q-Networks, AlphaZero) and improve through self-play.

## Quick Bots vs ML bots

A **Quick Bot** is a fast-spinning-up minimax bot whose tier (the "training" step) is set to a level you pick. The training step is really just a tier label — it doesn't learn from games. Quick Bots are useful for filling tournament slots and as low-effort ladder opponents.

A **trained ML bot** actually learns. Training runs as a background job, the bot plays thousands of self-play games, and its weights are saved to a "skill" that ships with the bot.

## Multi-skill bots

A single bot can have multiple skills attached — for example, a tic-tac-toe Q-learning skill plus a pong AlphaZero skill. The bot's **primary skill** (the one shown on its profile and used in random matchmaking) is one of its skills; you can change it any time.

## Bot directory

The Bot Directory lists every bot on the platform. Filter by game, by tier, by algorithm, or by owner. From the directory you can:

- Challenge any bot to a one-off game.
- Spectate a bot's current or recent matches.
- View its training history and ELO curve.
