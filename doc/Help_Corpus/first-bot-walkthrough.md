---
slug: first-bot-walkthrough
title: Your first bot — step-by-step walkthrough
category: basics
tags: [walkthrough, beginner, tutorial, first-bot, onboarding]
status: PUBLISHED
admin_only: false
---

# Your first bot — step-by-step walkthrough

If you've signed up, played a few games, and now want to **train your own bot**, this is the concrete recipe. From zero to a trained Q-Learning bot beating Easy minimax in about 45 minutes.

This walkthrough assumes you've completed the Intelligent Guide through at least step 3 (the bot creation step). If you haven't, the Guide's prompts will get you there.

## Phase 1 — create the bot (2 minutes)

1. Open **Profile** from the top nav.
2. Scroll to **My bots** and click **+ Create bot**.
3. The wizard appears. Pick a **display name** for your bot — anything memorable. The wizard will live-check the name; you'll see a green check if it's available.
4. (Optional) Pick a **persona** — a brief description of how you want to think about this bot. Doesn't affect training, just helps you remember which is which when you have multiple bots.
5. **Confirm**. Your bot now exists. It has no skills yet — that's the next step.

## Phase 2 — add a Q-Learning skill (1 minute)

1. From the bot's profile, click **+ Add skill**.
2. Pick the game: **XO** (tic-tac-toe).
3. Pick the algorithm: **Q-Learning**. (It's the recommended starter — fast, debuggable, reaches a competitive policy in ~7,000 episodes.)
4. **Confirm**. The skill is created with random initial values. It's not yet trained — it'll play like a random opponent until you train it.

## Phase 3 — your first training session (10 minutes)

1. Open the **Gym** from the top nav.
2. The **Train** tab opens by default. In the sidebar, pick your bot, then its XO Q-Learning skill.
3. Configure the session:
   - **Mode**: Self-play
   - **Episodes**: 2,000
   - **Decay schedule**: Exponential
   - **Rate**: 0.995
   - **Epsilon min**: 0.05
   - **Reset ε to 1.0 at start**: ✓ check this (your first session)
4. Click **Start training**.

The live panel shows the win/draw/loss rate as episodes run. Watch for the **thick solid lines** — those are the recent batch's stats and tell you whether the bot is actively learning right now. If both lines climb away from 33% (random chance against itself), training is working.

Session 1 takes about 5-7 minutes on a normal browser. You can navigate away if you want; the session will keep running in the background and notify you when it's done.

## Phase 4 — second session (10 minutes)

Once session 1 completes:

1. The **Sessions** tab now shows version 1 of your skill, status COMPLETED.
2. Back in the **Train** tab, the bot is still selected. Change one thing:
   - **Episodes**: 3,000
   - **Reset ε to 1.0 at start**: ☐ **uncheck this**. Session 2 should continue from where session 1 left epsilon (around 0.05 after 2,000 episodes at rate 0.995).
3. Click **Start training**.

This session converges the Q-table. Watch the recent solid lines flatten out — that's the bot converging on a stable policy.

## Phase 5 — third session, polish vs minimax (8 minutes)

Once session 2 completes:

1. In the Train tab:
   - **Mode**: vs Minimax
   - **Curriculum**: ✓ enabled (auto-advances opponent difficulty when you hit 65% win rate)
   - **Starting tier**: Novice
   - **Episodes**: 2,000
   - **Reset ε to 1.0 at start**: ☐ unchecked
2. Click **Start training**.

Curriculum mode automatically promotes the opponent (Novice → Intermediate → Advanced → Master) once your bot hits 65% win rate against the current tier. This is the most efficient way to polish a bot against deterministic opponents.

You'll see the opponent tier change in the live panel. Don't worry if win rate drops temporarily when a new tier kicks in — that's the bot adapting.

## Phase 6 — benchmark (3 minutes)

After session 3 finishes:

1. Open the **Evaluation** tab.
2. Pick your bot's XO skill.
3. Click **Run benchmark**.

The benchmark plays a fixed number of games (100 by default) against each of the five opponent tiers: Random, Easy, Medium, Tough, Hard. After a couple of minutes, you'll see win/draw/loss percentages per tier, plus a p-value and an estimated ELO.

**Expected results** for a well-trained Q-Learning bot at ~7,000 episodes:

| Opponent | Expected win rate |
|---|---|
| Random | 85-92% |
| Easy (Rusty) | 70-80% |
| Medium (Copper) | 50-65% |
| Tough (Sterling) | 30-50% |
| Hard (Magnus) | 0-15% (most games will be draws) |

If your numbers are in this range — congratulations, you have a working trained bot. If they're lower, see "Bot training — troubleshooting".

## Phase 7 — play against it (5 minutes)

The fun part. Your bot is now competitive enough that you'll have to think to beat it.

1. Open **Bots** from the top nav. Your bot is in the **mine** filter.
2. Click your bot, then **Challenge**. A Table appears with you on one seat and your bot on the other.
3. Play a few games. Try beating it as X (you go first). Try as O (you go second).

If you can beat your bot 90% of the time, it didn't train well — see troubleshooting. If you can beat it 30-50% of the time, it's working as intended. If you can barely beat it, train longer.

You can also bring it to a Spar match (from your profile) to see how it does against Rusty / Copper / Sterling specifically.

## Phase 8 — enter a tournament (optional, longer)

If your bot is in good shape:

1. Open **Tournaments**. Find an open tournament accepting bot entries.
2. From the tournament's detail page, **Register** with your bot.
3. Wait for the tournament to start (or, if it's recurring, the next occurrence).
4. When your match is ready, you'll get a notification. Click it to spectate.

Tournament matches are **best-of-N** (default 3). The bot plays autonomously; you just watch.

If your Intelligent Guide journey is at step 6, registering here triggers **Curriculum step 6** complete. Playing through the resulting **Curriculum Cup** triggers step 7 and the +50 TC reward.

## What you just did, in RL terms

- Created an **agent** (the bot) with a **policy** stored in a Q-table (tabular Q-Learning).
- Bootstrapped the policy via self-play (sessions 1-2) — both X and O perspectives explored simultaneously.
- Refined the policy against deterministic opponents (session 3) — curriculum advancement.
- Verified the policy via benchmark — objective scores at ε=0 (no exploration during evaluation).
- Deployed it for real play.

This recipe is the **canonical RL flow**: bootstrap with self-play, refine with a fixed opponent, evaluate, deploy.

## What to try next

You now have a baseline. Some natural follow-ups:

- **Train a second bot** with a different algorithm and compare them head-to-head in the Evaluation tab. **AlphaZero** at 15,000 episodes will beat your Q-Learning bot most of the time.
- **Increase the Epsilon min** to 0.01 and run 3,000 more Q-Learning episodes — this hardens the greedy policy at the cost of some exploration.
- **Sweep hyperparameters** with the Auto-Tuner — try different learning rates (α) and discount factors (γ) to find your bot's optimum.
- **Add a second skill** (Pong, when it fully ships) to your bot so it can compete in multiple games.

## Common stumbling blocks

**"My bot won't train — Start training button does nothing."** Make sure you picked a bot and a skill in the sidebar. Without a selection, the button is disabled.

**"Win rate is at 33% and not moving."** Self-play against a random policy floor is 33% (win/draw/loss roughly equal). Wait 1,000 episodes; if it's still flat, check that Reset ε to 1.0 was checked and the Rate is 0.995.

**"Session 2 reset everything."** You forgot to uncheck "Reset ε to 1.0 at start" — session 2 started fully random again. Not the end of the world; just run a bit longer.

**"Benchmark says 90% vs Random but my bot lost to me anyway."** Random doesn't play strategically; you do. The fact that the bot beats Random is the floor, not the ceiling. To beat *you*, the bot needs to handle the strategic patterns you specifically use — which means more training, or a stronger algorithm.

## You're done with the basics

After this walkthrough you've touched the core of AI Arena: Profile, Gym, Evaluation, Bot Directory, Tournaments. Every other surface builds on these. Welcome.
