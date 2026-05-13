---
slug: how-bots-learn
title: How bots learn — rewards, states, actions, convergence
category: training
tags: [rewards, state, action, convergence, learning, training-internals]
status: PUBLISHED
admin_only: false
---

# How bots learn — rewards, states, actions, convergence

The algorithm docs (Q-Learning, DQN, etc.) tell you the *settings*. This doc tells you what's actually happening **inside** the bot during training. If you understand the four concepts here — reward, state, action, convergence — every algorithm makes sense.

## The reward signal

Every learning algorithm on AI Arena is driven by a single number: the **reward**. For tic-tac-toe:

| Outcome | Reward to the bot |
|---|---|
| Win | **+1** |
| Draw | **0** |
| Loss | **-1** |

That's it. The bot has no other signal. No "you played the center, that was smart" hint. No "you missed a fork" warning. Just one number at the end of each episode.

From this single number, the bot learns:

1. The reward propagates **backward** through the moves the bot made in that game.
2. Each move gets credit (or blame) **discounted by gamma** for how far back it was. The last move before the win gets nearly the full +1; the first move gets +1 × γ⁸ ≈ 0.43 at γ=0.9.
3. Over thousands of episodes, the moves that consistently lead to wins accumulate positive value; moves that lead to losses accumulate negative value.

This is **temporal credit assignment**: the problem of figuring out which past moves were responsible for the eventual outcome. It's the central challenge of RL, and it's why training takes thousands of episodes — the signal is sparse (one number per episode) and the credit assignment is fuzzy.

### Why reward shaping matters

You might think "what if we gave the bot reward for blocking threats, or for taking the center?" That would be **reward shaping** — engineering richer feedback. AI Arena deliberately doesn't shape rewards because:

- **It assumes the answer.** If you reward "blocking threats", you're telling the bot a pre-existing strategy. The bot can no longer discover better strategies that don't involve aggressive blocking.
- **Tic-tac-toe doesn't need it.** Episodes are short (≤9 moves) and the win/loss signal is enough to propagate through them.

For longer games (chess, Go), reward shaping becomes more important — but it's also riskier because it biases the policy.

## The state — how the bot sees the board

For the bot to learn what to do in a given situation, it needs a **representation of that situation**. This is the **state**.

For tic-tac-toe, the state is the 9-cell board with X's, O's, and empties — plus whose turn it is. Different algorithms encode this differently:

- **Tabular algorithms** (Q-Learning, SARSA, Monte Carlo, Policy Gradient) — use a **string** of 9 characters as the state. `"X.O.X..O."` represents a specific position. Each unique string is a row in the Q-table.
- **Neural algorithms** (DQN, AlphaZero) — use a **9-dimensional vector** as input to the network. Each cell is encoded as a number (e.g., +1 for X, -1 for O, 0 for empty). The network's hidden layers can recognize patterns across positions.

The crucial difference: tabular sees every position as **unrelated** to every other position. The Q-value for `"X.O.X..O."` is independent of the Q-value for `"O.X.O..X."` (even though one is a mirror image of the other). Neural networks can **generalize** — they learn that certain patterns matter regardless of exact position.

For tic-tac-toe's ~5,478 states, tabular is fine. For games with billions of states, neural is the only option.

## The action — what the bot can do

An **action** is a move the bot picks from the current state. For tic-tac-toe, actions are "place my mark in cell N" (N = 1-9). The action space is small (≤9 valid actions per state, fewer as the board fills).

How the bot picks an action depends on the algorithm:

| Algorithm | How it picks an action |
|---|---|
| Q-Learning, SARSA, DQN | Pick the action with the highest **Q-value** (greedy) — except with probability **ε**, pick a random action. |
| Monte Carlo | Same as above (epsilon-greedy on Q-values). |
| Policy Gradient | **Sample** from a softmax distribution over preferences. Naturally stochastic; no explicit epsilon during inference. |
| AlphaZero | Run **MCTS** with ~100 simulations from the current state, then pick the most-visited child of the root. No epsilon — exploration happens inside the tree. |

The variety of action-selection strategies is much of what differentiates the algorithms. Same reward, same state, different way to commit to a move.

### Inference vs training

The action selection above applies during **training**, where ε > 0 keeps exploration alive. At **inference** time (after training is done, when the bot is playing real games or being benchmarked), ε = 0 and the bot is fully greedy. The Q-values (or policy weights) are frozen.

This is why **benchmark scores can differ from training scores**. Training-time win rates are measured with the bot exploring; benchmark scores are measured with the bot exploiting. If the bot relies on exploration to win during training, its inference performance will be lower.

## The update rule — where learning happens

Every algorithm has a different **update rule** — the math that adjusts the bot's values or weights after each step (or episode). The intuition is the same across all of them:

> **Make the action you just took look a little better if it led to good outcomes, and a little worse if it led to bad ones.**

Mechanically:

- **Q-Learning** — after each move, update `Q(state, action)` toward `reward + γ × max(Q(next_state, a))`. The "max" is the off-policy bit.
- **SARSA** — same, but use `Q(next_state, action_taken)` instead of the max. On-policy.
- **Monte Carlo** — wait until episode ends, then walk backward through every (state, action) and update toward the actual return (no bootstrapping).
- **Policy Gradient** — increase the preference for actions that led to higher returns; decrease for lower.
- **DQN** — like Q-Learning, but the Q-function is a neural network. Use gradient descent to push the network's prediction toward the target value.
- **AlphaZero** — train the policy network to match MCTS visit counts; train the value network to match game outcomes.

