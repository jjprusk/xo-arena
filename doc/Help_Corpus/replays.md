---
slug: replays
title: Replays — review past games
category: gameplay
tags: [replay, history, learning, ttl]
status: PUBLISHED
admin_only: false
---

# Replays — review past games

Every completed game on AI Arena produces a **replay** — a move-by-move recording you can scrub through later. Replays are how you learn from a loss, study a bot's behavior, or share a great game.

## Where to find a replay

Open any game from:

- **Your profile** → recent games or game history
- **A bot's profile** → its game list
- **A tournament bracket** → match cards link to their constituent games
- **Direct URL** → `/replay/:gameId`

Click the replay icon on any game card to open the viewer.

## Replay viewer controls

The viewer plays the game from move 1 to the final state:

- **Play / Pause** — autoplay the moves with a small pause between each.
- **Step forward / back** — single-move navigation. Useful for analyzing a specific turning point.
- **Scrub** — drag the timeline to jump to any move.
- **Speed** — variable playback speed (slower for analysis, faster for skim).

Each move shows the position (1–9 for XO, left-to-right top-to-bottom), the player who moved, and the time taken.

## What gets recorded

- **Move stream** — the sequence of moves with timestamps.
- **Final result** — winner / loser / draw, with each player's pre- and post-game ELO.
- **Context** — game mode (PvP, PvBot, Tournament, Spar, Cup), the Table the game ran on, and any tournament-match link.

The viewer renders the same `<TableSurface>` you saw during the live match — same board, same seat positions, same spectator visualization (if any spectators were watching live).

## Retention windows

Replays are kept for a fixed retention window:

- **Casual games** — 90 days by default (`replay.casualRetentionDays`)
- **Tournament games** — 90 days by default (`replay.tournamentRetentionDays`)

Both windows are admin-tunable in SystemConfig. After the window elapses, a daily job nulls out the move stream — but the **final result** (winner, score, ELO change) is kept **forever**. Your win/loss record never disappears; only the play-by-play is GC'd.

## Spar and Demo retention

- **Spar matches** — kept for **30 days** alongside the standard replay (longer than demos so you can review your bot's practice from earlier in the week).
- **Demo Tables** — bot-vs-bot demos from the Guide journey are GC'd aggressively (2-min grace post-completion, 1-hour hard TTL). Their replays disappear with the Table; the journey credit for step 2 persists either way.

## Sharing a replay

Open the replay viewer and copy the URL — anyone with the link can watch it (replays are public to anyone who has the URL). If the underlying Table was private, the replay link still works once the game is complete.

## Live view vs replay

These are two different things:

- **Live view** — you're spectating a Table while a game is in progress. Real-time updates, spectator badge, can't move.
- **Replay** — the game is over; you're scrubbing a recording. No realtime channel involved.

When a live game ends, the Table preserves the final state briefly so late-arriving spectators can see the result; afterward it's GC'd and the replay becomes the persistent record.

## Why replays matter

For human players: postmortem on a loss is the fastest way to improve. The scrub controls make it easy to find the one bad move.

For bot owners: replays are the input to **Explainability** in the Gym — you can load a position from a replay into the bot's value-estimate inspector and see exactly what your bot was thinking.

For tournament viewers: rewatching the bracket's defining games is part of the appeal of any competitive platform; replays are how AI Arena makes that possible.
