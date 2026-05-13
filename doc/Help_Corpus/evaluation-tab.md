---
slug: evaluation-tab
title: The Evaluation tab — benchmarking, head-to-head, deeper analysis
category: training
tags: [evaluation, benchmark, head-to-head, analysis, comparison]
status: PUBLISHED
admin_only: false
---

# The Evaluation tab — benchmarking, head-to-head, deeper analysis

The **Evaluation** tab is where you measure your trained skill objectively. It's the difference between *thinking* your bot is good and *knowing*. This doc walks through every Evaluation surface in depth.

For the conceptual "what's a benchmark and what should the numbers be", see "Benchmarking your bot". This doc is the click-by-click practical version.

## Three Evaluation modes

The tab has three sub-tools:

1. **Benchmark** — your bot vs the five fixed minimax tiers.
2. **Head-to-head (H2H)** — your bot vs another specific bot.
3. **Deep analysis** — extended benchmarks with statistical confidence intervals.

You can run any of them at any time on any trained skill.

## Benchmark — the standard evaluation

### Setup

1. In the Evaluation tab sidebar, pick a bot and its skill.
2. Pick **Benchmark** at the top.
3. Configure:
   - **Games per opponent**: 100 by default. Increase for higher confidence; decrease for faster results.
   - **Opponents to run**: by default all five tiers (Random, Easy, Medium, Tough, Hard). Untick any you don't care about.
4. Click **Run benchmark**.

### What happens

The Evaluation tab runs `N × T` games (N games per tier, T tiers) — typically 500 games total. Each game is your bot at ε=0 vs a fresh minimax instance at the relevant tier.

Progress shows live: a per-tier counter ticking up as games finish.

### Results panel

After the benchmark completes (usually 30 seconds to 2 minutes depending on game count):

| Opponent | Wins | Draws | Losses | Win Rate | p-value |
|---|---|---|---|---|---|
| Random | 87 | 3 | 10 | 87% | <0.001 |
| Easy | 71 | 14 | 15 | 71% | <0.001 |
| Medium | 51 | 30 | 19 | 51% | 0.41 |
| Tough | 32 | 41 | 27 | 32% | <0.001 |
| Hard | 6 | 76 | 18 | 6% | <0.001 |

**Below the table**: average win rate across all opponents, plus the estimated ELO based on that average. See the benchmarking doc for the win-rate → ELO mapping.

### Reading p-values

Each tier has a **p-value** testing whether the win rate is statistically greater than 50% (i.e., better than coin-flip).

- **p < 0.05** — the result is statistically significant. The bot is genuinely performing above chance at that tier.
- **p > 0.10** — sample size too small or the bot is genuinely near 50%. Don't draw conclusions; run more games.

If "Medium" shows 51% with p = 0.41 (like in the example above), the bot is *probably* at the 50% mark but you can't be sure with this sample. Run 500 games per tier for a more definitive answer.

### What to do with results

The expected ranges for a well-trained Q-Learning bot:

| Opponent | Expected win rate |
|---|---|
| Random | 85-92% |
| Easy | 70-80% |
| Medium | 50-65% |
| Tough | 30-50% |
| Hard | 0-15% (high draw rate) |

If you're in range, deploy. If you're below, **train more or switch algorithms** — see the troubleshooting doc.

If you're **above** the upper end of the range, you've probably trained longer than the recipe suggests, or you have a tighter epsilon-min, or you tuned hyperparameters via the Auto-Tuner. Great work.

## Head-to-head — bot vs bot

H2H is for **comparing two specific candidates**. Use it when:

- You trained two versions of the same skill with different settings and want to know which is stronger.
- You want to compare two different algorithms (e.g., your Q-Learning bot vs an AlphaZero bot).
- You want to see how your bot does against someone else's public bot.

### Setup

1. In the Evaluation tab sidebar, pick **Head-to-head** at the top.
2. Pick **bot A** (yours).
3. Pick **bot B** (yours or any public bot).
4. Configure:
   - **Games**: at least 200 for statistical significance.
   - **Alternate sides**: default ✓. Each pair of games swaps X/O so neither bot has the first-move advantage.
