---
slug: gym-workflows
title: Gym workflows — common end-to-end recipes
category: training
tags: [workflows, gym, recipes, tutorial, debugging]
status: PUBLISHED
admin_only: false
---

# Gym workflows — common end-to-end recipes

The Gym has eight tabs. Knowing what each tab does is one thing; knowing how to **string them together** to accomplish a real goal is another. This doc walks through the most common end-to-end workflows.

Each workflow lists the click path, the expected time, and what success looks like.

## Workflow 1 — Train your first bot

**Goal**: Take a fresh bot from zero to a competitive Q-Learning skill.

**Time**: ~45 minutes.

1. **Profile → My bots → + Create bot**. Pick a display name, confirm.
2. **Profile → bot row → + Add skill**. Pick XO + Q-Learning.
3. **Gym → Train tab → pick the skill**.
4. **Session 1**: Self-play, 2,000 episodes, Exponential rate 0.995, Epsilon min 0.05, Reset ε ✓. Start.
5. Wait ~5 min. Watch the win/draw/loss chart climb.
6. **Session 2**: Same settings but **Reset ε ☐ unchecked**, episodes 3,000. Start.
7. Wait ~7 min.
8. **Session 3**: Switch Mode to **vs Minimax**, **Curriculum** opponent, episodes 2,000. Reset ε unchecked. Start.
9. Wait ~5 min.
10. **Evaluation tab → Benchmark**. Run 100 games per opponent.
11. Check the result: vs Random ≥ 85%, vs Easy ≥ 65%. ✓ Done.

**Success looks like**: A v3 skill in the Sessions tab, COMPLETED, with benchmark ELO ≥ 1,100.

If the benchmark is below target, go to **Workflow 5** (Fix a losing bot).

For the full annotated version of this recipe, see "Your first bot — a walkthrough".

## Workflow 2 — Compare two algorithms

**Goal**: Find out whether Q-Learning or DQN is better for your tic-tac-toe bot.

**Time**: ~1 hour (DQN is the long pole — 35,000 episodes).

1. Train a Q-Learning skill on bot A using Workflow 1 (or load an existing one).
2. Create bot B with a DQN skill.
3. **Gym → Train tab → bot B's DQN skill**. Run the 4-session DQN recipe: 10k self-play, 10k self-play, 10k vs-Minimax-curriculum, 5k vs-Minimax-master. Total: 35,000 episodes, ~45 minutes wall-clock on a decent machine.
4. **Evaluation tab → Benchmark each** (separately). Note their benchmark ELOs.
5. **Evaluation tab → Head-to-head → bot A vs bot B**. 200 games, alternate sides ✓. Start.
6. The winner is whichever bot has the higher H2H win rate. Confirm and apply ELO if you want it on the ladder.

**Success looks like**: A clear winner — typically DQN by 5-15% in H2H, though the gap depends on training time.

If H2H is close to 50/50, either algorithm works; pick the one that's faster to train (Q-Learning).

## Workflow 3 — Optimize hyperparameters

**Goal**: Find the best learning rate (α) for your Q-Learning bot.

**Time**: ~30 minutes (5 candidates × 1,000 episodes each, plus benchmark).

1. **Gym → Auto-Tuner tab → pick your bot and Q-Learning skill**.
2. **Sweep parameter**: α (learning rate). Range: 0.1 to 0.5 in steps of 0.1 (5 candidates).
3. **Episodes per candidate**: 1,000.
4. Click **Start sweep**. The platform runs candidates in parallel.
5. Wait ~10-20 minutes. Each candidate completes; the table fills in with benchmark scores.
6. Note the winning α (highest benchmark ELO).
7. **Train tab → bot and skill → use winning α for next full training run**.
   - Actually, α isn't a Train tab field; it's hardcoded. The Auto-Tuner sweep tells you what α to mentally treat as "active" but you can't manually set it. So the practical use is to confirm whether the default is good — and if not, mention it in a Feedback note since v1 doesn't yet expose α as a Train tab field.