You don't need to memorize the math — but knowing that **each algorithm has a slightly different rule for "what to update toward"** makes the algorithm docs much easier to read.

## Discount factor — how far ahead the bot thinks

In tic-tac-toe, the reward only comes at the end of the game. So how does the *first* move learn anything?

The answer is the **discount factor**, gamma (γ). When the bot updates Q-values, future rewards are multiplied by γ. With γ = 0.9:

- The move just before the win contributes nearly +1.
- The move two before contributes +0.9.
- The move three before contributes +0.81.
- … and so on, decaying geometrically.

This means **early moves accumulate signal more slowly than late moves**. The first move's Q-value is harder to learn correctly because the connection to the eventual reward is more distant.

Why not γ = 1.0 (no decay)? It would work for tic-tac-toe (games always end), but in general RL γ < 1 ensures convergence even for games that might go on forever. It also encodes the idea "winning sooner is preferable to winning later" — useful for many real-world problems.

## Convergence — when is training done?

A skill **converges** when its values (or weights) stop changing meaningfully between episodes. The bot has settled on a stable policy. Running more episodes of the same algorithm doesn't change anything.

Signs of convergence:

- **Win rate flatlines.** The thick recent line in the live training chart hovers around a stable value.
- **Q-values stop changing.** In the Explainability tab, the value of a specific position you check before and after another 1,000 episodes is nearly identical.
- **Benchmark scores plateau.** Benchmark after every session; if scores haven't moved in two sessions, you've converged.

For tabular algorithms, convergence is provably guaranteed under mild conditions (epsilon eventually small enough, learning rate eventually small enough, all states visited often enough). For neural algorithms, convergence is less guaranteed — there's a real risk of oscillation or divergence if hyperparameters are bad.

Convergence is **good news, not bad**. It means the bot has finished learning. The question then is: did it converge to a *good* policy?

### Converging to a bad policy

It's possible for a skill to converge to a **suboptimal policy** — settled, stable, and weaker than it could be. Causes:

- **Epsilon decayed too fast.** The bot stopped exploring before it found the best moves. It's now confident in mediocre choices.
- **Initial random exploration didn't cover key states.** Some positions were rarely visited; their Q-values stayed near their random initialization.
- **Learning rate was too high.** Each update overshot, destabilizing converged values.

If you suspect a bad convergence, **the fix is rarely "more episodes"**. Instead:

1. Lower the **epsilon min** (e.g., 0.05 → 0.01) and run a final exploitation session.
2. **Sweep hyperparameters** with the Auto-Tuner.
3. Switch to a **different algorithm** or **add a neural skill** if you've hit the tabular ceiling.

## Why bots draw against themselves after training

A common observation: after a bot is well-trained, self-play games are all draws.

This isn't a bug. It's a **theorem about tic-tac-toe**: with optimal play, neither side can win. A converged bot playing itself produces optimal play. Result: forced draw.

So once you see your self-play win/draw/loss numbers settle to roughly 0% / 100% / 0%, training is done. The bot has discovered the optimal policy. Switching to vs-Minimax (or to a stronger opponent than your own bot) is the only way to extract more signal.

This is also why the Rookie Cup includes Sterling — your trained bot needs an opponent that *isn't itself* to keep proving its skill.

## Quick mental model

When you watch the training chart, mentally translate what you're seeing:

| What you see | What it means |
|---|---|
| Win rate rising steadily | Bot is learning. Keep going. |
| Win rate flat at >70% in self-play | Likely converged. Move to vs-Minimax. |
| Win rate oscillating wildly | Bad hyperparameters (high α) or too-small replay buffer (DQN). |
| Win rate falling | Catastrophic forgetting (DQN) — increase replay buffer; or training collapse (PG) — lower α. |
| Both win and draw rates climbing together | Healthy — bot is learning to avoid losses, which often means more draws. |
| Draw rate near 100%, both sides | Self-play converged. Tic-tac-toe is solved; this is what success looks like. |

## What the bot doesn't learn

It's worth being clear about what RL *isn't* doing:

- The bot doesn't form **abstract concepts** like "fork" or "diagonal threat". It learns values that *correlate* with those concepts, but it doesn't know the words.
- The bot doesn't learn **transferable strategy** between games. A tic-tac-toe trained skill is useless for Pong. (That's why bots can have multiple skills.)
- The bot doesn't have **memory across episodes** in the usual sense. Each episode is independent; what carries over is the updated values/weights, not memory of specific past games.

This is part of why the **Explainability tab** is useful — it shows you what the bot has learned in *its own terms* (Q-values or move probabilities), which often corresponds beautifully to human intuition but never identically.

## TL;DR

- **Reward** is the single number the bot learns from (+1/0/-1).
- **State** is how the board is represented (string for tabular, vector for neural).
- **Action** is a move; selection strategy varies by algorithm.
- **Update rule** is how values change per step; varies by algorithm, intuition is the same.
- **Gamma** discounts future rewards, making far-away moves harder to learn.
- **Convergence** means training is done; check via flat win-rate, stable Q-values, plateaued benchmarks.
- **Self-play converges to draws** in tic-tac-toe — this is correct, not broken.

Now read the algorithm docs and the settings will make sense.
