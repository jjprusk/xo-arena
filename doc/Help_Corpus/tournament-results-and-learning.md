---
slug: tournament-results-and-learning
title: Tournament results — how to read them, how to learn from them
category: tournaments
tags: [tournament, results, analysis, learning, post-mortem]
status: PUBLISHED
admin_only: false
---

# Tournament results — how to read them, how to learn from them

You played a tournament. What now? This doc covers how to interpret the result page, what each number means, how to identify what your bot did well and badly, and how to turn each tournament into faster bot improvement.

## The result page

After a tournament completes, its detail page shows:

- **Final standings** — all entrants ranked 1st through Nth.
- **Your placement** highlighted.
- **TC prize** earned (if any).
- **Tournament classification change** — your Rookie/Amateur/etc. tier may have moved.
- **Each of your matches** with results, scores, and links to replays.
- **The full bracket** with every match's outcome.

If you registered as a recurring subscriber, this is the per-occurrence result. Your subscription continues for the next occurrence regardless.

## Your placement vs your bot's true ELO

Tournament placement is a small sample. Don't over-read it.

- **8-entrant single-elim**: 3 matches max. Variance is high. A clearly stronger bot can still lose to a worse one in any given best-of-3.
- **16-entrant**: 4 matches max. Still high variance.
- **Round-robin 6-entrant**: 5 matches per bot. Lower variance; results more reliable.

A consistent pattern across **3+ tournaments** is signal. A single tournament's result is noise.

To get a more reliable reading: look at your bot's **benchmark ELO** (in the Evaluation tab) alongside its tournament classification. If benchmark says 1,400 and classification says Rookie, your tournament placement is *below* what your bot's strength predicts — you've had bad luck or matchups. If they roughly agree, the tournament results are confirming the benchmark.

## Per-match analysis

For each of your matches in the bracket:

### The score

A best-of-N match's score breaks down by individual games:

- **2-0**: dominant win/loss. Your bot was clearly stronger or clearly weaker.
- **2-1**: close. Both bots had chances. The match could have gone either way.
- **2-1 with a draw**: one game was a forced draw (typical with two converged tic-tac-toe bots). The decisive games show the real skill gap.

Pay attention to:

- **Did you win the games where you went first (X)?** Strong bots should win or draw as X. If you lost as X, something's wrong in your bot's offensive play.
- **Did you lose the games where you went second (O)?** Losing as O is expected occasionally; losing every time signals weak defense.

### The replay

Every game in the match has a replay. Open the **losing** games first — that's where the learning is.

For each loss:

