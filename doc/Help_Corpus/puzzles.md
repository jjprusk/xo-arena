---
slug: puzzles
title: Puzzles — what they are and why they're there
category: gameplay
tags: [puzzles, tactics, training, tic-tac-toe, learning]
status: PUBLISHED
admin_only: false
---

# Puzzles — what they are and why they're there

The **Puzzles** page (under the top-nav, route `/puzzles`) gives you single-position tic-tac-toe tactical exercises. Each puzzle hands you a board mid-game and asks you to find the one move that solves it. They're small, fast, and intentionally bite-sized — a typical puzzle solves in under five seconds once you see it.

## The four puzzle types

| Type | What you're asked to do | Why it matters |
|---|---|---|
| **Win in 1** | Find the move that wins immediately (three-in-a-row on this turn). | Trains the basic "complete your line" reflex — the most fundamental tic-tac-toe action. |
| **Block in 1** | Stop your opponent from winning on their next turn. | Trains defensive awareness — seeing the *opponent's* threats, not just your own. |
| **Fork** | Find a move that creates two simultaneous winning threats so the opponent can only block one. | Trains the central winning idea in tic-tac-toe. Forks are how strong players (and bots) generate wins; without them, perfect play leads to a draw. |
| **Survive** | Most moves from this position lose; find the one that doesn't. | Trains pattern recognition for losing positions — knowing which lines to avoid. Often the move is non-obvious. |

## Why puzzles exist on AI Arena

Puzzles serve three purposes that line up with the rest of the platform's training arc:

1. **Skill-building for human play.** Even though AI Arena's centerpiece is bot training, you'll still play tic-tac-toe yourself — against your own bots, against built-ins, in Spar, in Cups. Sharper tactical eyes make you a better evaluator of how *your bot* is playing.

2. **Understanding what a bot has to learn.** Every algorithm in the Gym (Q-Learning, DQN, AlphaZero, etc.) is internally learning to recognize the patterns these puzzles isolate: when to complete a line, when to block, when a fork is available. Solving puzzles by hand makes the "what the bot is figuring out" conversation tangible. The bot-training docs lean on these exact concepts.

3. **A low-stakes warm-up.** Sometimes you don't want a full game — you want to ping a few positions, get a hit of "got it!", and move on. Puzzles fit that. They're free, untimed, and don't affect your ELO or rankings.

## How they're generated

Puzzles aren't hand-curated — they're generated procedurally on the server. Each request to the puzzle endpoint asks for a specific type (or "any") and the server constructs a fresh position that satisfies the constraint, validates it with minimax, and returns the position + correct answer. There's effectively unlimited supply.

This means: don't try to memorize puzzles — you'll see a different one next time. The skill the puzzles train is **pattern recognition**, not memorization.

## Where puzzles fit in the journey

The Intelligent Guide doesn't currently put puzzles on the critical path — they're a side activity, not part of the 7-step onboarding journey. After you finish the Curriculum and enter Specialize phase, puzzles become one of the "things to do" surfaced in the Guide's What's Next panel for users in the Explorer archetype.

If you're brand new and want to warm up before training your first bot, puzzles are a good 5-minute primer on the game's tactical layer. If you've been training bots and find your benchmarks plateauing, puzzles are a useful sanity check that you still understand *why* your bot's strong moves are strong.

## Bottom line

The Puzzles page is a small, focused tactical-training surface. Four types, infinite supply, fast feedback. They sit alongside training-your-bot and playing-real-games as the third learning lane on AI Arena — the one where *you* are the learner, not the bot.
