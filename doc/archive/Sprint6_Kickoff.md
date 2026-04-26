---
title: "Sprint 6 Kickoff — V1 Polish + Release"
subtitle: "Intelligent Guide v1, Sprint 6 (final pre-release sprint)"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## Why this doc exists

This is a context primer written immediately before a `/compact` so the post-compact Claude session has a self-contained brief on where we are and what to do next. **First action on resume: read this file end-to-end, then start Sprint 6 implementation per §3 below.**

---

## 1. Where we are

### Sprints complete (code on `dev`)

| Sprint | Code | Manual QA | DoD passed |
|---|---|---|---|
| 1 — Foundation               | done | done (Phase 1 QA)              | yes |
| 2 — Phase 0 funnel           | done | done (Phase 1 QA + QA pass D)  | yes |
| 3 — Hook + Quick Bot         | done | DEFERRED to unified v1 QA       | no  |
| 4 — Curriculum + Coaching    | done | DEFERRED to unified v1 QA       | no  |
| 5 — Discovery + Measurement  | done | DEFERRED to unified v1 QA       | no  |

### What Sprint 5 actually shipped (commits `d102307`..`367de94`)

Seven commits, all on `dev`:

1. `d102307` — Discovery-rewards service + 4 SystemConfig keys + 20 tests
2. `51ed9d3` — Wired `firstRealTournamentWin` (in `tournamentBridge`) + `firstNonDefaultAlgorithm` (in `mlService` + `skillService`) + 5 tests. Renamed reward keys to canonical spec names (kickoff doc had wrong names).
3. `bdaf5b5` — `isTestUser` auto-flag (4 layers: syncUser email-domain, `um create`, `um role ADMIN`, `PATCH /admin/users` baRole='admin') + `metrics.internalEmailDomains` SystemConfig key + 10 tests. Column already existed from the Sprint 1 foundation migration.
4. `0022655` — `metricsSnapshotService.js` (4 metrics: `northStar` / `funnel` / `signup` / `testUserCount`) + hourly idempotent cron + 16 tests. Snapshot writes idempotent via `deleteMany` + `create` on `(date, metric, dimensions)`.
5. `ba686cb` — `GET /api/v1/admin/guide-metrics` endpoint + 4 tests. Recomputes today + returns 30-day history.
6. `3ec3aac` — `landing/src/pages/admin/GuideMetricsPage.jsx` + 4 tests. North Star tile w/ trend line (recharts), funnel bars, signup split, "excluding N test users" footer. Mounted at `/admin/guide-metrics`.
7. `367de94` — `um testuser` (`--on/--off/--list/--audit`) + `um rewards show/grant/revoke/reset` + extended `um status` (phase, isTestUser, discovery grants, TC). No CLI tests — matches existing `backend/src/cli/commands/` convention. Audit mode caught 4 admins missing the flag on the local DB.

Test counts at this kickoff: **backend 1187/1187**, **landing 104/104**, **tournament 67/67**.

### Two known v1 placeholders that still need a decision

Per Sprint 5 commit `51ed9d3`:

- `firstSpecializeAction` discovery reward — wired but never fires in v1 (no Specialize UI yet). Logic stays as a placeholder; the catalog row is intentional. v1.1 (Sprint 7) wires the trigger.
- `firstTemplateClone` discovery reward — same story (no user-facing template-clone UI in v1; admin clone path is admin-only, not the right surface). Curriculum Cup clones are *deliberately excluded* from this reward.

Both are documented in commits + the discovery service header comment. **Don't try to wire them in Sprint 6.**

### The unified v1 acceptance plan (still on)

Per the strategic call from before Sprint 5, **Sprint 6's DoD already requires unified QA** (1-week staging soak + 10+ users complete the funnel). So Sprint 6's QA pass IS the v1 acceptance pass — there is no separate `Sprint6_QA.md`. The `V1_Acceptance.md` doc gets written *during* Sprint 6 and walks Sprints 3+4+5+6 in one pass.

---

## 2. The plan

