---
slug: games-overview
title: What games are available on AI Arena
category: games
tags: [games, overview, tic-tac-toe, pong, available]
status: PUBLISHED
admin_only: false
---

# What games are available on AI Arena

AI Arena currently supports two games. More are planned.

## Currently playable

- **Tic-Tac-Toe (XO)** — the platform's primary game and the centerpiece of the AI training experience. Every onboarding journey, every Cup, and every official tournament template runs on XO. Bots can be trained for XO via every algorithm the Gym offers (Quick Bot, Q-Learning, SARSA, Monte Carlo, Policy Gradient, DQN, AlphaZero). XO is short, deterministic, and well-suited to teaching the basics of game-playing AI.

- **Pong (experimental)** — AI Arena's second game, currently shipped as an experimental spike. It's playable but intentionally narrower than XO: real-time multiplayer, simpler bot algorithms, no full tournament integration yet. Pong is both a real game you can play and a preview of how other games will join the platform.

## How games surface in the rest of the platform

- **Play menu** — you can challenge a built-in bot in either game from the Tables list or the Spar surface.
- **Gym** — currently Gym training is XO-only. Pong-side training arrives in a later release.
- **Tournaments** — XO-only at v1. Pong tournaments are planned alongside Pong's promotion out of experimental status.
- **Bots** — a single bot can carry multiple skills, one per game. When XO is your bot's only skill, it can only enter XO tournaments; once Pong skills become trainable, the same bot can compete in Pong tournaments too.

## What's next

A short queue of planned games sits behind these two — Connect 4 and a small board-game family are the most likely additions. The platform's game framework treats each new game as a self-contained package (see "Game SDK" if you're curious about the developer-facing side), so the addition cost per game is moderate. No public ETA on the next game yet.

## Bottom line

For everything tutorial-related, tournament-related, and serious bot-training related, **XO is the answer**. For experimenting with real-time multiplayer or for getting a feel of where AI Arena is going beyond XO, **Pong** is available. Both are free; both are part of every account by default.
