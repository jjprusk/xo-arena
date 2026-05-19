---
slug: training-presets-and-time
title: Training presets, runtime, and the admin-approval gate
category: training
tags: [presets, quick, standard, deep, eta, approval, concurrency, gym]
status: PUBLISHED
admin_only: false
---

# Training presets, runtime, and the admin-approval gate

When you start a training session in the Gym, you don't pick a raw episode count — you pick a **preset**. The preset bundles two things: how many episodes the run will play, and roughly how long that takes. This doc explains the three presets, why some of them need admin approval, and why you can only have one training session running at a time.

## The three presets

Every trainable algorithm exposes the same three options:

- **Quick** — small, fast, good enough for a sanity check. Useful when you've just changed something and want to see if the bot still learns at all.
- **Standard** — the everyday preset. Long enough to land a useful learning curve, short enough that you'll get the result the same hour.
- **Deep** — the heaviest available run. Reserved for "I want this bot to be as good as it can get on this algorithm."

The exact episode count and runtime depend on the algorithm — AlphaZero "Deep" is a different proposition than Q-Learning "Deep." The Gym shows you both numbers up front so there are no surprises.

## Why presets and not a slider

Two reasons.

**First, predictability.** A slider invites the question "should I pick 73,000 or 74,000?" The answer is almost never different in any meaningful way, but it's a real cognitive tax. Three named tiers let you decide *what kind of run* you want, not *what exact number to type*.

**Second, calibration.** The presets are tuned per (algorithm, game). Q-Learning saturates fast on Tic-Tac-Toe — 50,000 episodes is enough to plateau, and 200,000 is no better. AlphaZero saturates slowly on Connect 4 — 2,500 self-play games is barely a warmup, and 10,000 is the lower bound for real strength. The presets bake that knowledge in so you don't have to guess.

## Time / cost / approval

Sessions whose estimated runtime crosses **four hours** require admin approval before training starts. Today that's:

- **AlphaZero "Standard"** (~4 hours) and **"Deep"** (~24 hours)
- **DQN "Deep"** (~4 hours)
- **Policy Gradient "Deep"** (~4 hours)

Everything shorter auto-confirms and starts running immediately.

The approval gate isn't a punishment — it's a budget check. A 24-hour AlphaZero run uses real CPU on a shared box, and we'd rather an admin glance at the queue and say "yes go ahead" than have ten people accidentally all hit Deep at the same time.

If your session is waiting on approval you'll see "PENDING APPROVAL" on the session page. There's no client-side ETA for the approval itself — it happens when an admin gets to the queue.

## Why you can only run one session at a time

Every trained bot belongs to someone. The platform enforces a **per-user cap** of one active training session at a time (admins can have more if the operator's set the override). This prevents a single user from pinning every available CPU slot by chaining up Quick after Quick after Quick.

If you try to start a second session while one is already running, you'll get a "Training limit: you already have 1 active session (max 1)" error. Wait for the first to finish (or pause it — see [pausing-and-resuming-training](/help/pausing-and-resuming-training)) and try again.

## Picking the right preset for what you're doing

A working rule of thumb:

- **Trying something new** (changed a hyperparam, added a new bot, want to verify the wiring works): **Quick**. You're looking for "does the curve go up at all?", not "is this the best curve I can get?"
- **Building a bot you actually want to deploy**: **Standard**. This is the right answer most of the time.
- **You've already done Standard, you know it learns, and you want the strongest version**: **Deep**.

There's no shame in stopping early — see [bot-training-troubleshooting](/help/bot-training-troubleshooting) for how to read a flat curve and stop a session that's not converging.

## See also

- **`bot-training-concepts`** — what the hyperparameters actually mean.
- **`understanding-training-charts`** — reading the W/D/L curves once a run starts.
- **`training-multi-curve-eval`** — the side curves (Easy / Medium) and what they tell you.
- **`pausing-and-resuming-training`** — taking a break mid-run without losing progress.