1. Implement Sprint 6 deliverables on `dev` per the implementation plan §5 Sprint 6 (see §3 below).
2. Run unit + component tests at each milestone, commit in logical chunks (one feature per commit).
3. Write `V1_Acceptance.md` once code is complete (the unified QA script across Sprints 3+4+5+6).
4. User runs the V1 acceptance pass on local, then `/stage`, then 1-week staging soak.
5. After soak, `/promote` to production behind the `guide.v1.enabled` feature flag, flip flag for all users.

---

## 3. Sprint 6 deliverables (from Implementation Plan §5 Sprint 6)

**Sprint goal:** shake out bugs, document operational procedures, ship v1 to production.

### 3.1 Dashboard cohort slicer (§2)

- Admin-selectable granularity: Day / Week / Month, default Week.
- Same query, different `DATE_TRUNC` — UI-level view pivot, not a per-granularity aggregation.
- Adds a granularity dropdown to `GuideMetricsPage` and either:
  - Server side: extends `/admin/guide-metrics` to accept `?granularity=day|week|month` and bucket the history rows server-side, OR
  - Client side: roll up the existing 30-day daily history rows in the component.
- Per the spec, **client-side rollup is acceptable** since "same query, different `DATE_TRUNC`" is explicitly a view pivot. Pick the cheaper option (probably client-side for v1, server-side later if performance demands it).

### 3.2 Backfill script for historical metrics

