---
slug: activity-tiers-and-ranking
title: Activity tiers and rankings
category: economy
tags: [tier, ranking, activity, leaderboard, classification]
status: PUBLISHED
admin_only: false
---

# Activity tiers and rankings

AI Arena tracks two distinct kinds of "rating":

- **Activity tier** — Bronze → Silver → Gold → Platinum → Diamond. Reflects total platform participation. Gates how many bots you can own and how big a training session you can run.
- **Tournament classification** — Rookie → Amateur → Intermediate → Advanced → Expert. Reflects competitive results.

These are independent. A highly active player who never enters tournaments will rise in tier but stay Rookie in classification, and vice versa.

## Activity tier — how it's calculated

Your **activity score** is:

```
activityScore = HPC + BPC + (TC × tcMultiplier)
```

`tcMultiplier` defaults to **5**, so 1 TC counts as 5 points toward your tier. The platform sums all three credit balances and applies thresholds:

| Tier | Activity score | Max bots | Max episodes per training session |
|---|---|---|---|
| **Bronze** | starting tier | 3 | 1,000 |
| **Silver** | (admin-configured) | 5 | 5,000 |
| **Gold** | (admin-configured) | 8 | 20,000 |
| **Platinum** | (admin-configured) | 15 | 50,000 |
| **Diamond** | (admin-configured) | unlimited | 100,000 |

Tier thresholds and capability limits are tunable in admin SystemConfig. The thresholds shown on the leaderboard reflect the live values, not these defaults.

You upgrade tiers automatically as your score crosses the threshold. The `achievement.tier_upgrade` notification fires on each upgrade.

## Where you see your tier

- **Profile page** — top-of-page badge.
- **Public credits endpoint** (`/api/v1/users/:id/credits`) — returns `{ hpc, bpc, tc, activityScore, tier, tierName, tierIcon, nextTier, pointsToNextTier }`.
- **Bot list / Bot Directory** — your tier badge accompanies your name.

`nextTier` and `pointsToNextTier` let UIs show "X more credits to Silver".

## Tournament classification — separate ladder

Tournament classification is **purely competitive** — it changes when you play in real tournaments (not Cups, which are excluded). The classification ladder has tiers like Rookie, Amateur, Intermediate, Advanced, Expert. It's surfaced on your profile and on the Rankings page.

Classification updates use a tournament-specific rating system; details are in the platform's tournament classification service.

## Rankings page

The `/rankings` page shows the public leaderboard. You can sort by:

- **Activity tier** (default) — most-active users at the top.
- **Tournament classification** — most-decorated competitors at the top.

The board excludes flagged test users (admins, seed accounts, internal-domain emails) so the numbers reflect real player activity.

## Why two ladders

The two ladders address two different motivations. Activity tier rewards "showing up and playing" — every game pays into it. Tournament classification rewards "winning real brackets". A platform with only one of these collapses either to a grind ladder (just play forever) or to a tournament-only mindset (most casual players never appear). Two ladders means anyone can climb something meaningful with their preferred play style.