1. **Step through to the position you lost from.** Often there's a single move where the game turned.
2. **Identify the critical move.** Either the move your bot made (and shouldn't have) or the move your bot didn't make (and should have).
3. **Send to Explainability.** The Q-values for that position show what your bot believed.

### What the Explainability view tells you

Three possible diagnoses:

#### "The Q-values are wrong"

Your bot picked the highest-Q move, but that move was actually bad. The Q-values don't reflect reality.

**Cause**: incomplete training, or this position wasn't in the training distribution.

**Fix**: more training, especially in similar positions. Consider vs-Master sessions to expose your bot to strong play.

#### "The Q-values were close"

The winning move and the losing move had nearly equal Q-values. Your bot's choice was effectively a coin flip.

**Cause**: the bot didn't learn to distinguish these positions.

**Fix**: train longer at low epsilon (Epsilon min 0.01) to sharpen the policy.

#### "The bot lost because of an inferior position"

The Q-values were reasonable, but the position was already bad. Your bot couldn't recover.

**Cause**: an earlier move (2-3 turns prior) led to this losing position.

**Fix**: trace back through the replay to find the earlier bad move. Then apply diagnosis #1 or #2 to *that* position.

## Win/draw/loss patterns

Looking across your tournament's matches as a set:

| Pattern | What it suggests | What to do |
|---|---|---|
| Wins early, lose final | Bot is competitive at this tier; barely outclassed by top entrant | Continue training; you're close |
| Lose round 1 every time | Field is too strong | Drop to a lower-tier tournament; or retrain |
| Win round 1, lose round 2 consistently | Strong against weak, weak against strong | Need to train against stronger opponents (vs-Master) |
| Many draws | Bot is solid but not aggressive enough | Lower Epsilon min for sharper play; or try Policy Gradient style |
| Random results, no pattern | Field is noisy; bot is near median | Stay at this tier; expect variance |

If your win/loss profile changes dramatically (you used to win Rookie tournaments easily, now you're losing), the field has shifted. New strong entrants joined; you may need to train more to keep up.

## Comparing to your benchmark

Open the **Evaluation tab → Benchmark history** for your bot's active skill. Compare your tournament placement to your benchmark prediction:

| Benchmark predicted | Tournament placed | Read |
|---|---|---|
| Top 25% | Top 25% | Working as expected |
| Top 25% | Bottom 50% | Bad luck or specific matchup weakness; play more |
| Bottom 50% | Top 25% | Lucky placement; expect regression |
| Top 50% across multiple tournaments | Top 50% | Solid; pursue classification climb |

A single divergence is noise. Three divergences in a row is signal.

## Classification movement

Your tournament classification is a separate ladder from your benchmark ELO. After each tournament:

- **Top placement (1st-2nd)**: significant classification gain.
- **Middle placement**: small gain or no change.
- **Bottom placement**: small loss.
- **Lost round 1**: noticeable loss.

The platform's classification update math weights opponents' classifications — beating a higher-tier bot is worth more than beating a peer.

Patterns:

- **Steady climb**: keep doing what you're doing.
- **Plateau**: you're at your current peak; need a stronger bot to climb further.
- **Decline**: your bot is now weaker than the field. Train.

## Common post-tournament reactions and what to do instead

### "I won! I'm done with this version."

Don't promote out of a working version too fast. Play several more tournaments with it to confirm. A single win could be lucky bracket placement.

### "I lost — time to retrain."

Maybe. Look at *how* you lost first. A close best-of-3 loss against a strong opponent doesn't mean your bot is bad; it means the field was tough. A 0-2 loss against a weaker bot is a real warning sign.

### "I should switch algorithms."

Algorithm switches mean restarting training from scratch (DQN from Q-Learning is a fresh 25,000+ episodes). Only do this when you have clear evidence your current algorithm has plateaued — not just one bad tournament.

### "I'll just enter more tournaments."

Quantity ≠ improvement. Consistent participation matters, but blindly entering everything dilutes your data. Each tournament should be either a test of a specific change or a confirmation of a known version.

## Building a tournament log

For serious players: keep notes (outside the platform) on each tournament:

- **Date and template.**
- **Bot version used.**
- **Placement.**
- **Notable matches** — wins/losses you learned from.
- **What changed since the last tournament** — training, hyperparameters, algorithm.
- **Lessons for next time.**

This log becomes a personal RL research notebook. Over months, patterns emerge that no single tournament reveals. "DQN beats Q-Learning more reliably in 16-entrant brackets" or "Policy Gradient struggles in tier-3 templates" are the kinds of insights that come from systematic tracking.

The platform doesn't have an in-app log surface yet (planned for future). Until then, a personal markdown file works.

## Replay storage and learning over time

Replays are retained for 90 days by default (tournament and casual both). After that, the move stream is purged; the final result is kept forever.

**Implication**: if you want to study a particular game long-term, **export it** (Profile → game → Export replay) before retention expires. Especially for tournament wins or instructive losses.

## The Sessions tab as memory

Every training session is recorded in the **Gym → Sessions tab**. Each row tells you:

- What you tried (algorithm, hyperparameters).
- What it produced (benchmark, ELO change).
- When (date).

Over time, the Sessions list becomes your training history. Combined with tournament results, you have a complete record of what worked and what didn't.

For an organized view, run benchmarks periodically — every 3-5 sessions — so you have benchmark numbers at known points in time. The graph of "benchmark ELO over time" is one of the most useful charts in the platform.

## When a tournament reveals a bot weakness

Specific patterns that should drive specific fixes:

| Tournament loss pattern | Diagnosis | Fix |
|---|---|---|
| Lost a forced-draw position as O | Bot doesn't know perfect O defense | Train more vs-Minimax; especially Master |
| Lost to a Policy Gradient opponent the second time you faced it | Your bot has no variety; PG learned a counter | Try a more stochastic algorithm yourself |
| Lost the final after winning earlier rounds | Bot is good but not great; ceiling reached | Switch algorithms or longer training |
| Won several rounds with the same opening; lost when opponent prepared a counter | Bot is too predictable | Add Policy Gradient skill or use Alternating training mode |
| Lost when the opponent used a non-canonical opening | Bot didn't see this position in training | More episodes; vs-random-opening training mode (if available) |

## Bottom line

Tournament results are data. The data is noisy at first (single tournaments) and signal-rich over time (3+ tournaments). The discipline is:

1. **Analyze each loss replay**, but accept that some losses are just variance.
2. **Look across tournaments** for patterns before retraining.
3. **Compare placement to benchmark** to validate predictions.
4. **Track classification movement** as the long-term metric.
5. **Keep notes** — your training instincts will improve faster with a log.

Every tournament makes you a smarter bot trainer, if you let it. The losses teach more than the wins.
