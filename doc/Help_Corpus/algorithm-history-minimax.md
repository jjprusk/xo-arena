---
slug: algorithm-history-minimax
title: Minimax — history, applications, and what comes next
category: concepts
tags: [minimax, history, algorithm-background, game-theory, ai-history, chess, alpha-beta]
status: PUBLISHED
admin_only: false
---

# Minimax — the original game-playing algorithm

Minimax is the **oldest, most foundational** algorithm in computer game-play.
Every modern game-AI technique — MCTS, AlphaZero, even deep RL approaches —
either descends from minimax or was built to overcome its limits. If you
understand minimax, you understand the bedrock that everything else stands on.

This page covers where the algorithm came from, what it's been used for,
where it's hit its ceiling, and where it still wins today.

## Origins — von Neumann and the minimax theorem (1928)

The mathematical core of minimax predates computers entirely. In 1928, John
von Neumann proved the **minimax theorem** — a foundational result in game
theory stating that in any zero-sum two-player game with perfect information,
there exists an optimal strategy for both players that minimizes the maximum
possible loss.

The theorem was abstract math at the time — there was no machine to run it
on. But the principle ("assume your opponent plays optimally, then play the
move that minimizes their best response") became the entire pattern that
game-playing programs would later embody.

When digital computers arrived two decades later, minimax was the obvious
first algorithm to try.

## The Shannon paper (1950) — minimax for chess

Claude Shannon's 1950 paper *"Programming a Computer for Playing Chess"* is
the founding document of computer chess. Shannon laid out:

- The minimax search procedure itself.
- A static evaluation function (material count + positional terms).
- The depth-vs-evaluation trade-off ("Type A" full-width search vs "Type B"
  selective search).
- The combinatorial explosion problem (chess has ~10^120 possible games).

Shannon didn't *build* a chess program — he sketched how one would work.
But the blueprint was complete enough that the first working chess programs
(Alex Bernstein at IBM, 1957; the Kotok-McCarthy program at MIT, 1962)
followed it directly.

## Alpha-beta pruning (1956–1975) — making minimax tractable

Pure minimax is exponential in search depth: doubling the depth squares
the work. Even a small game like chess (~35 legal moves per position)
explodes past what any computer could search to meaningful depth.

The breakthrough was **alpha-beta pruning** — a technique that proves
certain branches of the game tree don't need to be explored because they
*can't* affect the final result. Independently discovered by John McCarthy
(1956), Arthur Samuel (in his checkers work, late 1950s), and refined into
the modern form by Donald Knuth and Ronald Moore (1975).

Alpha-beta doesn't change the *answer* — it produces the same move as full
minimax. But it cuts the effective branching factor by roughly its square
root, which means the same hardware can search twice as deep. That single
improvement is what made minimax-based chess engines practically useful.

## The peak — Deep Blue beats Kasparov (1997)

Throughout the 1980s and 1990s, minimax + alpha-beta + increasingly
sophisticated evaluation functions powered the strongest chess programs in
the world. The trajectory was:

- Belle (1980) — first computer to reach master strength
- HiTech, Deep Thought (1980s) — grandmaster strength
- **Deep Blue (1997)** — defeated reigning world champion Garry Kasparov
  in a six-game match

Deep Blue was minimax search on custom chess hardware, searching ~200
million positions per second to depths of 12-14 plies with selective
extensions reaching 20+. No machine learning, no neural networks — just
brute search, hand-crafted evaluation, and the minimax core.

Deep Blue is often described as "the moment chess fell" to computers. It
was also the high-water mark of pure minimax as a competitive technique.

## Where minimax dominates today

For **small, fully-observable, deterministic, zero-sum games**, minimax with
alpha-beta is still the best tool. Tic-tac-toe, connect-four (where its
solution is exactly a deep minimax search), checkers (solved in 2007 using
alpha-beta), and many puzzle games are all minimax territory.

On AI Arena, **Easy / Medium / Hard built-in bots are all minimax** at
different depths:

- Easy = depth-1 or depth-2 (often with random tiebreakers).
- Medium = depth-2 to depth-4 (depending on game).
- Hard tic-tac-toe = full game tree (a perfect-play minimax).
- Hard connect-four = depth-capped strong minimax (depth-6 to depth-8).
- Master connect-four = the depth needed for perfect play.

Quick Bots (user-trained "minimax" bots) are also minimax with a depth
parameter. "Training" a Quick Bot doesn't change the algorithm — it just
labels the bot at a particular tier; the bot still searches the game tree
at runtime.

## Where minimax hits its ceiling

Three boundaries broke minimax as a frontier technique:

### 1. Branching factor explosion

Chess (~35 branches), Go (~250 branches). Minimax can search chess to
~20 ply on modern hardware with alpha-beta. The same depth in Go is
~10^48 positions. Not 10^48 *to evaluate* — 10^48 *to even enumerate*.
No hardware will ever close that gap with pure minimax.

This is why Go required a completely different approach (MCTS, eventually
neural-guided MCTS in AlphaGo / AlphaZero).

### 2. Hand-crafted evaluation is a bottleneck

Minimax's strength depends entirely on the *evaluation function* — the
formula that scores a non-terminal position. For chess, decades of expert
tuning produced extraordinarily detailed evaluations (material, pawn
structure, king safety, piece mobility, etc.).

But evaluation tuning has a ceiling. The 2010s showed that *learned*
evaluations (neural networks trained from self-play) could outperform
hand-tuned ones — leading to the decline of pure minimax engines.

### 3. Imperfect information / hidden state

Minimax assumes you can see the full game state. Poker, bridge, Stratego —
games where information is hidden — break the minimax assumption that
"my opponent's best response is computable from the current position."
Different techniques (counterfactual regret minimization, opponent
modeling) had to be invented.

## Minimax in the deep-learning era

Modern strongest chess engines (Stockfish, Leela Chess Zero) blend the two
worlds:

- **Stockfish** is fundamentally a minimax / alpha-beta engine — but its
  evaluation function is now an "NNUE" neural network (Efficiently Updatable
  Neural Network) that replaces the old hand-tuned formula. The *search*
  is still classical minimax; the *evaluation* is learned.
- **Leela Chess Zero** uses MCTS guided by deep neural networks
  (AlphaZero-style), no minimax core. It's competitive with Stockfish in
  some ways, weaker in others.

So minimax didn't die — it merged with deep learning. The architecture
that runs every world-championship-strength chess engine today is still,
in spirit, the same algorithm Shannon described in 1950.

## Where minimax goes next

Three frontiers:

1. **Embedded / fast minimax** — for small games and real-time decisions,
   minimax is unbeatable. Game engines, embedded AI in mobile games,
   safety-critical decision making — all use minimax variants because
   the algorithm is *provably optimal* given the search depth, with no
   training data needed.
2. **Hybrid search-and-learn** — the Stockfish NNUE pattern (classical
   search + learned evaluation) is likely the long-term shape of strong
   game AI. Expect more games to adopt this hybrid.
3. **As a teaching tool** — minimax remains the gateway algorithm in
   every AI curriculum. Understanding it is the prerequisite for
   understanding MCTS, AlphaZero, and every modern technique that
   builds on it.

## What this means on AI Arena

When you play against Easy / Medium / Hard built-in bots, you're playing
against minimax. When you train a "Quick Bot," you're configuring a
minimax depth tier. Minimax is the foundation everything else on the
platform measures against:

- A **DQN bot** that wins against Hard minimax is genuinely strong.
- An **AlphaZero bot** that draws Master connect-four (a perfect-play
  minimax) has learned the solved-game ceiling.

If you want to feel the algorithm directly, go play `Hard tic-tac-toe`
or `Hard connect-four`. You're facing the seventy-year-old idea that
started it all.

## See also

- **`algorithm-history-mcts`** — the algorithm that overtook minimax for
  large branching games.
- **`algorithm-history-alphazero`** — how neural-guided search surpassed
  pure minimax on chess and Go.
- **`the-history-of-game-ai`** — the full timeline.
- **`solved-games-and-master`** — how minimax depth maps to the tic-tac-toe
  and connect-four tier ladder.
