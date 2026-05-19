---
slug: self-play-vs-eval
title: Self-play, vs-minimax, and what an "eval game" is
category: training
tags: [self-play, eval, modes, training, learning]
status: PUBLISHED
admin_only: false
---

# Self-play, vs-minimax, and what an "eval game" is

There are three kinds of games happening when you train a bot, and they're easy to confuse. This doc separates them so you know what's a *training episode*, what's an *eval game*, and how they relate to the bot's eventual rating.

## The three kinds of games

**Training episode** — a game played to *update the bot's weights*. The bot is exploring, making mistakes, and learning from outcomes. Training episodes are what your preset's "episode count" counts. They're played at *training* settings: epsilon may be high (lots of exploration), and the opponent might be deliberately easy to give the bot something to win against.

**Eval game** — a game played to *measure how the bot is doing*. No learning happens. The bot uses its current weights at full exploitation (epsilon=0), and the opponent is a fixed reference (typically minimax at a known tier). Eval games are what the [multi-curve view](/help/training-multi-curve-eval) draws. They run periodically — currently every 1000 training episodes — and there are only ~20 per eval point, so they're cheap.

**Ranked game / tournament game** — a real game between the bot and either another bot or a human, played in the live arena and counted toward ELO. These don't happen during training; they happen when someone *queues* against the bot from the lobby.

## "Self-play" vs "VS-minimax" — these are training modes, not eval modes

Inside the training-episode bucket there are two flavours:

- **VS-minimax** — the bot trains against a fixed minimax opponent of a chosen difficulty. Good for early learning: the bot has a consistent foe to learn against.
- **Self-play** — the bot plays against a *copy of itself*, with both sides updating. Good for late-stage learning: the bot keeps getting harder to beat as it improves, so it never plateaus against a static opponent.

A real training curriculum often starts with VS-minimax and moves to self-play once the bot is strong enough to give itself a useful workout. Some algorithms (AlphaZero, MCTS) are self-play by design; others (Q-Learning, SARSA) work either way.

Eval games are **always vs-minimax** — they're calibrated against fixed reference opponents so the chart is comparable across runs.

## Why the eval games aren't part of training

If a bot played twenty eval games against minimax-hard every 1000 episodes *and learned from them*, you'd be biasing it toward whatever minimax-hard happens to do. That's the opposite of what eval is for. Eval should be a measurement, not training data.

Concretely: during an eval game, the bot's epsilon is forced to zero (pure exploitation), and the Q-table / network is not updated based on the result. The W/D/L tally goes into a `TrainingMetric` row that drives the chart, and that's it.

## What the rating update uses

The bot's ELO updates **after the session completes**, based on the final summary — not from individual training or eval games. The summary records the bot's overall W/D/L over the training episodes. ELO adjusts to reflect "this bot is now this strong."

Live ranked matches against this bot (after training finishes, from the lobby) move ELO too. Those are not training episodes; they're separate events recorded in the main `Match` history. See [matches-and-games](/help/matches-and-games).

## Picking self-play vs vs-minimax

Quick decision tree:

- **The bot is brand new and has never trained.** Start with VS-minimax against easy or medium. The bot needs to see *something* working before it can stand up to itself.
- **The bot has a stable learning curve against vs-minimax-hard and now plateaus.** Switch to self-play; it'll keep the bot's opponent strength climbing in lockstep with the bot.
- **The algorithm is AlphaZero or DQN with self-play enabled by default.** Don't overthink it — those engines are self-play-by-design and the preset already does the right thing.

## See also

- **`bot-training-concepts`** — what epsilon and gamma actually do during episodes.
- **`how-bots-learn`** — the per-episode update step explained.
- **`training-multi-curve-eval`** — reading the eval-side chart.
- **`matches-and-games`** — what counts as a ranked game outside of training.
