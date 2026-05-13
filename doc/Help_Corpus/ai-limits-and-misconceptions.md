---
slug: ai-limits-and-misconceptions
title: What AI can't do — limits and misconceptions
category: basics
tags: [ai, limits, misconceptions, safety, critical-thinking, learning]
status: PUBLISHED
admin_only: false
---

# What AI can't do — limits and misconceptions

AI Arena is a platform for learning *what* AI can do. To learn well, you also need to know what it *can't* do — and which intuitions about AI are wrong. This doc covers the common misconceptions, what your bots actually understand (and don't), and how to think critically about AI behavior generally.

## Misconception 1: "The bot understands the game"

Your trained bot doesn't understand tic-tac-toe. It doesn't know what a "row" is, or what "winning" means, or that there's an opponent.

What the bot has is a function: given a board state, predict a number per move. Higher number = more likely to lead to a future reward signal. That's the whole representation.

You, the human, look at the bot's behavior and apply concepts: "the bot is trying to block", "the bot prefers the center". Those are interpretations. The bot has no internal experience of trying or preferring — it has Q-values.

**Why this matters:** when your bot makes a strange move, don't ask "what was it thinking?" Ask "what numbers led to this choice, and are those numbers right?" The Explainability tab gives you the numbers. The "thinking" framing is a metaphor that works for humans communicating about AI but is misleading as an actual model.

## Misconception 2: "More episodes = a better bot, always"

There's a ceiling. For Q-Learning on tic-tac-toe, the ceiling is around 7,000-10,000 episodes; past that, your Q-table is converged and more episodes just confirm what it already knows.

Worse, more episodes with **bad settings** can make a bot *worse*. If learning rate is too high, late episodes can overwrite good early learning with noisy updates. If epsilon decays too slowly, the bot keeps exploring instead of consolidating.

**Why this matters:** if your bot is plateaued, the fix is rarely "more of the same". It's "different settings" or "different algorithm". See the troubleshooting doc.

## Misconception 3: "Bigger neural networks always do better"

For tic-tac-toe DQN, `[64, 64]` is the sweet spot. Going to `[128, 128]` or `[256, 256]` doesn't improve the bot — it just takes longer to train. The problem isn't network capacity; the problem is the size of the game.

Larger networks have more parameters, which means they need more data to learn well, which means more episodes — and you've spent your time training the network's *extra* parameters rather than refining the ones that matter.

**Why this matters:** the ML field has a general principle: **match network size to problem complexity**. Tic-tac-toe is simple. A small network is enough. Going bigger is wasted compute. The same applies in all ML — the right model size is a function of the problem, not "bigger is always better".

## Misconception 4: "AI improves continuously after deployment"

After training is done, your bot is **frozen**. Its weights don't change when it plays real games. If you want it to learn from a tournament loss, you'd have to manually run another training session.

This is called **inference mode** and it's the default. Online learning (continuous updates during play) is a different setting with its own stability and safety considerations.

**Why this matters:** if you watch your bot lose a game and think "it'll know better next time" — it won't, unless you retrain. The bot you play with on the ladder today is identical to the bot you finished training. Aging gracefully is a separate skill from initial training.

## Misconception 5: "The bot has memory across games"

Each game starts fresh from the bot's perspective. The Q-values represent **patterns across many games**, but the bot has no memory of "the last game we played". It doesn't remember that you opened with center against it last time.

This is different from how humans play. A skilled human opponent will remember your style, your favorite openings, your tendencies under pressure. The bot doesn't do this in v1.

**Why this matters:** your bot's behavior in game N is determined entirely by its Q-values (which don't change at inference) and the current board state. Not by what happened in game N-1. If a human opponent figures out a counter to your bot's play style, the bot won't adapt mid-match — only retraining changes its responses.

## Misconception 6: "AI uses 'human-like reasoning'"

Watching your bot play, it's easy to feel that it "decided" to block your threat or "saw" the fork developing. But the bot's process is fundamentally different from how a human thinks.

A human sees the board and recognizes patterns: "this is a fork setup", "they're threatening the diagonal". Then deliberates between options. Then commits.

A bot does: look up Q-values (or run the value function), pick the max. There's no deliberation, no recognition, no naming of patterns. The bot's "reasoning" is a single matrix multiplication (for DQN) or a single table lookup (for tabular).

**Why this matters:** when you read AI news ("an AI figured out X"), the natural inclination is to imagine the AI thinking through the problem. Usually it's not. Usually it's a different kind of process — fast pattern matching, sometimes elegant, but not human-like. The mental shortcut of "imagine the AI thinking" often misleads you about both what AI can do and what it can't.

