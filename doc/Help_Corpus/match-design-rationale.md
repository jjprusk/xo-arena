---
slug: match-design-rationale
title: Match design rationale — why best-of-2 ranked, why alternating colors, why a Master tier
category: concepts
tags: [matches, design, rationale, philosophy, trade-offs, ranked-play, tournaments, fairness]
status: PUBLISHED
admin_only: false
---

# Why we designed matches this way

This page is the *thinking-out-loud* version of the match rules.
The rules themselves live in `match-formats`; the concept of a
match lives in `matches-and-games`. This page exists for two
audiences:

1. **Players who want to understand the platform's design** —
   why is ranked play best-of-2 and not best-of-1 or best-of-3?
   Why are draws allowed? Why does the tournament tiebreaker
   randomize color?
2. **Future game contributors** (and our future selves) — what
   trade-offs did we consider, what did we reject, and what signals
   would make us revisit?

If you're just looking for the rules, see `match-formats`. If you
want to understand *why those rules*, keep reading.

## The problem we were solving

When the platform was tic-tac-toe-only, a "match" was a single
game. That worked because tic-tac-toe's first-mover advantage is
small — Easy and Medium bots can lose as either color, and at the
top of the ladder perfect play draws regardless. A one-shot result
was a tolerable signal.

Then we started designing connect-four. Connect-four is solved with
**first-player wins** under perfect play, and even at imperfect
play levels the first-mover advantage is substantial. A one-shot
connect-four result is dominated by *who got first-move* far more
than by *who played better*. That breaks ELO. That breaks the
ladder. That breaks tournament fairness.

We could have fixed connect-four specifically — built a special
case where connect-four uses matches and tic-tac-toe stays single-
game. But that creates two divergent mental models, two sets of UI
patterns, two documentation surfaces. The cost of consistency was
small: tic-tac-toe doesn't *suffer* from match-based play (games
are short), and gets the same benefit (fairer ratings, less
first-mover noise).

So the decision was: **the match becomes the unit of play across
all 2-person games**. Same model, same UI, same docs, fair across
games.

## Why alternating colors

Within a match, colors alternate. Game 1 you're X (or Red); game 2
you're O (or Yellow); game 3 (if it fires) is random color.

The alternative was *fixed colors throughout the match* — whoever
gets first-mover in game 1 stays first-mover. We rejected this
because:

- It makes the color assignment in game 1 even more decisive than
  before. Match-based play would do nothing to dilute first-mover
  advantage.
- It compounds the unfairness: a player who keeps getting first-
  mover across matches has a structural rating advantage.

The alternative of *letting players choose their color* — common in
some games — was also rejected because:

- Color choice becomes a strategic mini-game. Some players would
  game it (always pick first-mover when possible) and the ladder
  would measure color-picking skill more than playing skill.
- It introduces decision fatigue. Casual players don't want to
  evaluate color choices before every match.

Random / fixed alternation is the cleanest model. Each player
plays both colors equally; neither side gets a long-run advantage.

## Why best-of-2 for ranked (not best-of-1 or best-of-3)

Three options for ranked match length: best-of-1, best-of-2, best-
of-3. We picked best-of-2.

