---
slug: understanding-training-charts
title: Understanding training charts — what the lines mean
category: training
tags: [charts, analytics, training-panel, learning-curves, monitoring]
status: PUBLISHED
admin_only: false
---

# Understanding training charts — what the lines mean

During training, the Gym's live Training panel shows you charts in real time. The charts are your main signal for whether the bot is actually learning — much more informative than waiting for the session to finish and benchmarking. This doc explains every line, every axis, every number.

## The three charts

While a session is running, three charts update live:

1. **Win/Draw/Loss rate** — the main learning curve.
2. **Epsilon** — current exploration level.
3. **(DQN/AlphaZero only) Loss** — the network training loss.

For tabular algorithms (Q-Learning, SARSA, MC, Policy Gradient), only the first two appear. The third is neural-network-specific.

## The Win/Draw/Loss chart

This is the single most important chart in the Gym. It shows how often the bot is winning, drawing, and losing as training progresses.

### Two sets of lines

**Thick solid lines** — the **recent** rate, computed over the last batch of episodes (typically the last 100). Resets each update interval. These are the most informative — they show what the bot is doing **now**, not on average.

**Thin dashed lines** — the **cumulative** rate, computed over all episodes in the session so far. These rise slowly because they're weighted by every past episode including the early random play.

Three colors:

- **Green** — win rate.
- **Yellow** — draw rate.
- **Red** — loss rate.

The three always sum to 100%. If the bot is winning 70%, drawing 20%, and losing 10%, those add to 100% — every episode has exactly one outcome.

### What healthy learning looks like

A successful training run shows:

- **Solid green climbing** from random-floor (~33% in self-play) toward 80%+ over the first few thousand episodes.
- **Solid red falling** toward 0%.
- **Solid yellow rising slowly** as the bot stops losing but doesn't yet always win.
- **Dashed lines lag the solid lines** — they're rising too, just slower because they're weighted by past episodes.

After several thousand episodes, all three solid lines flatten out. The bot has **converged** — it's not learning anymore. Move on to the next session (or change opponents).

### What unhealthy patterns look like

- **Both solid lines flat near 33%** — the bot isn't learning. Check that Reset ε to 1.0 is checked for session 1, and Rate isn't too aggressive (e.g., 0.995, not 0.95).

- **Solid lines oscillating wildly between updates** — typically high learning rate (tabular) or too-small replay buffer (DQN). See the troubleshooting doc.

- **Solid green falling after rising** — **catastrophic forgetting** (DQN). The network has overwritten earlier good values with later bad ones. Increase replay buffer size or lower learning rate.

- **Solid yellow climbing toward 100% in self-play** — the bot has fully converged. Tic-tac-toe is a forced draw under optimal play, so a converged self-play produces all draws. This is good news, not a problem.

- **Solid green high but solid yellow low in self-play** — the bot is winning a lot but the other side (also itself) isn't catching up. Usually a symptom of asymmetric training (it's strong as X but weak as O, or vice versa). Try **alternating** mode.

## The Epsilon chart

A simple line showing **ε over time**, falling from your starting value (usually 1.0) toward your `Epsilon min` (usually 0.05).

The shape depends on your decay schedule:

- **Exponential** — fast initial drop, slow tail. Most common.
- **Linear** — straight line. Used for Monte Carlo.
- **Cosine** — smooth S-curve. Used for Policy Gradient.

### What to look for

- **Reaches Epsilon min at ~80% of session episodes** — ideal. Last 20% are pure exploitation, locking in the learned policy.
- **Hits floor too early (50% of episodes in)** — Rate too aggressive. The bot stops exploring before converging. Slow the decay (higher Rate like 0.999).
- **Still high (>0.5) at the end of the session** — Rate too slow. The bot didn't exploit enough. Speed up (lower Rate like 0.995).

For multi-session DQN: the Epsilon chart shows ε across the *current session only*. The cumulative ε state is preserved between sessions (when "Reset ε to 1.0" is unchecked). The DQN session recipe gives expected ε start/end values per session.

## The Loss chart (neural algorithms only)

For DQN and AlphaZero, a third chart shows **training loss** — the gradient-descent error between the network's prediction and the target value.

