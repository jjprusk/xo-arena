---
slug: training-multi-curve-eval
title: The multi-curve view — Primary, Easy, Medium
category: training
tags: [eval, multi-curve, primary, easy, medium, charts, gym]
status: PUBLISHED
admin_only: false
---

# The multi-curve view — Primary, Easy, Medium

The main training chart shows how the bot does against the same opponent it's training against. That's the *primary* signal — the one that drives the rating update — but it's not the only thing worth watching. The **multi-curve view** adds two side curves so you can see how the bot is doing across a range of opponent strengths, not just at the level it's currently fighting.

## What you see

While training is running, the Gym renders three stacked W/D/L areas:

- **Primary** — the algorithm-appropriate "real" opponent (typically Hard minimax).
- **Easy** — minimax tuned down to "easy."
- **Medium** — minimax tuned to "medium."

Each curve is its own little chart of wins-draws-losses over training episodes. The chart you'd watch most carefully on the way up is **Primary** — if it's not climbing, training isn't working. Easy and Medium are sanity checks: a bot that's getting good at Hard should be utterly dominant against Easy and Medium.

## Why three curves

A single curve answers "how well does my bot do at the level it's trained against?" Multi-curve answers a richer question: **how does my bot generalise?**

Three things multi-curve will tell you that a single curve will not:

1. **Is the bot actually getting smarter, or just memorising one opponent?**
   If Primary climbs but Easy/Medium stay flat, you've probably overfit to the primary opponent. That can happen with VS-MINIMAX training when the minimax is too deterministic — the bot learns "in this state, this opponent plays this move, so I play this counter," which transfers poorly.

2. **When can I stop?**
   Once **all three** curves saturate (Easy at near-100%, Medium close behind, Primary at whatever ceiling the algorithm can reach), there's no useful learning left in this run. Time to stop.

3. **Is the side curves' "saturation" hiding a real problem?**
   Saturated curves auto-fade — a curve at 100% wins doesn't move and there's nothing left to learn from it. If a curve *re-activates* mid-training (a faded Easy curve suddenly loses), that's a red flag: the bot is unlearning basic play. Usually means the learning rate is too high or epsilon hasn't decayed enough.

## How many games per eval point

Each point on the multi-curve chart represents **about 20 games** played against opponents: 12 against Primary, 4 against Easy, 4 against Medium. This is a small sample on purpose — every eval game is wall-clock time stolen from training, so we keep the budget tight (~5% overhead).

Twenty games is enough to distinguish "winning 80%" from "winning 30%" at a glance, but not enough to tell "winning 78%" from "winning 82%." Don't read individual points too precisely; read the **trend over many points**.

## Reading the chart practically

A healthy training run on a tabular algorithm looks like:

- **Easy** climbs to ~100% wins within the first 10–20% of training and stays there.
- **Medium** climbs to ~80%+ wins by mid-training.
- **Primary** rises gradually; final value depends on the algorithm's ceiling.

A run that's **not** working tends to look like:

- All three curves stuck around random play (~33% wins, ~33% draws).
- Primary climbs but Easy/Medium don't — bot is memorising, not learning.
- Curves were climbing then collapsed — instability; the learning rate is probably too high, or the network architecture is too small to hold what it's learning.

## See also

- **`understanding-training-charts`** — the main W/D/L chart and what its lines mean.
- **`bot-training-troubleshooting`** — what to do when curves don't behave.
- **`how-bots-learn`** — what the bot is actually doing between eval points.
- **`bot-benchmarking`** — running a one-off head-to-head check outside the Gym.
