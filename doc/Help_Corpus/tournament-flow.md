---
slug: tournament-flow
title: Tournament flow — bracket to final result
category: tournaments
tags: [tournaments, bracket, matches, flow, spectating]
status: PUBLISHED
admin_only: false
---

# Tournament flow — bracket to final result

What actually happens once a tournament starts. From bracket generation to your final placement, with everything in between.

For pre-tournament steps (finding, registering, preparing), see "How to find and enter a tournament".

## The moment the tournament starts

At the tournament's start time:

1. **Registration closes** (if it hadn't already by capacity).
2. The platform generates the **bracket** using the configured seeding mode (random or deterministic).
3. **First-round matches** are created and marked as `READY`.
4. **All registered users get a notification**: "Tournament started. Your first match is ready."

The tournament's detail page transitions from "Registration" view to "Live bracket" view.

## Reading the bracket

For **SINGLE_ELIM** tournaments:

```
Round 1                Round 2         Final
  ├── You vs Bot A ─┐
  │                  ├── Winner ───┐
  ├── Bot B vs Bot C ┘             │
  │                                 ├── Champion
  ├── Bot D vs Bot E ─┐             │
  │                    ├── Winner ──┘
  └── Bot F vs Bot G ──┘
```

Your slot is highlighted. As matches complete, the bracket fills in winners.

For **ROUND_ROBIN** tournaments, the page shows a grid: who's playing whom across all rounds. Final standings are by total win count.

## Match flow — the moment-by-moment

Each match runs as a **best-of-N series** (default 3) on a Table.

### Step 1 — match ready

You get a notification: "Your match against [opponent] is ready." Click it to open the match's Table page.

The Table shows:

- The bracket context (which round, who the winner advances against).
- The current game number (1 of N).
- Both bots, their tournament identities and current ratings.
- The board, ready for the first game.

### Step 2 — first game starts

The first to navigate to the match's Table creates the Table (you on seat 0 = X). The second player joins (seat 1 = O), and the Table flips from `FORMING` to `ACTIVE`. The first game begins.

If you're spectating someone else's match (or you arrive after both seats are filled), you see the live board update.

### Step 3 — games play out

Each game runs as a normal XO match:

- The bot at seat 0 (X) moves first.
- The bot at seat 1 (O) responds.
- Games end with a win/loss/draw.

You don't play; your **bot** plays. Your role is to spectate (or to step away — the bot performs autonomously). Most matches finish in 30-60 seconds per game.

### Step 4 — series completion

Once one bot reaches the N/2+1 wins (e.g., 2 wins in best-of-3), the match is decided. The Table flips to `COMPLETED`. The bracket page updates: the winner advances to the next round, the loser is out (single elim) or counts a loss in the standings (round robin).

### Step 5 — between rounds

You're either:

- **Advancing**: a new match shows up as `READY` once your next opponent's match has also finished. You get another notification.
- **Eliminated**: your tournament is over. You can spectate other matches but won't have any more of your own.

In single-elim, half the field is eliminated each round. In round-robin, everyone plays everyone else.

## Disconnects and no-shows

The platform handles two specific edge cases:

### No-show

A player who **doesn't navigate to their match** within the no-show window (default 5 minutes after `READY`) is auto-forfeited. Their match is recorded as a loss; their opponent advances.

This window is admin-tunable in SystemConfig (`tournament.noShowMinutes`).

For bot-only tournaments (your bot vs other bots), the platform auto-creates the Table when both bots' owners are flagged as participating — so no-shows are rare. The window mainly affects human-vs-human tournaments (which v1 has fewer of).

### Disconnect during a match

If a bot's owner disconnects mid-match, the bot continues playing (it's autonomous). Spectators may briefly lose the live view but reconnect automatically.

If the bot itself stops responding (rare; possible on a heavy server load), the platform auto-forfeits after the disconnect window (default 90 seconds).

## Tournament results

When the bracket completes:

1. The tournament's status flips to `COMPLETED`.
2. Final standings are computed:
   - Single elim: champion (1st), runner-up (2nd), and so on by round eliminated.
   - Round robin: ranked by total wins; ties broken by head-to-head record.
3. **TC prizes** (if any) are credited to the top finishers.
4. **Tournament classification** is updated for participants — your Rookie/Amateur/Intermediate tier may shift based on performance.
5. All participants get a "Tournament complete" notification (and email if subscribed).

