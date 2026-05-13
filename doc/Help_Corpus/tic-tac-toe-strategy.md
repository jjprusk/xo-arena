---
slug: tic-tac-toe-strategy
title: Tic-Tac-Toe strategy — how to play well
category: games
tags: [tic-tac-toe, xo, strategy, opening, fork, tactics, beginner]
status: PUBLISHED
admin_only: false
---

# Tic-Tac-Toe strategy — how to play well

Tic-Tac-Toe is **a forced draw** under perfect play — neither player can win against a perfect opponent. But almost nobody plays perfectly, and the gap between "good enough to draw with perfect play" and "wins consistently" is small but learnable. This doc walks through it.

If you can't yet beat **Copper** (Intermediate built-in bot) regularly, the principles below will fix that. To beat **Sterling** (Advanced) you'll also need to set up forks. **Magnus** (Master) plays perfectly — you can only draw, never win.

## Board positions

The nine cells are numbered left-to-right, top-to-bottom:

```
 1 | 2 | 3
---+---+---
 4 | 5 | 6
---+---+---
 7 | 8 | 9
```

The **center** (5), the **four corners** (1, 3, 7, 9), and the **four edges** (2, 4, 6, 8) are the three position types. They are not equally valuable.

## Why position value matters

There are exactly **8 winning lines** on the board:

- 3 horizontal: (1-2-3), (4-5-6), (7-8-9)
- 3 vertical: (1-4-7), (2-5-8), (3-6-9)
- 2 diagonal: (1-5-9), (3-5-7)

Each cell participates in some of these lines:

| Cell type | Lines it appears in | Examples |
|---|---|---|
| **Center** (5) | **4 lines** | All three rows through it plus both diagonals |
| **Corner** (1, 3, 7, 9) | **3 lines** | Row + column + one diagonal |
| **Edge** (2, 4, 6, 8) | **2 lines** | Row + column only |

The center is **twice as valuable** as an edge for both offense and defense. This single fact explains 90% of opening theory.

## Opening principles

### If you're X (first move)

**Take the center (5).** It's the strongest opening — you'll be part of 4 potential winning lines from move 1. Against any but a perfect opponent, the center opening sets up multiple paths to a fork.

A **corner opening** (1, 3, 7, or 9) is also strong and slightly trickier — it's the "trap" opening that beats novices who respond with an edge. We'll cover this below.

**Never open with an edge.** Edges only participate in 2 lines; you're handicapping yourself on move 1.

### If you're O (responding to X)

**X took center → you take a corner.** Taking an edge loses against good play; taking another center is impossible. A corner gives you 3 lines to work with.

**X took a corner → you take the center.** This is the **only response that holds the draw** against a strong X. If you respond with anything else, X can force a fork by move 5.

**X took an edge → you have many options.** This is X's weakest opening. You can take the center, the opposite corner, or even a corner adjacent to X's edge. Take the center — it's still the strongest cell.

## The Fork — the key offensive concept

A **fork** is a position where you have **two ways to win simultaneously** — your opponent can block one but not both. Setting up forks is how you beat bots that block immediate threats (Intermediate / Copper) but don't look ahead deeply enough.

Example: you have X at 1, 5, 9 (corner-center-corner diagonal). If you can now play to 3 or 7 with another piece, you'd threaten both row 1-2-3 and column 3-6-9 (or 7-8-9 and column 1-4-7) — two threats, only one block possible.

The classic fork setup from X's opening:

1. X plays 5 (center).
2. O blocks/responds at 1 (corner).
3. X plays 9 (opposite corner). This creates a diagonal threat through center.
4. O must respond to the diagonal — but whatever O does, X can usually find a corner that creates two threats.

The cleanest fork pattern: control the center plus two non-adjacent corners (1 and 9, or 3 and 7). From there you typically have a fork available within a move or two.

## Move priority list

Whenever it's your turn, walk through this list in order. Play the **first option that applies**:

