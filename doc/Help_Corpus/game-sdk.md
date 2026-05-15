---
slug: game-sdk
title: Building a new game (Game SDK)
category: basics
tags: [game-sdk, developer, building-games, contributor, custom-game]
status: PUBLISHED
admin_only: false
---

# Building a new game for AI Arena

Yes — you can build games for AI Arena. The platform has a public **Game SDK** that defines a contract every game must implement, and the engine handles the rest: matchmaking, Tables, spectating, replays, ELO, tournaments, and the four bot AI tiers (Novice / Intermediate / Advanced / Master) all work the same way regardless of which game is in play.

## What you write vs. what the platform provides

When you add a new game you write a `packages/game-<name>/` package conforming to the SDK in `packages/sdk/`. That package owns:

- **Game state model** — what a "position" or "game state" looks like.
- **Move generator** — given a state, what are the legal moves.
- **Apply move** — given a state + move, what's the next state.
- **Terminal check** — is this state a win / loss / draw, and for whom.
- **Optional rendering hooks** — how the game looks in the browser.

That's it for the contract. Once those four methods work, you get for free:

- Real-time multiplayer Tables (PvP, bot challenges, spectating).
- The four built-in minimax-tier opponents (Quick Bots) — they work against any game implementing the SDK.
- ML training (Q-learning, SARSA, Monte Carlo, DQN, AlphaZero) via the Gym, including hyperparameter tuning and skill evaluation.
- Tournament brackets and recurring cups, with ELO ladders per game.
- Replays, sparring, the Bot Directory, and the Intelligent Guide.

## Who can build a game

Right now the Game SDK is an internal contract — the existing games (XO, Pong, planned Connect 4) are bundled with the platform. There's no public submission process in v1; that's planned for later. If you're interested in contributing a game, **use the Feedback button** on any page to start the conversation. We'll work with you on the integration.

If you're a developer looking at the SDK directly, the canonical reference is the `Game SDK Developer Guide` design doc in the repo — much more detail there than this page covers.

## What kinds of games fit

The platform is tuned for **2-player, turn-based, perfect-information games** — tic-tac-toe and its larger cousins, Connect 4, Othello, simple draughts variants, that kind of thing. Real-time games (Pong is the experimental exception) and imperfect-information games (poker, Stratego) are technically possible but the bot tiers, evaluation, and ML pipelines need significant adaptation.

If you have a game idea you think would fit, the Feedback button is the right place to pitch it.
