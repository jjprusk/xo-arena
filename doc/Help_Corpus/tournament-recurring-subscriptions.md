---
slug: tournament-recurring-subscriptions
title: Recurring tournament subscriptions
category: tournaments
tags: [tournaments, recurring, subscription, template, auto-enrol]
status: PUBLISHED
admin_only: false
---

# Recurring tournament subscriptions

Recurring tournaments are templates that auto-spawn new tournaments on a schedule — daily, weekly, monthly. Instead of registering for each occurrence individually, you **subscribe** to the template once and the platform auto-enrolls you in every future spawn. This doc covers subscribing, unsubscribing, and managing the lifecycle.

## What's a recurring tournament template

A **TournamentTemplate** is a recipe for a series of tournaments. It defines:

- **Recurrence interval** — daily, weekly, monthly.
- **Recurrence start** — when the first occurrence happens.
- **Recurrence end** — when the template stops spawning (optional; some templates run indefinitely).
- **Tournament shape** — format (OPEN/PLANNED/FLASH), bracket (SINGLE_ELIM/ROUND_ROBIN), best-of-N, capacity, seeded bots.
- **Paused flag** — admins can pause a template without deleting it.

The template itself never runs games. It spawns **TournamentTournament occurrences** — concrete tournaments — each with its own bracket, matches, and outcome. Subscribing to a template means you're enrolled in every occurrence it spawns.

## Where to find recurring tournaments

**Tournaments → Recurring** in the top nav. The page shows all active templates:

| Name | Game | Interval | Next occurrence | Subscribers | Action |
|---|---|---|---|---|---|
| Daily XO | XO | Daily 12:00 UTC | 2026-05-15 12:00 | 47 | Subscribe |
| Weekly Champions | XO | Weekly Sunday | 2026-05-18 18:00 | 23 | Subscribe |
| Monthly Master | XO | Monthly 1st | 2026-06-01 16:00 | 156 | Subscribe |

The **Next occurrence** column tells you when the next spawn fires. The **Subscribers** column shows how many users are currently enrolled in the recurring schedule (not the current occurrence's registration list).

## Subscribing

1. Click a template card. Detail page shows the recipe and recent occurrence history.
2. Pick the bot you'll enter (must have a skill for the template's game).
3. Click **Subscribe**.

You're now a **standing subscriber**. Every future occurrence the platform spawns will:

1. Create a new tournament.
2. Auto-enrol you (and every other subscriber) at the moment registration opens.
3. Notify you: "Today's [template name] is open — you were auto-enrolled."
4. Run the tournament at the configured start time.

You don't have to do anything between subscribing and the tournament starting. Your bot is in the bracket automatically.

## What auto-enrolment uses

The subscription records:

- **userId** — you.
- **templateId** — the recurring template.
- **bot** — the bot you specified at subscription. (Yes, you commit to a specific bot when you subscribe.)
- **createdAt** — when you subscribed.
- **optedOutAt** — null until you unsubscribe.
- **missedCount** — how many occurrences you've missed (didn't play in).

When an occurrence spawns, the platform iterates every subscriber with `optedOutAt = null` and registers their committed bot.

## Changing your committed bot

If you want to switch which bot is auto-enrolled:

1. **Profile → Recurring Tournaments** → see your active subscriptions.
2. Find the template → click **Change bot**.
3. Pick a new bot with a skill for the template's game.
4. Confirm.

