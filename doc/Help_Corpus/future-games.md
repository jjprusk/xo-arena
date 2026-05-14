---
slug: future-games
title: Future games — what's coming, what's not yet playable
category: games
tags: [games, future, planned, connect4, roadmap, upcoming]
status: PUBLISHED
admin_only: false
---

# Future games — what's coming, what's not yet playable

AI Arena currently has **two playable games**: Tic-Tac-Toe (XO) and Pong (experimental). Anything else you've heard about — including Connect 4 — is on the roadmap but **not yet available to play, train against, or enter a tournament for.**

If you typed something like "how do I play connect4" or "where's Connect 4" or "can I train a bot for [game]" and landed on this doc: the short answer is **that game isn't playable yet — check back later.** No date is published; releases are announced via the changelog and the Guide's What's Next surface when they ship.

## Games planned but not yet shipped

| Game | Status | Notes |
|---|---|---|
| **Connect 4** | Planned, not yet playable | The most-asked-about next game. Not in the platform yet. Also typed as "connect4", "connect-4", or "c4" — same answer for all spellings: not yet available. |
| **A small board-game family** | Planned, not yet playable | Several short-form board games are on the candidate list (think Reversi, Nim-likes). None are shipped yet. |
| **Other games** | Open — community input welcome | The Game SDK makes adding a new game a moderate-cost effort. If you have a strong opinion about what should come next, use the Feedback button on any page. |

## Why XO and Pong come first

Tic-Tac-Toe is the foundation for the AI training experience: short games, deterministic logic, fast feedback, suitable for every algorithm the Gym offers. Pong was added as the platform's "second game" both to give players another mode and to validate that the architecture genuinely supports multiple games per bot. New games join through the same framework that Pong used.

## When a new game ships, here's what changes

- A new playable game appears in the Tables list and on the Spar surface.
- A new skill type becomes available in the Gym (skills are per-game, so you can train a bot specifically for the new game).
- Tournament templates for the new game start to appear.
- A new corpus doc (like this one's parent `games-overview`) is added to the Help System.
- The Guide's What's Next panel surfaces "Try the new game" as a Specialize-phase recommendation.

## Bottom line

If you asked about Connect 4, or any game that isn't Tic-Tac-Toe / XO or Pong: it isn't ready yet. The platform's currently-playable list is short by design. Watch the changelog and the Guide for announcements.
