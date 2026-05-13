---
slug: reinforcement-learning-intro
title: What is reinforcement learning?
category: basics
tags: [rl, reinforcement-learning, intro, beginner, ai]
status: PUBLISHED
admin_only: false
---

# What is reinforcement learning?

If you've never trained an AI bot before, this doc gives you just enough background to make sense of everything else. No math. No prior ML experience required.

## The core idea — learning from outcomes

Think about how a child learns to ride a bike. Nobody gives them an instruction manual. Instead, they try something, fall, try a slightly different thing, fall less, eventually stay upright. **The signal they're learning from is "did the experiment go well or badly"** — falling is bad, staying up is good.

**Reinforcement learning (RL)** is the same idea, applied to AI. The "child" is a program called an **agent**. The "experiment" is a **game** the agent plays. The "did it go well" signal is a single number called the **reward** — typically +1 for winning, -1 for losing, 0 for a draw.

Over many games (called **episodes**), the agent learns which moves lead to high rewards and which lead to low ones. After enough episodes, the agent plays well.

That's it. That's the whole framework. Everything else is engineering.

## The cast of characters

In every RL setup, there are four things:

- **Agent** — the bot you're training. It picks actions.
- **Environment** — the world the agent operates in. For AI Arena, the environment is the tic-tac-toe board and the rules of the game.
- **State** — the current configuration of the environment. In tic-tac-toe, the state is "where are the X's, where are the O's, whose turn is it".
- **Reward** — the feedback signal at the end of each episode (or sometimes during it). On AI Arena: +1 win, 0 draw, -1 loss.

The agent's job is to learn a **policy** — a rule for what to do in each state — that **maximizes the total reward over time**.

## Exploration vs exploitation — the central tension

Here's the deepest insight in RL, in one sentence:

> **The agent must try things it doesn't know are good in order to find out if they're good.**

If the agent always picks the move it currently thinks is best (called **exploiting**), it never discovers better moves. If it always picks random moves (called **exploring**), it never gets good at anything.

The solution: a balance, controlled by a number called **epsilon (ε)**. Early in training, ε is high — the agent picks lots of random moves to discover the board. Later, ε is low — the agent picks its best-known move most of the time, occasionally trying something random just in case.

This **epsilon decay** is one of the most important hyperparameters you tune. Decay too fast and you lock in a bad policy. Decay too slow and you waste episodes on random play after the agent already knows what to do.

See "Bot training concepts" for the math, decay schedules, and recommended values.

## What an episode looks like

Pick a bot, hit Train, watch a single episode:

1. The board starts empty. It's X's turn (your bot, say).
2. Your bot looks at the state (empty board) and **picks an action** — let's say it plays center. The choice is informed by what it's learned so far, plus a chance of being random (epsilon).
3. The opponent (could be another instance of your bot in self-play, or a minimax opponent) plays its move.
4. Repeat until the game ends.
5. The **reward** is computed: did the bot win, draw, or lose?
6. The bot does some math — depending on the **algorithm** — to **update its policy**. Roughly: "the moves I made in this winning game look a little better now; the moves I made in losing games look a little worse."
7. Episode over. Start the next one with a fresh board.

Multiply this by 7,000 episodes (for Q-Learning) or 35,000 (for DQN) and you get a trained skill.

## Why "tabular" vs "neural" algorithms exist

There are two ways to remember which moves are good in which states:

- **Tabular** — keep a literal table. One row per state, one column per action. Each cell holds a number called a **Q-value** ("how good is this action from this state?"). When playing, look up the row, pick the highest column.
- **Neural** — train a small **neural network** that takes the state as input and outputs Q-values. The network's weights encode everything the agent has learned.

Both approaches solve the same problem. Tabular is simpler, faster to train, and easier to debug — perfect for tic-tac-toe, which has only ~5,478 reachable states. Neural is more powerful: it can **generalize** to states it has never exactly seen, by recognizing patterns. For games with millions of states (like chess, or Pong's continuous positions), tabular doesn't scale and you need neural.

AI Arena offers both. **Q-Learning**, **SARSA**, **Monte Carlo**, **Policy Gradient** are tabular (browser-trained). **DQN**, **AlphaZero** are neural (server-trained).

## Why self-play works

A natural question: if a bot plays only against itself, how can it get better? Isn't it just learning to beat itself, and won't both copies stay equally good (and equally bad)?

Here's why self-play works:

1. **Both sides explore.** Random moves happen on both sides early in training. Whichever side accidentally finds a good move benefits — its win rate ticks up.
2. **The good idea propagates.** The next time the same state appears, both sides know the good move (because they're the same agent). Now the *opponent* has to find a *better* move to win.
3. **This is an arms race.** Each side getting better forces the other to get better. The skill ratchets upward.
4. **Equilibrium is optimal play.** For a solved game like tic-tac-toe, the arms race terminates when both sides play optimally — a forced draw. For unsolved games, the arms race can go arbitrarily far.

This is exactly how AlphaZero learned to play Go better than any human, starting from zero knowledge.

## The four big things to know

If you remember nothing else from this doc:

1. **Episodes** are individual games the bot plays during training. Thousands of them stack up to a trained skill.
2. **Reward** is the signal the bot learns from: +1 win, 0 draw, -1 loss for tic-tac-toe.
3. **Epsilon** controls exploration vs exploitation: high early, low late.
4. **There are six algorithms** on AI Arena, each with different strengths. Q-Learning is the recommended starting point.

## What to do next

You're ready to train. Three paths:

- **Just do it** → "Your first bot — a walkthrough" gives you the concrete click-by-click recipe.
- **Go deep on concepts** → "Bot training concepts" covers epsilon, gamma, decay schedules, training modes.
- **Pick an algorithm** → "Q-Learning" is the recommended starter; the algorithm doc gives you settings and a session recipe.

## Common questions

**Is RL the same as machine learning?** RL is one of three major branches of ML. The others are *supervised learning* (learning from labeled examples — "this picture is a cat") and *unsupervised learning* (finding structure in unlabeled data). RL is unique because it learns from **outcomes of actions**, not from given answers.

**Why is tic-tac-toe a good RL problem?** It's small enough to fully solve (the agent can converge in minutes), the rules are universally understood, and the strategic structure (center > corner > edge, forks, blocking) is rich enough that an untrained agent is visibly different from a trained one. Perfect for learning RL.

**Will my bot keep learning during real games (post-training)?** No. After training completes, the skill is **frozen** — its weights don't change during inference. If you want it to learn more, run a new training session. The new session creates a new **version** in the skill's version history.

**Can a bot trained for tic-tac-toe play chess?** No. The state representation, action space, and reward structure are game-specific. A bot would need a separate **skill** per game. The platform supports this — your bot can carry one skill per game.

**Why does my bot draw against my other bot after training?** Because tic-tac-toe is a solved draw with optimal play. Once both your bots are trained well enough to play optimally, every game between them is a draw. This is success, not failure.

**Does the bot understand what it's doing?** No — and importantly, it doesn't need to. The bot has no concept of "fork" or "diagonal threat" the way a human does. It just knows which moves tend to produce high rewards in which board configurations. The Explainability tab lets you peek at the bot's value estimates and see whether they correspond to human strategic intuition (often they do).
