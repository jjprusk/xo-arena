# Frequently Asked Questions

## Overview

### What is XO Arena?
XO Arena is a competitive Tic-Tac-Toe platform. You can play against built-in bots,
challenge other players in real-time PvP rooms, solve puzzles, and train your own
machine-learning bots in the Gym.

### Do I need an account to play?
No — you can play against bots without signing in. An account is required for
PvP rooms, the leaderboard, puzzles, and the Gym.

### How do I create an account?
Click **Sign in** in the top-right corner. You can register with an email and password
or sign in with Google or Apple.

### What's coming soon?
Tournaments and in-app feedback are currently in development and will be available soon.

---

## Getting Started

### The Guide

XO Arena includes an interactive Guide designed to walk you through your first steps — from playing your first game to training your own AI bot. The Guide is always available via the <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:9999px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:white;font-size:15px;font-weight:600;vertical-align:middle;">✦ Guide</span> button in the top-left corner of the page as shown below.

<img src="/screenshots/guide-button.png" alt="Guide button in the header" style="border-radius:8px;margin:12px 0;border:1px solid #e5e7eb;" />

Click it at any point in your journey to reopen the Guide and review the steps.

### Using the Guide

The Guide presents a series of sequential steps, each represented by a balloon on an interactive map. Work through them in order to get the most out of the platform.

<img src="/screenshots/guide-overview.png" alt="Guide step map" style="border-radius:8px;margin:12px 0;border:1px solid #e5e7eb;" />

The steps take you from reading the FAQ and playing your first games against existing bots, through creating and training your own bot, all the way to competing on the leaderboard. Each step builds on the last — by the end you will have a working AI bot of your own.

### Have Fun

XO Arena is designed to make AI approachable by grounding it in a familiar game. Every bot in the system has its own "personality" shaped by how it was trained — some are aggressive, some defensive, some unpredictable. As you progress you will learn the basics of several AI model types and discover how training parameters like learning rate, exploration decay, and episode count affect the way a bot plays. Training a bot well takes experimentation and patience, and that challenge is the point.

---

## Playing

### How does Player vs Player work?
From the Play page, select **PvP** and create a room. Share the room name with your
opponent — they enter it on their Play page to join. Games are played in real time over
a WebSocket connection.

### What game modes are available?
- **PvBot** — play against a built-in bot at Easy, Medium, Hard, or Tough difficulty
- **PvP** — real-time match against another player in a named room
- **PvBot (community)** — challenge a trained ML bot owned by another user
- **First to N** — series format (first to win 1, 2, or 3 games, or unlimited)

### Can I undo a move?
In solo bot games you can request an undo; the bot will allow it. In PvP and community
bot games undos are not permitted.

### What are hints?
In solo bot games, hints highlight the strongest available move. Toggle hints from the
game controls.

---

## ELO & Leaderboard

### How is my ELO rating calculated?
XO Arena uses the standard ELO formula. Winning against a higher-rated opponent gains
more points; losing to a lower-rated opponent loses more. Your starting rating is 1200.

### What counts toward my ELO?
PvP and community bot games update both players' ratings. Games against the built-in
bots do not affect your ELO.

### What is the leaderboard period filter?
- **All** — lifetime win rate
- **Monthly** — games played in the current calendar month
- **Weekly** — games played in the current week (Mon–Sun)

### Can I see bots on the leaderboard?
Yes — toggle **Show bots** in the leaderboard filters. Bots are marked with 🤖.

---

## Credits & Tiers

### What are credits?
Credits are a lifetime measure of your participation on the platform. They accumulate
permanently, never expire, and cannot be purchased or transferred. There are three types:

- **HPC (Human Play Credits)** — earned by playing PvP games against other humans.
  +1 per completed game (win, loss, or draw all count).
- **BPC (Bot Play Credits)** — earned when one of *your bots* competes against a human
  or another user's bot. +1 per completed game. Credits go to the bot's owner, not the bot itself.
- **TC (Tournament Credits)** — earned by entering tournaments. +1 per entry, awarded
  at registration time. Entering yourself and a bot in the same tournament earns +2 TC.