5. Click **Run H2H**.

### Results

After the H2H completes:

| Bot | Wins | Draws | Losses | Win Rate | ELO change |
|---|---|---|---|---|---|
| Bot A (you) | 87 | 60 | 53 | 43.5% | -8 |
| Bot B | 53 | 60 | 87 | 26.5% | +8 |

(Wins for one are losses for the other; draws are shared.)

The **ELO change** column shows how the H2H result will affect each bot's ladder ELO if you confirm it. By default, H2H results **do not auto-apply to ELO** — you click **Confirm and apply** to make the change permanent.

**Why H2H beats benchmarks for direct comparison**: benchmarks measure each bot against fixed opponents. Two bots can both score 75% average vs minimax — but if one bot's play style exploits the other's weakness, the H2H result might be 65/35 not 50/50. Style matchups don't show up in benchmark scores.

### When to skip the ELO apply

If you're just exploring — "how would my Q-Learning bot do against AlphaZero?" — don't apply the ELO. Just look at the result.

Apply when:

- The H2H confirms one bot is clearly stronger (e.g., 65/35 over 200 games).
- You're trying to validate a new version of your skill vs an old one.
- You're benchmarking against someone else's bot for ranking purposes.

## Deep analysis

This sub-tool is for **statistical rigor**. It runs a large benchmark (1,000+ games per opponent) and produces confidence intervals.

You'll use this when:

- You're submitting your bot to a competitive context and want hard numbers.
- You're publishing or sharing results (e.g., for an academic context).
- You suspect a benchmark fluke and want a high-confidence rerun.

The output is similar to the standard benchmark but with **95% confidence intervals** on each win rate:

> vs Random: 88% ± 2.3%
> vs Easy: 74% ± 3.1%
> vs Medium: 53% ± 3.5%

Wider intervals mean less confidence. If the interval doesn't cleanly exclude 50%, you can't claim the bot is "better than chance" against that tier with high confidence.

## Comparing versions of the same skill

The Sessions tab shows your skill's version history with the latest stats. When you've completed multiple training runs (v1, v2, v3, …) you can benchmark any version:

1. Sessions tab → click the version row → **Use this version** to swap it in as the active skill.
2. Evaluation tab → Benchmark.
3. Repeat for the version you want to compare.

The benchmarks let you choose which version is strongest. The **Use this version** affordance is reversible — you can swap back.

For an even more direct version comparison, use **H2H** between two of your own versions. Run H2H between v2 and v3 to see which is stronger directly.

## When to evaluate

A rough rhythm:

- **After every training session** — quick 100-game benchmark to track progress.
- **When deciding which version to deploy** — H2H between candidates.
- **Before entering a tournament** — full benchmark + at least one H2H against a strong public bot to gauge competitive readiness.
- **After parameter changes** — sweep with the Auto-Tuner, then benchmark the winner.
- **When troubleshooting** — benchmark reveals where the bot is weak (which tier underperforms).

## What evaluation doesn't tell you

Evaluation produces **point-in-time** scores. It doesn't tell you:

- **How robust your bot is to unseen opponents.** A bot can ace benchmarks against minimax tiers but lose to a quirky Policy Gradient bot it has never seen.
- **How your bot will do against a human.** Humans don't play minimax. They have intuition, biases, and openings you might never have trained against.
- **Whether your bot will hold up after the meta shifts.** As the platform's bot population evolves, "common" strategies change. A bot trained six months ago against an old population might be weaker against today's pool.

For these, you need **real games on the live ladder**. Benchmarks are the floor — playing real games against real opponents is the actual measure.

## A sanity check checklist

Before deploying any trained skill, verify:

- [ ] Benchmark vs Random ≥ 85%. (Floor — should be easy.)
- [ ] Benchmark vs Easy ≥ 65%. (Basic competence.)
- [ ] Benchmark vs Hard: draw rate ≥ 60%. (Indicates the bot isn't losing winnable positions.)
- [ ] p-values all < 0.05 (run more games if any are higher).
- [ ] H2H against a previous version of the same skill: new version wins or ties.

If all five pass, your bot is ready for the ladder. If any fail, train more or troubleshoot.
