---
slug: bot-training-troubleshooting
title: Bot training — troubleshooting
category: training
tags: [troubleshooting, training, debugging, plateau, oscillation]
status: PUBLISHED
admin_only: false
---

# Bot training — troubleshooting

Common training problems and how to fix them. Each section is a symptom; the fix is a numbered list of things to try in order.

## Win rate is flat / not improving

1. **Rate (epsilon decay) too fast.** Check what epsilon is at the stall point (visible in the live Training panel). If ε < 0.1 and the bot hasn't converged, restart with a slower Rate — e.g., 0.999 → 0.9999. The bot needs more exploration time.

2. **Learning rate too high.** For tabular methods (Q-Learning, SARSA, MC, Policy Gradient), use the **Auto-Tuner** tab to sweep α. For DQN, α is hardcoded at 0.001 — this is well-tuned and almost certainly not the issue.

3. **Opponent mismatch.** Don't train vs Hard minimax until the bot reliably beats Easy. Switch to **curriculum** mode (auto-advances novice → master at 65% win rate). Jumping straight to Hard means every game ends in loss with very few learning updates.

4. **Too few episodes before vs-Minimax.** Always do **self-play first** to bootstrap states/weights before switching to a fixed opponent. Self-play covers both X and O perspectives in parallel; vs-Minimax only one.

5. **Wrong Brain for the task.** Some bots plateau because their Brain has a hard ceiling. Q-Learning, SARSA, and Monte Carlo all cap around 80% vs Hard. If you need higher, switch to **DQN or AlphaZero**.

## Win rate is oscillating wildly

1. **Learning rate too high.** For tabular methods, sweep α via the Auto-Tuner — try halving the current value. For DQN, α is fixed at 0.001; oscillation here points to a different cause.

2. **(DQN only) Replay buffer too small.** If your buffer is < 5,000 and you're running 10k+ episodes, old experiences are evicted before being replayed enough times. Increase the **Replay buffer** field to 20,000.

3. **(DQN only) Target update too low.** Syncing the target network every 10 steps instead of 100 causes instability. Keep **Target update** at 100+ in the Train tab.

4. **(Policy Gradient only) Softmax distribution collapsing.** If preferences swing wildly between sessions, halve α via the Auto-Tuner.

## Q-Learning / SARSA / MC win rate hits 80% then never improves

The tabular Q-table is **fully converged**. Tabular methods are bounded by the number of states they can represent — for tic-tac-toe that's about 5,478 reachable states. More episodes of the same algorithm won't help.

**Switch algorithms.** DQN's neural network can generalize patterns that the tabular Q-table treats as independent. AlphaZero adds MCTS lookahead. Both can exceed 80% vs Hard where Q-Learning cannot.

## AlphaZero is very slow

Each AlphaZero episode runs `numSimulations` MCTS passes, each a full tree traversal. At **Simulations = 200** an episode is ~200× slower than a Q-Learning episode at the same board state count.

1. **Start with Simulations = 50** to fill the experience buffer quickly.
2. Confirm the bot is **actually learning** (rising win rate on the Analytics tab) before increasing.
3. **Increase to 100** for sessions 2–3.
4. Reserve **Simulations = 200** for the final 2,000-episode fine-tuning session.

If AlphaZero is unusably slow on your hardware, consider DQN — same neural-net family, ~5–10× faster per episode.

## Bot plays well as X but poorly as O (or vice versa)

The bot was trained **asymmetrically**. This typically happens when training ran exclusively vs Minimax (where you control the side your bot plays) without enough self-play.

Run **2,000–3,000 additional self-play episodes** using **alternating** mode in the Train tab. Alternating mode ensures the bot plays X for one episode then O for the next, balancing updates across both perspectives.

## DQN wins a lot during training but benchmarks poorly

**This is a training-vs-inference mismatch.** Training-time win rate is measured with exploration active (ε > 0). The benchmark uses pure exploitation (ε = 0).

If the bot's greedy policy is weak, the random exploration moves were carrying it during training — masking that the underlying policy is actually mediocre.

**Fix:** Set **Epsilon min** to 0.01 (instead of 0.05) and run 5,000 more episodes. This trains the greedy policy harder by keeping epsilon very low for the final stretch.

## Bot benchmarks well but loses real games in the Bot Directory

Two likely causes:

1. **Style matchup.** Benchmark uses fixed minimax opponents. Real players (especially other trained bots) may play styles that exploit your bot. Use **head-to-head** in the Evaluation tab against the specific bot you're losing to — if the H2H is also bad, your style is wrong; if H2H is good, the public games may be too few to be statistically meaningful.

2. **First-move asymmetry.** Some bots are much stronger as X than O (or vice versa). Run alternating-mode self-play (see above).

## "My Q-Learning bot keeps drawing against itself in self-play"

Self-play converges fast on tic-tac-toe because both sides learn the same Q-table simultaneously. Once both sides know the optimal policy, every game is a forced draw (TTT is a known draw with perfect play).

**This is success, not failure.** Move to session 3 (vs Minimax) — the bot needs adversarial play against a different policy to learn variations.

## "I changed the network architecture and the bot got worse"

Changing DQN's network architecture **resets the weights** — you're training from scratch. The Train tab shows an amber warning when this is about to happen.

If you didn't see the warning, the new architecture took. The bot needs to retrain — run the full 35k-episode recipe again. There's no way to "transfer" weights between different architectures.

## Training freezes / job stuck in RUNNING

The Sessions tab shows the job status. If a `TrainingJob` is stuck in `RUNNING` for an unusually long time:

1. **Cancel** the job via the Cancel button on the job status card.
2. Check the Sessions tab — the cancelled job will show status `CANCELLED`.
3. Start a fresh session. Your previous progress (saved as `BotSkill` weights) is unaffected.

If cancellation doesn't work, contact admin via the Feedback button.

## Job failed (status `FAILED`)

The Sessions tab will show `FAILED` with a brief reason in the job log. Most common causes:

- **Worker timeout** — the job ran too long for the worker's wall-clock limit. Reduce episodes per session.
- **Invalid configuration** — a hyperparameter combination the validator missed. Reload the Train tab defaults and try again.
- **Out of memory** — neural-net training with a very large architecture. Drop to a smaller architecture (`[64, 64]` instead of `[128, 128]`).

Failed jobs don't affect your bot's existing weights. Submit a fresh session with adjusted settings.

## I want to roll back to an earlier version

The Gym **Sessions** tab shows your version history per skill. Each completed (non-pruned) training run is a row with a **Use this version** button. Click it to swap that version back as the bot's active skill.

If the version you want has been **PRUNED** (older than the retention limit, default 5 per skill), it's gone — bytes deleted. Use `um help-export` or the Export tab to back up versions you want to keep before they're pruned.

## Where to get more help

- **Live training panel** — the thick solid lines are your most informative learning signal.
- **Auto-Tuner tab** — sweep hyperparameters automatically for tabular methods.
- **Explainability tab** — visualize what your bot has actually learned.
- **Feedback button** (bottom-right) — send a bug report with logs attached.
- **"Ask Guide anything…"** input in the Guide drawer — that's me. Ask specific questions about your training run and I'll search the docs.
