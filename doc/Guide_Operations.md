---
title: "Intelligent Guide v1 — Operations Runbook"
subtitle: "On-call playbook for the v1 onboarding journey"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## Why this doc exists

The Intelligent Guide v1 is the seven-step onboarding journey (Hook → Curriculum → Specialize) plus the dashboards and rewards behind it. This document is what you read when something on the dashboard looks wrong, or when you want to safely tune one of the SystemConfig knobs.

It assumes you already know the *what* (`Intelligent_Guide_Requirements.md`) and *how* (`Intelligent_Guide_Implementation_Plan.md`). This is the *what to do when something is on fire* doc.

Companion docs:

- `Intelligent_Guide_Requirements.md` — the spec
- `Intelligent_Guide_Implementation_Plan.md` — sprints + checklists
- `V1_Acceptance.md` — end-to-end QA script (run before every release)
- `Guide_Operations.md` (this doc) — incident response + tuning

---

## 1. Incident response

### 1.1 The signal

The single source of truth is the **`/admin/guide-metrics`** dashboard:

- **North Star** — % of users (signed up ≥30 days ago) whose bot played a tournament within 30 days. Healthy ≥40%.
- **Funnel** — completion count for each of the 7 steps. Healthy: drop-off <30% per step.
- **Signup split** — credential vs OAuth share over the last 30 days.
- **Trend line** — Day / Week / Month rollup; pivot the granularity dropdown to find the right slice.

Footer reads "Excluding N test users" — internal accounts (any email matching `metrics.internalEmailDomains`) are filtered out so dashboard noise doesn't drown out real users.

### 1.2 Triage table

When a metric drops, work top-to-bottom. Likely cause first, easy diagnostic second, first remediation third. Do not skip diagnostics — most "the dashboard is wrong" reports are actually a single test-user account that wasn't flagged.

| Metric drops | Likely cause | Diagnostic | First remediation |
|---|---|---|---|
| **North Star** plummets | Big batch of test users not flagged → dashboard denominator inflated | `um testuser --audit` (lists drift between `metrics.internalEmailDomains` and `User.isTestUser`) | `um testuser --apply` to flag everyone matching the domain list |
| **North Star** drifts down slowly | Real cohort regression — bots not being entered into tournaments | Spot-check a few cohort users via `um status <user>` (look at `journeyProgress.completedSteps`); cross-reference with `/admin/tournaments` | Check tournament sweep cron on `tournament` service; investigate Discovery `firstRealTournamentWin` reward in logs |
| **Step 1** count drops | PvAI completion path broken | `docker compose logs backend \| grep "Journey step completed"` should show step 1 firing on PvAI game end | Check `backend/src/routes/games.js` — the `completeStep(userId, 1)` call after a successful game record |
| **Step 2** count drops | Demo-table watch credit broken — usually a TableGC change or socket listener regression | Repro: sign up a fresh user, navigate to a demo table, wait for the bot game to finish. Watch backend logs for `Journey step completed { stepIndex: 2 }` | Confirm `tableGcService.sweepDemos` isn't reaping mid-watch (check `guide.demo.ttlMinutes`); confirm socket `table:watch` listener fires |
| **Steps 3-5** count drops | Quick Bot wizard / Quick Train / Spar endpoint regression | `um status <user>` for any new user; check `/api/v1/bots/quick`, `/api/v1/bots/:id/train-quick`, `/api/v1/bot-games/practice` POST handlers | Check the relevant handler isn't crashing — they all call `completeStep` directly after the side-effect succeeds |
| **Step 6** count drops | Cup clone or participant `participant:joined` publish broken | `curl -X POST /api/tournaments/curriculum-cup/clone` as a test user; confirm a participant row appears | Check `tournament/src/services/curriculumCupService.js` and the bridge subscriber `backend/src/lib/tournamentBridge.js` |
| **Step 7** count drops | Cup completion not firing OR `tournament:completed` publish stuck | Watch tournament logs for the cup running; if it completes but step 7 doesn't fire, the bridge is the suspect | Check `tournamentBridge.coachingCard` subscription — same path emits step 7 |
| **Signup split** flips abruptly | OAuth provider down OR credential signup broken | Check `/api/auth/sign-in/email` and `/api/auth/sign-in/social/*` directly | If OAuth is the culprit, check Better Auth provider env vars; if credential — check the `User.create` path is committing |
| **Funnel** flat across the board | `guide.v1.enabled` was flipped off | `curl /api/v1/admin/guide-config \| jq '."guide.v1.enabled"'` | Flip back on via the admin SystemConfig panel; in-flight credits during the off window are gone (not recoverable) |
| **Test-user count** trending up | Internal accounts not being flagged correctly | `um testuser --audit` | Add the missing domain to `metrics.internalEmailDomains` via admin UI; then `um testuser --apply` |

