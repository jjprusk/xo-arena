---
slug: bots-overview
title: Bots — overview
category: bots
tags: [bots, ai, builtin, matchmaking, multi-skill]
status: PUBLISHED
admin_only: false
---

# Bots — overview

A **bot** on AI Arena is an AI player that plays games on your behalf or that you can challenge. Every bot has a primary skill, an ELO rating per game, a record of games played, and an owner (you, another player, or the platform for built-in bots).

## Built-in vs player-owned

There are two ownership categories:

- **Built-in bots** — ship with the platform. Their `botModelId` looks like `builtin:minimax:<tier>`. Four canonical built-in personas: **Rusty** (Novice), **Copper** (Intermediate), **Sterling** (Advanced), **Magnus** (Master). You can challenge any of them from the Bot Directory; they show up in Spar, Cups, and as low-tier matchmaking opponents.
- **Player-owned bots** — you create them. A player-owned bot has a `botModelId` of either `user:<userId>:minimax:<tier>` (Quick Bot — minimax under the hood) or a UUID pointing to a `BotSkill` row (ML-trained bot).

The reserved built-in names (Rusty, Copper, Sterling, Magnus) cannot be used as your bot's display name.

## Two ways to make a bot

You'll choose between:

- **Quick Bot** — a thirty-second tier-bump that gives you a minimax-based bot at a chosen difficulty. No training, no credit cost, deterministic strength. Good for filling tournament slots and getting your first bot.
- **Trained ML bot (a bot with one or more learning skills)** — a bot whose weights are actually learned through gameplay. You add a **skill** for a given game, then launch a training session in the Gym; the skill plays thousands of self-play games and its model is saved. Six algorithms are user-facing today: **Q-Learning**, **SARSA**, **Monte Carlo**, **Policy Gradient**, **DQN**, **AlphaZero**.

See "Training a Quick Bot" and "Gym and ML training" for details. The per-algorithm docs go deep on each one's settings, session recipes, and expected results.

## Skills — one bot, multiple games

As AI Arena expands beyond XO to Pong and other games, a single bot can carry **multiple skills** — one per game. Each skill is a separate model with its own algorithm, weights, and training history. Your XO bot could have a Q-Learning skill for XO and (when Pong's training UI fully releases) an AlphaZero skill for Pong, both attached to the same bot identity.

One skill is the bot's **primary** — what shows in the Bot Directory and what random matchmaking uses. The primary auto-updates when you complete a new training run; you can also set it manually from the bot's profile.

## Multi-skill bots

A single bot can carry **multiple skills** — for example, a tic-tac-toe Q-Learning skill plus a pong AlphaZero skill (once Pong's training UI fully releases). One skill is the **primary**, used for the Bot Directory listing and for random matchmaking. The primary is auto-updated when you finish a new training run; you can also repoint it manually from the bot's profile.

Multi-skill is **shipped today** (Phase 3.8 complete): the `BotSkill` table is live, the profile UI shows skill pills (game · algorithm · ELO · episodes) and an **+ Add skill** affordance, the Gym sidebar lets you drill down to a specific skill, and tournament/play pickers are identity-scoped so you don't see "Rusty (XO)" and "Rusty (C4)" as duplicates. Today you'll typically see one skill per bot in practice (since Pong's training UI isn't wired yet), but the structure is ready for future games.

Skills are stored in the `BotSkill` table and addressed via `POST /api/v1/bots/:botId/skills`. There's a unique constraint per `(botId, gameId)` — one skill per game per bot.

Tournament registration rejects bots that don't have a skill for that tournament's game (HTTP 400 with code `NO_SKILL`) — so you can't accidentally enter your XO-trained bot in a Connect 4 tournament.

## Bot Directory

The Bot Directory at `/bots` is your browse-and-challenge hub. Features:

- Filter by **owner** (mine / community / all).
- Filter by **game**, **provisional status**, **ELO range**, or **search by name**.
- Click any bot for its profile: ELO history, recent games, training history (for ML bots).
- **Challenge** any bot to a one-off game.
- **Quick Match** — the platform picks an ELO-matched opponent for you.

Guests can browse and challenge without signing in. Signing up promotes any guest play history into your account.

## Playing against other users' bots (and your friends' bots)

Every bot on AI Arena is **publicly playable** by default — there's no "friends only" or private-bot mode. When your friend trains a bot, that bot shows up in the Bot Directory alongside everyone else's, and you can challenge it the same way you'd challenge a built-in bot:

1. Open the **Bot Directory** at `/bots`.
2. Find your friend's bot — use the search-by-name filter or filter by owner.
3. Click **Challenge** (or **Quick Match** if you'd rather have the platform pick an ELO-matched opponent).

The match runs on a normal Table; both of you (and any spectators) can watch the bot play. The result counts toward each bot's ELO. There's no friend-specific match mode in v1 — bots are public, ladders are shared, results are visible to anyone browsing the Bot Directory.

If you want to play your **friend directly** (human vs. human), see the "Tables and spectating" doc — you create a private Table and share the link.

## Renaming your bot

Open your bot's profile and click the name to edit. Validation rules:

- Reserved names (Rusty, Copper, Sterling, Magnus) are blocked.
- Names matching the platform's profanity list are blocked.
- Display name must be unique among bots you own.

Renaming is free.

## Bot ELO and resets

Each bot has its own ELO per game. Bot ELO updates on every non-Spar match. Admins can reset a bot's ELO (the timestamp is recorded in `botEloResetAt`) — useful after a major model change so the ladder reflects current strength.
