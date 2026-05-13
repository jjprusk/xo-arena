---
slug: cups
title: Cups — Curriculum Cup and Rookie Cup
category: tournaments
tags: [cups, curriculum-cup, rookie-cup, guide, brackets]
status: PUBLISHED
admin_only: false
---

# Cups — Curriculum Cup and Rookie Cup

**Cups** are special, private tournaments tied to the Intelligent Guide journey. They're how the platform turns "I trained a bot" into "I just won (or lost) a bracket" — the moment most users decide whether AI Arena clicks for them.

## What makes a Cup different

Cups are tournaments flagged `isCup = true` in the schema, with three key differences from regular tournaments:

- **Private to you** — only you participate (plus seeded bots). Other users never see your cup; they have their own.
- **Excluded from ELO and public rankings** — wins and losses here don't move your tournament classification or feed leaderboards. The point is the learning, not the score.
- **Garbage-collected after 30 days** — cups age out so they don't accumulate. Take screenshots if you want a souvenir.

## Curriculum Cup — 4 entrants

The Curriculum Cup is triggered automatically when you complete **Curriculum step 6** (registering for a tournament with your own bot). The platform clones a tournament template and seeds it with:

- **You + your bot** (1 entry)
- **2 × Rusty** (Novice built-in bot)
- **1 × Copper** (Intermediate built-in bot)

Sterling and Magnus are intentionally **absent** — losing your first cup to the strongest bot on the platform is demoralizing, so the Curriculum Cup keeps the field beatable. Most users with a competent Quick Bot can win it.

Completing the Curriculum Cup (step 7) pays the **+50 TC** Curriculum-complete reward and graduates you to the Specialize phase.

## Rookie Cup — 8 entrants

The Rookie Cup is the *next* step after Curriculum — surfaced as the top "Competitor bucket" recommendation once you've finished Curriculum. It's bigger and tougher:

- **You + your bot** (1 entry)
- **4 × Rusty**
- **2 × Copper**
- **1 × Sterling** (Advanced built-in bot)

The bracket is **deterministically seeded** so Sterling lands in slot 8, opposite your slot 1 in the bracket — meaning you can only meet Sterling in the **semifinals at earliest**, and only the final if you both win out. Your first match is always against a Rusty; your early rounds stay beatable.

The Rookie Cup is your first real test of whether your bot has learned anything beyond minimax. Winning it usually requires an ML-trained bot — a Quick Bot Master will draw against Sterling forever.

## Bracket structure

Both cups use **single-elimination** brackets with **best-of-3** matches. The Curriculum Cup is a 4-entrant single-elim (2 rounds); the Rookie Cup is an 8-entrant single-elim (3 rounds).

## How to enter

You don't manually enter cups — the Guide spawns them at the right moment. The Curriculum Cup appears in your tournament list when you hit Curriculum step 6. The Rookie Cup is surfaced as a recommendation in the post-Curriculum Specialize view.

If you want to play a cup again after it's been garbage-collected, you can re-trigger it via the Guide (Settings → Restart journey) — though the journey reward only pays once.

## Why this design

The cup design balances two things:

1. **Make Curriculum feel like a real win** — most users complete it. The reward is real (+50 TC) but the field is winnable.
2. **Make Rookie feel like a real challenge** — Sterling is in the bracket. Beating it means you've learned something.

Together they form a smooth difficulty curve: Curriculum is the trainer wheels, Rookie is the road. Past Rookie Cup, the rest of the tournament system (Open, Planned, Flash, recurring) is the open road.