### 1.3 The "everything's broken" case

If multiple metrics drop at once — first check the **release flag**:

```sh
curl -s http://localhost:3000/api/v1/admin/guide-config \
  -H "Authorization: Bearer <admin-token>" \
  | jq '."guide.v1.enabled"'
```

If that's `false`, journey credits and discovery rewards are silently no-op. Flip it back on via the admin UI (`/admin` → Intelligent Guide v1 panel) — the change takes effect immediately, no restart needed.

### 1.4 Backfill after downtime

If the metrics cron didn't run (deploy / outage / DB downtime), run:

```sh
docker compose exec backend node src/scripts/backfillMetrics.js [--days N] [--dry-run]
```

The script walks past UTC days and rewrites North Star + signup-split rows. **Funnel + test-user-count are NOT backfilled** — those metrics have no historical state, so old values would be a flat replay of today.

`--dry-run` prints what would be written without touching the DB. `--days 14` re-walks the last 14 days only. Idempotent — safe to re-run for the same range.

---

## 2. Tuning SystemConfig safely

The admin UI (`/admin` → Intelligent Guide v1 panel) exposes 13 keys. All changes take effect immediately for new triggers — already-granted rewards are not retroactively adjusted.

| Key | Type | Default | Safe range | Reversibility |
|---|---|---|---|---|
| `guide.v1.enabled` | boolean | `true` | true/false | **Flip to off loses any journey credits / discovery rewards that fire during the off window.** Other gameplay (games, bots, tournaments) is unaffected. |
| `guide.rewards.hookComplete` | integer | 20 | 0–100 | Reversible. New users at step 2 get the new value. Already-granted rewards stay. |
| `guide.rewards.curriculumComplete` | integer | 50 | 0–200 | Reversible. New users at step 7 get the new value. |
| `guide.rewards.discovery.firstSpecializeAction` | integer | 10 | 0–100 | Reversible. **Surface ships in v1 with no caller** — no observable effect until v1.1. |
| `guide.rewards.discovery.firstRealTournamentWin` | integer | 25 | 0–100 | Reversible. Granted on first tournament win that is *not* a curriculum cup. |
| `guide.rewards.discovery.firstNonDefaultAlgorithm` | integer | 10 | 0–100 | Reversible. Granted when a user trains a bot with a non-`copy-rusty` algorithm (qLearning, dqn, etc.). |
| `guide.rewards.discovery.firstTemplateClone` | integer | 10 | 0–100 | Reversible. **Surface ships in v1 with no caller.** v1.1 wires user-facing template clone. |
| `guide.quickBot.defaultTier` | enum | `novice` | `novice` / `intermediate` / `advanced` / `master` | Reversible. Wizard-created bots get this tier going forward. |
| `guide.quickBot.firstTrainingTier` | enum | `intermediate` | same enum | Reversible. After Quick Train, the bot flips to this tier. |
| `guide.cup.sizeEntrants` | integer (read-only) | 4 | n/a | **Read-only in v1 — admin UI rejects writes.** The cup spawn logic hardcodes the 4-bot slot mix in `tournament/src/config/curriculumCupConfig.js`; changing the SystemConfig value alone would have no behavioral effect. v1.1 wires it. |
| `guide.cup.retentionDays` | integer | 30 | 1–365 | Reversible. The tournament sweep deletes COMPLETED cups older than this. |
| `guide.demo.ttlMinutes` | integer | 60 | 5–1440 | Reversible. Demo tables get reaped after this many idle minutes. Don't drop below 5 — short-running matches will get killed mid-game. |
| `metrics.internalEmailDomains` | string-array | `[]` | any | Reversible, but: removing a domain doesn't un-flag accounts that were already flagged (run `um testuser --audit` to see the drift, then `--apply` to reconcile). |