## Misconception 7: "AI can generalize across games"

Your XO-trained AlphaZero bot is useless at Pong. The state representation is different (board vs continuous paddle positions), the action space is different (cell choice vs paddle velocity), the dynamics are different (turn-based vs real-time).

Within AI Arena, you create a **separate skill per game**. Your bot can carry multiple skills (one per game) but they're trained independently.

This isn't a platform limitation — it reflects the actual state of the art. Cross-game generalization in deep RL is a hot research topic and remains hard. The recent papers on "foundation models for control" are trying to solve it; we're not there yet.

**Why this matters:** if you want a bot that plays many games well, you need to train each game's skill separately. There's no "general game intelligence" shortcut.

## Misconception 8: "If the bot played well in training, it'll play well in real games"

Training-time win rate is measured with epsilon > 0 (exploration active). Real games use epsilon = 0 (pure greedy). These can differ significantly:

- A bot exploring 30% randomly might still win 70% of training games (because the opponent is also exploring).
- The same bot at ε=0 might benchmark only at 55% because the greedy policy isn't as strong as the exploratory one.

**Why this matters:** always run a benchmark before deploying. Training scores are noisy and biased upward. Benchmarks (at ε=0) are the honest test.

## Misconception 9: "The bot will play the best move it can"

Your bot will play the **highest-valued** move according to its current Q-values. If the Q-values are wrong (because of incomplete training, bad hyperparameters, etc.), the bot plays sub-optimally and doesn't know it.

The bot has no meta-awareness. It can't tell you "I'm uncertain about this move" or "this is outside my training distribution". It just picks the max and commits.

**Why this matters:** trust but verify. A confident-looking bot move isn't necessarily a confident move; it's just the max of the bot's current values. The Explainability tab lets you see the values; if they're flat across many cells, the bot is actually uncertain (but acting decisive).

## What AI Arena specifically can't do (in v1)

- **Train across multiple games at once.** One game per skill.
- **Transfer learning.** A pre-trained Pong skill won't help your XO skill.
- **Online learning.** Bots are frozen post-training.
- **Adversarial robustness.** A new opponent style can sometimes exploit your bot. The fix is more diverse training, not the platform.
- **Explain its own reasoning in human terms.** Explainability shows values; interpretation is your job.
- **Self-improve without training.** Bots don't watch their own games and adjust.
- **Generate new strategies on the fly.** The bot's strategy is its Q-values; those are fixed at inference time.

These are all areas where current RL research is active. AI Arena reflects the state of the art as of its build date — it doesn't claim to have solved problems the field hasn't.

## What AI does well (worth knowing)

To balance the doom-and-gloom: AI is genuinely impressive at:

- **Pattern recognition in fixed domains** — your AlphaZero bot finds opening principles humans took centuries to formalize.
- **Optimization within a defined reward function** — when the goal is clearly specified, RL is excellent.
- **Scaling with compute** — bigger models on more data with more episodes do better, often dramatically.
- **Beating humans at narrow tasks** — chess, Go, Atari, StarCraft, Dota, Diplomacy — all surpassed by RL systems trained on the right setup.
- **Discovering non-obvious strategies** — AlphaGo's move 37 in game 2 vs Lee Sedol was famously inhuman and beautiful.

The point of this doc isn't to dismiss AI's capabilities. It's to give you a calibrated view: AI is powerful and limited, and knowing where the limits are is part of being a good user of AI tools.

## Skepticism as a habit

When you read AI news, ask:

- **What was the reward function?** If it's narrow, expect specification gaming.
- **What was the training distribution?** If it's narrow, expect failures on out-of-distribution inputs.
- **Was it benchmarked at inference time?** Training-time numbers can be misleading.
- **Does it transfer?** If "AI solves X", does it then solve X-prime?
- **Was a human in the loop?** Sometimes "AI" is a small amount of automation around a lot of human supervision.

These questions are good intuition for any AI announcement. They're the same questions you should ask about your own bot's training results.

## Bottom line

Your bot is a function. It's a useful function and (after training) a strong one. It doesn't understand anything; it doesn't deliberate; it doesn't generalize beyond its training. It does map states to actions in a way that maximizes its reward signal.

That's enough to beat human players at tic-tac-toe, win tournaments, and teach you about AI. It's not enough to call AI "intelligent" in any rich sense of the word.

Learning to think about AI this way — what it *is*, not what it feels like it is — is one of the most useful things AI Arena can teach you.
