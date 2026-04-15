# Bot Training Guide

## What is the Gym?

The Gym is where you train and evaluate your AI bots. Select a bot from the sidebar, then use the tabs to train it, review analytics, run evaluations, and more.

Only **ML bots** can be trained — they learn by playing thousands of games using reinforcement learning. **Minimax** and **MCTS** bots use deterministic algorithms and have fixed strength.

---

## Creating a Bot

Before you can train, you need a bot. Go to your [Profile](/profile) and click **Create Bot**. Choose a name and select **ML** as the bot type to enable training. Once created, your bot appears in the Gym sidebar.

---

## Training Your Bot

### Starting a Session

With your ML bot selected, open the **Train** tab. Choose your settings:

- **Mode** — *Self-play* (bot vs. itself) or *vs. built-in opponent* (bot plays against a community bot at a chosen difficulty).
- **Episodes** — Number of games to play in this session. More episodes = more learning, but takes longer. Start with **500–1000** to see initial progress.
- **Algorithm** — Q-Learning is a good default. It stores a table of learned move values (Q-values) for each board state.

Click **Start Training** to begin. Progress updates in real time.

### What Happens During Training

Each episode is one complete game. The bot:

1. Looks at the current board state.
2. Picks a move — sometimes randomly (exploration), sometimes using its best known move (exploitation).
3. Receives a reward: +1 for a win, –1 for a loss, 0 for a draw.
4. Updates its internal Q-table based on the outcome.

Over many episodes, the bot learns which moves lead to wins and avoids moves that lead to losses.

### Curriculum Learning

The Gym can automatically increase difficulty as your bot improves. When curriculum mode is active, the opponent difficulty advances when your bot crosses a win-rate threshold. You'll see a toast notification when the curriculum advances.

---

## Reading the Analytics

The **Analytics** tab shows charts from your training history:

- **Win rate** — Fraction of games won per session. A healthy ML bot should improve from ~33% toward 60%+ against mid-difficulty opponents.
- **Draw rate** — High draw rates are normal for Tic-Tac-Toe (optimal play always draws). A rising draw rate often signals improvement.
- **Loss rate** — Should decrease as training progresses.
- **Episode count** — Total games played across all sessions.

If win rate is flat or declining after many sessions, try resetting and re-training with a different mode or more episodes.

---

## Evaluating Your Bot

The **Evaluation** tab lets you run controlled matches to measure your bot's current strength:

- **Bot vs. Bot** — Pit your bot against another of your bots or a community bot.
- **Bot vs. You** — Play directly against your bot to feel how it plays.

Evaluation games are not counted in training — they measure performance only.

---

## Explainability

The **Explainability** tab shows a **Q-value heatmap** — a colour-coded overlay on the Tic-Tac-Toe board. Each cell shows how much value the bot assigns to placing a piece there in a given board position:

- **Bright / warm colours** — High Q-value; the bot strongly prefers this move.
- **Cool / dark colours** — Low or negative Q-value; the bot wants to avoid this move.

This helps you spot whether the bot has learned key strategic patterns (e.g. taking the centre, blocking forks).

---

## Checkpoints

The **Checkpoints** tab lists snapshots saved automatically at regular intervals during long training sessions. You can:

- **Restore** a checkpoint to roll your bot back to an earlier training state (useful if a recent session caused regression).
- Compare checkpoint win rates to track improvement over time.

---

## Sessions

The **Sessions** tab lists every training session ever run for this bot, including date, episode count, opponent settings, and outcome summary. Use it to audit your training history or identify which sessions produced the most improvement.

---

## Exporting Your Bot

Use the **Export** tab to download your bot's Q-table as a JSON file. You can use this file to:

- Back up your bot's learned knowledge.
- Share your bot model with others.

---

## ELO Rating

Every bot has an ELO rating (displayed in the Gym sidebar and on the Leaderboard). ELO updates automatically after ranked matches. A freshly created ML bot starts at **1200**. Train it, then enter tournament matches to push your ELO higher.

---

## Entering a Tournament

Once your bot is trained, head to [Tournaments](/tournaments) to find an active bracket and register. Tournament matches are played automatically — your bot competes live against other bots. Monitor results from the tournament detail page.

---

## Tips

- **Start with self-play** for fast early learning, then switch to a community-bot opponent once the bot wins most self-play games.
- **Run 2000+ total episodes** before evaluating ELO — early training is noisy.
- **Use the heatmap** to verify the bot has learned to prioritise the centre and corners.
- **Reset and retrain** if the win-rate chart flatlines for several sessions — sometimes Q-learning gets stuck in a local minimum.
