---
slug: tournaments
title: Tournaments
category: tournaments
tags: [tournaments, brackets, registration, recurring, formats]
status: PUBLISHED
admin_only: false
---

# Tournaments

Tournaments on AI Arena are scheduled multi-player events with a fixed bracket, a defined start time, and (usually) a prize in TC for top finishers.

## Tournament formats

Every tournament has a **format** — set at creation, never changed afterwards:

- **OPEN** — anyone can register up to capacity; the bracket runs as soon as the registration window closes (or the cap fills).
- **PLANNED** — a fixed start time. Registration opens at a configured time and closes at another. The bracket runs at the start time regardless of how full it is, padding with bot participants if needed.
- **FLASH** — short-notice tournament announced and started within minutes. Used for "happening now" events and admin-driven engagement.

## Bracket types

Two bracket structures are supported:

- **SINGLE_ELIM** — lose once, you're out. Standard knockout.
- **ROUND_ROBIN** — every participant plays every other; final standings are by win count.

Double-elimination and Swiss are *not* supported in v1.

## Best-of-N matches

Each tournament match is a **best-of-N series** of individual games. The default is **best-of-3** (first to 2 wins takes the match); admins can set 1, 3, or 5 when creating the tournament. The match tracks `p1Wins`, `p2Wins`, and `drawGames` until the series resolves.

## Seeding

Brackets are seeded one of two ways, set at creation:

- **random** — participants are shuffled into bracket positions. Default for most tournaments.
- **deterministic** — participants are placed by their pre-assigned slot index. Used by the Rookie Cup so Sterling (the strongest seeded bot) lands in the opposite bracket arm from the user — meaning you only meet Sterling in the final if you both make it that far.

## Registering

For a one-off tournament, register from the tournament's detail page. Two registration "modes" are tracked per participant:

- **SINGLE** — you signed up for just this tournament.
- **RECURRING** — you're a standing subscriber to a recurring template (see below) and were auto-enrolled in this occurrence.

The registration window has an explicit `registrationOpenAt` and `registrationCloseAt`. Once the window closes, no new entries.

Bots can be seeded into tournaments by admins via the admin panel — useful for guaranteeing a minimum field size.

## Recurring tournaments — templates + occurrences

A **TournamentTemplate** is a recurring recipe: a daily, weekly, or monthly cadence with a defined format, bracket type, registration window, and seeded bots. The template itself never runs games; it spawns individual **Tournament occurrences** on schedule.

Users **subscribe** to a template, not to individual occurrences. Click **Subscribe** on a template's page and you become a standing entrant — every future occurrence enrolls you automatically. Opt out any time from the My Tournaments page; your past results are kept. Missed-count tracking notes how many occurrences passed since your last participation.

## What happens during the tournament

When a tournament starts, the bracket is generated and each first-round match becomes a **Table** with two seats — yours and your opponent's. As soon as a match is ready you can navigate to it from the bracket; the first player to arrive creates the table, the second player flips it to active and the games begin.

If your opponent doesn't show up within the no-show window, the platform may auto-forfeit them so the bracket keeps moving. Disconnect handling is similar.

Between matches the bracket shows your next opponent and projected path. When you win or lose your final match the placement is recorded; any TC prize is credited.

## Cups vs regular tournaments

A subset of tournaments are flagged as **Cups** — see the "Cups" doc. Cups are Guide-tied (Curriculum Cup, Rookie Cup), private to the participating user, excluded from public rankings, and garbage-collected after 30 days. They're how the Guide journey wraps Curriculum into a real bracket experience without polluting platform stats.
