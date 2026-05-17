---
slug: research-log
title: Research Log — your training journal
category: training
tags: [research-log, gym, sessions, notes, journal, training]
status: PUBLISHED
admin_only: false
---

# Research Log — your training journal

The **Research Log** lets you attach notes to a training session in the Gym. Capture what you tried, what worked, what didn't, and the hyperparameters you suspect mattered — so when you come back next week and benchmark drops, you can scan a month of your own reasoning instead of starting from scratch.

Sprint 1 (live today) covers **per-session notes**: write, edit, delete, all scoped to sessions you own. Sprint 2 adds a Profile-level journal, ad-hoc entries, and an opt-in publish flow so you can share insights with the community. Sprint 3 lets the in-platform Guide cite your notes when answering training questions.

## Where it lives

1. Sign in and go to **/gym**.
2. Pick a model in the left rail that has at least one training session.
3. Click the **Sessions** tab.
4. Click a session row — the **selected session detail panel** appears below the list.
5. Under the stat grid, expand **📔 Research notes**.

The drawer is collapsed by default to keep the panel compact. The number after the title is the count of notes already on that session.

## Anatomy of a note

Every note has three fields:

- **Body** — free-form text up to 2 KB. Markdown-ish prose; rendered as plain text in Sprint 1 (markdown rendering arrives in Sprint 2's Profile journal).
- **Outcome** — one of `Success`, `Plateau`, `Regression`, `Inconclusive`. Picking honestly here matters: when the platform mines your notes later to improve advice, the outcome label is the signal that ties prose to result.
- **Tags** — comma-separated, free-form. They're normalized to lower-snake-case + deduped, so `LR, lr, Learning_Rate` collapses to `lr, learning_rate`. Cap is 10 tags per note, 32 chars each.

The drawer also stamps `createdAt` and the author (always you in Sprint 1).

## Add, edit, delete

- **Add note** — type a body, pick an outcome, add tags, click **+ Add note**. The note appears at the top of the list immediately (optimistic UI); if the server rejects the call, the row disappears and the error surfaces in the drawer.
- **Edit** — click **Edit** on any row. Inline form lets you change body / outcome / tags. **Save** writes it back; **Cancel** discards.
- **Delete** — click **Delete**. The row disappears immediately. If the server fails the delete, the row comes back and an error message appears.

Notes are private to you. Other users — including the bot's opponents — cannot see them.

## Sort order

Newest-first by default. Click **Newest first ↓** in the drawer header to flip to oldest-first; click again to flip back. The toggle is per-tab (it doesn't persist across reloads), which matches the typical use of "show me what I just wrote" vs "let me re-read the history of this experiment."

## What outcome should I pick?

Think about it in terms of the session you just ran, not the bot's lifetime:

- **Success** — benchmark went up, win-rate against a fixed opponent improved, or the bot started doing the thing you were trying to teach it.
- **Plateau** — nothing got worse, but nothing got better either. Useful signal: it tells future-you "this config converged; further training with these knobs is wasted compute."
- **Regression** — benchmark dropped or the bot got more exploitable. Pair this with the hyperparameters you suspect caused it.
- **Inconclusive** — couldn't tell. Common when episode count is too low or evaluation variance is too high. Write down what you'd need next time to make it conclusive.

## Tagging suggestions

Tags are how you'll find related notes a month from now. A few patterns that tend to age well:

- **Algorithm**: `q_learning`, `sarsa`, `dqn`, `monte_carlo`, `policy_gradient`, `alphazero`
- **Hyperparameter under test**: `lr` (learning rate), `gamma`, `epsilon`, `epsilon_decay`, `hidden_layers`, `mcts_sims`
- **Opponent**: `vs_random`, `vs_easy`, `vs_medium`, `vs_self`, `vs_human`
- **Outcome flavor**: `breakthrough`, `regression`, `lucky_seed`, `eval_noise`

Don't over-engineer the taxonomy in Sprint 1 — there's no community tag autocomplete yet. Just pick what's useful to *you*.

## Privacy

- Notes are stored on the platform tied to your user ID.
- Sprint 1 has **no publish path** — the publish UI does not appear yet.
- When Sprint 2 ships, publishing is opt-in per note, runs a PII scrubber over your text, and shows a side-by-side preview before anything leaves your account.
- A "share with Guide" preference (default ON) controls whether the in-platform Guide can cite your private notes when answering training questions you ask. This only matters once Sprint 3 ships.

## When to write a note

The best time is **right after the session finishes**, while your reasoning is still loaded in your head — "I bumped epsilon decay from 0.999 to 0.995 because the bot was over-exploiting in the late game." Five minutes later you'll lose the *why* and only the *what* will be left in your head.

If you only have time for one field, write the body. Outcome can be flipped later when the next benchmark lands.

## Limits

- Body: 2 KB per note (roughly 400 words). For longer write-ups, Sprint 2 ad-hoc entries will allow 4 KB.
- Tags: 10 per note, 32 chars each, lower-snake after normalization.
- Notes per session: no fixed limit.
- Edits: no version history yet — editing overwrites in place.

## What's coming

| Sprint | What you'll get |
|---|---|
| **Sprint 2** | Profile → Training journal tab with filters by algorithm / outcome / tag / date. Ad-hoc entries not tied to a specific session (planning posts, retrospectives, observations). Opt-in publish-to-community flow with PII scrubber + side-by-side preview. Markdown rendering. One-shot `.md` export of your full journal. |
| **Sprint 3** | The in-platform Guide can cite your own notes when answering training questions, and (if you've published any) other users' published notes. Citations show source badges so you can tell curated docs from your journal from community insights. |

For the full plan, see `doc/Research_Log_Plan.md` in the repo.
