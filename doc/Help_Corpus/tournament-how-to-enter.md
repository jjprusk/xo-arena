---
slug: tournament-how-to-enter
title: How to find and enter a tournament
category: tournaments
tags: [tournaments, register, find, prepare, entry]
status: PUBLISHED
admin_only: false
---

# How to find and enter a tournament

This doc is the step-by-step for getting into a tournament — finding one, registering, and preparing your bot. For what *happens during* a tournament, see "Tournament flow". For the recurring-subscription model, see "Recurring tournament subscriptions".

## Where tournaments live

Open **Tournaments** in the top nav. The page shows:

- **Open now** — tournaments currently accepting registrations.
- **Starting soon** — registration may be closed but the tournament hasn't started yet.
- **Upcoming** — scheduled future tournaments.
- **In progress** — tournaments running right now (you can spectate but not register).
- **My subscriptions** — recurring templates you're subscribed to.

Each tournament card shows:

- **Name** and short description.
- **Format**: OPEN, PLANNED, or FLASH.
- **Bracket type**: SINGLE_ELIM or ROUND_ROBIN.
- **Best-of-N**: typically 3.
- **Registration window**: how long you have to enter.
- **Start time**.
- **Capacity**: max number of entrants.
- **Filled**: how many are already registered.
- **Prize**: typically TC.

## Filtering tournaments

The page has filters in the sidebar:

- **Game** — XO, Pong (when available).
- **Format** — OPEN, PLANNED, FLASH.
- **Bot tier required** — some tournaments require a minimum tournament-classification tier (Rookie, Amateur, etc.).
- **Status** — Open registrations / In progress / Completed.

Use **Game = XO** + **Status = Open registrations** to find what you can enter right now.

## Tournament formats — which to pick

When you're new to tournaments, **OPEN** tournaments are the most flexible — they fill on a first-come basis and run as soon as the cap fills or the window closes. **FLASH** tournaments are short-notice (announced and started within minutes); good for testing your bot quickly. **PLANNED** tournaments have specific start times and are more "scheduled event" style.

For your first tournament: pick an OPEN or PLANNED tournament with low entry requirements and 4-8 entrants. Smaller fields = quicker brackets.

## Registering — the click path

1. Click a tournament card. Detail page opens.
2. Scroll to **Register**.
3. Pick the bot you want to enter. Only your bots that have a **skill for the tournament's game** are selectable. If you don't have a qualifying bot, you'll see a prompt to add a skill.
4. Confirm the tournament's terms (privacy, code of conduct, etc.) — typically a checkbox.
5. Click **Register**.

The page now shows your registration confirmed. You'll see your placeholder slot in the bracket (if it's been generated) or your spot in the registrant list (if not).

## Email verification gate

Tournament registration **requires a verified email**. If yours isn't verified:

- The Register button shows a banner: "Verify your email to enter".
- Click the banner; the platform resends the verification email.
- Verify via the link in the email; then return and register.

This gate is here to prevent spam registrations. Once verified, you're set for all future tournaments.

## Bot eligibility

Your bot must have a **trained skill for the tournament's game**. Specifically:

- Your bot must own at least one skill row matching the tournament's game (e.g., a Q-Learning XO skill for an XO tournament).
- The skill must have **completed at least one training session** (not v0 fresh).
- If your bot's primary skill is for a different game (e.g., XO bot trying to enter a Pong tournament), the bot will be rejected with error code `NO_SKILL`.

To check eligibility, open your bot's profile — every skill is listed with the game and current ELO. If you see a skill matching the tournament's game and it has games played > 0, you're good.

## Capacity and waiting lists

Most tournaments have a **max entrants** (e.g., 16). When capacity fills:

- Further registrations show "Tournament full" and aren't accepted.
- The platform doesn't currently have a waiting-list feature — you just have to find another tournament.

For high-demand tournaments (rare in v1), check the schedule for the next occurrence — many are recurring.

## Recurring tournament subscription (vs single registration)

For **recurring** tournaments (templates that fire on a daily/weekly/monthly schedule), you have two registration paths:

- **One-off**: register for just this occurrence. Don't auto-enroll in future ones.
- **Subscribe**: register for *every* future occurrence. The platform auto-enrolls you each time the template spawns a new tournament.

Most users subscribe — it's easier than remembering to register. Opt-out anytime from **Profile → Recurring Tournaments**.

See "Recurring tournament subscriptions" for the full subscription management workflow.

## Preparing your bot

Before registering — or before the tournament starts — make sure your bot is competitive:

### Quick readiness check

1. **Gym → Evaluation tab → Benchmark** your tournament-entered skill.
2. Look at the benchmark ELO. For typical bot tournaments, **ELO ≥ 1,200** is competitive; **≥ 1,400** is strong.
3. If you're below 1,200, your bot is likely to be eliminated in round 1. See "Bot training — troubleshooting" or "Gym workflows" Workflow 6 (Prepare a bot for a tournament).

### Algorithm choice for tournaments

| Goal | Algorithm |
|---|---|
| Just want to participate | Any. Q-Learning is fastest to train. |
| Want to win | AlphaZero (highest ceiling) or well-trained DQN. |
| Want to surprise opponents | Policy Gradient (unpredictable). |
| Want robust draws against strong bots | SARSA (conservative). |

For a real shot at winning a Rookie Cup or higher, **AlphaZero with the full session recipe** is the best choice. Train it at least a day in advance.

### Last-minute hardening

If the tournament is hours away and your bot is close-but-not-quite:

1. **Train tab → run a final session** with **Epsilon min = 0.01** and **Mode = vs Minimax Master, no curriculum** (2,000-3,000 episodes). This sharpens the greedy policy specifically against the hardest opponent class.
2. **Re-benchmark**. Hope for +20 ELO.
3. Confirm the active version (Sessions tab) before the tournament starts.

## Re-checking after registration

After you register:

- The tournament detail page shows your slot in the bracket as it fills out.
- The platform sends notifications: tournament starting soon, your match ready, etc.
- You can **withdraw** before the registration window closes (some tournaments restrict this — check the tournament's rules).

If you withdraw, your TC refund (if any) depends on the tournament's rules — most are free to enter in v1 so no refund is needed.

## Common reasons registration fails

- **Email not verified** — verify first.
- **No qualifying bot** — your bot lacks a skill for this game.
- **Bot's skill is v0** — never trained. Train at least one session first.
- **Tournament full** — capacity reached.
- **Registration window closed** — you missed the deadline.
- **You're already registered** — only one entry per tournament per user.
- **You've been banned** — won't typically be the case but the error message is explicit.

The Register button surfaces the specific reason inline.

## Multi-bot users — can I enter multiple bots?

**No, only one bot per tournament**. The platform enforces a one-entry-per-user-per-tournament rule. If you have multiple trained bots, pick the strongest and enter just that one.

If you want to test multiple bots' tournament readiness, use **head-to-head** in the Evaluation tab — that gives you direct comparison without consuming tournament slots.

## After registering — what next?

1. **Note the start time**. Check **Settings → Notifications** to make sure tournament-related events are on (so you don't miss your match).
2. **Monitor your bot's ELO** in the days/hours before the tournament — if it drifts down from public games, you may want to lock the active version (don't train new sessions that could weaken it).
3. **Be available** when the tournament starts. You don't need to be at the keyboard for matches (bot plays automatically), but if you're spectating, do so from a stable connection.

For what happens once the tournament starts, see "Tournament flow".
