---
slug: gym-explainability-tab
title: The Explainability tab — see what your bot learned
category: training
tags: [explainability, debugging, interpretation, q-values, policy, attention]
status: PUBLISHED
admin_only: false
---

# The Explainability tab — see what your bot learned

Most training tools tell you **how well** the bot performs (win rates, ELO). The Explainability tab tells you **what the bot has learned** — the internal values and probabilities it uses to make decisions. This is the most underused tab in the Gym, and the most powerful for diagnosing problems and building intuition.

## What it shows

You load a specific tic-tac-toe position into the tab, and it visualizes the bot's view of that position:

- **Value estimates** — how good is each possible move from this position, in the bot's opinion.
- **Policy probabilities** — for policy-based algorithms (Policy Gradient, AlphaZero), how often the bot would pick each move.
- **Attention / activations** — for neural-net algorithms (DQN, AlphaZero), which input features the network is paying attention to.

For tabular algorithms (Q-Learning, SARSA, Monte Carlo), you see **Q-values** directly. For neural, you see the network's per-cell output.

## Loading a position

Three ways:

### From scratch

1. Open the Explainability tab.
2. The default view is an empty board.
3. Click any cell to place X, click again to place O, click again to clear. Build up the position you want to inspect.
4. Click **Inspect** to compute the bot's view.

### From a replay

1. Open a replay from your bot's profile or `/replay/:id`.
2. Pause on the position you want to inspect.
3. Click **Send to Explainability** (visible during pause).
4. The Explainability tab opens with that position pre-loaded.

This is the most useful path — load a position from a game you just lost, and see exactly where the bot's evaluation went wrong.

### From a benchmark game

After running a benchmark in the Evaluation tab, expand the result for a specific game. Each loss has an **Inspect** affordance that opens the Explainability tab at the move where the bot made its worst (greatest value-loss) decision.

## The Q-value view (tabular skills)

For tabular algorithms, the board shows nine cells. Each empty cell has its **Q-value** rendered as:

- A **number** (e.g., `+0.82`, `-0.15`).
- A **color gradient** (green = good for the bot to play here; red = bad; gray = neutral).
- A **size** indicator if Q-values are clustered.

The cell with the highest Q-value is the bot's **greedy choice** — what it would play at ε=0.

### What healthy Q-values look like

For a well-trained Q-Learning bot looking at an empty board (X to move):

- **Cell 5 (center)**: Q ≈ +0.7 (clear best)
- **Corners (1, 3, 7, 9)**: Q ≈ +0.3 (next best)
- **Edges (2, 4, 6, 8)**: Q ≈ -0.1 (weakest)

The bot prefers center, then corners, then edges — matching human tic-tac-toe intuition.

### What unhealthy Q-values look like

- **Flat values across the board** (everything ≈ 0) — the bot didn't learn distinctions. Probably under-trained. Run more episodes.
- **Random-looking high values on edges, low on center** — the bot's training was distorted. Maybe it never explored the center enough. Check the Sessions tab for which mode produced this skill.
- **One cell at +1.0 and others at -1.0** — overfit to a specific pattern. Probably too aggressive a learning rate; try Auto-Tuner.

## The policy view (Policy Gradient and AlphaZero)

For these algorithms, the per-cell display shows **move probabilities** (summing to 100% across valid cells) rather than Q-values:

- Cell 5: 42%
- Cell 1: 14%
- Cell 3: 14%
- Cell 7: 14%
- Cell 9: 14%
- Edges: 0% each

The bot would pick cell 5 with 42% probability if sampling, 100% if going greedy. This is the **softmax distribution** the algorithm learned.

### Reading policy spread

- **High concentration on one cell (90%+)** — deterministic. Good for AlphaZero late in training (Temperature → 0.1). Bad for Policy Gradient, which loses its unpredictability advantage at high concentration.
- **Even spread across several cells** — uncertain. The bot considers multiple moves comparable.
- **Spread concentrated on the *wrong* cells** — the bot's learned bad preferences. Check the training run that produced this skill.

## The value view (AlphaZero)