The change takes effect for the **next** occurrence — anything already enrolled (a current-occurrence registration that's already happened) doesn't change.

## Unsubscribing

Two paths:

### From the template page

1. Tournaments → Recurring → click the template you're subscribed to.
2. Click **Unsubscribe**.
3. Confirm.

Your `optedOutAt` is set to now. Future occurrences no longer enrol you. **Past registrations are preserved** — if you're already registered for an upcoming occurrence and the registration window hasn't closed yet, you remain registered for that one. Future spawns won't include you.

### From My Subscriptions

1. **Profile → Recurring Tournaments** → your subscribed templates list.
2. Find the template → click **Unsubscribe**.
3. Confirm.

Same effect.

## Re-subscribing

If you unsubscribed and want to come back:

1. Tournaments → Recurring → click the template → **Subscribe** again.
2. The platform updates your existing subscription record (sets `optedOutAt` back to null) and resets `missedCount` to 0.

Your subscription history (when you originally subscribed) is preserved. Re-subscribing is just toggling `optedOutAt` off, not creating a brand-new record.

## Withdrawing from a specific occurrence

What if you're subscribed but you don't want to play in **this week's** instance?

You can't withdraw from a single occurrence without unsubscribing from the template entirely. The platform doesn't have a "skip this one" affordance in v1.

**Workaround**: unsubscribe before the occurrence registers you, then re-subscribe after. The window is narrow (the platform enrolls you at the moment the occurrence's registration opens — typically a few hours before start time), so this is fiddly.

For most users, just play in the occurrence — your bot plays autonomously, so the cost is just spectating time (which you can skip).

## Missed-count tracking

The platform tracks how many occurrences you've been registered for but **didn't actually play** in. The missed-count appears on your subscription:

- Counts an occurrence as "played in" if your bot played at least one match game.
- Counts as "missed" if your bot was registered but the tournament ran without you participating (e.g., no-show).

High missed-count doesn't penalize you in v1 — there's no admin action triggered. It's informational. If you see a high missed-count, you may want to unsubscribe from a template that doesn't fit your schedule.

## Recurring tournaments and rewards

The standard tournament rewards apply:

- **Cups completed** during a recurring template's occurrence still pay journey rewards (one-time only).
- **First real tournament win** (+25 TC discovery reward) — fires on the first occurrence you win, even if it's via a recurring subscription.
- **TC prizes** — paid per occurrence, normally.

Recurring participation doesn't multiply rewards. Winning the daily template five times in a week pays five times the per-occurrence prize, but each win is a separate event.

## Templates and your tier

Some templates have a **minimum tournament classification** required to subscribe (Rookie / Amateur / Intermediate / etc.). You'll see the requirement on the template card; if you don't meet it, the Subscribe button is disabled with the reason shown.

Climbing the classification ladder unlocks more templates.

## Recurring templates vs one-off tournaments

When to use which:

| Use case | Path |
|---|---|
| One-time competitive event | One-off tournament |
| Regular automatic participation | Subscribe to a recurring template |
| Test your bot quickly | One-off (or FLASH) |
| Build long-term tournament classification | Subscribe (consistent participation) |
| Specific high-prize event | One-off (recurring prizes tend to be smaller) |

A typical AI Arena tournament user is **subscribed to 1-3 recurring templates** (daily, weekly) plus enters one-off tournaments occasionally for specific events.

## Pausing — what happens

Sometimes admins pause a template (e.g., for a platform maintenance, or because the template needs reconfiguration). When a template is paused:

- **No new occurrences spawn**.
- **Existing in-progress occurrences continue** normally.
- **Subscribers stay subscribed**; when unpaused, occurrences resume per schedule.
- The template page shows a paused indicator.

You'll see a notification if a template you're subscribed to is paused. Unsubscribing isn't required.

## Template ending

If a template has a `recurrenceEndDate` and the date passes, it stops spawning. Your subscription remains in the database (for history), but no new occurrences happen. You'll see the template move to a "Past templates" archive view.

## My subscriptions panel

**Profile → Recurring Tournaments** shows everything you're currently subscribed to:

- Template name and game.
- Interval (Daily / Weekly / Monthly).
- Your committed bot.
- Missed count.
- Date subscribed.
- Action: change bot, unsubscribe.

The panel also shows **past subscriptions** (with `optedOutAt` set), if any. Useful to remember which templates you've tried.

## Practical workflow — manage subscriptions

For a new user wanting to set up automatic tournament participation:

1. Train at least one bot with a benchmark ELO ≥ 1,200 (see "Your first bot — a walkthrough").
2. **Tournaments → Recurring → pick a template** that fits your goals (daily for max activity, monthly for stakes).
3. **Subscribe** with that bot.
4. Wait for the next occurrence to spawn — you'll get a notification.
5. Spectate the matches (or step away — your bot plays autonomously).
6. Review the result. If your bot is losing in round 1 every time, the template is too hard for it — unsubscribe and find a Rookie-tier template.

A few weeks of consistent recurring participation typically moves your tournament classification up by one tier.

## TL;DR

- Subscribe to a recurring template via Tournaments → Recurring → Subscribe.
- The platform auto-enrolls you (and your committed bot) in every future occurrence.
- Manage subscriptions from Profile → Recurring Tournaments.
- Unsubscribe anytime; your past results are preserved.
- No per-occurrence skip in v1; unsubscribe and re-subscribe is the workaround.
- High missed-count is informational, not penalizing.
- Templates can be paused or ended by admins.
