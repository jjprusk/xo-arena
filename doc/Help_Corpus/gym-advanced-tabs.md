---
slug: gym-advanced-tabs
title: Gym advanced tabs — Checkpoints, Export, Rules
category: training
tags: [checkpoints, export, rules, advanced, gym]
status: PUBLISHED
admin_only: false
---

# Gym advanced tabs — Checkpoints, Export, Rules

The Gym's Train / Sessions / Evaluation / Explainability tabs cover most users' workflows. Three more tabs handle advanced scenarios: **Checkpoints** for mid-training rollback, **Export** for taking your model offline, and **Rules** for fallback policies. This doc covers all three.

## Checkpoints — mid-training snapshots

A **checkpoint** is a snapshot of a skill's weights saved **during** training. Different from a version, which is the end state of a completed session.

### Why mid-training snapshots matter

A long training run can degrade. The bot might learn well for the first 10,000 episodes, then a curriculum jump destabilizes it for the next 5,000 episodes, then it recovers — or doesn't. Without checkpoints, your only option after a degraded run is to start over.

With checkpoints, you can roll back to the state at episode 10,000 (when things were going well) and continue from there with adjusted settings.

### How checkpoints are created

Every training session writes a checkpoint at regular intervals (every 1,000 episodes by default; admin-tunable in SystemConfig as `gym.checkpoint.intervalEpisodes`). The checkpoints accumulate during the session; when the session completes, the final state becomes the new **version**.

So a 10,000-episode session typically produces ~10 checkpoints plus the final version.

### Using the Checkpoints tab

1. Sidebar → pick a skill.
2. Checkpoints tab → see a list of all checkpoints for this skill across all sessions:

| Session | Checkpoint episode | Recent win rate | Action |
|---|---|---|---|
| v3 | 9,000 | 71% | Restore |
| v3 | 8,000 | 68% | Restore |
| v3 | 7,000 | 64% | Restore |
| v3 | 6,000 | 58% | Restore |

3. **Restore** swaps the skill's weights to the chosen checkpoint state. The bot now plays as if training had stopped at that moment.

### When to restore a checkpoint

- **A long session destabilized the bot late.** Restore to before the destabilization, then start a new session with different settings.
- **You want to experiment.** Restore, run a 1,000-episode test session with new hyperparameters, see if it helps. If yes, keep going; if no, restore again and try something else.
- **You changed your mind about which session was best.** Maybe session v3 was supposed to polish v2 but actually weakened it — restore to v2's final checkpoint.

### Checkpoint retention

Checkpoints are kept for the **lifetime of the version** they belong to. When a version is pruned (because of version-history retention limits), its checkpoints are pruned too.

You can't manually delete a checkpoint without deleting the parent version. If you want a specific checkpoint kept long-term, the path is: restore it to active state, complete a training session (which makes it the basis of a new version), and that new version is then retained per normal rules.

## Export — take your model offline

The **Export** tab lets you download the weights and configuration of a trained skill as a single file (JSON for tabular, JSON+binary for neural). Useful for:

- **Backup** — keep a copy in case your version is pruned.
- **Offline analysis** — load the weights into your own scripts to inspect.
- **Sharing** — give the file to someone else (note: they can't directly import it into AI Arena yet, but they can analyze it externally).
- **Pre-export before delete** — if you're about to remove a version, export it first.

### How to export

1. Sidebar → pick a skill and a version.
2. Export tab → see the export options:
   - **Format**: JSON (default), CSV (tabular only, Q-tables), Numpy (binary, neural only)
   - **Include hyperparameters**: ✓ — adds the session config to the export.
   - **Include training metadata**: ✓ — adds the session's episode count, mode, ELO change.
3. Click **Export**. A file downloads to your machine.

### Export file structure

The JSON export looks roughly like:

```json
{
  "skill": "user_abc:xo:q-learning:v3",
  "algorithm": "q-learning",
  "game": "xo",
  "version": 3,
  "weights": { /* algorithm-specific */ },
  "hyperparameters": {
    "alpha": 0.3,
    "gamma": 0.9,
    "epsilon_min": 0.05,
    "decay_schedule": "exponential",
    "decay_rate": 0.995
  },
  "training_metadata": {
    "total_episodes": 7000,
    "modes": ["self-play", "self-play", "vs-minimax-curriculum"],
    "completion_date": "2026-05-10T14:32:00Z",
    "benchmark_elo": 1287
  }
}
```

For Q-Learning, `weights` is the Q-table as a `{ state_string: { action: q_value } }` map. For DQN, it's the network architecture and weight tensors. For AlphaZero, it's both networks' weights plus configuration.

### Importing weights back

**Not supported in v1.** Once exported, the file is for offline use only. You can't drag-and-drop it back to update a skill. If you want to "transfer" weights between contexts (e.g., from your account to a teammate's), the platform's design assumption is that each user trains their own bots.

