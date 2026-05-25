---
slug: gym-train-tab
title: The Train tab — every field explained
category: training
tags: [train-tab, gym, settings, fields, hyperparameters]
status: PUBLISHED
admin_only: false
---

# The Train tab — every field explained

The Train tab is the Gym's primary surface — where you actually launch training sessions. This doc covers every field, what it does, when to change it, and what the right value is per algorithm. If you've ever stared at the Train tab wondering "what do all these fields mean", read this.

> **Where these fields are.** By default the Train tab shows only **presets** — Quick, Standard, Deep — and a **Start training** button. The fields described below live behind the **Advanced** toggle and only appear after you click it. If you just want to train, pick a preset and skip this doc. Read on when you want to understand or override what a preset is doing.

## The four sections

When **Advanced** is on, the Train tab is laid out in four sections, top to bottom:

1. **Bot + skill picker** (left sidebar)
2. **Session basics** — mode, episodes, opponent
3. **Exploration / decay** — epsilon controls (or algorithm-specific equivalents)
4. **Algorithm-specific** — only shown for DQN and AlphaZero

A **Start training** button at the bottom runs the configured session.

## Section 1 — Bot + skill picker

The left sidebar shows your bots and their skills as a tree:

```
- My bots
  - Alphabot
    - XO · Q-Learning (v3, 5,000 episodes)
    - XO · AlphaZero (v1, 3,000 episodes)
  - Betabot
    - XO · DQN (v2, 25,000 episodes)
```

**Click a skill** to select it. The Train tab repopulates with defaults appropriate for that skill's algorithm.

If a bot has no skills yet, you'll see a **+ Add skill** affordance on the bot. Click it, pick a game and algorithm, and a fresh skill is created. The new skill starts at v0 (untrained).

You can have only one skill selected at a time — training is per-skill.

## Section 2 — Session basics

### Mode

A radio button with three options:

- **Self-play** — the skill plays both sides. Default for sessions 1-2 of most recipes; the only mode for AlphaZero.
- **vs Minimax** — the skill plays a deterministic minimax opponent. Default for session 3+ (polish phase).
- **Alternating** — the skill plays X for one episode, O for the next. Use when you suspect X/O asymmetry in your trained skill.

**Pick self-play first** — it covers both perspectives simultaneously and is the right starting mode for every algorithm except AlphaZero (which is self-play only).

### Episodes

A number input — how many games this session should play.

| Algorithm | Typical session episodes |
|---|---|
| Q-Learning | 2,000-3,000 per session |
| SARSA | 3,000 per session |
| Monte Carlo | 5,000 per session |
| Policy Gradient | 5,000 per session |
| DQN | 10,000 per session |
| AlphaZero | 3,000-5,000 per session |

Bounded by your activity tier's max-episodes-per-session (Bronze 1,000, Silver 5,000, Gold 20,000, etc.). The field warns you in red if you exceed the cap.

### Opponent (vs Minimax mode only)

When Mode = vs Minimax, an opponent dropdown appears:

- **Novice (Rusty)**
- **Intermediate (Copper)**
- **Advanced (Sterling)**
- **Master (Magnus)**
- **Curriculum** ← recommended

Curriculum auto-advances the tier when your bot wins 65% of the last 100 games. Start there unless you have a specific reason to lock to one tier (e.g., you specifically want to drill against Sterling).

## Section 3 — Exploration / decay

### Decay schedule

A radio button: **Exponential / Linear / Cosine**. Controls how ε falls over time.

| Algorithm | Recommended schedule |
|---|---|
| Q-Learning | Exponential |
| SARSA | Exponential |
| Monte Carlo | Linear |
| Policy Gradient | Cosine |
| DQN | Exponential (required for multi-session) |
| AlphaZero | (no epsilon — section hidden) |

The Train tab defaults to the recommended schedule when you pick a skill. Don't override unless you know why.

### Rate (Exponential schedule only)

A number input visible only when schedule = Exponential. The per-episode decay multiplier.

| Rate | Episodes to reach ε=0.05 from ε=1.0 |
|---|---|
| 0.995 | ~590 |
| 0.999 | ~2,990 |
| 0.9995 | ~5,990 |
| 0.9999 | ~29,950 |

Pick a rate that puts ε at the floor around 80% of your total planned episodes across all sessions.

**For Q-Learning's 7,000-episode recipe**: rate 0.995. **For DQN's 35,000-episode recipe**: rate 0.9999.

### Epsilon min

A number input — the floor that ε decays to. Typically 0.05 (5% residual exploration).

Lower this to 0.01 for the final session of a recipe to "harden" the greedy policy. Higher (0.08) for SARSA if you want extra-conservative play.

### Reset ε to 1.0 at start

A checkbox. Controls whether this session starts fully exploratory or continues from the last session's ε state.

| When | Setting |
|---|---|
| Session 1 of a fresh training run | ✓ checked |
| Sessions 2+ | ☐ unchecked |

If you forget to uncheck for session 2, the bot restarts exploration from scratch and effectively wastes the gains of session 1. Always uncheck for continuation sessions.

## Section 4 — DQN-specific fields

When the selected skill uses DQN, four extra fields appear:

### Network architecture

A layer builder. You can configure 1-3 hidden layers, each at 8 / 16 / 32 / 64 / 128 neurons.

