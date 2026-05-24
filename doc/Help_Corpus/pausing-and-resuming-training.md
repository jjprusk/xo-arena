---
slug: pausing-and-resuming-training
title: Pausing and resuming a training session
category: training
tags: [pause, resume, checkpoint, recovery, gym]
status: PUBLISHED
admin_only: false
---

# Pausing and resuming a training session

A long training run can be a multi-hour commitment. The Gym lets you pause a session in flight and pick it up later — even after a backend restart — without losing the work already done.

## Pausing

Pause stops the training loop *cooperatively*: it lets the bot finish the current episode, writes a checkpoint at exactly that point, and then exits the loop. The session moves from `RUNNING` to `PENDING` with a "paused at" timestamp. The Gym shows it in the paused state with a **Resume** button.

The model itself unlocks while paused — so if you have a *different* skill you want to train in the meantime, you can. The pause counts against your active-session quota until you Resume or Cancel, so the slot isn't truly free, but the underlying brain is free to be used by other sessions.

## Resuming

Resume picks the latest checkpoint and restarts the loop from there. Specifically: the engine's weights, the exploration epsilon, and the episode counter are all restored to the moment of pause. The next episode you'd have played without pausing is the next episode you play after resume.

You can pause and resume **as many times as you like**. There's no penalty — checkpoints overwrite the same slot, so the session doesn't accumulate stale state.

## What pause is *not*

- **Not "stop early."** Stop-early — committing the in-progress weights as final and finishing the run — is a separate operation (and not yet wired in v1; for now, your options are pause or cancel).
- **Not "reset."** Pause keeps everything. If you want to start over from scratch, cancel the session and start a new one.
- **Not "save the weights."** The bot's stored weights only update when the *session* completes (or on the periodic per-model checkpoint roll, which is separate). A paused session's progress is recoverable but not yet "in" the bot.

## Crash recovery

If the backend restarts while a session is RUNNING — deploy, OOM, crash, anything — the next boot scans for orphaned sessions and resumes them from their latest checkpoint, the same as if you'd hit Resume yourself. The window of lost work is at most one checkpoint interval (currently 1000 episodes).

If a session has no checkpoint at all — typically because it crashed in the first few hundred episodes — it gets marked `FAILED` instead, the model unlocks, and you can start a new session. No checkpoint means there's nothing meaningful to recover; restarting from zero is the right call.

## When to pause vs cancel

- **Pause** when you want this exact bot to keep going later. Different time of day, sharing a resource, etc.
- **Cancel** when the run is clearly not going to converge — flat curves, oscillating loss, learning rate set wrong. Cancel ends the session terminally; the bot's weights stay at whatever they were before this session started.

The `bot-training-troubleshooting` doc has a checklist for "is this run salvageable?" — useful for the cancel-vs-pause-vs-let-it-finish decision.

## See also

- **`training-presets-and-time`** — how long sessions take and the approval gate.
- **`understanding-training-charts`** — what to watch for while running.
- **`bot-training-troubleshooting`** — diagnosing a sick run.
