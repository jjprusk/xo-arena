---
slug: algorithm-history-mcts
title: Monte Carlo Tree Search — history, applications, and what comes next
category: concepts
tags: [mcts, history, algorithm-background, go, alphago, ucb, simulation, ai-history]
status: PUBLISHED
admin_only: false
---

# MCTS — the algorithm that broke open Go

Monte Carlo Tree Search (MCTS) is a younger algorithm than minimax — it
hit the mainstream in 2006 and reshaped game AI within a decade. Its
defining moment was AlphaGo beating Lee Sedol in 2016, but the technique
matters far beyond Go: any time the branching factor is too big for
minimax to reach meaningful depth, MCTS is the answer.

This page covers where MCTS came from, what it solved, where it lives
today, and where it's heading.

## The problem MCTS was invented to solve

By the early 2000s, computer chess was essentially finished — Deep Blue
had beaten Kasparov in 1997 and minimax-based engines kept improving.
But computer **Go** was nowhere close.

Go's branching factor (~250 legal moves per position vs chess's ~35) and
its long game length (~200 moves vs ~40 for chess) made minimax
impossibly shallow. Strong Go programs in 2005 were beating amateur
players but losing badly to even mid-level club players. Conventional
wisdom said human-level Go was *decades* away.

The issue wasn't computing power. It was the *evaluation function*. In
chess, you can score a non-terminal position by material count + pawn
structure + king safety + dozens of refinements. In Go, those quantities
don't exist — there are no pieces with values, no clear positional
heuristics. Hand-crafted Go evaluation was a dead end.

MCTS solved this by replacing the evaluation function with **random
playout statistics**.

## The core idea — playouts instead of evaluation

Rather than asking "how good is this position?" (which requires an
evaluation function), MCTS asks "what fraction of random games from
this position end in a win?" — and uses that statistic as a *proxy*
for position quality.

The basic loop:

1. **Selection** — walk down the tree from the root, picking the most
   promising child at each step.
2. **Expansion** — when you reach a node not yet fully explored, add a
   new child.
3. **Simulation (rollout)** — from the new node, play random moves to
   the end of the game and observe who wins.
4. **Backpropagation** — propagate the win/loss result back up the tree,
   updating visit counts and win statistics on every node along the
   path.

After enough iterations, the tree concentrates its visits on promising
lines. The move at the root with the highest visit count is the move
chosen.

The genius of this approach: it requires **no game-specific evaluation**.
It only needs to know the rules and a way to play random games to
completion. Drop MCTS into any new game and it'll start producing
reasonable play immediately.

## UCB1 and the exploration/exploitation balance

The technical breakthrough that made MCTS actually competitive was
**UCB1** (Upper Confidence Bound for Trees) — a formula from multi-armed
bandit theory that decides which child to visit at each step.

UCB1 balances:

- **Exploitation** — visiting children that have already shown high win
  rates.
- **Exploration** — visiting under-sampled children to make sure no
  good move is overlooked.

The combination is what lets MCTS converge: keep exploring enough to
discover surprises, while concentrating effort on the best lines.

This formulation came together as **UCT** (Upper Confidence Trees) in a
2006 paper by Levente Kocsis and Csaba Szepesvári — the moment MCTS
became practically useful.

## The Go revolution (2006–2016)

Within two years of the UCT paper, MCTS-based Go programs leapfrogged
the entire previous generation of Go AI:

- **MoGo** (2007) — first MCTS program to beat strong amateur Go players
  on small boards (9x9).
- **Crazy Stone** (2008) — won the Computer Go Olympiad, started beating
  professional Go players at 9-stone handicap.
- **Zen** (2012) — beat a 9-dan professional with 4 stones handicap.
- **AlphaGo** (2015) — became the first program to beat a professional
  Go player without handicap.
- **AlphaGo vs Lee Sedol** (March 2016) — AlphaGo won 4-1 against one of
  the strongest human Go players in history. The Lee Sedol match is one
  of the most watched AI events in history; it's the *MCTS moment*.

AlphaGo wasn't pure MCTS — it combined MCTS with deep neural networks
that learned to guide the search (this is the lineage that led to
AlphaZero — see `algorithm-history-alphazero`). But the search core was
MCTS, and without MCTS the whole architecture wouldn't have worked.

## Where MCTS dominates today

