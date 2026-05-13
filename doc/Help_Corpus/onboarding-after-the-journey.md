---
slug: onboarding-after-the-journey
title: After the Guide journey — what's next
category: basics
tags: [onboarding, specialize, post-curriculum, advanced, growth]
status: PUBLISHED
admin_only: false
---

# After the Guide journey — what's next

You finished the Intelligent Guide. Step 7 fired, +50 TC dropped, and the Guide drawer changed. The Curriculum is over; you're in **Specialize phase**. Now what?

The honest answer: AI Arena's pre-built journey is done. The platform stops pushing you. From here, growth is driven by your own goals — and the platform has more depth than the Guide showed you. This doc maps the territory and suggests where to focus.

## What "Specialize" actually means

In journey terms: step 7 done. The platform considers you onboarded. The Guide drawer transforms — it's no longer a step-by-step checklist; it's a tabbed surface with **What's Next** (recommendation cards) and **Shortcuts** (a grid of common actions).

In practical terms: the platform's full feature surface opens up:

- **Recurring tournaments** — you can subscribe.
- **Multi-skill bots** — adding Pong/Connect 4 skills (as they ship).
- **Advanced training algorithms** — DQN, AlphaZero are now within your reach (Curriculum step 4 only required a Quick Bot).
- **The Auto-Tuner** — hyperparameter sweeps.
- **Public rankings** — your activity tier and tournament classification are now meaningful.
- **The Bot Directory at large** — challenge any bot, study any player.

The Guide doesn't push you toward any of this. It surfaces options; you pick.

## Three archetypes

Most Specialize-phase users naturally fall into one of three patterns. The Guide's "What's Next" panel actually classifies you into these buckets to tailor recommendations:

### Competitor — ladder and tournament focused

**You enjoy:** winning tournaments, climbing the rankings, head-to-head bot battles.

**Recommended next steps:**

1. Subscribe to a recurring tournament (Daily XO is the entry point).
2. Train a stronger bot — graduate from Quick Bot to Q-Learning, then DQN.
3. Run head-to-head matchups against high-ranked bots in the Bot Directory.
4. Track your tournament classification on the Rankings page.

**Discovery reward to chase:** "First real tournament win" — +25 TC.

### Trainer — bot-quality focused

**You enjoy:** the training process, watching bots improve, optimizing hyperparameters.

**Recommended next steps:**

1. Train an AlphaZero bot. It takes longer but produces the strongest results.
2. Sweep hyperparameters with the Auto-Tuner. See the gym-auto-tuner doc.
3. Compare multiple algorithms on the same bot or across bots — head-to-head in the Evaluation tab.
4. Use the Explainability tab to dissect what your bots learned.