**Success looks like**: A confirmed-best α value (often near the default 0.3 for Q-Learning).

For sweeping γ, run a second pass with **Sweep parameter**: γ, **Range**: 0.85 to 0.99 in steps of 0.05.

## Workflow 4 — Promote a version after testing

**Goal**: You trained a new version of your skill; verify it's better and promote it.

**Time**: ~10 minutes.

1. **Gym → Sessions tab → see your new version (e.g., v4)**.
2. v4 is **not yet active** — v3 is. Note this from the "Active" badge.
3. **Evaluation tab → Benchmark** (this benchmarks v3, the current active).
4. Note v3's ELO.
5. **Sessions tab → v4 → Use this version**.
6. **Evaluation tab → Benchmark** (now benchmarks v4).
7. Compare ELOs. If v4 ≥ v3 by 20+ ELO, keep v4 active.
8. If v4 < v3, **Sessions tab → v3 → Use this version** to roll back.

**Success looks like**: Active version is the stronger of the two, confirmed by independent benchmarks.

For more rigorous comparison, run a **head-to-head between v3 and v4** in the Evaluation tab (you'd need to swap one onto a clone of your bot to make H2H work — see Sessions tab doc for the trick).

## Workflow 5 — Fix a losing bot

**Goal**: Your bot benchmarks below the expected range. Figure out why.

**Time**: 15-60 minutes depending on root cause.

### Step 1 — Diagnose the symptom

**Evaluation tab → Benchmark**. Note the per-tier breakdown:

- Below 85% vs Random → severe undertraining or bug. Re-run sessions from scratch.
- 85% vs Random but below 50% vs Medium → forks aren't being created. Train more vs-Minimax.
- All tiers OK except draws-too-rarely vs Hard → epsilon-min too high; lower to 0.01.

### Step 2 — Look inside

**Explainability tab → load empty board → Inspect**.

- Center should have the highest Q-value. If not, the bot didn't learn correctly.
- Corners should be next. If edges have higher Q-values than corners, the learned values are wrong.

**Sessions tab → review recent sessions**:

- Did session 3 use Curriculum or just Easy? Curriculum is much better for skill.
- Was Reset ε accidentally checked on a continuation session?
- Did a curriculum jump destabilize a session you didn't notice?

### Step 3 — Try the obvious fix

Based on diagnosis:

| Diagnosis | Fix |
|---|---|
| Q-values flat | Run 2,000 more self-play episodes. |
| Bot can't recover from curriculum jump | Restore to checkpoint before the jump; redo with smaller jumps. |
| Epsilon decayed too fast | Run a new session with Rate 0.999 instead of 0.995. |
| Reset ε mistake | Run a continuation session with Reset ε unchecked. |
| Tabular plateau (Q-Learning ceiling) | Switch to DQN or AlphaZero. |

### Step 4 — Re-evaluate

After the fix, benchmark again. If improved, you're done. If not, see the Troubleshooting doc for deeper diagnostics.

## Workflow 6 — Prepare a bot for a tournament

**Goal**: You're entering a tournament tomorrow. Make sure your bot is ready.

**Time**: 1-2 hours, depending on training state.

### Phase 1 — Verify current readiness

1. **Evaluation tab → Benchmark** your active skill.
2. Note the ELO. For Rookie Cup or competitive tournaments, you want **benchmark ELO ≥ 1,200**.
3. **Evaluation tab → H2H** against the highest-rated bot in the same tier you've trained. See if you're competitive.

### Phase 2 — If not ready

1. **Gym → Train tab → bot and skill**.
2. Run 1-2 additional **vs-Minimax-Master sessions** (2,000-5,000 episodes each, with Curriculum off). This hardens the bot against deterministic strong opponents.
3. Lower **Epsilon min** to 0.01 for the final session. Sharpens the greedy policy.
4. **Re-benchmark**. Goal: 5-10 ELO improvement.

### Phase 3 — Style check

1. **Explainability tab → load a tricky position** (one you've lost from).
2. Check the bot's recommendation. Is it the move you'd play?
3. If the bot's pick is dubious, you may need a final tuning session.

### Phase 4 — Final review

1. **Sessions tab → confirm your strongest version is active**.
2. **Evaluation tab → final benchmark** for the record.
3. **Tournaments page → register** the bot.

**Success looks like**: Confidence that your bot is at least 1,200 benchmark ELO and you've verified its play on a representative position.

## Workflow 7 — Roll back a bad training run

**Goal**: Your latest session weakened the bot. Get back to the good state.

**Time**: 2 minutes.

1. **Gym → Sessions tab → previous (better) version row → Use this version**.
2. **Evaluation tab → quick benchmark** to confirm.
3. Done.

For the bad session:

- Decide if you want to keep it in history (for reference) or delete it. Delete via the row's delete affordance.
- If you want to retry with different settings, **Gym → Train tab → adjust → Start training**.

## Workflow 8 — Build a multi-skill bot

**Goal**: Your bot has an XO skill. Add a Pong skill (when Pong's training UI fully releases).

**Time**: Depends on Pong's training recipe (likely 1-2 hours for an AlphaZero Pong skill).

1. **Profile → My bots → your bot → + Add skill → Pong + AlphaZero**.
2. The new Pong skill is created at v0.
3. **Gym → Train tab → bot → Pong skill**. Run the Pong AlphaZero recipe.
4. After training, the new skill exists alongside your XO skill.
5. **Bot profile**: you'll see both skills as pills. The bot's **primary skill** is the most recently trained — manually swap if you want a different primary.

**Note**: Pong's training UI is gated at the time of writing. The architecture supports multi-skill but the surface to *train* Pong specifically is rolling out as part of the Pong full release. Your XO bot can already structurally carry a Pong skill — just not yet train one in the Gym.

## Workflow 9 — Investigate a specific lost game

**Goal**: You lost a game. Figure out why.

**Time**: 5-10 minutes.

1. **Profile → recent games → click the lost game**. Replay opens.
2. **Step through move-by-move**. At each of your bot's moves, ask: was this move the best one available?
3. When you find a dubious move, **click Send to Explainability**.
4. Explainability shows the bot's Q-values for that position. Was the bot's chosen move the highest Q-value? If yes, the Q-values are wrong (your bot prefers the wrong move). If no, something else picked it (e.g., random move during exploration if the game was a training game — but real games are ε=0, so this shouldn't happen unless something's off).
5. Once you identify the move where the bot went wrong, you can plan a training fix: more episodes vs that pattern, or a rule.

## Workflow 10 — Onboard another player

**Goal**: A friend signed up for AI Arena. Get them training quickly.

**Time**: 20-30 minutes (theirs, with you guiding).

1. Have them complete the Hook phase (steps 1-2 of the Intelligent Guide) — that's automatic on signup.
2. Walk them through Workflow 1 (Train your first bot) live.
3. Run a benchmark together so they see what numbers to expect.
4. Suggest they read "Bot training concepts" and "Q-Learning" docs as next steps.

The goal is for them to have **a working trained bot in their account within their first hour**. After that, they're self-sufficient and the platform's surface area opens up.

## What's NOT a workflow

Some things people ask about that aren't really workflows:

- **"Make the bot learn faster"** — not a button. Use proper recipes; the speeds in this doc are realistic.
- **"Copy a trained bot from a friend"** — not supported. Each user trains their own.
- **"Train against a specific bot"** — partially supported via H2H in Evaluation, but H2H is for measurement, not training. Training opponents are limited to self-play and minimax.

## Quick reference

| Goal | Primary tabs |
|---|---|
| Train a new bot | Train → Sessions → Evaluation |
| Compare algorithms | Train (twice) → Evaluation (H2H) |
| Find hyperparameters | Auto-Tuner → Train |
| Promote a version | Sessions → Evaluation |
| Fix a losing bot | Evaluation → Explainability → Sessions → Train |
| Prep for tournament | Evaluation → Train → Evaluation |
| Roll back | Sessions |
| Investigate a loss | Replay → Explainability |
