---
slug: algorithm-history-alphazero
title: AlphaZero — history, applications, and what comes next
category: concepts
tags: [alphazero, alphago, history, algorithm-background, deepmind, neural-networks, mcts, self-play, ai-history]
status: PUBLISHED
admin_only: false
---

# AlphaZero — the algorithm that learned everything from scratch

AlphaZero is the algorithm that closed out the "computer beats human at
board games" era. In 24 hours of training on Go, chess, and shogi, it
surpassed every program ever written for any of those games — using
**no human gameplay data**, **no opening books**, and **no hand-crafted
evaluations**. Just the rules of the game and self-play.

It's also the strongest algorithm available on AI Arena, and the
hardest to train. This page covers where AlphaZero came from, what it
did, where it's gone since, and what the future holds.

## The lineage — AlphaGo, AlphaGo Zero, AlphaZero

AlphaZero didn't arrive in one paper. It was the third in a three-step
lineage from DeepMind, each one stripping away more human input than
the last.

### AlphaGo (2015–2016)

The original AlphaGo combined:

- A **policy network** trained on 30 million expert human Go moves
  (supervised learning).
- A **value network** trained on positions from self-play games.
- **MCTS** guided by both networks at search time.
- Hand-tuned rollout policies for additional simulation guidance.

AlphaGo defeated European Go champion Fan Hui in October 2015 — the
first program to beat a professional Go player on equal terms — and
then **Lee Sedol** in March 2016, 4-1, in one of the most watched AI
events in history. The Lee Sedol match is the moment AlphaGo became a
cultural phenomenon.

Then in May 2017, AlphaGo defeated **Ke Jie**, the world's #1 player, in
a 3-0 match. After that, DeepMind retired AlphaGo from competitive
play.

### AlphaGo Zero (October 2017)

Six months later, DeepMind published AlphaGo Zero — a successor that
threw away the human-expert training data and learned **entirely from
self-play**. Starting from random play, AlphaGo Zero:

- Trained for 3 days.
- Defeated the version of AlphaGo that beat Lee Sedol, 100-0.

It also used a single unified network (policy + value combined) and
discarded the hand-tuned rollout policies. Simpler architecture, no
human knowledge, dramatically stronger result.

### AlphaZero (December 2017)

Two months after AlphaGo Zero, AlphaZero generalized the approach to
**chess, shogi, and Go simultaneously** — same algorithm, no
game-specific tuning. In 24 hours of training on each game, AlphaZero:

- Surpassed Stockfish in chess (which had been the strongest engine for
  a decade).
- Surpassed elmo in shogi.
- Surpassed AlphaGo Zero in Go.

The chess result especially stunned the chess world. AlphaZero played
with a style that human grandmasters described as "almost alien" —
sacrificing material for long-term positional pressure in ways that
hand-crafted engines never did. The games are now studied as a new
canon of chess opening theory.

## How AlphaZero works

The core algorithm is remarkably elegant:

1. **A single neural network** takes a board position as input and
   outputs two things:
   - A **policy** (probability distribution over moves).
   - A **value** (estimated probability of winning from this position).
2. **At decision time**, MCTS uses the policy to guide tree expansion
   (which children to explore) and the value to evaluate leaves (no
   random rollouts needed).