Games against the built-in bots (Rusty, Copper, Sterling, Magnus) never earn any credits.

### What is my Activity Score?
Your Activity Score is a weighted sum of your credits:

> Activity Score = HPC + BPC + (TC × 5)

Tournament credits are worth 5× more than play credits because they represent a
higher level of commitment.

### What are tiers?
Your tier is determined by your Activity Score and unlocks higher platform limits as
you participate more:

| Tier | Min Score | Icon |
|------|-----------|------|
| Bronze | 0 | 🥉 |
| Silver | 25 | 🥈 |
| Gold | 100 | 🥇 |
| Platinum | 500 | 💠 |
| Diamond | 2,000 | 💎 |

### What do higher tiers unlock?
Two things currently scale with your tier:

**Bot slots** — the number of bots you can own:

| Tier | Bot Limit |
|------|-----------|
| Bronze | 3 |
| Silver | 5 |
| Gold | 8 |
| Platinum | 15 |
| Diamond | Unlimited |

**Training session length** — the max episodes per training run in the Gym:

| Tier | Episodes per session |
|------|----------------------|
| Bronze | 1,000 |
| Silver | 5,000 |
| Gold | 20,000 |
| Platinum | 50,000 |
| Diamond | 100,000 |

### Where can I see my credits and tier?
On your **Profile** page, in the Credits & Tier panel. It shows your current tier,
Activity Score, progress toward the next tier, and a breakdown of HPC, BPC, and TC.

---

## Puzzles

### What are puzzles?
Puzzles present a board position where one side has a forced win. Your goal is to find
the winning move (or sequence). They are a good way to study tactical patterns.

### Are puzzles timed?
Puzzles have an optional timer that you can enable from the puzzle controls. The timer
does not affect scoring.

---

## Bots & the Gym

### What is the Gym?
The Gym is where you train ML (machine-learning) bots. You configure a model, run
training episodes, and then deploy the bot to play against others on the leaderboard
or in community bot matches.

### What algorithms are available?
Six brain architectures are available when creating a bot:

- **Q-Learning** — classic tabular reinforcement learning
- **SARSA** — on-policy variant of Q-Learning
- **Monte Carlo** — episode-based value estimation
- **Policy Gradient** — direct policy optimization
- **DQN** — Deep Q-Network
- **AlphaZero** — Monte Carlo Tree Search with neural network guidance

### How many bots can I create?
It depends on your tier. Bronze accounts start with **3 bot slots** and the limit
increases as your Activity Score grows. See the Credits & Tiers section for the
full table.

### Can I delete a bot?
Yes — from the Bots page, click **Delete** on any bot you own. Deletion is permanent
and removes all associated training history and game records.

### What is a provisional bot?
A bot is provisional for its first few games after creation or an ELO reset. Provisional
ratings fluctuate more to converge quickly toward the bot's true strength.

### Can I reset my bot's ELO?
Yes — from the bot's detail page, use **Reset ELO**. This clears ELO history and
returns the bot to a provisional 1200 rating. It is blocked while the bot is in a
tournament.

---

## Account & Settings

### Where are the settings?
Click your avatar in the top-right corner, then select **Settings** from the dropdown.

### How do I change my display name?
Go to your **Profile** page (avatar dropdown → Manage account). Display name changes
are reflected immediately across the app.

### How do I reset my password?
On the Sign In screen, click **Forgot password**. A reset link will be sent to your
registered email address.

### Can I delete my account?
Account deletion is not self-serve at this time. Contact an administrator via the
feedback button.

---

## Troubleshooting

### The game board is not responding.
Try refreshing the page. If you were in a PvP room, the room may have expired — create
a new one.

### My ELO did not update after a game.
ELO updates run after the game is recorded on the server. If the app was offline during
the game the result may not have been saved. Check your Stats page to confirm the game
appears there.

### I found a bug or have feedback. How do I submit it?
Use the feedback button (💬) in the bottom-right corner of any page to submit a bug
report, optionally with a screenshot of the issue.