1. **Win** — if you have two in a row with the third cell empty, take it.
2. **Block** — if your opponent has two in a row with the third cell empty, block it.
3. **Fork** — if you can play a cell that creates **two** simultaneous threats, take it.
4. **Block their fork** — if your opponent can create a fork next move, prevent it. You may need to *create your own threat* that forces them to block instead of forking.
5. **Take center** — if 5 is empty, take it.
6. **Take opposite corner** — if your opponent is on a corner, take the diagonally opposite corner.
7. **Take any empty corner**.
8. **Take any empty edge**.

This list is the **minimax algorithm in plain English**. The built-in Copper bot uses exactly steps 1–2. Sterling uses steps 1–4 (and a 60% chance of 5–8). Magnus uses the full list, perfectly, every time.

Memorizing this list is the single biggest improvement you can make to your tic-tac-toe game.

## The corner-edge trap

If you open as X with a corner (say 1) and your opponent responds with an edge (say 2 or 4), **you almost always win**. The corner-edge response is a beginner mistake that novices and Rusty make often.

Example:
1. X plays 1.
2. O plays 2 (edge — mistake).
3. X plays 9 (opposite corner). Now X threatens 1-5-9.
4. O must play 5 (center) to block.
5. X plays 3. Now X threatens 1-2-3 *and* 3-6-9. Fork! O can only block one.
6. X wins on move 7.

This is the "corner opening trap" — it's why corner openings are sneakier than center openings against weak opponents. Against Magnus (or any strong player), the corner is still strong but won't force a win.

## Why X has the advantage

In Tic-Tac-Toe, X moves first and is always at least one tempo ahead. With perfect play:

- **X can force at least a draw.** Always.
- **O can force at most a draw.** Never a win against optimal X.

This is why AI Arena's Magnus is unbeatable — it plays perfectly as either side. As X, Magnus will draw the worst case. As O, Magnus will also draw. The same logic applies to your trained AlphaZero — once it's converged, it cannot lose.

## Beating each built-in bot

| Bot | Tier | How they play | How to beat them |
|---|---|---|---|
| **Rusty** | Novice | Random moves | Just play any opening. They'll mess up by move 3. |
| **Copper** | Intermediate | Blocks immediate losses, takes immediate wins, else random | Set up a fork. Copper blocks threats but doesn't see two-move plans. |
| **Sterling** | Advanced | 60% optimal minimax, 40% as Copper | Set up forks consistently — Sterling misses them 40% of the time. |
| **Magnus** | Master | Full minimax — perfect play | You can only draw. Best you can do is play optimally and hope they make a mistake — they won't. |

A common metric on AI Arena: **beating Copper 70%+ of the time** means you've mastered the basics. **Beating Sterling 30%+** means you understand forks. **Drawing Magnus every time** means you're playing optimally.

## When you're losing

If you find yourself losing repeatedly, the fix is almost always one of these:

1. **You're not taking the center on move 1 or 2** — fix this first.
2. **You're playing edge moves early** — they're traps for the player who plays them.
3. **You're not blocking forks** — when your opponent has two non-adjacent corners and the center, *check for the threatened fork* before making any "natural" move.
4. **You're rushing** — slow down. Walk through the priority list every turn. Tic-Tac-Toe punishes autopilot.

## Reading replays as a teaching tool

After a loss, open the replay. Step through move-by-move and at each of *your* turns ask: "Which step on the priority list should I have played?" Find the move where you skipped a higher-priority step. That's the lesson.

Replays are the single best way to improve — better than playing more games against the same opponent and losing the same way.

## The Explainability tab as a strategy oracle

If you've trained your own bot, load a position into the Gym's Explainability tab. The bot's value estimates and move probabilities give you a second opinion on what the strongest move is. Comparing your intuition to a well-trained bot's recommendation is fast strategic learning.

For untrained bots or pre-trained built-ins, you can still play out the position against Magnus — Magnus's response is by definition the optimal move.

## Going deeper

Once you've internalized the priority list, the next layer of strategy is:

- **Two-move planning** — anticipating your opponent's best response and choosing the move that handles all their responses well.
- **Tempo trades** — sometimes accepting a small disadvantage now to force a fork two moves later.
- **Symmetry recognition** — many tic-tac-toe positions are mirror images of each other. Knowing this halves the positions you need to memorize.

These are minor refinements compared to the priority list, but they're the difference between a 90% Magnus draw rate and a 100% draw rate.