MCTS is the default algorithm for any game where:

- The state is fully observable and the game is deterministic.
- The branching factor is *too high* for minimax to reach useful depth.
- A natural "rollout" exists (you can play random games to completion).

This includes Go, Hex, Othello variants, complex board games, real-time
strategy game subproblems, and many puzzle / planning domains. MCTS is
also a frequent choice in **general game-playing systems** — programs
that learn to play any game from its rules — because of its
no-evaluation-function-required property.

In **non-game domains**, MCTS variants are used for:

- **Robotics planning** — searching through plans under uncertainty.
- **Drug discovery** — searching chemical-space trees for promising
  compounds.
- **Combinatorial optimization** — scheduling, routing, theorem proving.
- **Large-language-model reasoning** — recent work (2023+) uses MCTS-like
  rollouts to improve LLM problem-solving on reasoning tasks.

## Where MCTS hits its ceiling

Three boundaries:

### 1. Smaller games where minimax just wins

For tic-tac-toe, connect-four, or any game where minimax can search to
the leaves, MCTS *adds noise* — random rollouts will sometimes mis-evaluate
positions that minimax would solve exactly. Minimax is the better tool
for small games.

### 2. Stochastic / hidden-information games

Pure MCTS assumes deterministic state. Games with chance (backgammon)
or hidden information (poker) need MCTS variants — **Information Set
MCTS**, sampling-based methods, or alternative algorithms entirely.
They work, but require modification.

### 3. The cost of rollouts

In games with very long playouts (200+ moves), pure random rollouts
become expensive and noisy. This is what drove the AlphaGo team to
replace random rollouts with neural-network value estimates — see
AlphaZero history.

## MCTS in the AlphaZero era

Modern MCTS in serious applications almost always means **neural-guided
MCTS**:

- A **policy network** guides which child to select at each step
  (replacing pure UCB1 with PUCT).
- A **value network** evaluates leaf positions directly (replacing
  random rollouts with a learned estimate).
- The tree-search backbone is still classical MCTS.

This is the AlphaZero pattern. It's also how strong modern Go engines
(Leela Zero, KataGo) work, and how AlphaZero-clones for chess, shogi,
and other games operate.

So MCTS today usually means "tree search guided by learned models"
rather than "pure random rollouts" — but the search structure and
backpropagation core are unchanged from the 2006 UCT formulation.

## Where MCTS goes next

Three active frontiers:

1. **MCTS for LLM reasoning** — using tree search over candidate
   reasoning chains to improve answer quality. Papers from 2023-2025
   (Tree-of-Thoughts, Reasoning-via-Planning, etc.) show MCTS-style
   search dramatically improves complex problem-solving.
2. **MCTS for real-world planning** — scheduling, robotics, autonomous
   driving subproblems. The "no evaluation function needed" property is
   especially valuable here.
3. **Hybrid MCTS + classical search** — small games still favor
   minimax, large games favor MCTS. Hybrid algorithms that switch based
   on the situation (or run both and pick the better answer) are a
   research direction.

## What this means on AI Arena

MCTS bots on the platform use the classical algorithm — UCB1-guided
tree search with rollouts. Training an MCTS bot tunes the simulation
count, exploration constant, and (for advanced presets) the rollout
policy.

For tic-tac-toe, MCTS is *over-engineered* — the game is small enough
that minimax solves it directly. MCTS bots in tic-tac-toe will reach
near-perfect play but the algorithm wasn't designed for games that small.

For connect-four, MCTS is squarely in its sweet spot — the branching
factor is small enough that rollouts are fast, but the game tree is too
deep for minimax to reach the leaves. An MCTS bot with enough
simulations will reach very strong play on connect-four, often beating
depth-capped minimax (Hard tier).

Against Master connect-four, MCTS *alone* won't reach perfect play —
random rollouts aren't accurate enough at the highest levels. That's
where AlphaZero (MCTS + neural networks) takes over.

## See also

- **`algorithm-history-alphazero`** — how MCTS + deep neural networks
  produced AlphaGo, AlphaZero, and the current state of the art.
- **`algorithm-history-minimax`** — the algorithm MCTS overtook.
- **`the-history-of-game-ai`** — the full timeline of game-playing AI.
- **`algorithm-monte-carlo`** — practical guide to training MCTS bots
  on AI Arena.