The Y-axis is a small positive number; X-axis is episode count.

### Healthy loss curve

- **Starts high** (1.0+) — the network hasn't learned anything; predictions are far from targets.
- **Falls quickly in the first 10-20% of episodes** — initial learning phase.
- **Plateaus at a low positive value** — the network has converged to a stable representation.
- **Stays smooth** — no big spikes after the initial period.

### Unhealthy loss patterns

- **Loss not falling** — the network isn't learning. Architecture might be wrong (try `[64, 64]`), or batch/replay-buffer settings are off, or learning rate is mismatched (but α is hardcoded — so it's not this for v1).

- **Loss spiking randomly during training** — typically when a new opponent tier kicks in (vs-Minimax with curriculum) and the bot faces unfamiliar positions. Loss spikes then settles. Normal as long as it settles.

- **Loss flat-out increasing** — divergence. Stop the session. Reduce learning rate (not possible in v1; α hardcoded). Increase target update interval (DQN).

- **Loss oscillating wildly** — replay buffer too small for episode count. Increase to 20,000+.

## Combining the three charts

The three charts work together. Some patterns only show up across all three:

- **Win rate rising AND loss falling AND epsilon decaying** → healthy training, converging well.
- **Win rate flat AND loss flat AND epsilon still high** → the bot is mostly random; it hasn't found a learning signal yet. Wait or reconfigure.
- **Win rate rising AND loss falling AND epsilon already at floor** → the bot is exploiting what it knows, refining quickly. The last 10-20% of a session.
- **Win rate falling AND loss spiking** → catastrophic forgetting in DQN. Stop, increase replay buffer, restart.

## Per-tier breakdown (vs-Minimax mode)

When training in vs-Minimax mode with curriculum enabled, you'll see the chart annotated with **tier change markers** — vertical dotted lines indicating where the bot advanced from Novice → Intermediate → Advanced → Master.

After each tier change, expect:

- A brief **win rate drop** (the new opponent is stronger).
- A brief **loss spike** in DQN (new positions, harder targets).
- **Recovery within a few hundred episodes** as the bot adapts.

If the bot can't recover after a tier change — win rate stays low for 1,000+ episodes — the bot wasn't actually ready for that tier. Curriculum is supposed to wait for 65% win rate before advancing, but in noisy training that threshold can hit accidentally. Either lower the curriculum threshold or pre-train more before vs-Minimax.

## What the analytics tab adds

The **Analytics** tab shows the same data but for **completed sessions** — historical view across all your training runs for this skill. Use it to:

- Compare learning curves across sessions (was session 3 actually faster than session 2?).
- Spot trends (is your hyperparameter sweep producing real improvements?).
- Diagnose plateaus (when did the bot stop improving?).
- Plan the next session ("I need to add 5,000 more episodes before exploring vs-Minimax").

The Analytics tab also offers a **smoothed view** — a moving average over a wider window — to make trends easier to see. Useful for noisy learning curves.

## Update interval

The live charts refresh at a configurable interval (default every 50 episodes). You can change this in the Train tab's advanced settings. Faster updates = smoother chart but more UI overhead. Slower updates = bigger jumps between data points but less browser load. Default is fine for most users.

## When the chart is misleading

Two cases:

1. **Very short sessions (< 200 episodes)** — too few episodes for the rates to stabilize. The chart looks noisy because each batch's win rate has high variance.

2. **vs-Minimax sessions where you switched opponents** — the chart shows the *current* opponent's stats, not a continuous bot performance metric. A tier change can look like "the bot suddenly got worse" when really the bar got higher.

Always interpret charts in context of the configured settings — especially session mode, curriculum status, and Epsilon min.

## TL;DR

- **Thick solid lines** = recent performance, your main signal.
- **Thin dashed lines** = cumulative, slow to move.
- **Green/Yellow/Red** = win/draw/loss.
- **Healthy run**: solid green climbs, solid red falls, solid yellow climbs slowly toward 100% in tic-tac-toe self-play (forced-draw equilibrium).
- **Bad signs**: oscillation (high α or small replay buffer), forgetting (DQN — increase buffer), flat-and-high ε (decay too slow).
- **Use Analytics** for historical comparison and trends.