## Cups — what's different

If the tournament is a **Cup** (Curriculum Cup, Rookie Cup), the flow is slightly different:

- **Private to you** — only you and your seeded bots participate; no other humans are in the cup.
- **The seeded bots play their matches automatically** — they advance through their half of the bracket on their own. You only have to play your own matches.
- **Excluded from public rankings** — wins/losses here don't affect your tournament classification or public ELO.
- **GC'd after 30 days** — the cup is preserved for review but eventually purged.

The match flow within a cup is identical to a regular tournament; just the field composition and the recording differ.

See "Cups — Curriculum Cup and Rookie Cup" for the full cup story.

## Spectating a tournament

Even if you're not in a tournament, you can watch it:

1. **Tournaments → in progress tab → click any tournament**. The bracket page opens.
2. **Click any match's Table icon**. You join as a spectator.
3. The live board updates. You see both bots' moves in real time.

For high-profile tournaments (admin-promoted), the platform may also show a **Featured matches** panel highlighting interesting current games.

Spectator count is shown per Table — you can see how many other people are watching the same match.

There's **no spectator chat** in v1. Watch quietly, enjoy the games.

## After elimination

If you're eliminated in an early round:

- You can spectate the rest of the tournament if you want.
- You can withdraw from spectating (just close the tab — nothing else needs cleanup).
- Your tournament classification adjusts based on how you did.

If you placed in a prize position (top 3 in many formats), you'll see the TC credit in your balance and a "Tournament prize" line in your activity feed.

## Best-of-N tactics

For best-of-N matches (default 3), some strategic notes:

- **Game 1 sets the tone**. Your bot plays its current strongest line. Same for the opponent.
- **Games 2-3 reveal style**. If your bot wins game 1, the opponent's adaptation (if their algorithm has any) shows in game 2. For deterministic minimax opponents, every game is identical.
- **For Policy Gradient bots**: the natural stochasticity means games can play differently even from the same opening. This is an advantage in best-of-N because the opponent can't memorize.
- **For AlphaZero bots**: MCTS may explore slightly different lines per game, giving variety.

The platform doesn't allow swapping bots between games of a single match — what you registered with is what plays the entire series.

## Tournament outcomes affect your bot's ELO

Each game within a tournament match updates your bot's ELO normally. Wins against high-ELO bots boost yours; losses against low-ELO bots hurt. So a tournament can move your bot's ladder rating significantly — typically more than casual games because tournament opponents are generally stronger.

After a tournament, your bot's public profile shows the tournament in its history, with placement and ELO change.

## Withdrawing during a tournament

Once a tournament has started, **you can't withdraw**. Your bot continues to play. If you really want to stop, an admin can manually intervene — file a Feedback report with a reason.

This is intentional: if withdrawals were free, brackets would get chaotic late in tournaments.

For recurring tournaments, you can unsubscribe from the template anytime via Profile → Recurring Tournaments — that prevents future occurrences from enrolling you, but doesn't withdraw you from one already in progress.

## Replays of tournament games

Every tournament game produces a **replay**. Open them from your bot's game history or from the tournament's detail page (look for "Match replay" links).

Tournament replays are retained for **90 days** by default (admin-tunable). Their final results (winner, ELO change) are kept forever.

Use tournament replays to:

- Study what went wrong in a loss.
- Verify the bot played its trained strategy as expected.
- Compare your bot's play against the opponent's — useful for training the next iteration.

See "Replays — review past games" for the full replay-viewer workflow.

## What if the tournament is cancelled

Tournaments can be cancelled by admins (rare; usually for technical issues). If yours is:

- A notification fires: "Tournament cancelled."
- Any TC entry fee is refunded (if applicable; most v1 tournaments are free).
- Your bot's ELO is **not** adjusted for matches that never happened.
- The tournament's history shows status `CANCELLED`.

If you registered for a recurring template and one occurrence is cancelled, your subscription remains active for future occurrences.

## TL;DR

- Tournament starts at scheduled time → bracket auto-generated → matches play out.
- Each match is best-of-N games on a Table.
- Your bot plays autonomously; you spectate or step away.
- Win → advance. Lose → eliminated (single elim) or score a loss (round robin).
- Tournament ends → prizes credited, classification updated, notifications sent.
- Replays available for 90 days; final results forever.
- No mid-tournament withdrawals; no spectator chat in v1.
