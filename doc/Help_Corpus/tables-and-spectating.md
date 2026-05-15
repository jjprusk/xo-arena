---
slug: tables-and-spectating
title: Tables and spectating
category: gameplay
tags: [tables, spectating, realtime, demo-tables, tournament-matches]
status: PUBLISHED
admin_only: false
---

# Tables and spectating

A **Table** is the unit of live gameplay on AI Arena. Every game — Quick Play, PvP, bot challenges, tournament matches, demo tables — runs on a Table. Tables are also where spectating happens.

## Seats and spectators

A Table has two **seats** (the two players) and an unbounded list of **spectators**:

- **Seated players** move pieces and influence the game state.
- **Spectators** see the board update in real time but cannot move. They're tracked in-memory by socket connection — authenticated watchers are deduped by user ID, guests by socket. The list is per-session only (no DB row).

If you join a Table that already has two seated players, you join as a spectator automatically. You can leave any time without affecting the game.

There is **no spectator chat** in v1. Spectators see the board and can leave — that's it. Keeping the surface quiet was intentional: tournament matches especially benefit from a focused viewing experience.

## Creating a Table

From the Tables page click **New Table**. You pick:

- **Game** — XO (default) or Pong (experimental).
- **Public vs private** — public Tables appear on the Tables list for anyone to join; private Tables are link-only.

Once seated, the game starts as soon as both seats are filled. A `FORMING` Table that sits idle past the no-show window may be garbage-collected.

## Can I play against my friends? (Human vs human)

Yes — you can play directly against a friend on AI Arena, head-to-head, human versus human. There's no "friends list" or invite system in v1, but the workflow is intentionally simple — you create a private Table and share the link.

The 3 steps:

1. **Create a private Table.** From the Tables page click **New Table**, pick your game, and choose **Private**.
2. **Share the link.** The Table page has a shareable URL. Send it to your friend any way you'd normally share a link — chat, text, email, Discord, etc.
3. **They click the link, sit at the open seat, and the game starts.**

Private Tables don't appear on the public Tables list, so the only way to join is the link. Tournament-match Tables and Hook-phase demo Tables work the same way under the hood (private + link-only).

If you'd rather your friend play one of your **bots** (not you directly), every bot is publicly challengeable from the Bot Directory — see the "Bots overview" doc.

## Joining an open seat

Public Tables waiting for a second player are listed on the Tables page with a **Join** button. One click seats you; the game starts immediately.

If the host left before you joined, you'll see an "abandoned" indicator — pick another Table.

## Bot-game Tables

When you challenge a bot from the Bot Directory, the platform creates a Table with you on one seat and the bot on the other. Other players can spectate the match in real time. Bot games behave like PvP from the spectator's point of view; the bot just makes its moves automatically.

## Tournament-match Tables

Every tournament match runs on its own Table, created on demand when the match becomes ready. The first player to navigate to the match creates the Table (seat 0, X); the second player joins, the Table flips from `FORMING` to `ACTIVE`, and the games begin.

Tournament-match Tables are always **private** — they don't appear on the public Tables list. Your bracket page is how you reach them.

## Demo Tables

If you're in the Hook phase of the Intelligent Guide, the platform creates a **demo Table** for step 2 — a bot-vs-bot match you watch without participating. Demo Tables are:

- **Private** — only the creator (you) can see them; never appear on the public list.
- **Marked** `isDemo=true` in the schema.
- **Bot-vs-bot** — both seats are built-in bots; you watch.
- **Garbage-collected aggressively** — one active per user (a new demo replaces the old), two-minute grace after completion, one-hour hard TTL.

The matchup is picked from a curated allowlist (e.g., Copper vs. Sterling, Rusty vs. Copper) so beginners see interesting, asymmetric play. Completion of the watch threshold credits Hook step 2 and pays +20 TC.

## Spar Tables

A **Spar** is a casual training match between your own bot and a built-in opponent at easy / medium / hard. Spar runs on a Table like any other match. It's part of Curriculum step 5; see the "Spar" doc.

Unlike demo Tables (which are GC'd aggressively), **spar matches are retained for 30 days** — you can review a practice match from earlier in the week from your bot's profile.

## Spectator badge

Spectator presence renders two ways:

- **At the table** — a low-density pill at the edge of the table surface shows a count plus a live dot. Click to expand a popover listing watcher names.
- **In the sidebar** — the table-context sidebar lists watchers by name as a secondary view.

Both are read-only — there's no way to interact with watchers in v1.

## Lifecycle and cleanup

Table statuses you'll see: `FORMING` (waiting for second player), `ACTIVE` (game in progress), `COMPLETED` (game ended; preserved briefly so spectators can see the result), `ABANDONED` (no-show or both players left), and various end states.

Abandoned and stale Tables are periodically garbage-collected by `tableGcService`. Late-joining spectators have a brief grace window to see the final result before cleanup.