**Discovery reward to chase:** "First non-default algorithm" — +10 TC (training anything that isn't the platform default).

### Explorer — concept and platform breadth focused

**You enjoy:** trying everything, understanding the platform's design, building intuition.

**Recommended next steps:**

1. Train one bot with each algorithm — see how the styles differ (per the bot-personalities doc).
2. Browse the help corpus — algorithm docs, AI concepts, RL intro.
3. Try Pong (when it's fully out of experimental status).
4. Run the platform's pedagogical paths: watch demo Tables, read RL theory, do hyperparameter sweeps.

**Discovery reward to chase:** "First template clone" — +10 TC (when admin features open up for community templates).

You're not locked into one archetype. Many users do all three over time. The Guide's recommendations bias toward what you've been doing recently — if you mostly enter tournaments, you'll see Competitor cards; if you mostly train, you'll see Trainer cards.

## Specific next moves by goal

### "I want a stronger bot"

The fastest path:

1. **Switch algorithms.** If you trained Q-Learning, try AlphaZero. The ceiling is much higher.
2. **Run more episodes.** Q-Learning's recipe is 7k episodes; DQN's is 35k; AlphaZero's is 15k. Whichever you pick, follow the full session recipe.
3. **Sweep hyperparameters.** The Auto-Tuner finds settings that beat defaults.
4. **Benchmark and iterate.** After each change, run a benchmark. If it improved, keep going. If not, revert.

See "Gym workflows" → Workflow 6 (Prep for tournament) for a focused recipe.

### "I want to win tournaments"

1. **Make your bot competitive.** Above first. Benchmark ELO ≥ 1,400 if you want to win regularly; ≥ 1,200 if you want to compete.
2. **Pick the right tournaments.** Smaller fields (4-entrant) are easier to win than larger ones (16+). Avoid tournaments with high-tier classification requirements until you're ready.
3. **Subscribe to recurring templates.** Consistent participation builds your tournament classification.
4. **Spectate other matches.** Learn what styles dominate. Pattern-match the algorithms (see bot-personalities-and-styles).
5. **Prepare specifically.** Hours before a tournament, do a final vs-Master session at Epsilon min = 0.01. See Workflow 6.

### "I want to understand AI"

1. **Read "Reinforcement learning intro"** if you haven't.
2. **Read "How bots learn"** for the conceptual deep dive.
3. **Train one bot per algorithm.** Run the full recipe for each. Spend time in the Explainability tab seeing how each bot's Q-values differ.
4. **Read the algorithm docs** for the ones that interest you.
5. **Pick up Sutton & Barto** — the canonical RL textbook (free online). The first 6 chapters cover everything you've been using on AI Arena.

### "I want to build something"

1. **Train a multi-skill bot.** Add as many skills (across games) as you can.
2. **Master the version-history workflow.** Use Sessions tab to compare versions, roll back, promote.
3. **Run sweeps systematically.** Document what hyperparameter combinations win on which algorithms.
4. **Share your findings** — feedback button on any page; or write something for the community when public discussion surfaces.

This is the platform's R&D path. Less common than the other three but rewarding.

## What the platform DOESN'T push you to do

Some things the Guide doesn't recommend, but you can:

- **Train against specific opponents repeatedly.** Spar with Magnus to harden your bot against perfect play.
- **Build "personality bots"** — train multiple bots with different algorithms and pit them against each other in H2H to see which style wins on your specific opponent population.
- **Study the Bot Directory deeply** — find a player whose bots interest you and study their training history (via their public profile).
- **Experiment with the Auto-Tuner** at multiple parameter levels — find a learning rate or gamma value that genuinely improves your bot.
- **Set up a "research log"** — keep notes (outside the platform) on what you tried, what worked, what didn't. Bot training rewards systematic experimentation.

The Guide's recommendations are useful for keeping momentum, not for being exhaustive. After Specialize phase, your time on the platform is yours to organize.

## Daily / weekly rhythms

If you want consistent growth, structure your time:

### Daily (10-15 minutes)

- Check notifications for tournament results.
- If a recurring tournament you subscribed to is starting today, you don't need to do anything — your bot auto-plays. But you can spectate.
- Glance at the public rankings. Has your tier moved?
- Pick one help doc to read. Cycle through topics over weeks.

### Weekly (1-2 hours)

- Run one Auto-Tuner sweep on your strongest bot.
- Run a benchmark to track progress.
- Consider adding a new skill (different algorithm) for comparison.
- Review your tournament results — find one loss, watch the replay, identify what went wrong.

### Monthly (3-4 hours)

- Do a full training run on a new algorithm.
- Compare via H2H against your previous best.
- If significantly better, promote.
- Decide on a focus area for the next month (e.g., "master Policy Gradient" or "win a Rookie Cup").

This rhythm is enough to keep growing without burning out. Many top users on AI Arena follow something like it.

## When you've truly outgrown the platform

There's a point — usually after several months of serious training — where your bot is consistently winning at its tier and there's no clear next step within the platform's surface area. Three options:

1. **Push for higher tournaments.** As your classification rises, harder tournaments become available with deeper fields.
2. **Branch into other games.** Pong (when out of experimental), Connect 4 (planned), and future games offer fresh challenges.
3. **Apply the skills elsewhere.** Take what you've learned and try a real RL project — OpenAI Gym, Mujoco, robotics simulators. AI Arena was the on-ramp; the open world of RL is the destination.

Many AI Arena alumni have moved to real ML jobs, research, or independent projects. The pattern matches: a beginner who reaches Specialize and stays for a few months has built skills that translate directly to professional ML work.

## Reward popups in Specialize

The Specialize phase is **discovery-reward-driven** rather than step-driven. Each first-time action you take pays +TC:

- First Specialize action: +10 TC.
- First real tournament win (non-Cup): +25 TC.
- First non-default algorithm: +10 TC.
- First template clone (when admin features open): +10 TC.

These are **idempotent** — each fires only the first time. They're how the platform recognizes meaningful platform-graduation milestones.

## The Guide's role going forward

The Guide drawer now shows:

- **What's Next** tab — 3-5 recommendation cards based on your archetype and recent activity. Cards can be dismissed (7-day grace before a replacement appears).
- **Shortcuts** tab — a SlotGrid of common actions (start training, find a tournament, etc.). Hidden during the journey; now unlocked.

The Guide doesn't push as hard as it did during Hook/Curriculum. It's more like a sidebar of suggestions you can use or ignore.

If you ignore the Guide for 14 days (no Specialize-phase actions), the orb pulses with an inactivity nudge. One-time, per the platform's "don't be annoying" design.

## What if I want to redo the journey?

You can restart from **Settings → Guide → Restart journey**. This clears completed-step state. You can replay Hook and Curriculum.

**Note**: journey rewards only pay the first time. Restarting doesn't re-trigger the +20 TC or +50 TC.

Restart is useful for testing the journey for a friend, or just for nostalgia. Most users don't.

## Bottom line

Curriculum gave you the structure of "do these things in order." Specialize gives you the space of "pick your goals." The platform's depth is comfortably in front of you; the Guide's hand-holding is appropriately behind you.

Whether you spend the next year winning tournaments, refining your understanding of RL, or building a bot collection, the platform supports all three. The first 30 minutes were the foundation. The next 30 hours are where the actual learning happens.

Welcome to Specialize.
