---
slug: onboarding-first-30-minutes
title: Your first 30 minutes on AI Arena
category: basics
tags: [onboarding, new-user, walkthrough, first-session, beginner]
status: PUBLISHED
admin_only: false
---

# Your first 30 minutes on AI Arena

A concrete, minute-by-minute walkthrough of what to expect — and what to do — in your first session on AI Arena. This is the "I just landed on the site, now what?" guide.

For the *technical* onboarding (signup mechanics, journey steps, etc.), see "Getting started" and "The Intelligent Guide". This doc is the **experience** version.

## Minute 0-3: Land on the home page

Before you sign up, you'll see the home page with:

- A live **bot-vs-bot demo** in the center — two AI bots playing tic-tac-toe in real time. Watch a few moves.
- A row of CTAs: **Play against a bot**, **Build your own bot**, **Challenge any bot**.
- A "Watch another match" button if you want to see another demo pairing.

**What to do:** spend a minute watching the demo. Notice that the bots play deliberately, not randomly. Notice the "thinking" pause some bots show — that's real computation.

**Why:** AI Arena's pitch is "train bots that learn to play games." The demo shows you the end state: bots that play well. Everything you'll do is in service of building one yourself.

## Minute 3-5: Sign up

Click **Build your own bot** or **Play against a bot** — both prompt sign-up for full access. Two options:

- **Email + password** — standard form. Email verification is optional for most features (required for tournaments only).
- **Continue with Google** — OAuth flow. Skip the password-creation step.

The form asks for:
- **Email**
- **Password** (min 8 chars; the form shows a strength indicator)
- **Display name** (what other players see — changeable later)

After submitting, you're auto-signed-in. There's no "click the verification email first" gate — verification is a soft banner.

**What to expect:** about 60 seconds. The form's anti-bot guard adds a 3-second wait before the Create button activates.

## Minute 5-7: Your first game

You're now signed in. The **Intelligent Guide** orb appears in the top-right header — animated, pulsing blue. The Guide panel may auto-open on your right.

The Guide's first prompt is: **"Play your first game."** Click **Quick Play** on the home page.

You're paired with a built-in bot — typically **Rusty** (Novice tier) for your first game. The board appears; you're X (you move first).

**What to do:**