AlphaZero is unique in having a separate **value network** — predicts the overall position value (range [-1, +1] for [losing, winning]) rather than per-move Q-values.

The Explainability tab shows two numbers for AlphaZero:

- **Position value** — what the value net predicts. +0.7 means "the bot is winning". -0.3 means "the bot is slightly losing".
- **MCTS visit counts** — for each move, how many simulations explored that branch. The bot picks the most-visited.

A strong AlphaZero bot's value predictions should match the actual game outcome: at the start it's ~0 (uncertain), late in a won game it's ~+1, late in a lost game it's ~-1.

## The attention view (DQN and AlphaZero, optional)

If your skill is a neural network, an **attention** or **activation** sub-view shows which input cells the network is paying most attention to when computing its decision.

This is highly experimental and most useful for debugging:

- If attention is **uniform** across cells, the network isn't pattern-matching effectively.
- If attention is **concentrated on relevant cells** (e.g., the cells that form a threat), the network has learned to recognize structure.

Attention visualizations are technical. They're most useful when you're explicitly investigating why a neural skill underperforms.

## Using Explainability to diagnose problems

### "My bot keeps losing in a specific position"

1. From the replay of the lost game, send the position to Explainability.
2. Look at the bot's Q-values: which move did it pick? Was that the right move?
3. If the bot picked a clearly bad move (low Q-value relative to other cells but happens to be the actual best move), it's a values-learning gap — train more on that pattern.
4. If the bot picked the move with the highest Q-value but that move is actually bad, the Q-values are wrong — the training distribution didn't include enough of this position.

### "My bot draws all games — is it stuck?"

For tic-tac-toe self-play, all-draws is **success**, not stuck. But check Explainability for an empty board:

- If center is clearly +0.7, corners next, edges last → it learned correctly. The draws are the optimal outcome.
- If values are flat → it didn't learn; the draws are because both sides are random. Train more.

### "Did my training session actually help?"

Open Explainability on the same position before and after the session. Compare the Q-values. If they shifted meaningfully (e.g., the best move's Q went from +0.4 to +0.7), the session helped.

## Using Explainability as a strategy oracle

Even when not debugging, you can use a strong trained bot's Explainability view as a "second opinion" on the right move in any position:

1. Build the position you're curious about.
2. Inspect with your strongest bot (or with one trained on AlphaZero).
3. The bot's recommendation is your reference.

For tic-tac-toe, a well-trained Magnus-level bot's recommendation is by definition optimal — you can use it to verify your own strategic thinking.

## Comparing two skills' views on the same position

If you have multiple skills (e.g., Q-Learning and AlphaZero versions), load the same position in each:

1. Sidebar → pick skill A → Explainability → load position → save the view (screenshot or "pin" if available).
2. Sidebar → pick skill B → Explainability → load same position.
3. Compare.

This is gold for understanding **algorithm differences**. A Q-Learning bot's center-bias and an AlphaZero bot's MCTS-rooted preferences will look subtly different in the visualization — often a tipoff to which algorithm is stronger in this specific scenario.

## What Explainability does NOT show

- **The bot's reasoning in human terms.** The bot doesn't think "this is a fork". It just has values. The interpretation as "fork" or "diagonal threat" is something *you* do when looking at the numbers.
- **The bot's confidence.** Q-values and policy probabilities show preferences, not certainty. A bot with Q = +0.7 on the center can be very confident or modestly confident; the value doesn't differentiate.
- **Tree search beyond the immediate move (mostly).** For AlphaZero, you see MCTS visit counts which are an indirect signal; full search trees are not visualized.
- **History.** Each position is inspected fresh; the bot doesn't remember what it saw two moves ago in this game.

## TL;DR

- Open Explainability, build or load a position, click Inspect.
- For tabular skills: Q-values per cell, color-coded.
- For policy skills: move probabilities.
- For AlphaZero: position value + MCTS visit counts.
- Use it to debug losses (load the losing position), validate training (compare before/after), and as a strategy oracle (let a strong bot tell you the right move).
- It's the most underused tab; the more you use it, the faster you improve as a bot trainer.
