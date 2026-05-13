---
slug: gym-sessions-tab
title: The Sessions tab — version history and rollback
category: training
tags: [sessions, versions, history, rollback, training-job]
status: PUBLISHED
admin_only: false
---

# The Sessions tab — version history and rollback

The Sessions tab is where your training history lives. Every training run you launch in the Train tab shows up here as a record. You can review old runs, compare versions, roll back to a stronger past version, or cancel something stuck. This doc covers every action.

## What you see when you open it

The Sessions tab lists every training run **for the currently-selected skill** (chosen in the sidebar). Each row is one session:

| Version | Algorithm | Mode | Episodes | Started | Duration | Status | ELO change | Action |
|---|---|---|---|---|---|---|---|---|
| v3 | Q-Learning | vs Minimax | 2,000 | 2026-05-10 14:32 | 6 min | COMPLETED | +18 | Use this version |
| v2 | Q-Learning | Self-play | 3,000 | 2026-05-09 10:11 | 8 min | COMPLETED | +12 | Use this version |
| v1 | Q-Learning | Self-play | 2,000 | 2026-05-08 09:45 | 5 min | COMPLETED | +0 | Active |

Rows are sorted newest-first. The active version is marked.

If you have neural training jobs in flight, you'll see rows with **non-completed** statuses:

- **QUEUED** — submitted, waiting for a worker.
- **RUNNING** — actively training; progress bar shown.
- **CANCELLED** — you stopped it.
- **FAILED** — the worker reported an error; click the row for details.
- **PRUNED** — completed but the weights have been deleted because of version-history retention. The record is preserved; the bytes are gone.

## Versions explained

Every **completed** training run becomes a new version of the skill, numbered sequentially. v1 is the first ever completed run; v2 is the second; etc.

The version that's currently "live" — the one the bot uses in real games and benchmarks — is the **active** version. By default, the first-ever completed run becomes active. Subsequent runs land in the list but **don't auto-promote** — you click **Use this version** to swap them in.

Why no auto-promote? Because a fresh training session isn't always better than the previous one. Maybe you tried a new algorithm that didn't pan out. Maybe a curriculum jump destabilized the bot. The decision of "is the new version actually stronger" is yours — usually informed by a benchmark.

## Comparing versions

A few ways:

### Quick — by ELO change column

Each session row shows the **ELO change** estimate — a small projection of how this version would rate vs the previous one based on recent benchmarks. Positive = improvement, negative = regression. Trust this for a quick sniff test; not for high-stakes decisions.

### Best — head-to-head

For real comparison, run **H2H in the Evaluation tab** between two versions:

1. Sessions tab → click **Use this version** on v2.
2. Evaluation tab → H2H → bot A is your bot (now running v2), bot B is your bot again.

Wait — both can't be the same. The trick: bot A is your bot (v2 active), bot B is a *different* bot you've cloned to hold v3. Or use the Compare versions action below.

### Built-in — Compare versions action

Some skills support a **Compare** action right in the Sessions tab. Select two version rows and click **Compare**. The platform briefly swaps each version in, runs a benchmark on each, and shows you a side-by-side. This is the most ergonomic comparison flow when available.

## Rolling back

If you trained v3 and it benchmarks worse than v2:

1. Sessions tab → row for v2 → **Use this version**.
2. Optionally: archive v3 by un-pinning it (it stays in history but won't show in the active flag).

The bot now plays v2 in all matches. v3 isn't deleted — it's still in your history; you can swap back any time.

If you really want to remove v3 from history entirely, click the row's **delete** affordance. This is irreversible and removes the weights immediately (skipping the normal pruning).

## Cancelling a running session

If a neural training job is stuck or you realize you misconfigured something:

1. Sessions tab → row with status RUNNING → **Cancel** button.
2. The status flips to CANCELLED within a few seconds.
3. Your bot's existing weights are unaffected (cancellation discards the partial run, not prior versions).

You can cancel anytime — the platform handles partial state cleanly. Don't be afraid to abort a bad run early.

## Failed sessions

A FAILED row means the worker reported an error. Click the row to see:

- **Error reason** — a short string (e.g., "out of memory", "config validation", "worker timeout").
- **Last log lines** — useful for diagnosis or for the Feedback report.
- **Suggested fix** — sometimes the platform suggests reducing batch size or episode count.

A FAILED session doesn't affect your active version. Submit a fresh session with adjusted settings.

## Pruning — when versions disappear

Your platform stores up to **5 completed versions per skill** by default (admin-tunable in SystemConfig as `gym.versions.retention`). When you exceed this:

- The oldest **non-active** version is marked PRUNED.
- The weights are deleted from storage; the record is kept for history.
- A PRUNED version's row shows **(weights deleted)** in place of the "Use this version" action.

The currently-active version is **never pruned**. So your latest active version is always safe.

To avoid losing a version you care about, **export it** (Export tab) before it's pruned. Export downloads the weights as a JSON file you can keep locally.

## Reading session metadata

Each row's metadata tells you what configuration produced this version:

- **Algorithm** — Q-Learning, SARSA, etc. (cross-check: every version of a skill should have the same algorithm; if not, something's off).
- **Mode** — Self-play, vs Minimax, Alternating. Shows what setup produced this version.
- **Episodes** — total episode count for that single session.
- **Hyperparameters** — click the row to expand: shows Rate, Epsilon min, gamma, network architecture, etc., as they were configured for that run.

When you're trying to remember "what worked", these metadata fields are the answer. They're why hyperparameter sweeps and Auto-Tuner runs feed into informed decisions — you have a record of what was tried.

## Typical workflows

### Just finished a session — what now?

1. Watch the row appear with COMPLETED status.
2. Click into it; quickly scan the ELO change estimate.
3. If positive — open the Evaluation tab and run a benchmark to confirm.
4. If the benchmark looks good — promote via **Use this version** (if not already active).
5. If the benchmark is worse than expected — roll back, then troubleshoot.

### Just realized v3 is weaker than v2

1. Sessions tab → v2 row → **Use this version**.
2. Re-benchmark to confirm v2 is now active.
3. (Optionally) Delete v3 if you don't want it cluttering the list.

### I want to compare three versions

1. Run benchmarks on v1, v2, v3 in turn (using **Use this version** between each).
2. Compare the resulting numbers side by side.
3. Or pair-wise H2H if you have the patience.

The platform doesn't yet support a three-way compare in one action — for now it's manual.

### A session is stuck in RUNNING

1. Cancel it from the Sessions tab.
2. Check if the platform is generally OK (the Health page in admin shows infra status).
3. Submit a new session with the same config.

If multiple sessions in a row fail or stick, file a Feedback report — there may be a worker issue.

## What's NOT in the Sessions tab

For reference:

- **Live training charts** — those are in the Train tab during a running session.
- **Per-tier benchmark history** — that's in Analytics or Evaluation.
- **Bot ELO trajectory** — bot profile, not skill-specific. Sessions tab shows ELO change per session but not the full ELO history.
- **Real-game performance** — the bot's ladder games show up in the bot profile's game list, not here.

The Sessions tab is **training-run focused**: configuration in, weights out.

## Quick reference

- **Active** version is what the bot uses today.
- **Use this version** swaps a row in as active.
- **Cancel** stops a RUNNING job; weights from before are safe.
- **PRUNED** = bytes gone; record stays. Export before pruning if you care.
- **FAILED** = worker error; submit fresh, weights unaffected.
- 5 versions retained per skill by default; admin-tunable.
- Compare versions via H2H (Evaluation tab) or the in-row Compare action where available.