1. Click the center cell (5). Most strong openings take center.
2. The bot responds with some move (usually a corner; Rusty sometimes plays an edge if it's having a bad day).
3. Play out the game.

**Expected outcome:** you'll probably win, since Rusty plays mostly random valid moves. Even if you lose, the game ended; that's what the Guide cares about for step 1.

The Guide credits **step 1** of your journey. You'll see a small notification or progress indicator.

## Minute 7-12: Watch a bot-vs-bot demo (step 2)

Back on the home page (or via the Guide drawer's next prompt), you'll be invited to **watch a demo**. This is the Hook phase's step 2.

A bot-vs-bot table is created for you. Two AI bots play a tic-tac-toe game. You watch — no input from you.

**What to do:** watch attentively for at least 2 minutes (the watch threshold). If the match ends before 2 minutes, that also counts (step 2 fires on match completion *or* 2-min watch, whichever comes first).

**What you're learning:** how the bots play differently. Even at the same tier, two bots can have subtle stylistic differences. This is your first taste of "the algorithm matters".

When step 2 completes, the **Reward Popup** appears: **+20 TC**. Your TC balance updates from 0 to 20.

You've just earned your first credits. They're recognition for completing Hook.

## Minute 12-15: Create your first bot

The Guide's next prompt: **Create a bot.**

Click into **Profile → My bots → + Create bot**. The wizard appears.

- **Display name**: pick something memorable. The wizard live-checks availability (you can't use Rusty, Copper, Sterling, or Magnus — those are reserved for built-in bots).
- **Persona** (optional): a short description for your own notes.
- **Confirm**.

Your bot now exists but has **no skills yet**. The profile page shows it with an "+ Add skill" affordance.

**Curriculum step 3** fires when the bot is created.

## Minute 15-25: Add a skill and train it

The Guide pushes you to the **Gym** for step 4 (Train your bot).

Two paths:

### Path A: Quick Bot (fastest, ~30 seconds)

1. **Profile → your bot → + Add skill → XO + Quick Bot**.
2. Pick a tier — **Novice** is the default; pick **Intermediate** to make it more interesting.
3. Confirm. Your bot now has a minimax skill at the chosen tier. No training session runs; the tier is just labeled.

Step 4 fires. The bot is ready to play.

### Path B: ML training (more time, much more learning)

1. **Profile → your bot → + Add skill → XO + Q-Learning**.
2. The skill is created with random initial values.
3. **Gym → Train tab → pick your bot → pick the Q-Learning skill**.
4. **Session 1**: Self-play, 2,000 episodes, Exponential rate 0.995, Epsilon min 0.05, Reset ε checked. Start.
5. Wait ~5 minutes. Watch the win/draw/loss chart climb.

Step 4 fires on training-session completion.

**For your first 30 minutes**, Path A is the realistic choice (Path B takes longer than 30 minutes for a respectable bot). You can come back to ML training later.

## Minute 25-30: Spar your bot (step 5)

Now that your bot exists with a skill, the Guide invites you to **Spar** — a practice match against a built-in opponent.

1. **Profile → your bot → Spar**.
2. Pick difficulty: **Easy** (vs Rusty). Confirm.
3. A bot-vs-bot match runs automatically. You watch.
4. When the match ends, step 5 fires.

**Expected outcome:** if your bot is a Quick Bot at Novice tier or above, it'll likely win or draw against Rusty. Don't worry about wins or losses; step 5 fires regardless.

The Spar match adds to your bot's ELO history. You can see it on your bot's profile.

## At minute 30: where you are

You've completed the **Hook phase** (steps 1-2) and most of **Curriculum** (steps 3, 4, 5 done; 6 and 7 left). You have:

- An account with display name and 20 TC.
- One bot with one skill (Quick Bot or partially-trained Q-Learning).
- Three completed journey steps.
- A sense of what the platform offers.

The Guide's next prompts:

- **Step 6**: Register your bot for a tournament. Tournaments are scheduled events; you'll click into the Tournaments page and pick one to enter. This may not happen immediately — you'll need to find a tournament with an open registration window. Recurring "Daily XO" templates often have one happening within a few hours.
- **Step 7**: Complete that tournament. After registration, the tournament runs at its scheduled time and your bot plays autonomously.

## What to do in the next 30 minutes

If you have more time:

- **Train a real Q-Learning skill** — spend another 15 minutes running the full Q-Learning recipe (sessions 1-3, ~30 minutes total). You'll see your bot get demonstrably stronger.
- **Play against your own bot** — challenge it from the Bot Directory. Two perspectives on the same bot is the fastest way to feel how training matters.
- **Browse the help corpus** — open the Guide drawer's "Ask Guide anything…" chat (when Sprint 2 ships) or browse `/help` (when Sprint 3 ships). The corpus is deep — start with "Reinforcement learning intro" if you want the concept layer.
- **Subscribe to a recurring tournament** — Tournaments → Recurring → pick "Daily XO" and subscribe. Your bot will auto-enroll in every future occurrence.

## What if I get stuck

Common stumbles in the first 30 minutes:

**"The Guide drawer isn't showing me what to do next."** Click the Guide orb in the top-right header to reopen the drawer if it's closed.

**"Quick Play doesn't work."** Make sure you're signed in (avatar visible top-right). Quick Play requires authentication.

**"My bot isn't appearing in the Bot Directory."** New bots appear immediately; refresh if needed. If your bot has no skills, it won't show up — make sure you completed "Add skill".

**"I don't see the Reward Popup."** It might have auto-dismissed. Check your TC balance on the profile page — if it's +20, the reward fired.

**"Spar isn't an option for my bot."** Spar requires your bot to have a skill. If you skipped Add Skill, do that first.

If you're really stuck, use the floating **💬 feedback button** at the bottom-right of every page. It captures your context (page URL, optional screenshot) and reports the issue.

## What this 30 minutes accomplished

You started as a guest. You ended with:

- An account in the platform.
- A bot with a skill, recorded in the database.
- Three completed journey steps (1, 3, 4, 5; step 2 separately).
- Your first reward (+20 TC).
- A working mental model of what the platform offers.

Every minute spent was productive. The pedagogical bet of AI Arena is that **doing** is faster than reading — and after 30 minutes you've experienced enough of the platform to know whether you want to invest more. If you do, the next 30 minutes (Curriculum step 6-7 + recurring subscription) lock in the habit. If you don't, the +20 TC and your bot stay in your account; you can come back any time.

## Tips for the next session

When you come back:

- **Open the Guide drawer first thing.** It'll show you what's next based on where you left off.
- **Check your TC balance.** It should match what you left.
- **Glance at your bot's recent games.** If you subscribed to a recurring tournament, you may have results already.
- **Read one help doc per session.** Pick a topic you're curious about. The Glossary is a good start; the algorithm docs are good once you've trained a bot.

After three to five sessions like this, you'll have a trained bot that's competing in tournaments, an intuition for how RL works, and a working understanding of the platform's full surface. That's the destination of the Intelligent Guide journey.
