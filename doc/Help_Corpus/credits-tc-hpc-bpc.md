---
slug: credits-tc-hpc-bpc
title: Credits — TC, HPC, BPC
category: economy
tags: [credits, economy, rewards, tier, activity]
status: PUBLISHED
admin_only: false
---

# Credits — TC, HPC, BPC

AI Arena uses three credit currencies. In v1 they are **earned, not spent** — there are no entry fees or training costs. The currencies signal activity and unlock tiers; eventually some surfaces may charge credits, but today everything on the platform is free.

## What each currency means

- **TC — Tournament Credits.** Awarded for journey milestones, tournament wins, and discovery rewards. The activity-score formula gives TC a 5× weight, so a single TC counts more than a single HPC or BPC.
- **HPC — Human Play Credits.** Awarded +1 to each human player who plays a game (HVH, HVB, HVA). Casual signal that you're active.
- **BPC — Bot Play Credits.** Awarded +1 to the bot owner when their bot plays an *external* opponent (not the same owner, not self-play). Rewards letting your bots out into the wild.

You start with **0 of all three** when you create your account.

## How you earn each currency

### TC — journey + discovery + tournament wins

| Source | Amount | When |
|---|---|---|
| **Hook phase complete** (steps 1+2 done) | +20 TC | After watching the bot-vs-bot demo to threshold |
| **Curriculum phase complete** (step 7) | +50 TC | When your first tournament finishes |
| **First Specialize action** | +10 TC | First action after graduating Curriculum |
| **First real tournament win** | +25 TC | Idempotent; only the first counts |
| **First non-default algorithm** | +10 TC | First time you train a non-Q-Learning bot |
| **First template clone** | +10 TC | First time you clone a tournament template |

All journey/discovery rewards are **idempotent** — the same milestone never pays twice.

The journey reward amounts (`+20` for Hook, `+50` for Curriculum) are stored in SystemConfig and admin-tunable.

### HPC — human play

Every game a human plays awards +1 HPC to that human. This applies to:

- **HVH** (human vs. human) — both players get +1.
- **HVB** (human vs. bot) — the human gets +1.
- **HVA** (human vs. AI) — the human gets +1. *Note: pure AI-vs-AI demo watches don't award HPC.*

### BPC — bot play

When your bot plays against a bot or human owned by someone else, you earn +1 BPC. Self-play (your bot vs. your bot, your bot vs. you) does not award BPC — that would let a single user farm credits.

## What credits get you

Today credits unlock your **activity tier** — a public ranking from Bronze upward (Silver, Gold, Platinum, Diamond). Your tier:

- Sets the **maximum number of bots** you can own (Bronze 3 → Silver 5 → Gold 8 → Platinum 15 → Diamond unlimited).
- Sets the **maximum episodes per training session** (Bronze 1k → Silver 5k → Gold 20k → Platinum 50k → Diamond 100k).
- Appears on your profile and on leaderboards.

Tier thresholds are admin-tunable. As you accumulate credits your tier upgrades automatically; the Notifications panel can ping you on tier upgrades.

The **activity score** is calculated as `HPC + BPC + (TC × tcMultiplier)`. The default multiplier is 5, so 1 TC is worth 5 HPC or BPC for tier purposes.

## Refunds and admin grants

In v1 there's no automatic refund flow (because there's no spending). Admins can adjust SystemConfig reward values, but there is no per-user credit-grant endpoint in the public API.

## Where you see your balance

Your three balances surface on your profile page, in the credits panel, and via the public endpoint `GET /api/v1/users/:id/credits`. The endpoint returns balances plus your activity score, current tier, tier icon, next tier, and points to the next tier.

## Looking ahead

If the platform later introduces spending — bot training that consumes BPC, premium tournament entry in TC, ranked PvP in HPC — those rules will be added per surface and rolled out with notice. v1's contract is "free everything; credits = recognition only."
