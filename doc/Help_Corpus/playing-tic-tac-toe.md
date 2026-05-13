---
slug: playing-tic-tac-toe
title: Playing Tic-Tac-Toe (XO)
category: games
tags: [tic-tac-toe, xo, gameplay, rules]
status: PUBLISHED
admin_only: false
---

# Playing Tic-Tac-Toe (XO)

Tic-Tac-Toe is the default game on AI Arena. The board is small, the rules are simple, and the strategic depth is exactly what AI Arena uses to teach machine learning concepts.

## How to play

X always moves first. Click any empty cell on the 3x3 grid to place your mark. The first player to get three in a row — horizontally, vertically, or diagonally — wins. If all nine cells fill without three-in-a-row, the game is a draw.

When you're playing against a bot, the bot moves automatically after you. Stronger bots take a moment to "think" — that pause is real computation, not animation.

## Why most expert games end in draws

If both sides play optimally, Tic-Tac-Toe is a forced draw. There is no winning strategy against a perfect opponent. That's why high-tier bots almost always draw against each other and against expert players.

The skill, then, is in **punishing mistakes**. The center cell, the four corners, and forced double-threats are the main levers strong play uses. Weak bots make small mistakes that good players can exploit.

## Match modes

You can play XO in several modes:

- **Quick Play** — single game against a matchmade built-in bot (vs. AI).
- **Challenge a bot** — pick any bot from the Bot Directory and play it.
- **PvP** — open a Table and wait for another human, or join an open Table from the Tables list.
- **Spar** — a Curriculum-step training match between *your bot* and a built-in opponent at easy / medium / hard.
- **Tournament match** — a best-of-N series (default 3) inside a tournament bracket.

## Replays

Every completed game produces a replay you can step through move-by-move. Open a game from your Profile or Table history; click the replay icon. Each move shows the position (1–9 left-to-right, top-to-bottom) and the time taken.

Replays are stored for a retention window (currently 90 days for casual games and 90 days for tournament games by default, both admin-tunable). After that the move stream is purged; the final result is kept forever.

## ELO and your rating

Every XO game updates an ELO rating tied to that game. PvP ranked games and bot challenges contribute to your XO ELO. Quick Play against the lowest-tier built-in bot does not (it's tuned for first-time players).

Tournament games adjust your tournament classification (Rookie, Amateur, Intermediate, etc.) — separate from your ELO.