- A one-shot script (likely `backend/scripts/backfill-metrics.js`) that walks the User + Game + Tournament history and writes MetricsSnapshot rows for each past UTC day where data exists.
- Goal: day-1 dashboard isn't empty after deploy.
- Idempotent (the snapshot writer's unique-on-(date,metric,dimensions) constraint already guarantees this).
- Can be run via `docker compose exec backend node scripts/backfill-metrics.js [--days N]`.

### 3.3 A/B hook points

- `recommendationService` (placeholder file) and `journeyService` get instrumentation hooks for future experiments.
- v1 ships the hook surface, not actual experiments. Just enough that v1.1 can plug into them.
- Pattern: a thin `experimentVariant(userId, experimentKey, defaultBucket)` helper that returns a stable per-user bucket. No experiment definitions yet.

### 3.4 SystemConfig admin UI

- Admin settings page extension: inline-edit each of the v1 SystemConfig keys.
- Spec lists 14 v1 keys total. The currently-seeded set in `backend/prisma/seed.js` has **9** of them:
  - `guide.rewards.hookComplete` (20)
  - `guide.rewards.curriculumComplete` (50)
  - `guide.rewards.discovery.firstSpecializeAction` (10)
  - `guide.rewards.discovery.firstRealTournamentWin` (25)
  - `guide.rewards.discovery.firstNonDefaultAlgorithm` (10)
  - `guide.rewards.discovery.firstTemplateClone` (10)
  - `guide.quickBot.defaultTier` ("novice")
  - `guide.quickBot.firstTrainingTier` ("intermediate")
  - `metrics.internalEmailDomains` ([])
- **Three more v1 keys still need seeding** (currently in-code constants — see §4.3 below):
  - `guide.cup.sizeEntrants` (4)
  - `guide.cup.retentionDays` (30)
  - `guide.demo.ttlMinutes` (60)
- That's 12. The "14" figure in the implementation plan rounds up — it counts a couple of pre-existing keys that the admin UI should also surface (`bots.defaultBotLimit`, `game.idleWarnSeconds`, etc., if Sprint 6 chooses to). Verify against §8.4 of the requirements doc when starting.
- **Sprint 6 should also migrate the cup/demo constants from in-code (`tournament/src/config/curriculumCupConfig.js`, etc.) to SystemConfig reads.** Otherwise the admin UI couldn't tune them.
- Mirror the existing inline-config pattern in `landing/src/pages/admin/AdminDashboard.jsx` (`MLLimitsPanel`, `LogRetentionPanel`, `IdleConfigPanel`, etc.) — there's a clean `getXConfig` / `setXConfig` shape to copy.

### 3.5 Operational runbook — `/doc/Guide_Operations.md`

- Incident response: what to do if the funnel drops (which dashboard panel to look at, what SystemConfig knob to twist, when to roll back).
- How to tune SystemConfig values safely (which knobs are reversible, which require a deploy, what's the safe range).
- How to read the dashboard (what's healthy, what's a warning, what's a fire).
- When to escalate.
- Per `feedback_doc_directory.md`: lives in `/doc`. Per `feedback_doc_pdf_companion.md`: needs a matching `.pdf` rendered with the tuned pandoc command (see §5.3 below).

### 3.6 V1 Acceptance unified QA script — `/doc/V1_Acceptance.md`

- Walks Sprints 3 + 4 + 5 + 6 in one pass.
- Replaces the deferred `Sprint3_QA.md` / `Sprint4_QA.md` / `Sprint5_QA.md` (the Sprint 5 one was deliberately not written; the 3 + 4 ones exist as drafts and should be folded in or referenced).
- Stages: signup → Hook → Quick Bot → Train → Spar → Curriculum Cup → Coaching card → admin dashboard sanity check → CLI sanity check.

### 3.7 Tests

- Full regression: backend + landing + tournament + E2E.
- Staging smoke-test sequence: `guide-phase0`, `guide-hook`, `guide-curriculum` (these E2E specs already exist).
- Load test (basic): 100 concurrent fake signups via script, verify no race conditions in journey-state updates. Likely a `backend/scripts/load-signups.js`.
- Dashboard stress test: 30 days of snapshot data rendered without hang. Quick check — can be done by seeding fake snapshot rows + opening the page.

### 3.8 Production gating: `guide.v1.enabled` feature flag

- Per Sprint 6 DoD: "production behind a feature flag (`guide.v1.enabled`), flag flipped on for all users."
- Add as a new SystemConfig key (default `true` in dev, default `false` in production seed if separate).
- Wire as a top-level guard in `journeyService.completeStep` + `discoveryRewardsService.grantDiscoveryReward` (early-return when off — keeps Phase 0 working but suppresses everything Hook+).
- Consider also gating reward popup + journey card render on the landing side if appropriate, to be defensive.

### 3.9 Definition of Done — V1 Acceptance Criteria

(Per implementation plan §5 Sprint 6.)

- [ ] **Conversion:** 2× baseline landing-to-signup conversion in staging comparison (14-day window)
- [ ] **Funnel:** ≥ 60% of new signups arrive with Hook pre-credited
- [ ] **Time-to-signup:** median < 10 minutes
- [ ] **Journey completion:** Staging internal testers: ≥ 80% complete Hook (steps 1-2) in first session; ≥ 30% complete full Curriculum in 7 days
- [ ] **Metrics:** Dashboard populated, exclude test users, cohort slicer works
- [ ] **No critical bugs:** P0/P1 bugs at zero during staging validation week
- [ ] **Tests:** All Sprint 1-6 test suites green
- [ ] **Deployed:** production behind `guide.v1.enabled`, flag flipped on for all users

The first four items are *outcomes of the soak*, not code-time deliverables. Code-time deliverables are the metrics + flag + runbook so the soak can produce these signals.

---

## 4. Critical context that would be lost in compact

### 4.1 Journey-step trigger map (current, post-Sprint 5 — unchanged from Sprint 4)

| Step | Trigger | Code location |
|---|---|---|
| 1 | PvAI game complete (HvB, NOT PvP)                | `games.js`, `socketHandler.js` |
| 2 | Demo Table watched ≥ 2 min OR seen to completion | `DemoArena.jsx` (guests, localStorage); `botGameRunner._recordGame` (signed-in viewers credited on demo completion) |
| 3 | Bot created (Quick Bot or full Gym)              | `bots.js`, `bots/quick.js` |
| 4 | Bot trained (depth bump or real ML run)          | `mlService.js`, `skillService.js`, train-quick endpoint |
| 5 | Spar match completed                             | `botGameRunner._recordGame` when `game.isSpar && game.sparUserId` |
| 6 | Tournament registration                          | `tournamentBridge.js` on `tournament:participant:joined` |
| 7 | Tournament completion with `finalPosition`       | `tournamentBridge.js` on `tournament:completed` |

Plus Sprint 5's discovery-reward grant sites (don't re-wire):
- `firstRealTournamentWin` — `tournamentBridge.js` `tournament:completed`, position 1, !isCup.
- `firstNonDefaultAlgorithm` — `mlService.js` + `skillService.js` finishFrontendSession paths, alongside the step-4 fire.

### 4.2 Sprint 5 modules at a glance (so you don't re-discover)

- `backend/src/services/discoveryRewardsService.js` — `DISCOVERY_REWARDS`, `DISCOVERY_REWARD_KEYS`, `grantDiscoveryReward(userId, key, io?)`, `getGrantedRewards(userId)`. Idempotent via `user.preferences.discoveryRewardsGranted[]`.
- `backend/src/services/userService.js` — `isInternalEmailDomain(email)` exported helper. `syncUser` already wires it.
- `backend/src/services/metricsSnapshotService.js` — `runMetricsSnapshot(now?)`, `startMetricsSnapshotCron()`. Started at server boot from `index.js`.
- `backend/src/routes/admin.js` — `GET /admin/guide-metrics` returns `{ now, history }`.
- `landing/src/pages/admin/GuideMetricsPage.jsx` — mounted at `/admin/guide-metrics`. Imports `recharts` (already a dep).
- `backend/src/cli/commands/{testuser.js, rewards.js}` — wired in `um.js`.
- `backend/src/cli/commands/status.js` — extended with two new lines per user (guide phase, rewards).

### 4.3 Cup + demo config is still in-code (NOT yet SystemConfig)

`tournament/src/config/curriculumCupConfig.js` defines `CURRICULUM_CUP_CONFIG` as constants. `tableGcService.js` has the demo TTL hardcoded. Sprint 6's "SystemConfig admin UI" deliverable should:

1. Add the three SystemConfig keys (`guide.cup.sizeEntrants`, `guide.cup.retentionDays`, `guide.demo.ttlMinutes`) to `seed.js` `CONFIG_DEFAULTS`.
2. Refactor those config files to read from SystemConfig at startup (with the in-code value as fallback, matching the existing `_getSystemConfig(key, defaultValue)` pattern used everywhere else).
3. Surface in the admin UI for inline edit.

If you don't do this, the admin UI for cup/demo config is just decorative.

### 4.4 The metrics-snapshot history may be sparse on day 1

The hourly cron writes today's snapshot, but there's no historical backfill yet — that's deliverable §3.2. So the dashboard's trend line will be one data point on a fresh deploy until the backfill script runs. Run the backfill **before** flipping the flag for all users so the dashboard is meaningful from minute 1.

### 4.5 The two suites + the docker container quirks (unchanged from Sprint 4/5)

- Backend tests: `docker compose exec backend npm test`. Do NOT use `docker compose run --rm backend ...` — fresh container has stale node_modules missing `web-push`.
- Tournament tests: `cd tournament && npm test` (host).
- Landing tests: `cd landing && npm test -- --run` (host).
- Pre-commit hook (`/dev` skill) runs landing + backend automatically.

### 4.6 Memory entry — DB migrations

After any schema change, run migrations inside the backend container:

```sh
docker compose exec backend npx prisma migrate deploy
```

(NOT `docker compose run --rm` — the user's `feedback_db_migrations.md` memory says use the running container.) Sprint 6 likely needs zero schema changes — all new state is SystemConfig rows + UI.

The canonical Prisma schema lives at `packages/db/prisma/schema.prisma` (NOT `backend/prisma/schema.prisma` — that's a stale vendored copy and was the source of confusion in Sprint 5). Always grep / edit the `packages/db` version.

### 4.7 What NOT to touch in Sprint 6

- The metricsSnapshot writer / aggregation logic — Sprint 5 shipped it stable.
- The discovery-rewards service module + its grant-site wiring — same.
- Journey-step trigger sites — same.
- The reward popup / coaching card components — same.
- The Phase 0 funnel surfaces (DemoArena, signup modal, EmailVerifyBanner) — Sprint 2 work, stable.

### 4.8 Heads-up on E2E specs that already exist

These run in `cd e2e && npx playwright test <name> --project=chromium`:

- `guide-phase0.spec.js` — Sprint 2 funnel
- `guide-hook.spec.js` — Sprint 3 hook reward popup
- `guide-curriculum.spec.js` — Sprint 4 curriculum (3 scenarios: spar→step 5, clone→step 6, cup→step 7)

Sprint 6 should add:
- (optional) `guide-metrics.spec.js` — admin signs in, opens `/admin/guide-metrics`, sees the freshly-computed snapshot. Nice-to-have, not required.
- (optional) `guide-systemconfig.spec.js` — admin tunes a SystemConfig key, verifies the new value sticks. Nice-to-have, not required.

---

## 5. Process notes

### 5.1 Workflow

- User handles all `git push` / `/stage` / `/promote` / Fly operations. Never run those unless explicitly invoked. Per `feedback_deploy_flow.md`.
- `/dev` skill commits + pushes to `dev`. Pre-commit hook runs the full backend + landing test suites. Use it for end-of-feature commits.
- For ad-hoc commits during a feature, plain `git commit` (no push) is fine — user pushes when ready.
- Always promote `dev → staging → main`, never reverse. Per `feedback_stage_direction.md`.
- After Sprint 6 code-complete, write `V1_Acceptance.md`. User runs it on local + staging.

### 5.2 Tests

- Backend: `docker compose exec backend npm test` (1187 baseline at end of Sprint 5)
- Landing: `cd landing && npm test -- --run` (104 baseline)
- Tournament: `cd tournament && npm test` (67 baseline)
- E2E (manual only — not in pre-commit): `cd e2e && npx playwright test <name> --project=chromium`
- Per `feedback_tests_before_completion.md`: write tests for new backend endpoints + service branches **before** declaring a feature complete.

### 5.3 Docs

- All `.md` documentation files go in `/doc` (not `/docs`). Per `feedback_doc_directory.md`.
- Every `/doc/<name>.md` must have a matching `<name>.pdf` rendered via pandoc+xelatex with the tuned command. Commit them together. Per `feedback_doc_pdf_companion.md` and `feedback_pandoc_pdf_quality.md`.
- Pandoc command:
  ```sh
  cd /Users/joe/Desktop/xo-arena/doc && pandoc <NAME>.md -o <NAME>.pdf \
    --pdf-engine=xelatex \
    -V mainfont="Times New Roman" -V monofont="Menlo" \
    -V geometry:margin=0.75in \
    -V colorlinks=true -V linkcolor=blue -V urlcolor=blue \
    --toc --toc-depth=3 \
    -H pdf_header.tex
  ```

### 5.4 Compaction discipline

Per `feedback_compaction.md`: keep responses concise. Verbose output grows context faster and triggers compaction sooner.

---

## 6. First action on resume (post-compact)

1. **Read this file end-to-end.** Confirm understanding of §3 (Sprint 6 scope) and §4 (critical context).
2. **Confirm the implementation order with the user** (per the project's "match scope of actions to what was actually requested" guidance). Suggested order, smallest-first:
   1. Migrate the three in-code cup/demo constants to SystemConfig + add `guide.v1.enabled` flag (§3.4 prep + §3.8) — shortest, unblocks the admin UI work.
   2. Backfill script for historical metrics (§3.2) — pure backend, no UI.
   3. Cohort slicer on `GuideMetricsPage` (§3.1) — small UI add.
   4. SystemConfig admin UI panels (§3.4) — bigger UI add, mirrors existing AdminDashboard pattern.
   5. A/B hook points (§3.3) — small surface, easy to bolt on.
   6. Operational runbook `Guide_Operations.md` (§3.5) — pure docs.
   7. Unified `V1_Acceptance.md` (§3.6) — pure docs, written last so it reflects shipped code.
   8. Run full regression (backend + landing + tournament + E2E).
3. Brief glance at:
   - `tournament/src/config/curriculumCupConfig.js` — what to migrate to SystemConfig
   - `backend/src/services/tableGcService.js` — demo TTL constant
   - `landing/src/pages/admin/AdminDashboard.jsx` — the panel pattern to mirror for SystemConfig UI
   - `backend/prisma/seed.js` `CONFIG_DEFAULTS` — to see the current 9 v1 keys + add the 3 missing ones + the flag
   - `backend/src/services/journeyService.js` `completeStep` — the surface that needs the `guide.v1.enabled` early-return
   - `backend/src/services/metricsSnapshotService.js` — to understand what to backfill from raw events
4. Do not start coding immediately on resume — confirm the plan + order with the user first.
