---
slug: match-formats
title: Match formats — best-of-N, draws, tiebreakers, and how ELO is calculated
category: gameplay
tags: [matches, best-of, format, ranked, tournament, casual, elo, scoring]
status: PUBLISHED
admin_only: false
---

# Match formats

This page is the operational reference: how many games per match,
what the rules are when a match ties, how ELO is computed, and what
the Master Challenge format is for connect-four.

For the *concept* of a match (and why we use them instead of single
games), see `matches-and-games`. For the *reasoning* behind the
specific choices, see `match-design-rationale`.

## The format table

| Context | Match length | Draws allowed? | Tiebreaker if tied? |
|---|---|---|---|
| Casual / Quick Match | **best-of-1** (single game) | Game can end in a draw | n/a |
| Ranked (ladder + classification) | **best-of-2** | Yes — match score reflects the split | n/a |
| Tournament (bracket play) | **best-of-3** | No (one player must advance) | Game 3 with random color |
| Master Challenge (connect-four only) | **best-of-2** | Yes (your goal is to draw as second-mover) | n/a |

That's the whole rulebook. Sections below explain each row in detail.

## Casual / Quick Match — best-of-1

When you tap "Quick Match" against a built-in or community bot, you
get one game. The system picks your color, you play, the game ends,
your stats update.

Casual play exists for snack-play — the goal is *fastest fun match*,
not statistical signal. The ELO update uses the same per-game scoring
as a ranked game (1.0 / 0.5 / 0.0) and the same K-factor, but
because there's only one game, the result is naturally noisier than
the two-game average a ranked match produces.

Casual matches **do** count toward:
- Your total game count.
- Your bot's experience hours.
- Per-game achievements (first win, first draw, etc.).

Casual matches **do not** count toward:
- Tournament eligibility.
- Tier promotions on the classification ladder.

## Ranked — best-of-2 with draws allowed

Ranked matches are the standard format for classification climbing.
Two games, colors alternate, both games count.

### How games are scored

For each game in the match:

- **Win** = 1.0
- **Draw** = 0.5
- **Loss** = 0.0

### How the match is scored

The match score is the *sum* of the per-game scores. So possible
match outcomes for a best-of-2 are:

- **2.0** — Both games won (a clean sweep)
- **1.5** — One win + one draw
- **1.0** — Either both draws *or* one win + one loss
- **0.5** — One draw + one loss
- **0.0** — Both games lost

The ELO update is computed against the match score, normalized to
the range `[0, 1]` (so divide by 2 for a best-of-2 match). A 1-1
split → match score 0.5 → roughly the same ELO outcome as drawing
twice.

### Why draws are allowed in ranked

Forcing a winner on every match would mean every 1-1 tie triggers a
sudden-death game, which would (a) make ranked matches take longer
on average and (b) introduce the same first-mover-luck noise into
the sudden-death game that the alternating-colors rule exists to
eliminate. Draws cost nothing; let them be draws and update ELO
accordingly.

## Tournament — best-of-3 with decisive tiebreaker

Tournament matches need to produce a winner — brackets can't carry
draws forward. So tournaments use **best-of-3** with a tiebreaker
rule for the 1-1 case.

### How games are scored

Same as ranked: 1.0 win, 0.5 draw, 0.0 loss, per game.

### How the match ends

A match ends as soon as one player has won 2 games:

- 2-0 → match ends after game 2; no game 3 played.
- 2-1 → match ends after game 3.
- 1-0-1 (win, draw, win) → game 3 only fires if the first two
  games produced a 1-1 tie.

### The 1-1 tiebreaker — random color

If, after games 1 and 2, the score is 1-1 (each player won one
game), game 3 fires with a **randomly assigned color** for the
deciding game. The random assignment is shown to both players
before the game starts, and both players know going in that this
is the rule. Random feels variance-heavy because it *is* — that's
the cost of forcing a decisive winner from a tied score. Other
formats (higher-seed-wins, loser-picks-color, etc.) all carry their
own unfairness; random is the cleanest.

This is the same convention used in chess tournament Armageddon
games and connect-four professional play.

### Why not best-of-2 in tournaments too?

Tournaments need decisive results because brackets advance one
player per match. Best-of-2 produces 1-1 ties frequently, and
resolving them would require *another* tiebreaker rule that ends
up being best-of-3 in effect. Going to best-of-3 directly is
cleaner.

## Master Challenge — best-of-2, no ranking impact

Connect-four has a built-in **Master tier** that plays mathematically
perfect connect-four. Master sits outside the classification ladder
and exists as a separate Challenge mode (button on the connect-four
home page).

### Format

- **Best-of-2** — one game with you as first-mover, one with Master
  as first-mover.
- Standard 1.0/0.5/0.0 per-game scoring.
- **No ELO update** — Master matches don't affect your rating.
- **Per-bot record kept** — Master results are tracked on the bot
  detail page as a separate stat block (wins / draws / losses vs
  Master).

