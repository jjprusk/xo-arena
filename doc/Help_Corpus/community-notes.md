---
slug: community-notes
title: Community notes — how published research-log entries appear in Guide answers
category: research-log
tags: [research-log, community, privacy, citations]
status: PUBLISHED
admin_only: false
---

# Community notes

When you publish a note or entry from your **Training Journal** (Profile → Training
Journal → Publish), it joins the **community notes** lane of the Guide's retrieval
pipeline. That means the Guide can cite your published note when answering another
user's question — and you can read other users' published notes from the
**Community** sub-tab.

This page is a one-pager on what gets shared, what stays private, and how the
citations work.

## What gets shared when you publish

- **The body of the note or entry**, after the **PII scrubber** redacts emails,
  phone numbers, IP addresses, US-style street addresses, and credit-card-shaped
  digit runs. The publish confirmation modal shows a side-by-side preview so you
  can spot anything else (especially personal names — the scrubber does not
  attempt to detect those automatically).
- **Your display name**, attached as the author byline on the citation chip and on
  the Community sub-tab.
- **The category** (for entries) or **outcome** (for notes), and your tags.

## What stays private

- **Anything you do not publish.** Private journal entries and notes stay yours
  alone unless you explicitly hit Publish.
- **Your session details** — the bot you were training, the hyperparameters
  recorded by the platform, the metrics. Only the free-text body of the note
  travels.
- **Anything the modal flagged as redacted** — the published copy uses the
  scrubbed text, not the original.

## How the citations work

When the Guide answers your question it consults three **lanes** of content:

1. **Curated Guide** (`📘 Guide`) — the hand-written corpus in `/doc/Help_Corpus`.
2. **Community notes** (`🌐 Community`) — what other users have published.
3. **Your own notes** (`🔒 Your note`) — your private journal, only when you
   have **Share with Guide** turned ON in the Training Journal header.

Each lane has its own per-query budget (configurable by admins via
`SystemConfig.help.lanes.*`; defaults: corpus 4, community 2, private 2). The
top-scoring chunks from each lane are merged into the prompt the Guide sees, and
their source docs appear as **citation chips** under the answer. Click a chip to
jump to the source — either the Guide page, your journal, or the community feed.

## Unpublishing

You can unpublish a note or entry at any time from your Training Journal. The
linked community doc and its retrieval chunks are deleted; the Guide will not be
able to cite it in future answers. (Answers already streamed before the unpublish
are not rewritten — they live on in the user's local thread.)

## Rate limit

To keep the community lane signal-rich, each user can publish at most **50 notes
or entries per rolling 7-day window**. Unpublishing is unlimited. If you hit the
limit the modal surfaces a friendly "weekly publish limit reached" message; try
again later.

## See also

- **Training Journal** (Profile → Training Journal) — the surface that lets you
  write, publish, browse, and export.
- **Settings → Share notes with Guide** — the toggle that opts your *private*
  notes into the Guide's retrieval lane. Off by default.
