# Frequently Asked Questions

## Welcome to AI Arena

### What is AI Arena?
AI Arena is a platform where humans and AI bots compete in classic strategy games. Our first game is **Tic-Tac-Toe** — a familiar board game that turns out to be surprisingly rich territory for exploring how different AI algorithms think and play.

The platform is built around a simple idea: the best way to understand AI is to play against it, build it, and watch it improve.

### What is XO?
XO is the Tic-Tac-Toe game within AI Arena. It's where all the action currently lives — human vs human, human vs bot, and bot vs bot matches, along with the Gym where you train your own AI.

### Do I need an account to play?
No — you can play against the built-in bots without signing in. An account is required for PvP rooms, the leaderboard, puzzles, the Gym, and tournaments.

### How do I create an account?
Click **Sign in** in the top-right corner. You can register with an email and password or sign in with Google or Apple.

### What's coming soon?
More games. Tic-Tac-Toe is just the beginning — AI Arena is designed to support a growing library of classic strategy and board games. Each new game will bring its own leaderboards, bots, and training challenges.

---

## The Guide

### What is the Guide?
The Guide is your partner on AI Arena. During your first visit it walks you through an eight-step journey — from reading the FAQ and playing your first game all the way to competing in tournaments with your own trained bot. Once your journey is complete, the Guide doesn't go away: it becomes a quick-access panel for navigating the site, checking your progress, and surfacing useful information wherever you are.

The Guide lives in the <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#5B82B8,#3A5E8E);font-size:13px;vertical-align:middle;box-shadow:0 0 0 2px rgba(255,255,255,0.15),0 1px 4px rgba(0,0,0,0.3);">🤖</span> **Guide button** in the header — always one click away, on every page.

### How does your initial journey work?
The Guide tracks eight steps that you complete at your own pace:

1. **Welcome to the Arena** — automatically completed when you first open the Guide
2. **Read the FAQ** — you're here now
3. **Play your first game** — play against a community bot to see how the game works
4. **Explore AI Training** — read the Gym Guide to understand how bots are built
5. **Create your first bot** — set up your own AI bot with a chosen algorithm
6. **Train your bot** — run a training session in the Gym
7. **Enter a tournament** — register for an upcoming tournament
8. **Play a tournament match** — compete in a live tournament game

### Do I have to complete the steps in order?
Yes — each step unlocks the next. The Guide always shows your current step and a direct link to take action.

### Can I dismiss the Guide?
Yes — expand the step list and click **Dismiss journey** at the bottom. Your progress is saved and you can reopen the Guide at any time from the <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#5B82B8,#3A5E8E);font-size:13px;vertical-align:middle;box-shadow:0 0 0 2px rgba(255,255,255,0.15),0 1px 4px rgba(0,0,0,0.3);">🤖</span> Guide button.

### What do I earn for completing the Guide?
Finishing all eight steps earns the **Arena Graduate** badge and **+50 Tournament Credits (TC)**, which count toward your Activity Score and tier progression.

---

## Playing

### How does Player vs Player work?
From the Play page, select **PvP** and create a room. Share the room name with your opponent — they enter it on their Play page to join. Games are played in real time over a WebSocket connection.

### What game modes are available?
- **PvBot** — play against a built-in bot at Easy, Medium, Hard, or Tough difficulty
- **PvP** — real-time match against another player in a named room
- **PvBot (community)** — challenge a trained ML bot owned by another user
- **First to N** — series format (first to win 1, 2, or 3 games, or unlimited)

### Can I undo a move?
In solo bot games you can request an undo; the bot will allow it. In PvP and community bot games undos are not permitted.

### What are hints?
In solo bot games, hints highlight the strongest available move. Toggle hints from the game controls.

---

## Puzzles

### What are puzzles?
Puzzles present a board position where one side has a forced win. Your goal is to find the winning move (or sequence). They are a good way to study tactical patterns.

### Are puzzles timed?
Puzzles have an optional timer that you can enable from the puzzle controls. The timer does not affect scoring.

---

## Bots & the Gym

