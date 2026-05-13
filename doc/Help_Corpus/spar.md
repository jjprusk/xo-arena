---
slug: spar
title: Spar — practice matches for your bot
category: bots
tags: [spar, training, practice, builtin]
status: PUBLISHED
admin_only: false
---

# Spar — practice matches for your bot

**Spar** is a low-stakes way to put your bot in front of a built-in opponent and see how it does. It's a single match (best-of-N games) between **your bot** and a system bot at a chosen difficulty. Spar is part of Curriculum step 5 — finishing a spar credits the step regardless of outcome.

## How to start a spar

From your **Profile → My bots**, click **Spar** on the bot you want to test. You'll be prompted to pick a difficulty:

| Difficulty | Opponent | Strength |
|---|---|---|
| **Easy** | Rusty (Novice) | Random valid moves. |
| **Medium** | Copper (Intermediate) | Blocks losses, takes wins, otherwise random. |
| **Hard** | Sterling (Advanced) | 60% optimal minimax. |

Magnus (Master) is intentionally not a Spar option — beating Master requires sustained training, not casual practice.

The Spar tiers are hardcoded in `backend/src/config/sparTiers.js`; they are not admin-tunable in v1.

## What happens during a Spar

A regular Table is created with your bot on one seat and the chosen system bot on the other. The game plays out automatically — neither player makes manual moves, since both seats are bots. You watch as a spectator.

The match runs the configured best-of-N (default 3). When it ends, you see the result and any rating change. Spar results **do** update your bot's ELO — Spar is "practice" but not "exhibition"; the wins and losses are real.

## What Spar does for Curriculum

Completing **any** Spar match (win, lose, or draw) credits Curriculum step 5. The step is one-time — repeated spars don't pay again — but they do continue to update ELO and the bot's game history.

## When to use Spar

Spar is best for:

- **Quick sanity check** — does my freshly trained bot beat Easy? Does it beat Medium?
- **Tier benchmarking** — how does my bot stack up against the canonical built-in tiers, without the noise of human opponents?
- **Curriculum progression** — getting step 5 credited.

If you want a longer, more diverse evaluation, use the Gym's **Evaluation** tab — it runs many games against multiple opponents with metrics.

## Spar vs Tournament vs Quick Match

| Mode | Opponent | Affects ELO? | Affects rankings? |
|---|---|---|---|
| **Spar** | Built-in only (Rusty/Copper/Sterling) | Yes | Yes |
| **Quick Match** | ELO-matched any bot | Yes | Yes |
| **Tournament match** | Whoever the bracket pairs | Yes (large) | Yes (tier) |
| **Cup match** | Curriculum/Rookie seeded bots | No | No |

So Spar is on the same footing as Quick Match for ELO purposes — it's just curated to be against the known-strength built-in bots.
