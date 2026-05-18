---
slug: the-history-of-game-ai
title: The history of game AI — from Shannon to AlphaZero and beyond
category: concepts
tags: [history, game-ai, ai-history, overview, timeline, chess, go, deepmind, ai-progression]
status: PUBLISHED
admin_only: false
---

# The history of game AI

Game-playing has been a benchmark for artificial intelligence since the
field began. Every major shift in AI thinking has been demonstrated
first on games — chess, checkers, backgammon, poker, Go, StarCraft. The
games AI played reveal what AI *could* do at each moment in time.

This page is the timeline. For deeper background on individual
algorithms, see the per-algorithm history docs.

## Why games?

Games are the ideal AI benchmark for three reasons:

1. **Clear rules.** No ambiguity about what's legal or what counts as
   winning. Algorithms can be evaluated objectively.
2. **Continuous difficulty spectrum.** Tic-tac-toe is trivial; Go is
   hard. Within a single game, opponents range from random play to
   superhuman. There's always a next benchmark.
3. **Public legibility.** A chess match between a computer and a world
   champion is something *everyone* understands. Wins and losses are
   visible. The cultural impact of an AI beating a top human at a
   famous game vastly exceeds an AI beating a human at, say, an
   industrial scheduling problem.

So games have always been *the* AI benchmark. Every major era of AI
has its defining game-playing moment.

## The eras

### 1. Symbolic AI and game theory (1928–1956)

- **1928** — John von Neumann proves the *minimax theorem*. Game theory
  is born; the strategy concept that will power every game-playing
  program for the next 70 years is laid down mathematically.
- **1950** — Claude Shannon publishes *Programming a Computer for
  Playing Chess*. Lays out minimax search, evaluation functions,
  and the depth-vs-breadth trade-off. The blueprint for every chess
  engine.
- **1951** — Christopher Strachey writes the first program to play
  draughts (checkers) on a Manchester Mark 1. The first program-vs-
  human match in any game.
- **1956** — The Dartmouth Conference coins "Artificial Intelligence."
  Game playing is one of the founding research areas alongside
  reasoning and language understanding.

### 2. The minimax era — chess and checkers (1957–1997)

- **1957** — Alex Bernstein at IBM writes the first full-game chess
  program for an IBM 704. Plays at "novice human" level.
- **1959** — Arthur Samuel publishes his checkers program with
  self-play learning — arguably the first machine learning system in
  history. Coins the term "machine learning."
- **1962** — MIT's Kotok-McCarthy chess program defeats a beginner
  human in a tournament.
- **1968** — David Levy bets £1,250 against four AI researchers that
  no chess program will beat him by 1978. He wins the bet.
- **1975** — Donald Knuth and Ronald Moore publish the modern
  formulation of alpha-beta pruning, making minimax dramatically
  more efficient.
- **1979** — Hans Berliner's BKG 9.8 program beats the world
  backgammon champion in a 7-game match. Game AI's first
  world-champion-level result — though largely due to dice luck.
- **1980** — Belle (Ken Thompson) is the first computer to reach
  master strength in chess.
- **1988** — Connect-four is solved (independently by James Allen
  and Victor Allis). First player wins with perfect play, starting
  in the center.
- **1989** — IBM's Deep Thought defeats grandmaster Bent Larsen — the
  first computer to beat a grandmaster in tournament play.
- **1994** — Chinook defeats world checkers champion Marion Tinsley
  (Tinsley resigns the second match due to illness; passes away later
  that year). Chinook is later declared the world champion by default.
- **1996** — Deep Blue (IBM) wins a single game against world chess
  champion Garry Kasparov, but loses the match 4-2.
- **1997** — **Deep Blue defeats Kasparov 3.5-2.5** in a six-game
  rematch. The first computer to beat a reigning world champion at
  classical chess under tournament conditions. Front-page news
  everywhere. The minimax era's defining moment.

### 3. The neural network spring (1989–2010)

While minimax dominated headlines, a quiet parallel track was building:

- **1989** — TD-Gammon (Gerald Tesauro) — neural network learns
  backgammon through *self-play*. By 1992 it's playing at expert
  level. The first major use of neural-network + reinforcement
  learning for a game.
- **1992–1995** — Watkins formalizes Q-learning. Rummery & Niranjan
  introduce SARSA. Reinforcement learning's foundations.
- **1999** — Sutton & Barto publish *Reinforcement Learning: An
  Introduction*. The canonical RL textbook.
- **2003** — Levente Kocsis and Csaba Szepesvári start the work that
  will become UCT (the practical formulation of MCTS).

This era was *quiet* compared to the minimax era. RL worked on
backgammon and a few specific problems, but Go remained intractable
and chess belonged to minimax.

### 4. The MCTS era and the Go problem (2006–2015)

- **2006** — UCT (Upper Confidence Trees) paper by Kocsis &
  Szepesvári. MCTS becomes practically usable.
- **2007** — MoGo beats strong amateur Go players on 9x9 boards.
- **2007** — Schaeffer's team announces **checkers is weakly solved**.
  Optimal play from the starting position leads to a draw.
