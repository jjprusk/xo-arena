---
slug: matches-and-games
title: Matches and games — what they are, how colors work, why the distinction matters
category: gameplay
tags: [matches, games, alternating-colors, first-move, fairness, gameplay, basics]
status: PUBLISHED
admin_only: false
---

# Matches and games

Most board games on AI Arena are played in **matches**, not single games. This
page explains what a match is, why it's the unit of play (not the individual
game), how colors / first-move privilege work, and why we built it this way.

If you're just here for the rules: skip to **The 30-second version** below.
If you want to understand the design — why a match instead of a single game,
why colors alternate, what happens if a match ends in a tie — keep reading.

## The 30-second version

- A **game** is one round of play: pieces are placed, someone wins or draws,
  the board is reset.
- A **match** is a sequence of 1+ games, with the result computed from
  *all* the games in the sequence.
- Within a match, **colors alternate** — you go first in one game, the
  opponent goes first in the next. Over the match as a whole, the
  first-mover advantage is shared equally.
- ELO and classification updates happen per **match**, not per game.

How many games are in a match depends on context — see
`match-formats` for the full table.

## Why a match, not a single game?

Both games on AI Arena (tic-tac-toe and connect-four) have a built-in
asymmetry: the player who moves first has an advantage. In some games
(tic-tac-toe with imperfect play) the advantage is small; in others
(connect-four with strong play) it's decisive.

If a competitive game is just one round, then *the coin flip that decides
who goes first* becomes a meaningful part of the result — sometimes more
meaningful than the players' skill. That's not what a ladder is supposed
to measure.

Matches solve this. By playing multiple games with colors rotating, the
advantage cancels out. The match result reflects who played better
overall, not who got lucky with the coin flip.

This also makes the ELO math more honest. A single-game ELO update on a
high-variance, first-mover-decided outcome is a noisy signal. A match-level
update — pooled across games where both players had the advantage — is a
much cleaner one.

## How colors / first-move work

Different games use different terminology — *X / O* in tic-tac-toe,
*Red / Yellow* in connect-four — but the underlying mechanic is the
same: one side moves first.

For each match, color assignment follows these rules:

- **Game 1 of a match**: random (announced before the match starts), or
  fixed by tournament seeding. Both players know which side they're
  playing before the first move.
- **Subsequent games in the same match**: colors swap automatically. If
  you were the first-mover in game 1, you're the second-mover in game 2,
  and so on.
- **Tournament tiebreaker games** (game 3 in a best-of-3 that's tied 1-1):
  random color assignment, announced up front, both players go in
  knowing the variance.

You can't pick your color manually. The game does it for you. This is
on purpose — letting players choose color introduces a strategic
mini-game (who gets first move) that the ladder isn't designed to
measure.

## Examples

### Tic-tac-toe (3×3, X and O)

A casual quick match is a **single game**. Whoever the system assigned
to X goes first, plays one round, the result updates your stats.
Fast snack-play; no alternating-colors complexity because there's
nothing to alternate against.

A ranked match is **best-of-2**:
- **Game 1**: you're X, opponent is O. You go first.
- **Game 2**: you're O, opponent is X. They go first.
- **Result**: 2-0, 1-1 (with the per-game tally being win/draw/loss
  scored as 1/0.5/0), and the match score is averaged.

A tournament match is **best-of-3**, with game 3's color being random
if needed (only fires if 1-1 after the first two games).

### Connect four (6×7, Red and Yellow)

Same rules, slightly different numbers because connect-four games
take longer:

- **Casual quick match**: one game, system-assigned color.
- **Ranked**: best-of-2, alternating Red/Yellow. ~3 minutes of play.
- **Tournament**: best-of-3, with random color on the tiebreaker
  if it fires.

For connect-four specifically, first-mover advantage is *much* larger
than in tic-tac-toe — the game is solved, and with perfect play the
first-mover always wins. See `solved-games-and-master` for what that
means in practice.

## When a match ends

A match ends as soon as the result is decided. That means:

- **Best-of-1**: ends after game 1.
- **Best-of-2**: plays both games. The match result is the sum of the
  two per-game scores. Both 1-1 (a tie) and 2-0 (a clean sweep) are
  valid match outcomes.
- **Best-of-3**: plays games until one player has 2 wins, then stops.
  Game 3 only fires if games 1 and 2 were split 1-1. (Two clean wins
  ends the match early — you don't play game 3 just because it was
  scheduled.)

For ranked play, draws in a match are allowed. Your ELO might move
a small amount even if the match is tied; that's normal.

For tournaments, draws are not allowed — game 3 with random colors
breaks the tie, and one player advances.

## Why we did it this way

The detailed design reasoning lives in `match-design-rationale`.
Short version: we wanted ratings that measure *skill*, not luck;
matches that are still snackable for casual play; and a tournament
format that produces decisive winners. Best-of-2 for ranked and
best-of-3 for tournaments hits that target. Anything shorter loses
fairness; anything longer makes ranked play too long for everyday
use.

## See also

- **`match-formats`** — the full table of match lengths per context
  (casual / ranked / tournament / Master Challenge) plus the ELO math.
- **`match-design-rationale`** — the trade-offs we considered and
  why we landed here.
- **`solved-games-and-master`** — why connect-four's "Hard" tier is
  beatable but its "Master" tier is mathematically not, and what that
  means for ranked play.
