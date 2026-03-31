# Frequently Asked Questions

## Getting Started

### What is XO Arena?
XO Arena is a competitive Tic-Tac-Toe platform. You can play against AI opponents,
challenge other players in real-time PvP rooms, solve puzzles, and train your own
machine-learning bots in the Gym.

### Do I need an account to play?
No — you can play against AI opponents without signing in. An account is required for
PvP rooms, the leaderboard, puzzles, and the Gym.

### How do I create an account?
Click **Sign in** in the top-right corner. You can register with an email and password
or sign in with Google.

---

## Playing

### How does Player vs Player work?
From the Play page, select **PvP** and create a room. Share the room name with your
opponent — they enter it on their Play page to join. Games are played in real time over
a WebSocket connection.

### What game modes are available?
- **PvAI** — play against a built-in AI at Easy, Medium, Hard, or Tough difficulty
- **PvP** — real-time match against another player in a named room
- **PvBot** — challenge a trained ML bot owned by another user
- **Best-of-N** — series format (best of 3, 5, or 7 games)

### Can I undo a move?
In PvAI mode you can request an undo; the AI will allow it. In PvP and PvBot modes
undos are not permitted.

### What are hints?
In PvAI mode, hints highlight the strongest available move according to the current AI.
Toggle hints from the game controls.

---

## ELO & Leaderboard

### How is my ELO rating calculated?
XO Arena uses the standard ELO formula. Winning against a higher-rated opponent gains
more points; losing to a lower-rated opponent loses more. Your starting rating is 1200.

### What counts toward my ELO?
PvP and PvBot games update both players' ratings. PvAI games against built-in opponents
do not affect your ELO.

### What is the leaderboard period filter?
- **All** — lifetime win rate
- **Monthly** — games played in the current calendar month
- **Weekly** — games played in the current week (Mon–Sun)

### Can I see bots on the leaderboard?
Yes — toggle **Show bots** in the leaderboard filters. Bots are marked with 🤖.

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
or in PvBot mode.

### What algorithms are available?
Currently **DQN** (Deep Q-Network) and **Q-Learning** are supported. More algorithms
may be added in future updates.

### How many bots can I create?
By default each account can own up to **5 bots**. Accounts with the Bot Admin role
have no limit.

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

### I found a bug. How do I report it?
Use the feedback button (💬) in the bottom-right corner of any page to submit a bug
report, optionally with a screenshot of the issue.
