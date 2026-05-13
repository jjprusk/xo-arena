---
slug: playing-tic-tac-toe
title: Playing Tic-Tac-Toe
category: games
tags: [tic-tac-toe, xo, gameplay]
status: PUBLISHED
admin_only: false
---

# Playing Tic-Tac-Toe (XO)

Tic-Tac-Toe is the default game on AI Arena. It's the simplest classic game, and that's exactly what makes it interesting for AI: a small board, perfect information, and a manageable number of possible positions.

## How to play

X always moves first. Click any empty cell on the 3x3 grid to place your mark. The first player to get three in a row — horizontally, vertically, or diagonally — wins. If all nine cells fill without three-in-a-row, the game is a draw.

If you're playing against a bot, the bot moves automatically after you. Strong bots take a moment to "think" — that delay is real computation, not a UI trick.

## Why most games end in draws

If both players play optimally, Tic-Tac-Toe is a forced draw. There's no winning strategy that beats a perfect opponent. That's why most games against the strongest bots end without a winner.

The skill, then, is in punishing mistakes. The center cell, the four corners, and forced double-threats are the levers strong play uses. Weak bots make small mistakes that good players can exploit.

## Reading the board

Each cell on the board has a position (1-9, reading left-to-right, top-to-bottom). After the game, the **replay viewer** shows every move with its position and timestamp. This is helpful when you're learning — you can see where you went wrong.

## What about Pong?

Pong is a second game we're rolling out, with the same matchmaking and bot infrastructure. Most help articles apply equally to both — when they don't, they say so.