A future feature may add re-import; for now, treat exports as one-way archives.

## Rules — fallback policies

The **Rules** tab manages **rule-based fallback policies** that a skill consults when its learned policy is uncertain. This is an advanced, optional feature.

### What a rule-based fallback is

A skill's learned values (Q-values or policy probabilities) sometimes have **near-ties** — two or more moves with very similar estimates. The learned policy has no strong preference. Without a rule, the skill defaults to the first move (or breaks ties randomly).

A **rule** is a small, hand-coded heuristic that fires in specific situations:

- "If the opponent has two-in-a-row, always block."
- "If I have two-in-a-row, always complete."
- "If center is empty, prefer center."

When the learned policy is uncertain, the skill checks active rules in order and picks the rule's recommendation.

### When to use rules

For most users: **never**. The default rules are sensible (win-if-you-can, block-if-you-must, prefer-center) and the learned policy is usually good enough to dominate.

The Rules tab becomes useful when:

- **You want to enforce a specific opening style** — e.g., always play corners as X.
- **Your bot consistently fails on a known pattern** — e.g., it doesn't block forks; you can add a fork-blocking rule.
- **You're studying RL** — adding/removing rules helps you see what the learned policy already knows.

### How to configure rules

1. Sidebar → pick a skill.
2. Rules tab → see the list of rules in priority order. Default rules are at the top, marked **system**.
3. Toggle individual rules on/off, or reorder them. Higher-priority rules fire first.
4. Click **+ Add rule** to write a new one (UI-driven; you don't write code).

Available rule conditions (for tic-tac-toe):

- **I-can-win** — fires if any move completes three-in-a-row.
- **Block-opponent-win** — fires if the opponent has two-in-a-row.
- **Create-fork** — fires if a move creates two simultaneous threats.
- **Block-fork** — fires if the opponent can create a fork next.
- **Center-empty** — fires if cell 5 is open.
- **Opposite-corner** — fires if the opponent is on a corner and the diagonal opposite is open.

Each rule produces a recommended action; the skill picks the highest-priority rule whose condition fires.

### When rules apply

Rules apply **only when learned-policy uncertainty exceeds a threshold** (admin-tunable in SystemConfig as `gym.rules.uncertaintyThreshold`, default 0.05). A confident learned policy never consults rules; only ambiguous positions do.

This means rules don't override a well-trained bot's learned strategy. They fill gaps where the learned policy is shaky.

### Rules and benchmarking

Benchmark scores include rule-driven decisions. A skill with active rules might benchmark slightly higher than its bare learned policy would — because rules cleanly handle the cases learned policy fumbles.

For a true "raw learned policy" benchmark, disable all rules temporarily and re-run the benchmark.

### Default rules

Every skill ships with three default rules (priority order):

1. **I-can-win**
2. **Block-opponent-win**
3. **Block-fork**

These three implement the "do-no-harm" baseline. Beyond these, the learned policy makes the calls.

## Quick reference

- **Checkpoints** = mid-training snapshots, useful for rolling back within a session. Lifetime = parent version's lifetime.
- **Export** = JSON dump of weights + hyperparameters + metadata. One-way (no import).
- **Rules** = fallback heuristics for ambiguous learned-policy decisions. Most users leave defaults. Three default rules cover the basics.

## When you might never need these tabs

If your training runs go well, you're not interested in offline analysis, and you trust the default rules — you can ignore Checkpoints, Export, and Rules entirely. The Train + Sessions + Evaluation + Explainability tabs cover ~95% of users.

These three tabs are for the 5% who want more control or are doing serious bot R&D.