- **2008** — Crazy Stone wins the Computer Go Olympiad. MCTS-based
  Go programs start steadily climbing the ranks of human players.
- **2012** — Zen beats a 9-dan professional Go player at 4-stone
  handicap.
- **2012** — AlexNet wins ImageNet, kicking off the deep learning
  revolution. Game AI hasn't combined it with games *yet*, but the
  ingredients are now in place.

### 5. The deep RL revolution (2013–2017)

- **2013** — Mnih et al. (DeepMind) publish *Playing Atari with Deep
  Reinforcement Learning*. DQN learns to play 7 Atari games from raw
  pixels.
- **2015** — DQN paper in *Nature* (49 Atari games, superhuman on 29).
  Deep RL is *the new hotness*.
- **2015** — **AlphaGo defeats Fan Hui** (European Go champion).
  First time a program beats a professional Go player on equal
  terms.
- **March 2016** — **AlphaGo defeats Lee Sedol** 4-1 in Seoul. One
  of the most-watched AI events in history. *The* moment Go falls
  to computers.
- **2017** — AlphaGo defeats world #1 Ke Jie 3-0.
- **October 2017** — **AlphaGo Zero** — learns Go entirely from
  self-play, no human gameplay data. Beats Lee Sedol's AlphaGo 100-0.
- **December 2017** — **AlphaZero** — generalizes to Go, chess, and
  shogi. Beats Stockfish (chess), elmo (shogi), and AlphaGo Zero
  (Go) in 24 hours of training each. The defining moment of
  algorithmic generality.

### 6. The post-AlphaZero era (2018–present)

After AlphaZero, the focus shifted from "can AI beat top humans" (yes,
at any reasonable game) to **algorithmic generality** and **harder
problems** — imperfect information, real-time games, and applications
beyond games entirely.

- **2017** — DeepStack and Libratus achieve superhuman performance at
  heads-up no-limit Texas Hold'em poker. *Imperfect information*
  finally falls.
- **2019** — Pluribus beats top human players at 6-player no-limit
  Hold'em. Multi-agent imperfect information.
- **2019** — AlphaStar (StarCraft II) beats top professional players.
  Real-time strategy with partial information, large action space.
- **2019** — MuZero generalizes AlphaZero by learning the rules of
  the game from observation. Atari + board games + general
  applications.
- **2020** — MuZero variants applied to video compression (YouTube),
  matrix multiplication (AlphaTensor, 2022), and other non-game
  domains. Game AI techniques become broad scientific tools.
- **2022–present** — The LLM era. Game-playing techniques (MCTS,
  AlphaZero-style search) get combined with language models for
  reasoning tasks. AlphaProof, AlphaGeometry, and various LLM+search
  systems start solving math olympiad and reasoning problems.

## What's been solved (and what hasn't)

By 2025, the "human vs computer" framing has largely been answered:
**every classical board and card game where AI has been seriously
applied, AI has reached or exceeded the top humans.**

The unsolved frontiers are increasingly:

- **General intelligence** rather than specific games.
- **Imperfect information at very large scale** (multi-player negotiation,
  some real-time games).
- **Robust generalization** (an AlphaZero trained on Go won't
  transfer to chess without retraining; humans transfer skills more
  fluidly).
- **Sample efficiency in the real world** (still vastly worse than
  humans for complex robotic / real-world tasks).
- **Open-ended creative play** (games like Minecraft where there is
  no clear win condition).

The center of gravity has shifted from games to scientific discovery,
robotics, and language. But the algorithms that made game AI work —
minimax, MCTS, DQN, AlphaZero-style search — are the *same algorithms*
now being applied at the new frontiers.

## How AI Arena fits in

AI Arena is a teaching platform for this entire arc. The six algorithms
on the platform — Rule-Based, Minimax, MCTS, DQN, AlphaZero (+
others) — span the full history. Training and playing against bots
using each algorithm is a way to *experience* the progression:

- **Rule-Based** — symbolic AI, 1956+. Fast, transparent, brittle.
- **Minimax** — Shannon-era game-playing, 1950+. Provably optimal at
  small games; foundation of every chess engine through Deep Blue.
- **MCTS** — Kocsis & Szepesvári, 2006. The algorithm that made Go
  beatable.
- **DQN** — DeepMind 2013-2015. Reinforcement learning meets deep
  learning. The Atari moment.
- **AlphaZero** — DeepMind 2017. Search + neural networks +
  self-play. The current state of the art.

When you train a DQN on AI Arena, you're running the same algorithm
DeepMind used to learn Pong. When you train AlphaZero, you're running
the algorithm that beat Lee Sedol. The hardware is smaller; the rules
are simpler; but the algorithms are *literally the same*. That's the
point of the platform.

## See also

- **`algorithm-history-minimax`** — the algorithm that ran from 1928
  to Deep Blue.
- **`algorithm-history-mcts`** — the algorithm that broke Go.
- **`algorithm-history-dqn`** — when RL met deep learning.
- **`algorithm-history-alphazero`** — the current peak.
- **`algorithm-history-rule-based`** — the still-shipping foundation
  beneath everything.
- **`ai-concepts-in-ai-arena`** — how each of these algorithms is
  implemented on the platform.
