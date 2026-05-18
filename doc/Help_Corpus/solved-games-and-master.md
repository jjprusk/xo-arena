---
slug: solved-games-and-master
title: Solved games — why some games can't be won, what Master mode is, and how to think about it
category: concepts
tags: [solved-games, perfect-play, master, hard-tier, game-theory, connect-four, tic-tac-toe, pedagogy]
status: PUBLISHED
admin_only: false
---

# Solved games and the Master tier

Some board games are **solved** — game theory has worked out the
optimal strategy from the starting position. For solved games,
"perfect play" produces a known outcome every time, and there's no
clever move that gets you past it.

This page explains what "solved" means, how it affects gameplay on
AI Arena, why connect-four has a "Master" tier above Hard (and
tic-tac-toe doesn't), and how to think about training against bots
that play optimally.

## What does "solved" mean?

A game is *solved* when game theory can specify, for any reachable
position, the optimal move and the outcome that perfect play from
that point leads to. For a fully solved game (also called "strongly
solved"), this is true from the starting position onward.

For two-player games like the ones on AI Arena, "solved" usually
means one of three outcomes is guaranteed under perfect play from
both sides:

- **First-player wins** — the first-mover always wins with optimal
  play.
- **Second-player wins** — the second-mover always wins (rare in
  practice).
- **Forced draw** — neither side can force a win; perfect play
  always ends in a draw.

The phrase "perfect play" is important. *Imperfect* play (anything
less than optimal) creates opportunities for the other side. The
"solved" result is the ceiling, not what happens in every game
between humans or non-optimal bots.

## Tic-tac-toe — solved, forced draw

Tic-tac-toe is the canonical solved game. The board is small enough
(3×3, 9 cells, fewer than 5,500 unique positions) that the entire
game tree fits in memory, and the result has been known for
centuries.

**Perfect play from both sides always ends in a draw.**

What this means in practice:

- A perfect-play tic-tac-toe bot **cannot lose**.
- A perfect-play tic-tac-toe bot **can lose if its opponent plays
  perfectly** … wait, that's a contradiction. Let me rephrase:
  *two* perfect-play bots playing each other always draw. A perfect-
  play bot facing an imperfect player will either win (if the
  opponent makes a mistake) or draw (if the opponent plays
  perfectly).
- The platform's *Hard* tic-tac-toe bot plays close to perfectly.
  Reaching the level where you consistently draw the Hard bot is
  the recognized ceiling. Beating Hard isn't an expectation; *not
  losing* to Hard is.

Because the ceiling in tic-tac-toe is a draw (achievable by any
careful player or trained bot), tic-tac-toe doesn't need a tier
above Hard. Hard is already the apex.

## Connect-four — solved, first-player wins

Connect-four was solved in 1988 by James Allen and (independently)
Victor Allis. With perfect play, **the first player always wins**.
The winning strategy starts with placing the opening piece in the
center column.

What this means in practice:

- A perfect-play connect-four bot, going *first*, **cannot be
  beaten**. Period. Not by a great human player; not by a strong
  trained bot; not by anyone. Perfect play from the center is a
  forced win.
- A perfect-play connect-four bot, going *second*, can sometimes
  be drawn — if the first-mover plays imperfectly. Against a
  *perfect* first-mover, the perfect second-mover still loses.

This creates a real product problem. The XO-style tier ladder
("Easy → Medium → Hard, beat them all to climb") doesn't work when
"Hard" means *mathematically unbeatable*. We solved this two ways.

## How the platform handles the connect-four problem

### Step 1 — Hard is depth-capped (not perfect)

The connect-four **Hard** bot plays strong minimax search but
intentionally capped at a depth shorter than the depth required for
perfect play. Practically, this means:

- Hard plays *very well* — strong opening, sound midgame,
  tactically alert.
- Hard sometimes misses long-horizon tactical lines that a perfect
  bot would catch.
- A patient, skilled player (or a sufficiently-trained user bot)
  can beat Hard with effort.

This preserves the climb-the-ladder feeling: Easy → Medium → Hard
is a real progression, with Hard being the apex of the rated
ladder.

### Step 2 — Master is a separate, opt-in challenge

Above Hard sits the **Master** tier. Master plays mathematically
perfect connect-four. It exists as a separate Challenge mode (not
on the rated ladder) so that:

- The platform stays honest about the fact that connect-four is
  solved.
- Curious players can experience perfect play firsthand.
- The result vs. Master doesn't affect your ELO (since perfect play
  is, by definition, unbeatable as first-mover and the result
  carries no skill signal).

The Master button lives on the connect-four home page. Clicking
it opens a best-of-2 Challenge match — you'll play one game as
first-mover, one as second-mover.

### What "beating Master" looks like

You can't beat Master in the literal "2-0 win the match" sense.
The realistic outcome ranges:

| Match result | Meaning |
|---|---|
| **0.5 / 2.0** (you drew as first-mover, lost as second) | This is the **ceiling**. You played near-perfectly when you had the advantage; you couldn't escape the inevitable when Master had it. Real accomplishment. |
| **0.5 / 2.0** (you lost as first-mover, drew as second) | Mathematically impossible against a perfect Master. If this happens, Master isn't actually perfect — file a bug. |
| **0.0 / 2.0** (you lost both) | Most common result, especially when you're learning. The first-mover game is where to focus — that's where you have the strategic upper hand. |
| **1.0 / 2.0** (you won one, lost one) | Mathematically impossible against a perfect Master. Bug. |
| **2.0 / 2.0** (you swept) | Mathematically impossible. If this happens, our Master implementation has a flaw — please report it. |

So: the goal vs Master is *force a draw as first-mover*. That's
"beating" Master in the only sense that's available to you.

### Why have a Master at all?

Three reasons:

1. **Pedagogy.** Solved games are a fascinating concept in game
   theory and AI. Letting players experience perfect play firsthand
   is a teaching surface — much more vivid than reading "connect-
   four is solved" on Wikipedia.
2. **Bot training goalpost.** Users training their own connect-four
   bots (especially AlphaZero variants) can use Master as a quality
   benchmark — "can my bot reach Master parity?" This is the
   canonical AlphaZero teaching moment, and it works because Master
   is the actual ceiling.
3. **Honest game design.** Pretending connect-four isn't solved
   would be misleading and would damage the platform's
   pedagogical credibility. Master is the honest acknowledgment.

## Built-in tier comparison across games

| Tier | Tic-tac-toe | Connect-four |
|---|---|---|
| Easy | Heuristic with random | Heuristic with random |
| Medium | Depth-2 minimax | Depth-4 minimax |
| Hard | Near-perfect (depth-9 or full game tree) | **Depth-capped strong play** (depth-6 to depth-8 minimax) |
| Master | n/a (Hard is already the ceiling) | **Perfect play** (depth required for solved-game optimality) |

The asymmetry between games is intentional — each game's tier
structure reflects its game-theoretic reality. Tic-tac-toe's
ceiling is a draw, achievable by Hard. Connect-four's ceiling
splits into two: a beatable-with-effort Hard tier on the rated
ladder, and a perfect-play Master tier off-ladder.

Future games on AI Arena (Hex, Othello, etc.) will follow the same
pattern — if a game is solved, its Master tier exists; if not,
Hard is the apex.

## How to think about losing to Master

Losing to Master isn't a measure of your skill; it's a measure of
the game's solved-ness. Perfect play has been worked out;
*everyone* loses to a perfect connect-four first-mover.

The skill signal that matters is:

- **As first-mover against Master**: did you draw, or did you make
  a mistake and let Master capitalize? Drawing means you found the
  perfect line.
- **As second-mover against Master**: did the game last as long as
  possible? Did you force Master to make every optimal move? You
  can't escape the loss but you can make Master *earn* it.

Strong connect-four play is about minimizing your own mistakes more
than finding clever wins. Master makes that the explicit goal.

## Training bots against Master

If you've trained a connect-four bot (especially AlphaZero) and
want to evaluate it:

- Run **Master matches** to see how close your bot is to perfect
  play. A bot that consistently draws as first-mover and loses
  slowly as second-mover is approaching the theoretical optimum.
- Master matches don't update your bot's ELO (Master is off-ladder).
  They populate a separate **"vs Master"** stat block on the bot
  detail page.

Watching your trained bot improve against Master over training
sessions is the most direct way to see your bot approaching perfect
play. That's the AlphaZero teaching moment in action.

## See also

- **`matches-and-games`** — what a match is and why colors
  alternate within one.
- **`match-formats`** — the per-context match format table,
  including Master Challenge format.
- **`algorithm-alphazero`** — the algorithm best-suited for
  reaching near-perfect connect-four play through self-play.
- **`bot-training-concepts`** — the general training vocabulary
  (plateau, exploration, convergence) that applies to all games.