### What outcomes look like

- **Master as first-mover** → Master wins. Always. Connect-four is
  solved and perfect play wins from the first position.
- **You as first-mover** → Master can be drawn (with strong play
  from you) but not beaten. Realistically you'll lose this game
  too unless you're playing close to optimal.

The achievable Master goal isn't a 2-0 win — it's *drawing the game
where you're first-mover*. A 0.5/2.0 result against Master is a real
accomplishment that the platform will celebrate. See
`solved-games-and-master` for why this is the ceiling and how to
think about it.

## ELO math — per-match update

ELO updates happen after a match completes, not after each game in
the match. The formula uses standard ELO but with the *match score*
(normalized 0–1) as the actual-result input.

> Whether a *tournament* match moves your ELO depends on the game.
> Ranked matches always move ELO; tournament matches are opt-in
> per-game, declared on the game package's SDK metadata. Solved games
> opt out because the best-of-3 game-3 random-color tiebreaker is a
> coinflip on a drawn series — that's bracket-decisive (someone has
> to advance) but not a clean skill signal to feed into the rating
> ladder. Tic-Tac-Toe is opted out today; Connect 4 will opt in when
> it ships, because BO3 1-1-into-game-3 in Connect 4 is decided by
> real play, not random colors. Casual play never moves ELO.

### Worked example: ranked best-of-2

Suppose you're rated 1200 and you play a ranked match against an
opponent rated 1240. You play two games and split 1-1 (one win for
you, one for them).

- **Match score**: (1.0 + 0.0) / 2 = **0.5**
- **Expected score** (from ELO formula): **0.4428** for you, **0.5572**
  for the higher-rated opponent.
- **You scored higher than expected** (0.5 > 0.4428), so your ELO
  *increases* by **+1.8** (to **1201.8**). The opponent's ELO *decreases*
  by the same **1.8** (to **1238.2**). Ratings are stored to one decimal
  place; the deltas are symmetric because the K-factor is shared.

If you'd swept 2-0:
- **Match score**: 1.0 (much higher than expected)
- **ELO gain**: +**17.8** (to **1217.8**) — winning both games against a
  slightly higher-rated opponent is a strong signal.

If you'd been swept 0-2:
- **Match score**: 0.0 (lower than expected)
- **ELO loss**: −**14.2** (to **1185.8**), since you were favored to
  score 0.4428 and scored 0.

The exact formula is `newELO = ELO + K · (actual − expected)` with
**K = 32** for all match outcomes; `actual` is the normalized match
score above, `expected` is the standard ELO logistic against your
opponent's rating. Numbers here use TTT defaults (provisional players
seed at 1200).

### Why the per-match approach feels fairer

Under the old single-game model, one bad game would tank your ELO
even if the opponent only beat you because they got first-mover
privilege. Under match-based ELO, that same loss is balanced
against your win in the swapped-color game — the rating math
captures *who played better overall*, not who got lucky once.

This is also why ranked games take a little longer to climb the
ladder than they used to: each match is a more reliable signal,
which means individual matches move your ELO by less. The total
amount of skill-vs-rating movement per hour stays roughly the same,
but each match counts for more.

## Bots and matches

Both built-in bots (Easy, Medium, Hard) and user bots / community
bots follow the same match formats. A ranked match against any bot
is best-of-2; a tournament match is best-of-3, regardless of which
bot is sitting in the opposing seat.

The Master tier is connect-four-only and uses its own Best-of-2
format described above.

## Connect-four specifics

A few connect-four behaviors worth flagging:

- **A draw in connect-four is uncommon** but possible (the board can
  fill without four-in-a-row). When it happens, both players score
  0.5 on that game.
- **First-mover advantage in connect-four is large** — much larger
  than in tic-tac-toe. The alternating-colors rule matters more
  here. Without it, ratings would drift heavily based on first-mover
  luck.
- **Master draws are real achievements** — getting Master to a draw
  in the game where you're first-mover is what near-perfect
  connect-four play looks like.

## Tic-tac-toe specifics

- **A draw in tic-tac-toe is extremely common** with strong play —
  tic-tac-toe is solved, and perfect play from both sides always
  ends in a draw. A 0.5-0.5 (both games drawn) match between two
  strong players is the *expected* outcome at the top of the ladder.
- **First-mover advantage in tic-tac-toe is small** — Easy and
  Medium bots can lose as either color; perfect-play bots draw as
  either color. The match format still matters for fairness but
  the effect is more subtle than in connect-four.

## See also

- **`matches-and-games`** — the concept of matches vs games, and
  why colors alternate within a match.
- **`match-design-rationale`** — why these specific numbers
  (best-of-2 ranked, best-of-3 tournament, etc.) instead of others.
- **`solved-games-and-master`** — what "solved" means and how the
  Master tier reflects it.
