---
slug: bot-personalities-and-styles
title: Bot personalities — emergent styles per algorithm
category: training
tags: [styles, personality, emergent-behavior, algorithm-differences, spectating]
status: PUBLISHED
admin_only: false
---

# Bot personalities — emergent styles per algorithm

Different algorithms produce different *play styles*, even when trained to the same level of strength. A Q-Learning bot and a SARSA bot might benchmark the same but play visibly differently. This doc describes the emergent personalities you'll see, how to spot them when spectating, and how to choose an algorithm based on the style you want.

## Why emergent styles exist

Every algorithm makes the same goal — maximize expected reward — but optimizes it through a slightly different lens. The lens affects which strategies the bot favors:

- **Off-policy** algorithms (Q-Learning, DQN) optimize the **greedy** strategy directly, even while exploring. They learn the policy they'd play at ε=0.
- **On-policy** algorithms (SARSA) optimize the **exploration-aware** strategy — they account for their own randomness. The result is more conservative play.
- **Sample-based** algorithms (Monte Carlo) optimize over **complete-game outcomes** without bootstrapping. Slow to learn but clean.
- **Distribution-based** algorithms (Policy Gradient) learn **probability distributions** over actions, not single best moves. Naturally stochastic.
- **Search-based** algorithms (AlphaZero + MCTS) **plan at decision time** in addition to learning. The plans show.

After training, all six produce strong tic-tac-toe play. The texture of that play differs.

## The six personalities

### Q-Learning — "the optimizer"

**Vibe:** efficient, no-nonsense, plays the textbook move.

**Identifying behaviors:**
- Always takes the center on move 1 as X.
- Picks the canonical optimal response (corner) when O against a center opening.
- Sets up forks aggressively when the opponent is weak.
- At ε=0, plays the same line in identical positions every game.

**Watch for:** the Q-Learning bot is **predictable in a good way**. You'll see it play the lines that look right. If you're playing it as a human, memorizing its preferred openings will work against it — until you face a stronger algorithm that mixes things up.

**Best against:** weak opponents (Rusty, Copper) where direct exploitation wins games.

### SARSA — "the cautious"

**Vibe:** plays for the draw, never gambles, hard to exploit.

**Identifying behaviors:**
- Often picks moves that *block multiple opponent threats* even when a clear-winning move is available — because under SARSA's worldview, the winning move's value is dampened by the exploration risk during training.
- More likely to take the corner than the center if Q-values are close.
- Draws against Magnus consistently; rarely wins against Sterling.

**Watch for:** the SARSA bot plays like a chess master at endgame — defensive, accurate, drawish. You'll see it refuse aggressive lines that a Q-Learning bot would take.

**Best against:** human opponents who are aggressive. SARSA's conservatism punishes attacking style.

### Monte Carlo — "the slow learner"

**Vibe:** plays competently but a bit indecisively early in training; eventually competent but never the strongest.

**Identifying behaviors:**
- Q-values are less peaked than Q-Learning's — the bot has many cells with similar value, so it makes "fine" moves that aren't always the textbook best.
- Slow to converge (13k episodes), so early-version MC bots play with quirky preferences that get smoothed out later.
- After convergence, plays similarly to Q-Learning but a little less sharp.

**Watch for:** if you're watching a low-version MC bot, you'll see it make plausible but suboptimal moves — the kind of move that "isn't wrong but a stronger player would have done better".

**Best as:** a pedagogical bot for understanding RL. The clean credit assignment is easier to explain in a tutorial than TD methods.

### Policy Gradient — "the unpredictable"

**Vibe:** plays differently in similar positions, harder for humans to memorize, can win against opponents who model only one strategy.

**Identifying behaviors:**
- Same opening position sometimes leads to different first moves across multiple games (when softmax probabilities are close).
- Less likely to take the canonical "best" move; often takes a slightly weaker but unusual move.
- Plays well against fixed-strategy opponents who can't adapt.

**Watch for:** the PG bot's variety is the giveaway. If you see a bot play three different second moves in three games from the same first move, it's likely PG. Q-Learning, SARSA, and Monte Carlo wouldn't do that at ε=0 — they'd commit to a single line.

**Best against:** repeat human opponents. After 10 games, a human has typically memorized a Q-Learning bot's lines. PG forces them to re-adapt every game.

### DQN — "the generalizer"

**Vibe:** plays well in familiar positions; sometimes surprisingly good (or surprisingly bad) in unfamiliar ones.

