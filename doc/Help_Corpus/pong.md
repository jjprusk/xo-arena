---
slug: pong
title: Pong (experimental)
category: games
tags: [pong, experimental, multiplayer, realtime]
status: PUBLISHED
admin_only: false
---

# Pong (experimental)

Pong is AI Arena's second game, currently shipped as an **experimental "spike"** — it works, it's playable, but it's intentionally narrower than XO. The Pong surface is a real-time multiplayer test for the platform's networking stack as well as a preview of what other games on AI Arena will look like.

## How to play

1. From `/pong`, click **Create room**. You'll get a link.
2. Share the link with another player (or open it yourself in another browser).
3. Player 1 controls the left paddle; player 2 controls the right paddle.
4. First to **7 points** wins.

The room is a Table just like XO — public Tables show up in the Tables list (with game = pong); private Tables are link-only.

## Controls

Keyboard:

- **W / S** or **Up / Down arrows** — move your paddle up/down.

The controls are intentional and minimal — Pong is a real-time game, so any latency in the control loop is part of the experience.

## What's experimental about it

The label "spike" means a few things:

- **No tournaments** — Pong isn't yet integrated with the tournament/cup system. You can play one-off matches; you can't enter a Pong tournament.
- **No bot training in v1** — the Gym does not yet expose Pong as a training target. The codebase has Pong wired into the SDK and the AI registry, but the UI to train a Pong bot is gated.
- **Limited matchmaking** — Quick Match doesn't pair you in Pong. Use the Tables list to find an open room.
- **Spectator features minimal** — spectators can watch but the latency/buffering behaviour is rougher than XO.

What's *not* experimental: the underlying infrastructure. Pong shares the realtime channels, Table model, ELO service, and SDK contract with XO. The experimental label is about polish and feature completeness, not stability.

## Why Pong is interesting

XO is a perfect-information turn-based game. Pong is real-time and continuous. Building both on the same platform demonstrates that the SDK contract (`packages/sdk/`) can support both kinds of games — which is the architectural foundation for adding Chess, Connect Four, or any future game without rewriting the platform.

When Pong graduates from "spike" to fully shipped, you can expect:

- Bot training (likely AlphaZero variants — Pong is well-suited to MCTS).
- Tournaments and cups.
- Proper matchmaking and ladder.
- Tightened spectator experience.

For now, Pong is a fun aside and a useful platform stress test.

## Disconnect recovery

If your opponent's connection drops, you'll see an "Opponent disconnected" recovery page. They have a brief window to reconnect; if they don't, the match ends.

## Why no AI?

The bot side of Pong is harder than XO's because the state space is continuous and the action timing matters. The platform's RL algorithms are ready (AlphaZero in particular handles this kind of game well), but training a competitive Pong bot is a much longer session than training an XO bot. Getting that training UX right is what the Pong full release is waiting on.
