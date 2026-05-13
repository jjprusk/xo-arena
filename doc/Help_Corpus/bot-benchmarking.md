---
slug: bot-benchmarking
title: Benchmarking your bot — scores, ELO, head-to-head
category: training
tags: [benchmark, evaluation, elo, head-to-head, p-value]
status: PUBLISHED
admin_only: false
---

# Benchmarking your bot

After training, **always run a benchmark** before deploying your bot to the Bot Directory or entering it in a tournament. The benchmark gives you an objective score against fixed opponents — a much better signal than training-time win rate (which is measured with exploration active).

## Running a benchmark

Open the Gym → **Evaluation** tab, pick your bot, and click **Run benchmark**. The platform plays a fixed number of games against each of five opponent tiers and reports the results.

The benchmark uses **ε = 0** (pure greedy play) on your bot, so the score reflects how it will actually play in real games — not how it played during training when it was exploring.

## What the benchmark measures

| Scenario | Opponent | Win Rate Goal (good bot) |
|---|---|---|
| **vs Random** | Pure random moves | > 85% |
| **vs Easy** | Novice minimax (Rusty) | > 70% |
| **vs Medium** | Intermediate minimax (Copper) | > 55% |
| **vs Tough** | Advanced minimax (Sterling) | > 35% |
| **vs Hard** | Perfect minimax (Magnus) | > 15% (draws are good here) |

A perfect tic-tac-toe player **can never lose** — only win or draw. "vs Hard" scores above 15% indicate the bot is finding genuine wins against a perfect opponent by exploiting first-move advantage. Most well-trained bots score 0–10% wins against Hard with high draw rates (50–80%); that's normal.

## Benchmark-to-ELO correlation

The Evaluation tab averages your win rates and maps the result to an approximate ELO:

| Avg Benchmark Win Rate | Approximate ELO |
|---|---|
| < 30% | < 900 |
| 30–45% | 900–1,050 |
| 45–60% | 1,050–1,200 |
| 60–72% | 1,200–1,400 |
| 72–82% | 1,400–1,600 |
| > 82% | 1,600+ |

This is a useful sanity check before your bot enters the live ladder — if your benchmark suggests ELO 1,400 but the bot is provisionally rated at 1,200, the benchmark is the better predictor of where it will settle.

## Head-to-head (H2H) comparison

Use H2H when you want to compare **two candidate models** trained with different configs (e.g., DQN with `[64, 64]` vs `[128, 64]`, or Q-Learning at 5k vs 8k episodes).

Pick two bots, click **Run head-to-head**, and the platform plays them against each other. Run at least **200 games** for statistical significance.

The ELO update from H2H reflects the **true relative strength** between the two bots better than benchmark scores against fixed opponents — because the benchmark doesn't expose play styles that beat *each other*.

## p-value interpretation

Every benchmark result includes a **p-value** testing whether the win rate is statistically greater than 50% (i.e., better than chance).

- **p < 0.05** — the result is statistically significant; the bot is genuinely performing above chance.
- **p > 0.10** — sample size too small or the bot is genuinely near 50%. Run more games (the Evaluation tab lets you increase the per-scenario count) or train more.

If the bot benchmarks at 55% vs Easy with p = 0.20, **you don't actually know** if it's better than coin-flip. Don't deploy it to the Bot Directory based on a marginal p-value — keep training.

## Why benchmark beats training-time scores

Training-time win rate is measured **while the bot is exploring** (ε > 0). At ε = 0.3, every third move is random — even a well-trained bot will lose games it would have won at inference time.

Conversely, training-time win rate can also be inflated when the *opponent* in self-play is also using ε > 0 — both bots are making random moves and the win rate trends to chance.

**The benchmark uses ε = 0 on both sides** (your bot greedy; the opponent deterministic). That's the honest test.

## When to benchmark

- **After every training session** — confirm the new version is better than the previous.
- **Before promoting a version** from version history to active — your version-history view shows benchmark scores so you can pick the strongest.
- **Before entering a tournament** — make sure the bot is at least benchmark-ELO ≥ 1,200 if you want a meaningful chance in the Rookie Cup or beyond.
- **After parameter sweeps** — the Auto-Tuner can sweep α / γ / ε settings for tabular Brains; benchmark each candidate.

## Reading the analytics chart

The Analytics tab visualizes benchmark trends over training sessions:

- **Win rate per opponent tier** plotted over training time — useful to see if a particular tier (e.g., Hard) is the choke point.
- **ELO trajectory** estimated from benchmark scores — gives you a sense of whether the bot is plateauing.

A bot that's been training for 20,000 episodes with no benchmark improvement is plateaued. Either change architecture (DQN), switch Brain (Q-Learning → AlphaZero), or accept the ceiling.

## Common benchmark surprises

**"My bot wins 95% during training but benchmarks at 60%."** Training was at high epsilon; the bot's greedy policy is weaker than the exploratory one suggested. Lower **Epsilon min** to 0.01 and train 5,000 more episodes — this hardens the greedy policy.

**"My bot scores well vs Easy/Medium but poorly vs Tough/Hard."** The bot hasn't trained against strong minimax. Run a vs-Minimax session with curriculum advancement.

**"Two trained versions benchmark similarly but win H2H differently."** Benchmark scores don't capture style-vs-style matchups. Trust H2H more than the average when comparing candidate versions.

**"My bot wins less than 50% vs Random."** Something is seriously wrong — either training didn't converge, the move-validity check is off, or you're benchmarking the wrong version. Check the Sessions tab for completion status, and load an earlier checkpoint if needed.