| Architecture | Use case |
|---|---|
| `[32]` | Smallest; quick experiments |
| `[64]` | Single-layer baseline |
| `[64, 64]` | **Recommended** — best quality/speed tradeoff |
| `[128, 64]` | Larger; diminishing returns for tic-tac-toe |
| `[128, 128]` | Largest; rarely justified |

**Changing the architecture resets the network's weights.** The Train tab shows an amber warning when this is about to happen. If you're mid-recipe and don't want to lose progress, don't change architecture.

### Gamma (γ)

A dropdown: 0.85 / 0.90 / 0.95 / 0.99.

For tic-tac-toe DQN, **0.95** is the recommended value — plans further ahead than 0.90 without instability. Default is 0.90.

### Batch

A number input — samples per gradient step. Default 32.

Increase to 64 for `[128, 128]` networks (the bigger network can absorb more data per step). Decrease only if browser performance is suffering.

### Replay buffer

A number input — the size of the circular experience memory.

| Total episodes planned | Recommended buffer size |
|---|---|
| ≤ 10,000 | 5,000-10,000 |
| 10,000-20,000 | 10,000-20,000 |
| 20,000-35,000 | 20,000-30,000 |
| 35,000+ | 50,000 |

A buffer **too small** for long runs evicts old experiences before they can be replayed enough — leading to oscillation and forgetting.

### Target update

A number input — steps between target-network syncs. Default 100.

**Don't lower below 50** — too-frequent syncs destabilize the bootstrapped target values. Higher (200, 500) is fine and sometimes more stable.

## Section 4 (alternate) — AlphaZero-specific fields

When the selected skill uses AlphaZero, three extra fields appear instead of the DQN ones. AlphaZero **has no epsilon section** — exploration is built into PUCT.

### Simulations

A number input — MCTS rollouts per move.

| Phase | Simulations |
|---|---|
| Initial sessions | 50 |
| Refinement sessions | 100 |
| Final tuning | 200 |

Doubling Simulations roughly doubles wall-clock time per episode.

### PUCT

A number input — the exploration constant in MCTS. Default 1.5.

| Value | Effect |
|---|---|
| 0.5-1.0 | More exploitation; deterministic late play |
| 1.5 | Balanced (default) |
| 2.0+ | More exploration; useful if the bot gets stuck early |

### Temperature

A number input — controls how the move is sampled from MCTS visit counts.

| Value | Effect |
|---|---|
| 1.0 | Proportional sampling (default early) |
| 0.5 | Slight bias toward most-visited |
| 0.1 | Near-deterministic (use late in training) |

Reduce Temperature in later sessions to sharpen the policy.

## Section 5 (last) — Start training

A single button at the bottom. Disabled if:

- No bot/skill is selected.
- Episodes exceeds your tier's cap.
- A training session is already running (one active job per user).

When you click it:

1. A session ID is created.
2. The session enters the queue (briefly, for neural skills).
3. The live training panel appears below — your charts, your progress bar.
4. You can navigate away — the session keeps running in the background.

The session will notify you on completion (or failure) via the in-app notification stack and (if enabled) push.

## What's NOT in the Train tab

For reference:

- **Learning rate (α)** — hardcoded per algorithm (0.3 tabular, 0.001 neural). Sweepable via Auto-Tuner for tabular only.
- **Update interval** — how often the chart refreshes. In a hidden advanced settings panel; rarely changed.
- **Random seed** — not exposed; training is intentionally non-deterministic across runs.

If you wish you could set any of these, that's the Auto-Tuner's job for hyperparameters or a feature request for the rest.

## Common configurations at a glance

For copy-paste:

**Q-Learning Session 1**:
- Mode: Self-play
- Episodes: 2,000
- Decay: Exponential, Rate 0.995, Epsilon min 0.05
- Reset ε: ✓

**Q-Learning Session 2**:
- Same as above but Episodes 3,000 and **Reset ε unchecked**.

**Q-Learning Session 3 (polish)**:
- Mode: vs Minimax, Curriculum
- Episodes: 2,000
- Decay: Exponential, Rate 0.995, Epsilon min 0.05
- Reset ε: ☐ unchecked

**DQN Session 1 (warmup)**:
- Mode: Self-play
- Episodes: 10,000
- Decay: Exponential, Rate 0.9999, Epsilon min 0.05
- Reset ε: ✓
- Network: `[64, 64]`
- Gamma: 0.95
- Batch: 32, Replay buffer: 10,000, Target update: 100

**AlphaZero Session 1**:
- Mode: Self-play (only option)
- Episodes: 3,000
- Simulations: 50, PUCT: 1.5, Temperature: 1.0

For full session recipes (multi-session arcs), see the per-algorithm docs.

## Field-to-doc map

If you need more depth on any field:

- Bot/skill picker → "Bots — overview"
- Mode, Episodes, Curriculum → "Bot training concepts"
- Decay schedules → "Bot training concepts" (the schedule comparison table)
- Rate, Epsilon min, Reset ε → "Bot training concepts" (epsilon section)
- DQN-specific fields → "DQN" algorithm doc
- AlphaZero-specific fields → "AlphaZero" algorithm doc
- Tier limits → "Activity tiers and ranking"
- Auto-Tuner → "The Auto-Tuner"