### What is the Gym?
The Gym is where you train ML (machine-learning) bots. You configure a model, run training episodes, and then deploy the bot to play against others on the leaderboard or in community bot matches.

### What algorithms are available?
Six brain architectures are available when creating a bot:

- **Q-Learning** — classic tabular reinforcement learning
- **SARSA** — on-policy variant of Q-Learning
- **Monte Carlo** — episode-based value estimation
- **Policy Gradient** — direct policy optimization
- **DQN** — Deep Q-Network
- **AlphaZero** — Monte Carlo Tree Search with neural network guidance

### How many bots can I create?
It depends on your tier. Bronze accounts start with **3 bot slots** and the limit increases as your Activity Score grows. See the Credits & Tiers section for the full table.

### Can I delete a bot?
Yes — from the Bots page, click **Delete** on any bot you own. Deletion is permanent and removes all associated training history and game records.

### What is a provisional bot?
A bot is provisional for its first few games after creation or an ELO reset. Provisional ratings fluctuate more to converge quickly toward the bot's true strength.

### Can I reset my bot's ELO?
Yes — from the bot's detail page, use **Reset ELO**. This clears ELO history and returns the bot to a provisional 1200 rating. It is blocked while the bot is in a tournament.

---

## ELO & Leaderboard

### How is my ELO rating calculated?
AI Arena uses the standard ELO formula. Winning against a higher-rated opponent gains more points; losing to a lower-rated opponent loses more. Your starting rating is 1200.

### What counts toward my ELO?
PvP and community bot games update both players' ratings. Games against the built-in bots do not affect your ELO.

### What is the leaderboard period filter?
- **All** — lifetime win rate
- **Monthly** — games played in the current calendar month
- **Weekly** — games played in the current week (Mon–Sun)

### Can I see bots on the leaderboard?
Yes — toggle **Show bots** in the leaderboard filters. Bots are marked with 🤖.

---

## Credits & Tiers

### What are credits?
Credits are a lifetime measure of your participation on the platform. They accumulate permanently, never expire, and cannot be purchased or transferred. There are three types:

- **HPC (Human Play Credits)** — earned by playing PvP games against other humans. +1 per completed game (win, loss, or draw all count).
- **BPC (Bot Play Credits)** — earned when one of *your bots* competes against a human or another user's bot. +1 per completed game. Credits go to the bot's owner, not the bot itself.
- **TC (Tournament Credits)** — earned by entering tournaments. +1 per entry, awarded at registration time. Entering yourself and a bot in the same tournament earns +2 TC.

Games against the built-in bots (Rusty, Copper, Sterling, Magnus) never earn any credits.

### What is my Activity Score?
Your Activity Score is a weighted sum of your credits:

> Activity Score = HPC + BPC + (TC × 5)

Tournament credits are worth 5× more than play credits because they represent a higher level of commitment.

### What are tiers?
Your tier is determined by your Activity Score and unlocks higher platform limits as you participate more:

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
On your **Profile** page, in the Credits & Tier panel. It shows your current tier, Activity Score, progress toward the next tier, and a breakdown of HPC, BPC, and TC.

---

## Account & Settings

### Where are the settings?
Click your avatar in the top-right corner, then select **Settings** from the dropdown.

### How do I change my display name?
Go to your **Profile** page (avatar dropdown → Manage account). Display name changes are reflected immediately across the app.

### How do I reset my password?
On the Sign In screen, click **Forgot password**. A reset link will be sent to your registered email address.

### Can I delete my account?
Account deletion is not self-serve at this time. Contact an administrator via the feedback button.

---

## Troubleshooting

### The game board is not responding.
Try refreshing the page. If you were in a PvP room, the room may have expired — create a new one.

### My ELO did not update after a game.
ELO updates run after the game is recorded on the server. If the app was offline during the game the result may not have been saved. Check your Stats page to confirm the game appears there.

### I found a bug or have feedback. How do I submit it?
Use the feedback button (💬) in the bottom-right corner of any page to submit a bug report, optionally with a screenshot of the issue.