**Best-of-1** was rejected because it can't honor the alternating-
colors rule (there's only one game to alternate). A single-game
ranked match would re-introduce all the first-mover-luck problems
matches exist to fix.

**Best-of-3** was tempting — more games means better signal, and
tournaments use best-of-3 anyway. We rejected it for ranked because
of session length:

- Average connect-four game: ~90 seconds. Best-of-3 connect-four
  match: ~4.5 minutes, often more once you factor in thinking time.
- Average tic-tac-toe game: ~30 seconds. Best-of-3 tic-tac-toe
  match: ~1.5 minutes.
- Ranked play is the *everyday ladder-climbing flow*. It should be
  snackable — quick session, real progress, move on. Best-of-3
  pushes ranked matches into "I need a real chunk of time to play"
  territory, which kills the casual-but-serious use case.

**Best-of-2** is the smallest match that respects alternating
colors. ~3 minutes for a connect-four match, ~1 minute for tic-
tac-toe. Snackable, fair, statistically meaningful.

### Why draws are allowed in ranked

Best-of-2 produces 1-1 ties frequently — especially between equally
matched players. We chose to *allow* the tie rather than force a
sudden-death game.

The argument for allowing draws:

- A 1-1 tie *is* a valid signal: both players showed they could
  win as one color and lose as the other. That's an honest result.
- A sudden-death game would re-introduce first-mover luck (whoever
  got the color advantage would have a real edge in the deciding
  game) — defeating the purpose of alternating colors.
- ELO math handles fractional outcomes cleanly. A 1-1 match score
  of 0.5 vs an expected 0.44 (slightly favored) → small positive
  ELO movement. The signal is small but real.

The argument against (which we considered): users may find drawn
ranked matches less satisfying than decisive ones. We weighed this
against the fairness cost of forcing a winner and concluded that
fairness wins. If user research suggests otherwise, we'd revisit.

## Why best-of-3 for tournaments

Tournament brackets *must* produce a winner — you can't carry a
draw forward. So tournament matches need a tiebreaker mechanism.

Best-of-3 is the smallest tournament format that:

- Honors alternating colors for the first two games (fair under
  normal play).
- Has a natural tiebreaker (game 3 only fires if 1-1, by which
  point both players have played each color once).
- Stays under ~10 minutes total for connect-four matches even with
  longer thinking time.

We considered best-of-5 (more standard in chess) but rejected it
for the same session-length reason: tournament participation should
be tractable for casual-but-engaged players, not a multi-hour
commitment.

### Why game-3 color is random, not seed-based

When a tournament match is 1-1 going into game 3, both players have
already played one game as first-mover and one as second. Game 3 is
asymmetric — whoever gets first-mover has the edge, especially in
connect-four. We considered four ways to assign color:

| Assignment rule | Why we rejected it |
|---|---|
| **Higher seed gets first-mover** | Rewards rating, entrenches top players, conflicts with the "ladder measures skill" principle. |
| **Loser of game 2 picks** | Introduces a strategic mini-game (color selection) right when both players are mentally fatigued from the tied match. |
| **Whoever had the disadvantage cumulative-wise gets first-mover** | Both players have had exactly one of each color in games 1+2; there is no cumulative disadvantage to compensate. |
| **Random, announced before the match** | What we picked. |

Random is the cleanest rule. Both players know it going in. The
variance is real but distributed evenly across many tournaments —
some matches you get the lucky color, some you don't. Over a career
this evens out.

This mirrors chess Armageddon convention, where draw-breakers
combine random color with asymmetric time controls. We don't need
the time-control side because our game clocks are different by
nature.

## Why a separate Master tier for connect-four

The connect-four solved-game problem (perfect play wins for the
first-mover) forced a design choice. Three options:

**Option α — Connect-four Hard = perfect play.** Same shape as tic-
tac-toe Hard. But "Hard" becomes mathematically unbeatable, which
breaks the climb-the-ladder pedagogy. Rejected.

**Option β — Connect-four Hard = depth-capped strong play; nothing
above Hard.** Hard is beatable; the ladder works. But we hide the
fact that connect-four is solved, which is intellectually dishonest
for a platform whose pitch is "learn AI through games." Rejected.

**Option γ — Hard = depth-capped, Master = perfect, Master is
off-ladder.** Hard preserves the climb-the-ladder UX; Master is
the honest acknowledgment of the solved-game ceiling; the
asymmetry from tic-tac-toe (no Master tier) is fine because tic-
tac-toe's ceiling is already at Hard. **This is what we shipped.**

The decision to put Master off-ladder (no ELO impact) was important.
If Master matches affected ELO, the rating system would have to
account for the fact that *everyone loses to Master as second-mover*
— which is structural, not skill-based. Off-ladder neatly avoids
that.

## What we'd revisit, and what signals would prompt it

The match design is a v1 lock, but some pieces are calibrations we
might tune:

- **Hard's depth in connect-four.** If user feedback says Hard is
  too easy / too hard, we'd adjust the minimax depth. Starting at
  depth-6; could drop to depth-5 or push to depth-7/8 once we
  see ranked-game-completion data.
- **Best-of-2 vs best-of-3 for ranked.** If ranked matches feel
  too noisy (1-1 ties happening more than ~40% of matches across
  the user base, or ELO movement feels too erratic), we'd consider
  bumping ranked to best-of-3. The cost is session length; the
  benefit is more signal per match.
- **The random-color tiebreaker for tournament game 3.** If
  tournament participants consistently report frustration with the
  random rule (e.g. it's the deciding factor in too many high-
  stakes matches), we'd consider switching to a seeded rule or
  some other convention.
- **Master inclusion for future games.** Each future solved game
  inherits the Master tier idea — we'd evaluate per-game whether
  the math makes Master worthwhile. Some solved games are forced-
  draw (like tic-tac-toe) and don't need a Master tier above the
  Hard tier; others are first-player-wins (like connect-four) and
  do.

## The deeper principle

The match design reflects a single principle: **the rating
ladder should measure skill, not luck**. Every choice — alternating
colors, match-based ELO, allowed draws, random tournament
tiebreakers — is in service of that principle.

When future games are added to AI Arena, the same principle should
guide their tier structure, tournament format, and rating math.
First-mover advantage gets diluted; structural game-theoretic
realities (like solved-game ceilings) get acknowledged honestly;
ratings reflect what they're supposed to reflect.

## See also

- **`matches-and-games`** — what a match is and how colors
  alternate within it.
- **`match-formats`** — the operational rules for each context
  (casual / ranked / tournament / Master Challenge).
- **`solved-games-and-master`** — the game-theoretic background
  behind the Master tier decision.
- **`activity-tiers-and-ranking`** — how ELO and classification
  tiers map onto your rating progression.