### 2.1 Safe-tuning pattern

Before changing a reward value:

1. Note the current value.
2. Make the change in the admin UI.
3. Watch the funnel + signup-split panels for the next 24 hours.
4. If something drops, flip back. The rollback is instant.

For the release flag specifically, prefer **off → on** to "patch fast and ship." Off → on is reversible; off-window credits are not.

---

## 3. Reading the dashboard

### 3.1 Healthy

- North Star ≥ 40% on the 7-day moving average.
- Funnel: drop-off < 30% per step (i.e., step N+1 retains >70% of step N).
- Signup split: stable ratio. A sudden flip is a signal.
- Test-user footer: stable count, growing only when intentional internal signups happen.

### 3.2 Warning (investigate same day)

- North Star drops 5+ points week-over-week.
- One funnel step drops 50%+ overnight.
- Signup split flips by >30 points overnight.
- Test-user count grows by >5 in one day with no known internal onboarding.

### 3.3 Fire (investigate immediately)

- North Star at 0% (denominator collapsed → flag audit issue, or genuine outage).
- All funnel steps at 0 (release flag flipped off).
- Signup split is 100/0 (one auth path is broken).
- Dashboard returns 500 or hangs (admin endpoint or metrics cron broken).

### 3.4 Cohort granularity

The trend chart on the North Star panel has a Day / Week / Month picker (default Week). Use:

- **Day** — for high-volume periods or to spot a single bad-day regression.
- **Week** — default; smooths weekday/weekend noise.
- **Month** — for long-range comparisons; daily buckets get too sparse.

The bucketing is client-side only — the underlying snapshot data doesn't change.

---

## 4. Escalation

For Sprint 1 (the only sprint at time of writing), **everything routes to Joe**. The goal is to grow this list as the team grows:

- **First responder** — Joe (any time)
- **Backup** — n/a yet; document who replaces Joe when the on-call schedule exists
- **Tournament service issues** — Joe (the bridge subscriber + cup logic both live in `tournament/`)
- **Auth issues** — Joe (Better Auth + OAuth provider env vars)

The pattern future on-call docs should follow: incident type → first responder → escalation step 1 → step 2.

---

## 5. Common operations cookbook

Copy-paste recipes for routine ops. Each one has been smoke-tested at least once on local dev.

### 5.1 Onboard a new internal admin

```sh
um create <name> --admin
```

Then verify the auto-flag fired (the email-domain rule should have set `isTestUser=true` if the email matches `metrics.internalEmailDomains`):

```sh
um testuser <name>
```

If it didn't auto-flag (e.g., the user's email is on a personal domain), force the flag:

```sh
um testuser <name> --on
```

### 5.2 Audit + reconcile test-user drift

```sh
um testuser --audit              # list users whose flag disagrees with the domain list
um testuser --apply              # reconcile: flag everyone matching, unflag everyone not matching
```

The audit is read-only. `--apply` is the only command that writes; review the audit output first.

### 5.3 Backfill the dashboard after a long downtime

```sh
docker compose exec backend node src/scripts/backfillMetrics.js
```

Optional: limit the lookback with `--days 30`. Use `--dry-run` to preview without writing. The script is idempotent so re-running for the same range is safe.

### 5.4 Disable the guide for a hotfix

