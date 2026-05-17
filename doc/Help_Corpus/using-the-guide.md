---
slug: using-the-guide
title: Using the Help Guide — what it can answer, what it can't, and how navigation works
category: basics
tags: [help, guide, navigation, capabilities, faq, take-me-to]
status: PUBLISHED
admin_only: false
---

# Using the Help Guide

The Help Guide is the chat panel that opens from the question-mark button in
the bottom corner of any page. It answers questions about AI Arena: how
features work, how to train bots, what an algorithm does, where to find
something, what a setting means.

This page is the meta-doc — what the Guide can do, what it can't, and how to
get the most out of it.

## What the Guide can answer

The Guide is grounded in the documentation that ships with AI Arena (the
`/doc/Help_Corpus/` set), plus your own private notes and the community-
published notes if you've opted in. It does well on questions like:

- **"How do I..."** — e.g. *"How do I train a Q-learning bot?"* The Guide
  walks you through the steps from the relevant corpus doc.
- **"What is..."** — e.g. *"What is epsilon decay?"* The Guide explains the
  concept and links to the deeper doc.
- **"Why is..."** — e.g. *"Why is my bot plateauing?"* The Guide pulls from
  troubleshooting docs and (if you've opted in) your own past plateau notes.
- **"Where is..."** — e.g. *"Where are my bots?"* The Guide tells you the
  exact page path (*Profile → My Bots*) and links to it where possible.
- **"What's the recipe for..."** — e.g. *"What's the recipe for training an
  AlphaZero bot?"* The Guide quotes the recommended session plan from the
  algorithm doc.

## What the Guide can't do

The Guide is a **question answerer**, not a navigator, an action executor, or
a real-time assistant. Specifically:

- **"Take me to page X"** — the Guide can tell you *where* a page lives and
  give you a clickable link in the answer, but it can't actually navigate the
  browser for you. To go somewhere, click the link in the Guide's reply, use
  the top nav, or type the URL.
- **"Do X for me"** — the Guide can't create bots, start training runs,
  publish notes, or change settings on your behalf. It can walk you through
  the steps; you click the buttons.
- **"What's happening right now"** — the Guide doesn't have live access to
  your current session's metrics, your queue position, or anything in flight.
  For real-time data, use the in-page panels.
- **General-purpose chitchat or topics outside AI Arena** — the Guide
  politely declines questions unrelated to the platform.

## How to ask good questions

Two tips that meaningfully improve answers:

1. **Use platform vocabulary when you have it.** "Train my bot" beats "make
   my computer play better" because the corpus uses the former. If you're
   not sure of the term, ask a definitional question first (*"what's a
   training session?"*) and then ask your real question.
2. **Be specific about what you want.** *"How do I train a Q-learning bot?"*
   gets a clearer answer than *"how do I train"* because the corpus has
   per-algorithm and general docs both — the algorithm token disambiguates.

If a first answer misses the mark, try rephrasing. Word choice matters more
than question length: a five-word query with the right nouns beats a
fifty-word query with vague pronouns.

## Where to navigate when the Guide points you somewhere

When the Guide says something like "go to **Profile → Training Journal**" or
"open the **Gym** tab," here's where those live in the nav:

- **Top nav (logged in)**: Play · Gym · Tournaments · Rankings · Profile.
- **Top nav (admin)**: + Admin dropdown.
- **Profile** has its own accordion sections: Stats, Credits, Merits, My Bots,
  Training Journal, etc. Each section is deep-linkable
  (`/profile?section=journal`).
- **Gym** has tabs: Train · Sessions · Checkpoints · Evaluation · Analytics
  · Explainability · Rules · Export.

If you can't find a page the Guide referenced, check the spelling of the path
in the Guide's reply (it tries to match the exact label that appears in the
nav) — and if the page genuinely doesn't exist, that's a documentation bug
worth filing via the Feedback button at the bottom of the Guide panel.

## When the Guide doesn't have an answer

You'll occasionally see one of two short responses:

- **"I don't have that in the docs yet…"** — the corpus doesn't cover the
  question well enough for the Guide to answer responsibly. Try rephrasing
  with different keywords, browse the corpus from the **Help** index, or use
  the Feedback button to flag the gap.
- **"I can only help you with AI Arena questions…"** — the question landed
  outside the platform's scope (e.g. general programming, current events,
  another tool). The Guide stays narrow on purpose; trying related on-platform
  framing ("how does AI Arena handle X" vs "what is X in general") usually
  surfaces relevant content.

Both responses are deliberate — better a clean no than a confidently wrong
yes.

## See also

- **`getting-started`** — the three-step path for new users.
- **`intelligent-guide`** — the seven-step learning journey (different
  feature; the Journey lives in the Guide drawer too but is curriculum, not
  Q&A).
- **`research-notes-and-journal`** — the Training Journal and how the
  Guide uses your notes when you opt in.
