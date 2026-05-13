---
slug: admin-help-runbook
title: Admin runbook — Guide, SystemConfig, and journey ops
category: admin
tags: [admin, runbook, system-config, journey, debugging]
status: PUBLISHED
admin_only: true
---

# Admin runbook — Guide, SystemConfig, and journey ops

This doc is for **HELP_ADMIN** and **ADMIN** users. It covers the platform knobs that change user behavior, where to look when journey metrics dip, and the SystemConfig keys that most often need tuning.

If you're a regular user, skip this — nothing here affects how you play.

## Where to look

| Surface | URL | What it does |
|---|---|---|
| Admin dashboard | `/admin` | Platform stats overview |
| Journey metrics | `/admin/guide-metrics` | 7-step funnel, North Star metric, signup split, cohort granularity |
| SystemConfig editor | `/admin` (Guide Config panel) | Tune journey rewards and behavior |
| Help admin | `/admin/help` | Edit help docs (HELP_ADMIN audience) |
| Tournament admin | `/admin/tournaments` | Create / cancel tournaments and templates |

## North Star metric

**`% of new signups reaching step 7 within 7 days`**, target ≥40%. Visible on `/admin/guide-metrics`.

Three states:

- **Healthy** — ≥40%. Journey is doing its job.
- **Warning** — 30-40%. Investigate; usually a single step is the choke point.
- **Fire** — <30%. Likely something broke (e.g., demo Table not crediting). Triage immediately.

The dashboard also shows the per-step funnel — which steps shed users disproportionately is the fastest signal of where the friction is.

## Triage — common journey issues

| Symptom | Likely cause | First check |
|---|---|---|
| Step 1 funnel weak | New users not finding Quick Play | Home page CTA prominence; PvAI route works |
| Step 2 funnel weak | Demo Table not crediting or watch threshold too high | `guide.demo.ttlMinutes`; logs for `guide:hook_complete` |
| Step 4 not firing | Quick Bot training endpoint error | `train-quick` route logs |
| Step 6 not firing | Tournament registration error | `TournamentParticipant` writes |
| Step 7 reward not paid | Cup completion missed | `journeyService.completeStep(userId, 7)` logs |
| Metric drop suddenly | New test accounts polluting | `um testuser --audit` |

## Key SystemConfig values

The journey panel exposes these knobs:

### Journey kill switch

- **`guide.v1.enabled`** *(boolean)* — flips all journey rewards off if set false. **Irreversible** for in-flight credits (a user mid-Hook stays mid-Hook). Use only for genuine emergencies.

### Reward amounts (TC)

- **`guide.rewards.hookComplete`** — default **20**. Paid on step 2 completion.
- **`guide.rewards.curriculumComplete`** — default **50**. Paid on step 7 completion.
- **`guide.rewards.firstRealTournamentWin`** — default **25**. Idempotent discovery reward.
- **`guide.rewards.firstNonDefaultAlgorithm`** — default **10**. First time a user trains with anything other than the platform default algorithm.
- **`guide.rewards.firstTemplateClone`** — default **10**. First time a user clones a tournament template.
- **`guide.rewards.firstSpecializeAction`** — default **10**. First action after graduating Curriculum.

All amounts are admin-tunable; effects are reversible (changing the value affects future awards only).

### Quick Bot tier defaults

- **`guide.quickBot.defaultTier`** *(enum: `novice` / `intermediate` / `advanced` / `master`)* — what a brand-new Quick Bot's tier defaults to before training.
- **`guide.quickBot.firstTrainingTier`** — what Curriculum step 4's "first training" bump promotes the bot to. Default `intermediate`.

### Demo Tables

- **`guide.demo.ttlMinutes`** *(5–1440, default 60)* — the hard TTL on a demo Table. After this many minutes idle, it's GC'd regardless of state.

### Cups

- **`guide.cup.retentionDays`** *(1–365, default 30)* — how long cup tournaments stick around before the sweep purges them.
- **`guide.cup.sizeEntrants`** — **read-only in v1**; the 4-entrant Curriculum Cup and 8-entrant Rookie Cup sizes are hardcoded for now.

### Metrics filtering

- **`metrics.internalEmailDomains`** *(string array)* — email domains whose new signups are auto-flagged `isTestUser=true` so they don't pollute dashboard metrics.

## Help docs editing (HELP_ADMIN)

The Help docs at `/admin/help` are **DB-canonical** after the initial corpus seed. Edits in the UI persist to the database; the markdown files in `/doc/Help_Corpus/` are not the source of truth post-seed.

Workflow:

1. Open `/admin/help` → list of all docs.
2. Filter by status (PUBLISHED / DRAFT / ARCHIVED) if needed.
3. Click any doc → editor. The **slug** is read-only after creation; everything else is editable.
4. Save sends `PUT` with the current **version** as an optimistic-lock token. If someone else edited the doc since you opened it, you'll see a "Someone else edited this doc" banner with a **Reload** button — reload, re-apply your changes, save again.
5. Save bumps the version and triggers an automatic **reindex** (chunks + embeddings) so the new content is searchable immediately.

To create a new doc, click **+ New doc**. The slug must be globally unique; you can't change it later.

To archive, click **Archive** in the editor. Archived docs disappear from public Help and from retrieval but stay in the DB (status flipped to ARCHIVED). You can restore by editing status back to PUBLISHED.

## CLI tools

From the backend container:

- **`um help-list`** — show all docs with category, status, version, chunk count.
- **`um help-reindex [slug]`** — rebuild chunks + embeddings for one doc or all (no args).
- **`um help-export [--out /tmp/help-export]`** — write all PUBLISHED docs back to markdown for backup. Use this before a major schema migration or to capture a snapshot for git.

The `um` CLI shell-execs into the backend container; on production you can run it via `fly ssh console`.

## Test user audits

To check if metric drops are caused by real users versus test pollution:

```
um testuser --audit
```

This lists every user flagged `isTestUser=true` and the basis for the flag (admin role / domain match / manual). If you see real-looking accounts in the list, they were probably mis-flagged at signup; correct via `um testuser <email> --off`.

## Out-of-order step completion

Step completion is **idempotent and order-permissive**. A user can credit step 3 before step 2 (e.g., if they create a bot before finishing the demo watch). This is intentional — the journey is a checklist, not a state machine. The phase derivation logic handles the disordered case by returning whichever phase the completed-step set is consistent with.