1. Open `/admin`, scroll to "Intelligent Guide v1" panel.
2. Uncheck **`guide.v1.enabled`**.
3. The browser confirm dialog explains the cost — accept.
4. Click Save.

Effect: journey credits and discovery rewards become no-ops within milliseconds. Other gameplay continues normally. The metrics cron still runs and dashboards still update.

### 5.5 Re-enable the guide

1. Open `/admin` → Intelligent Guide v1 panel.
2. Check `guide.v1.enabled`.
3. Click Save.

No confirm dialog when re-enabling. Effect is immediate. The next user action that would fire a step credit will go through.

### 5.6 Inspect a single user's journey state

```sh
um status <user>             # phase + isTestUser + grants + TC
um rewards show <user>       # discovery reward grants
```

If a user reports "I should have gotten the +50 TC for completing the curriculum but didn't" — start here. Look for step 7 in `completedSteps`; if present, the reward fired. If TC didn't increment, check the `User.creditsTc` write path in `journeyService._handleCurriculumComplete`.

### 5.7 Replay a failed reward

There is intentionally no "replay" command. The audit trail is the logger output:

```sh
docker compose logs backend | grep "Hook complete\|Curriculum complete"
```

If the reward log line is missing, the trigger never fired (root cause is upstream). If the log line is there but the user reports no TC, something failed in the DB write — re-run the audit + manually grant via Prisma if necessary, but log the manual grant.

### 5.8 Service Worker kill switch

The landing app's Service Worker (Phase 20, app-shell caching) reads two SystemConfig keys on each `install` / `activate` and on tab visibility-change, via the public `GET /api/v1/config/sw` endpoint:

- **`sw.enabled`** *(bool, default true)* — the kill switch. Flip to `false` and every SW in the wild self-unregisters and clears all caches on its next check-in (within ~30s, bounded by the response's `Cache-Control: max-age=30`).
- **`sw.version`** *(int, default 1)* — bump to invalidate the SW's precache without unregistering the worker. Use this when a cached asset URL is wrong or poisoned but the SW logic itself is fine.

**When to flip the kill switch:**
- A bad SW deploy is serving stale or corrupted assets to users and you can't roll forward fast.
- Auth or `/api/*` requests are mysteriously hitting cached responses (the SW should never cache `/api/*` — if you suspect it is, kill it while you debug).
- A user reports "I see an old version of the app even after a hard reload" and you need a fleet-wide eject.

**To kill the SW (revert when fixed):**

```sh
# Set sw.enabled = false
docker compose exec -T backend node --experimental-transform-types --no-warnings -e "
  import('./src/lib/db.js').then(async ({ default: db }) => {
    await db.systemConfig.upsert({
      where:  { key: 'sw.enabled' },
      create: { key: 'sw.enabled', value: false },
      update: { value: false },
    })
    console.log('sw.enabled = false — SWs will self-unregister on next check-in')
    await db.\$disconnect()
  })
"
```

Re-enable by upserting `value: true` (or deleting the row, since the default is true). Bump cache version with `key: 'sw.version', value: <currentVersion + 1>`.

**Verification:** open DevTools → Application → Service Workers on a tab you know had the SW registered; within 30s of flipping `sw.enabled=false`, the SW should disappear and `caches.keys()` in the console should return `[]`.

---

## 6. References

- **Spec** — `/doc/Intelligent_Guide_Requirements.md`
- **Implementation plan** — `/doc/Intelligent_Guide_Implementation_Plan.md`
- **Acceptance script** — `/doc/V1_Acceptance.md`
- **Sprint 6 kickoff** — `/doc/Sprint6_Kickoff.md`
- **Backfill script** — `backend/src/scripts/backfillMetrics.js`
- **Snapshot service** — `backend/src/services/metricsSnapshotService.js`
- **Admin endpoints** — `backend/src/routes/admin.js` (`/guide-metrics`, `/guide-config`)
- **Admin UI** — `landing/src/pages/admin/{GuideMetricsPage,GuideConfigPanel}.jsx`
