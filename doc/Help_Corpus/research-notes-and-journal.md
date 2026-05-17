---
slug: research-notes-and-journal
title: Research notes — what they are, how to write them, how to use them to tune your bot
category: research-log
tags: [research-log, journal, training, hyperparameters, tuning, notes, entries, workflow]
status: PUBLISHED
admin_only: false
---

# Research notes

The **research log** is your in-platform notebook for everything you do while
training bots: what you tried, what you observed, what worked, what didn't, and
what you'll try next. It lives in your Profile under **Training Journal**, and
this page is the one-stop guide to using it well.

This doc is long on purpose — it covers the basics ("what is this thing?") all
the way through advanced workflow ("how should I structure my notes so future-me
can tune the bot from them?"). Skim the headings; jump in at whatever level you
need.

## What are research notes?

A **note** is a short free-form journal entry attached to a single training
**session** (one run of your bot through a batch of episodes). You write the
note when something is worth remembering — a surprising metric, a parameter
change that helped, a confusing regression. The note carries:

- A **body** (1–2 KB of free text — Markdown welcome).
- An **outcome** label: `SUCCESS`, `PLATEAU`, `REGRESSION`, or `INCONCLUSIVE`.
- A list of **tags** (free-form, lowercase, underscores). Examples: `lr`,
  `gamma`, `epsilon_decay`, `plateau`, `breakthrough`, `reward_shaping`.
- A timestamp.

Notes are **per-session**: when you open a training session in the Gym, the
session detail panel has a "Notes" drawer where you can add, edit, and delete
notes tied to that specific run.

## What is the difference between notes and entries?

The Training Journal has two flavors of writing:

1. **Notes** — tied to a specific training session. The session id is stamped
   onto the note so you can always navigate back to the run that produced it.
   Outcome label (`SUCCESS`/`PLATEAU`/...) is required.
2. **Entries** — free-form, *not* tied to any session. Use these for higher-
   level planning, retrospectives, observations, or anything else. Required
   fields: a **title** (≤ 120 chars), a **body** (≤ 4 KB), and a **category**
   (`PLANNING` / `RETROSPECTIVE` / `OBSERVATION` / `OTHER`).

Rule of thumb: if you're writing because of something a specific session did,
use a **note**. If you're writing because of a broader thought ("here's my plan
for the week", "what I learned across three Q-learning sessions", "I should try
DQN next"), use an **entry**.

## Where do I find my journal?

- **Profile → Training Journal**. This is the home base — three sub-tabs: *My
  notes*, *My entries*, *Community*. Each sub-tab has a list view, inline
  filters, and the appropriate composer.
- **Per-session notes drawer**. Inside the Gym, when you click into a specific
  training session, there's a "Notes" panel attached to that session — same
  notes you see in the Profile, just filtered to that one session.
- **Markdown export**. The Training Journal header has an "Export .md" button
  that downloads everything (notes + entries, interleaved reverse-chronologically)
  as a single `.md` file with YAML frontmatter per item.

## How do outcomes work?

The four outcome labels on notes are the lightweight signal that makes a long
journal searchable later. Use them honestly — they're for *future-you*.

- **`SUCCESS`** — the change you made improved the bot's learning. Win-rate up,
  loss down, episode-length toward the target, whatever you were tracking. Even
  modest wins count.
- **`PLATEAU`** — the bot stopped improving. Loss flattened, win-rate flattened,
  metrics oscillating without trending. This is the most important label for
  future-you because plateaus are where you make the biggest decisions
  (continue? change hyperparams? switch algorithm?).
- **`REGRESSION`** — the bot got *worse*. Sometimes this is informative
  ("dropping epsilon too fast killed exploration") and sometimes it's a fluke.
  Write down which you think it is.
- **`INCONCLUSIVE`** — you ran something but the signal was too noisy or the
  run was too short to call. Be honest about this — labelling weak signal as
  `SUCCESS` poisons your filter searches later.

When you filter the journal by outcome later, you're filtering for the *shape*
of past learning, not for specific metrics.

## How detailed should a note be?

Short answer: **enough that future-you (a week later, a month later) can
reproduce or judge the run from the note alone**. That usually means three
things:

1. **What changed.** What did you do differently from the prior run? "Dropped
   lr from 3e-4 to 1e-4." "Switched from epsilon-greedy to Boltzmann." "Added
   reward shaping for board-center moves." If nothing changed, say so — that's
   also useful ("same config, different seed").
2. **What you observed.** "Win-rate climbed 18% → 27% over 5k episodes then
   plateaued." Numbers help. Time-to-plateau helps. Episode counts help. You
   don't need to copy the metrics page — those are already saved by the
   platform — but a one-line summary of the *shape* of the curve makes the
   note actionable.
3. **What you'll try next.** "Going to keep lr at 1e-4 and bump gamma from 0.95
   to 0.99." "Want to retry this with a longer epsilon decay." "Probably need
   a different algorithm." This is the most-skipped field and the most useful
   when you come back after a break.

**Things you do not need to include:**

- The full hyperparameter set. The platform records that on the
  `TrainingSession` row; you can always click back to the session to see it.
- Per-episode loss values. Charts are persisted.
- Your bot's name / id. The note is attached to the session, which is attached
  to the bot.

**Length sweet spot:** ~150–500 characters. Long enough to capture the *why*,
short enough that you'll actually write one every run.

## Examples — good notes vs noisy notes

A **good** note:

> Switched ε-decay from 0.999 to 0.9995 (slower decay). Win-rate climbed
> 22% → 31% over 6k episodes, still climbing at end-of-run. Plateau from
> last run was clearly an exploration starvation issue. Next: keep this
> decay, try gamma 0.95 → 0.99 to see if longer horizon helps.
>
> **outcome:** SUCCESS · **tags:** epsilon_decay, exploration, breakthrough

A **noisy** note:

> tried stuff didn't really work, will look again later
>
> **outcome:** INCONCLUSIVE · **tags:** (none)

The noisy version is honest but useless to future-you. If you can't write a
two-sentence summary right now, that itself is a signal — either the run was
genuinely inconclusive (in which case write one line saying *why*, e.g. "loss
curve is too noisy to read at this batch size") or you haven't actually looked
at the results yet.

## What about tags? How should I use them?

Tags are free-form labels that you write in the composer (comma-separated).
They get normalized: lowercased, hyphens become underscores. So `Q-Learning`,
`q_learning`, `q-learning` all become `q_learning`. Max 10 tags per note, each
≤ 32 characters.

**The point of tags** is filtering: "show me every `PLATEAU` note tagged
`epsilon_decay`." This works once you have a small, *consistent* tag vocabulary.

**A working tag vocabulary for a single user:**

- **Hyperparameter tags**: `lr`, `gamma`, `epsilon`, `epsilon_decay`,
  `batch_size`, `replay_buffer`.
- **Pattern tags**: `plateau`, `breakthrough`, `regression`, `instability`,
  `noisy`.
- **Topic tags**: `reward_shaping`, `exploration`, `exploitation`,
  `discount`, `convergence`.
- **Algorithm tags** (if you train multiple): `q_learning`, `sarsa`, `dqn`,
  `policy_gradient`, `alpha_zero`.

You'll know your tag vocab is working when filtering by one tag returns 3–15
notes that all feel related. If it returns 50, your tag is too generic; if it
returns 1, your tag is too specific.

## How do I use the journal to actually tune my bot?

This is where the journal pays for itself. A few concrete workflows:

### Workflow 1 — "I hit a plateau again. Has past-me solved this before?"

1. Open Profile → Training Journal → My notes.
2. Filter outcome = `PLATEAU` and add the relevant tag (e.g. `epsilon_decay`).
3. Read the 3–10 results: was there a parameter change that unstuck you last
   time? A different algorithm you eventually switched to?
4. The notes' "what you'll try next" lines are your candidate moves.

### Workflow 2 — "What worked last time I trained Q-learning on XO?"

1. Filter outcome = `SUCCESS` + tag = `q_learning`.
2. Walk the most recent 5–10 successes. The pattern across them — what they
   share — is your bot-tuning playbook.
3. Pull the hyperparameters from the linked sessions (one click per note).

### Workflow 3 — "I'm coming back after a two-week break, what was I doing?"

1. Sort the journal by most-recent. Read the last 3–5 notes.
2. Look for the last `PLATEAU` or `INCONCLUSIVE` — that's almost certainly the
   spot you got stuck and stopped.
3. The note's "what you'll try next" tells you the move; the linked session
   tells you the config to start from.

### Workflow 4 — "Plan a multi-session experiment"

1. Open the Profile → Training Journal → My entries.
2. Add an entry with category `PLANNING`, title "Compare gamma 0.95 vs 0.99
   for SARSA", and a body listing the runs you're going to do.
3. Tag it with `planning`, `gamma`, `sarsa`.
4. After each session, write the *session note* — and at the end of the
   experiment, write a `RETROSPECTIVE` entry that links the planning entry.

### Workflow 5 — "Let the Guide help"

The Guide can read your private notes when you flip the **"Share with Guide"**
toggle at the top of the Training Journal. With it on, asking the Guide
something like *"I'm hitting a plateau on Q-learning, what should I try?"*
includes the relevant past notes as context — the Guide can then say things
like *"You wrote on May 3 that slowing ε-decay unstuck a similar plateau —
worth trying again."* See `community-notes` for the privacy details.

## What do I see when I read someone else's note?

The **Community** sub-tab shows notes other users have explicitly *published*.
You'll see:

- The note **title** (auto-derived from the first line) or entry **title**.
- The **body**, after the PII scrubber redacted any emails / phones / IPs /
  street addresses / credit-card-shaped numbers.
- The **author**'s display name, the **category**, and the **tags**.

Use the same outcome + tag vocabulary to find community notes — they're
indexed the same way. The author's notes were written for their own
future-them, not for you, so they may need translation; but plateau patterns
and hyperparameter intuitions transfer surprisingly well across users on the
same algorithm.

If a community note seems to nail a tuning question you're having, click the
author's display name to see what else they've published.

## How do I publish my own notes?

From the Training Journal, every note row has a **"Publish…"** button. It
opens a side-by-side preview: original on the left, scrubbed version (what
others will see) on the right. After you confirm, the note is mirrored as a
community-readable doc and the button flips to **"Unpublish"** — click that
any time to retract.

Detailed mechanics (PII scrubber, rate limits, what stays private) are
covered in the `community-notes` Guide page.

## Can I export my notes?

Yes. The Training Journal header has an **"Export .md"** button that downloads
your entire log (notes + entries, reverse-chronological) as a single Markdown
file with YAML frontmatter per item. Useful for:

- Offline backup ("my journal but on disk").
- Sharing a curated subset (you can edit the file before sending it).
- Migrating to an external notebook if you outgrow the in-platform tool.

## Privacy at a glance

- **Notes and entries are private by default.** Nobody else can read them.
- **The Guide cannot read them** unless you turn on "Share with Guide".
- **Publishing is opt-in per note/entry** — never automatic. The preview modal
  shows you exactly what would be visible.
- **Unpublishing is immediate** — the community doc is deleted; the Guide can
  no longer cite it.

## See also

- **`community-notes`** — what gets shared when you publish, how the lanes
  work, the rate limit, and the privacy contract in detail.
- **`gym-sessions-tab`** — the per-session notes drawer where you write
  session-attached notes.
- **`bot-training-concepts`** — terms and ideas that show up in note bodies
  (plateau, exploration vs exploitation, reward shaping, etc.) explained
  alongside the algorithms.