3. **At training time**, the agent plays games against itself, using
   MCTS for move selection. The MCTS visit counts become improved
   policy targets (better than the raw network's policy), and the
   game outcomes become value targets. The network trains to match
   these MCTS-improved targets.

The cycle — *MCTS produces better moves than the raw network → the
network trains on those better moves → the better network produces
even better MCTS results* — drives steady improvement from random
play to superhuman performance. No human data, no hand-crafted
features, no game-specific knowledge beyond the rules.

The key insight that makes this work: **MCTS is a policy improvement
operator**. The network proposes a policy; MCTS, by spending compute,
produces a better one. Training the network to imitate the MCTS-improved
policy then improves the base, which improves MCTS, and so on. This is
the *policy iteration* pattern from classical RL, scaled up to deep
networks and game-tree search.

## What AlphaZero solved

AlphaZero ended several long-standing debates:

- **Domain-specific engineering isn't required.** For decades, chess
  engines relied on intricate hand-tuned evaluation. AlphaZero showed
  this was unnecessary — even disadvantageous compared to learned
  evaluations.
- **Self-play is enough.** No human gameplay data was used. The agent
  literally bootstrapped from random play. This challenged assumptions
  about whether human knowledge was necessary for high-level play.
- **One algorithm, many games.** The same code achieved superhuman
  performance on Go, chess, and shogi. Game-playing AI didn't need
  to be specialized.
- **Compute and data win.** The successful recipe was: enough compute,
  the right algorithm, and enough self-play data. The "AI bitter
  lesson" (Sutton, 2019) — that general methods scaled by compute
  consistently beat hand-engineered solutions — had AlphaZero as a
  central exhibit.

## The successors — MuZero and beyond

DeepMind kept pushing:

### MuZero (2019)

MuZero learns the rules of the game *itself* — not given them. It learns
a model of the environment from observations, then plans inside that
learned model. It matches AlphaZero on board games and also achieves
state-of-the-art on Atari (which AlphaZero couldn't handle because
Atari isn't a board game with known rules).

### EfficientZero (2021)

A sample-efficiency improvement on MuZero. Reaches human-level Atari
performance with 2 hours of game data — roughly 100x more efficient
than MuZero.

### MuZero applications beyond games

DeepMind has applied MuZero variants to:

- **Video compression** — improved YouTube video encoding efficiency
  by 4% (a huge real-world impact at YouTube scale).
- **Matrix multiplication** — discovered faster matrix multiplication
  algorithms than humans had found in 50 years (AlphaTensor, 2022).
- **Chip design** — Google uses RL-based methods for floor-planning in
  AI accelerator chips.
- **Mathematics** — AlphaGeometry (2024) solved International Math
  Olympiad geometry problems at near-gold-medal level.

The pattern is "AlphaZero-style search + learned models" applied to any
domain where you can simulate or model the consequences of decisions.

## Where AlphaZero hits its ceiling

Three boundaries:

### 1. Compute cost

AlphaZero's training is *expensive*. The original Go training used
5,000 TPUs for 4 hours. Even for smaller games, AlphaZero-style
training takes orders of magnitude more compute than DQN or MCTS
alone. On AI Arena, AlphaZero training a connect-four bot to strong
play takes hours-to-days even on a single machine.

### 2. Requires a model or simulator

You need to be able to play self-play games. For real-world problems
(robotics in the physical world, healthcare decisions, etc.), you
can't just simulate — making AlphaZero hard to apply directly.
MuZero partially fixed this by learning a model.

### 3. Imperfect information

AlphaZero assumes full observability. Games with hidden state
(poker, Stratego, real-time strategy with fog of war) need different
techniques. **DeepStack** and **Pluribus** for poker, **AlphaStar**
for StarCraft II all used different algorithmic ingredients (CFR,
self-play with population diversity, supervised pre-training)
rather than pure AlphaZero.

## Where AlphaZero goes next

Three active frontiers:

1. **Scientific discovery** — AlphaTensor, AlphaGeometry, FunSearch.
   AlphaZero-style search applied to mathematics, chemistry, biology.
   This is the most exciting current frontier: using game-playing
   algorithms to find novel scientific results.
2. **Combined with language models** — using LLMs as policy/value
   networks, with MCTS for search. Early work suggests this can
   dramatically improve LLM reasoning on complex tasks. AlphaProof
   and AlphaGeometry combine LLMs with AlphaZero-style search.
3. **Real-world planning** — robotics, logistics, scheduling. As
   world models improve (Dreamer-v3, Genie), AlphaZero-style
   planning becomes increasingly applicable to physical-world
   problems.

## What this means on AI Arena

AlphaZero on the platform implements the canonical algorithm:

- A neural network that outputs both policy and value heads.
- MCTS with PUCT (Predictor + UCB) for guided tree search.
- Self-play training, replaying games into the network.
- Temperature-controlled move selection (more random early in
  training, more deterministic later).

For **tic-tac-toe**, AlphaZero is enormous overkill — the game is
small enough that minimax solves it exactly. AlphaZero on tic-tac-toe
will converge to perfect play in minutes; you're really just
*watching the algorithm work* on a tiny problem.

For **connect-four**, AlphaZero is squarely in its sweet spot. It's
the algorithm best suited to approach **Master tier** (perfect play).
A well-trained AlphaZero connect-four bot is the strongest possible
opponent the platform can produce short of perfect minimax — and the
canonical AlphaZero teaching moment is watching your bot's Master
match results improve over training sessions, eventually drawing
Master as first-mover (the ceiling for non-perfect play).

AlphaZero is also the **slowest to train** by far. Each MCTS rollout
during self-play takes seconds, not milliseconds. Training a
connect-four AlphaZero to strong play can take many hours of compute.
This is why preset gates exist: AlphaZero training at scale needs
explicit admin approval on the platform.

But the result — *your own bot, trained from scratch, reaching
near-perfect play against a solved game* — is the most impressive
training story AI Arena can show.

## See also

- **`algorithm-history-mcts`** — the search algorithm at AlphaZero's
  core.
- **`algorithm-history-dqn`** — the value-function lineage AlphaZero
  builds on.
- **`solved-games-and-master`** — what AlphaZero is trying to
  approach (perfect connect-four play).
- **`algorithm-alphazero`** — practical guide to training AlphaZero
  on AI Arena.
- **`the-history-of-game-ai`** — the full timeline.