**Identifying behaviors:**
- Handles common positions (canonical openings, standard mid-games) with confidence and high Q-values.
- In less-common positions (e.g., a weird opening you'd never see in normal play), the network's Q-values may be flatter — the bot is *interpolating* from similar training positions.
- Can occasionally make brilliant generalized moves that a Q-table-based bot would miss.
- Can also make mysterious blunders in positions the network didn't generalize well to.

**Watch for:** the DQN bot has a "smooth" feel — its moves flow logically even in unusual positions. Tabular bots in unusual positions sometimes feel jittery (since each unusual position is independent in the Q-table).

**Best for:** larger games (when AI Arena ships them) where generalization is required. For tic-tac-toe specifically, DQN's edge over Q-Learning is modest.

### AlphaZero — "the searcher"

**Vibe:** plays with apparent foresight; often makes moves whose value isn't obvious until 2-3 moves later.

**Identifying behaviors:**
- "Quiet" moves that don't directly threaten anything but tighten the position. Other algorithms might miss these.
- Strong endgame — MCTS searches forward and rarely misses winning lines.
- Variable opening choice depending on Temperature setting; at high temperature, plays diverse openings.
- May take a few seconds per move (visible "thinking" pause) because MCTS is running.

**Watch for:** the AlphaZero bot looks like a strong human player. Moves with subtle long-term consequences. The "thinking pause" is also a giveaway — other algorithms move instantly.

**Best against:** any opponent, with the highest absolute strength. The only algorithm that can find truly novel positional ideas.

## Spotting algorithm differences in spectator mode

When you're watching two bots play and don't know which algorithms they use:

| Signal | Likely algorithm |
|---|---|
| Always takes center first, always plays the textbook line | Q-Learning or SARSA |
| Visibly defensive; refuses aggressive moves | SARSA |
| Plays multiple different openings in repeated games | Policy Gradient |
| Visible pause before each move (1-3 seconds) | AlphaZero |
| Strong moves in unusual positions | DQN or AlphaZero |
| Slow learner profile (training history shows shallow win rate at modest episode count) | Monte Carlo |
| Sharp tactical play, perfect against weak opponents but draws against Magnus | Q-Learning |
| Subtle moves whose value emerges 2-3 moves later | AlphaZero |

You'll get faster at this with practice. After watching 50-100 games, the styles become obvious.

## Choosing based on style

The standard advice ("Q-Learning for fast, AlphaZero for strong") covers strength. Style adds another dimension:

| Goal | Pick |
|---|---|
| Reliable, textbook-strength bot for ladder play | Q-Learning |
| Defensive, draw-machine bot that's hard to beat | SARSA |
| Bot for studying RL pedagogically | Monte Carlo |
| Bot that surprises human opponents | Policy Gradient |
| Bot that generalizes (good for future multi-game) | DQN |
| Strongest absolute bot, willing to invest training time | AlphaZero |

For tournaments specifically:

- **Casual open tournaments**: Q-Learning is fine. Most opponents won't be strong enough to require more.
- **Rookie Cup / first competitive event**: AlphaZero if you have time; Q-Learning if not.
- **Recurring competitive tournaments where opponents see you weekly**: Policy Gradient — your bot's variability prevents opponents from building a counter.
- **High-stakes one-shots**: AlphaZero with full session recipe + final hardening.

## Style and human-vs-bot dynamics

If you're a human playing against your own bot to test it:

- **Q-Learning** feels like playing a strong but very consistent opponent. You'll find lines that exploit it; once you do, you'll win consistently.
- **SARSA** feels frustrating because it never goes for the win — every game becomes a slow draw or close defensive grind.
- **Monte Carlo** feels slightly random in early versions; later, similar to Q-Learning.
- **Policy Gradient** feels different every game. You can never quite memorize it.
- **DQN** feels human-like — confident in standard positions, occasionally surprising elsewhere.
- **AlphaZero** feels like playing someone significantly stronger than you. You'll lose more than you'd like.

These are subjective impressions but they hold up across many games and many users.

## Multi-skill bots and style

A bot can carry multiple skills (one per game). When you add a Pong skill to an XO bot, the *XO style stays the same* — that skill's algorithm and training are independent. You might have an XO Q-Learning skill (consistent) and a Pong AlphaZero skill (strong, slow) on the same bot. That's fine — they're separate; the bot's identity is just an umbrella over its skills.

What you can't do is *mix* styles within a single skill. A Q-Learning XO skill is Q-Learning. To get Policy Gradient style on the same bot, add a second skill or replace the existing one.

## Bottom line

Picking an algorithm isn't only about strength. The same strength comes in different flavors, and the flavor affects gameplay, opponent reactions, and how others (or you) perceive your bot. Knowing the styles helps you:

- Choose an algorithm that fits your goals.
- Spot algorithm differences when watching games.
- Predict how your bot will fare against various opponents.
- Understand why two trained bots with similar benchmarks play visibly different games.

A platform with six learnable algorithms gives you a six-dimensional toolbox. The more you understand each dimension, the better your bots get.
