---
title: "Sprint 6 Resume — 3 of 8 done, 5 to go"
subtitle: "Intelligent Guide v1, Sprint 6 mid-sprint resume"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## Why this doc exists

Mid-sprint compact. Sprint 6 is 3 commits in (foundation work done); 5 deliverables remain. The original `Sprint6_Kickoff.md` still applies for the unfinished tasks — this doc adds the *delta* since that was written, plus concrete next-step instructions that fit in a single read.

**Read order on resume:** this doc → original `Sprint6_Kickoff.md` only if you need deeper context on a specific task.

---

## 1. What's done (3 commits on `dev`)

| # | Commit | What |
|---|---|---|
| 1 | `e2b61bd` | `guide.v1.enabled` flag + cup/demo SystemConfig migration |
| 2 | `af99e25` | historical metrics backfill script |
| 3 | `863f1d2` | cohort slicer (Day/Week/Month) on GuideMetricsPage |

### What that actually shipped

- **Four new SystemConfig keys** in `backend/prisma/seed.js`:
  - `guide.v1.enabled` (true) — release gate. Wired as early-return guard in `journeyService.completeStep` AND `discoveryRewardsService.grantDiscoveryReward`. Read fresh per call.
  - `guide.cup.sizeEntrants` (4) — reserved/informational only in v1; cup still spawns with fixed 4-bot bracket. Documented as v1.1 tunable.
  - `guide.cup.retentionDays` (30) — wired into `tournament/src/lib/tournamentSweep.js` `sweepOldCups`. Read each sweep tick (no restart needed for changes).
  - `guide.demo.ttlMinutes` (60) — wired into `backend/src/services/tableGcService.js` `sweepDemos`. Read each sweep tick.

- **Backfill script** at `backend/src/scripts/backfillMetrics.js`:
  - Walks past UTC days, writes northStar + signup rows only.
  - Funnel + testUserCount NOT backfilled (no historical state) — documented in script header.
  - Idempotent. Run via `docker compose exec backend node src/scripts/backfillMetrics.js [--days N] [--dry-run] [--verbose]`.
  - Smoke-tested locally on 14 days: works.

- **Cohort slicer** on `landing/src/pages/admin/GuideMetricsPage.jsx`:
  - New `granularity` state (default `'week'`).
  - Exported helper `rollupTrend(points, granularity)` buckets by Day / ISO Week / YYYY-MM. Averages within bucket (north star is a percentage).
  - Trend chart's X-axis dataKey switched from `date` to `bucket`.
  - Granularity dropdown rendered in the page header.

### Test counts at this resume

- backend: **1199/1199** (was 1187 at Sprint 5 end → +12 from v1Flag.test.js [6] + backfillMetrics.test.js [6])
- landing: **109/109** (was 104 → +5 from cohort slicer tests)
- tournament: **67/67** (unchanged)

---

## 2. What's pending (5 tasks)

Tasks live in TaskList: `#21` SystemConfig admin UI · `#22` A/B hook points · `#23` Operational runbook · `#24` V1_Acceptance.md · `#25` Final regression + wrap.

### Task #21 — SystemConfig admin UI panels

**Goal:** admin can inline-edit the v1 Guide SystemConfig keys without a deploy.

**Scope (12 keys):**
1. `guide.v1.enabled` (boolean) — **release gate**, must be editable
2. `guide.rewards.hookComplete` (number)
3. `guide.rewards.curriculumComplete` (number)
4. `guide.rewards.discovery.firstSpecializeAction` (number)
5. `guide.rewards.discovery.firstRealTournamentWin` (number)
6. `guide.rewards.discovery.firstNonDefaultAlgorithm` (number)
7. `guide.rewards.discovery.firstTemplateClone` (number)
8. `guide.quickBot.defaultTier` (string: novice/intermediate/advanced/master)
9. `guide.quickBot.firstTrainingTier` (string)
10. `guide.cup.sizeEntrants` (number, but read-only label — document as v1.1 tunable)
11. `guide.cup.retentionDays` (number)
12. `guide.demo.ttlMinutes` (number)
13. `metrics.internalEmailDomains` (string-array, freeform)

**Concrete steps:**

1. **Backend endpoint pair.** Mirror the existing `/admin/idle-config` pattern in `backend/src/routes/admin.js`:
   - `GET  /api/v1/admin/guide-config` → returns `{ key: value, ... }` for the 13 keys (with defaults from `seed.js`).
   - `PATCH /api/v1/admin/guide-config` → accepts `{ key1: v1, key2: v2 }` partial, writes via `setSystemConfig` from skillService. Validate types per key. Return updated map.
   - Tests: `backend/src/routes/__tests__/guideConfig.test.js` — shape + validation + admin-auth.
2. **Landing API client.** Add `api.admin.getGuideConfig(token)` + `api.admin.setGuideConfig(body, token)` in `landing/src/lib/api.js`.
3. **GuideConfigPanel component.** New file `landing/src/pages/admin/GuideConfigPanel.jsx` (or fold into AdminDashboard.jsx — *prefer separate file for cleanliness*). Mirror `MLLimitsPanel` / `IdleConfigPanel` pattern: `useEffect` load → form → save button → "✓ Saved" toast.
4. **Mount it on AdminDashboard.** Add `<GuideConfigPanel />` to the panel stack in `AdminDashboard.jsx` `default export`.
5. **Component test:** `landing/src/pages/admin/__tests__/GuideConfigPanel.test.jsx` — load → edit → save → verify API call.

**Gotchas:**
- `metrics.internalEmailDomains` is a JSON array. Render as a comma-separated textarea; parse on save.
- `guide.cup.sizeEntrants` ships in v1 but should render disabled/read-only with a "v1.1" hint. Don't let admin edit it — the cup slot mix is hardcoded in `tournament/src/config/curriculumCupConfig.js`, so changing the key alone wouldn't change behaviour.
- `guide.v1.enabled` should have a confirm-before-toggle UX (it's the release gate; flipping it off silently disables all guide credits).
- Use `getSystemConfig` from `backend/src/services/skillService.js` (not a new helper). It's the one all the other admin config endpoints use.

**SystemConfig naming convention:** the 9 already-seeded keys (after Sprint 5) plus the 4 new from this sprint = 13. The implementation plan said "14 v1 keys" — the missing one is probably the pre-existing `bots.calibrationGamesTotal` or similar non-Guide key. Ignore the count; ship the 13 listed above.

### Task #22 — A/B hook points

**Goal:** instrument `journeyService` and a new `recommendationService` (placeholder) so v1.1 experiments can plug in without re-touching these surfaces.

**Concrete steps:**

1. **Helper.** New file `backend/src/services/experimentService.js`:
   ```js
   /**
    * experimentVariant(userId, experimentKey, defaultBucket)
    *   → returns a stable per-user bucket (deterministic hash).
    *   v1 ships the surface; v1.1 wires real experiment defs.
    */
   ```
   Stable hash: `crypto.createHash('sha256').update(userId + ':' + experimentKey).digest('hex')` → take first 4 hex chars → mod into bucket count. Default bucket count from a SystemConfig key like `guide.experiments.<key>.buckets` (default 1 = no split).
2. **Hook into journeyService.** In `_handleHookComplete` and `_handleCurriculumComplete`, call `experimentVariant(userId, 'reward.amount', 'control')` and pass into the reward calc as a future-proofing hook. v1 doesn't actually branch — but the call is wired so a v1.1 experiment-def file can flip behaviour.
3. **Stub recommendationService.** New file `backend/src/services/recommendationService.js`:
   ```js
   /**
    * Placeholder for v1.1 Specialize-phase recommendations (§7).
    * v1 exports getRecommendations(userId) returning [] — no surface
    * fires this yet, but the hook surface exists so the v1.1 wire-up
    * doesn't require touching journeyService or any UI surfaces.
    */
   export async function getRecommendations(userId) {
     // experimentVariant(userId, 'rec.algorithm', 'baseline') — wired hook,
     // not yet branched. v1.1 swaps in the real catalog walker.
     return []
   }
   ```
4. **Tests:** `backend/src/services/__tests__/experimentService.test.js` — same userId+key always returns same bucket; different keys yield different buckets; bucket count from SystemConfig respected.

**Gotcha:** don't try to actually wire experiment branching in v1. The deliverable is the *surface*. Per implementation plan §5 Sprint 6: "instrumented … for future experiments".

### Task #23 — Operational runbook `doc/Guide_Operations.md`

**Goal:** doc that an on-call admin can read and act on if the funnel drops.

**Sections to write (per kickoff §3.5):**
- **Incident response** — what to do if the dashboard shows a sharp drop. For each metric (north star, funnel, signup), list: likely cause, diagnostic command (`um status`, `um testuser --audit`, dashboard panel), first remediation step.
- **Tuning SystemConfig safely** — table of the 13 keys, safe range, reversibility note (most are reversible; `guide.v1.enabled` flip can lose in-flight credits during the moment it's off).
- **Reading the dashboard** — what's healthy (north star >40%, funnel drop-off <30% per step), what's a warning, what's a fire.
- **Escalation** — who to ping (probably "Joe", but document the pattern).
- **Common operations cookbook**:
  - "Onboard a new internal admin" → `um create <name> --admin`, then `um testuser <name> --on` (the auto-flag should already do this; document for verification)
  - "Audit drift" → `um testuser --audit`
  - "Backfill the dashboard after a long downtime" → `docker compose exec backend node src/scripts/backfillMetrics.js`
  - "Disable the guide for a hotfix" → admin UI → flip `guide.v1.enabled` off (confirms warning)
  - "Re-enable guide" → flip `guide.v1.enabled` on, no other action needed

**Concrete file ops:**
- Write `/doc/Guide_Operations.md` per `feedback_doc_directory.md`.
- Render PDF per `feedback_doc_pdf_companion.md` + `feedback_pandoc_pdf_quality.md`. Pandoc command in the original Sprint6_Kickoff §5.3.
- Commit both `.md` and `.pdf` together.

### Task #24 — Unified `V1_Acceptance.md`

**Goal:** single QA script that walks Sprints 3+4+5+6 in one pass. The user runs this on local then on staging.

**Stages to script (chronological user journey):**

1. **Phase 0 funnel (Sprint 2)** — fresh-load landing as guest; verify CTA copy; play one PvAI; verify Hook step 1 credited at signup; click Build-a-bot CTA; signup.
2. **Hook (Sprint 3)** — confirm welcome modal; play to demo-table completion; verify step 2 credit + reward popup (+20 TC); confirm phase flips hook→curriculum.
3. **Curriculum — Quick Bot (Sprint 3)** — open Quick Bot wizard; verify creation triggers step 3; click "Quick Train" → verify step 4 + bot tier flips (rusty→copper).
4. **Curriculum — Spar (Sprint 4)** — go to bot profile; click Spar (easy tier); wait for completion; verify step 5 credited.
5. **Curriculum — Cup (Sprint 4)** — click Curriculum Cup clone; verify step 6 fires on participant join; wait ~30s for cup to complete; verify step 7 + Curriculum-complete reward popup (+50 TC); verify coaching card appears (CHAMPION if won, RUNNER_UP if 2nd, HEAVY_LOSS if 3-4); confirm phase flips curriculum→specialize.
6. **Discovery rewards (Sprint 5)** — train a real ML bot (qLearning or similar) → verify `firstNonDefaultAlgorithm` reward popup (+10 TC). Then enter and win a non-cup tournament → verify `firstRealTournamentWin` (+25 TC).
7. **Admin metrics (Sprint 5+6)** — sign in as admin; open `/admin/guide-metrics`; verify North Star %, funnel bars (you should appear at step 7), signup split, "excluding N test users"; switch granularity Day → Week → Month, confirm chart re-renders.
8. **Admin SystemConfig UI (Sprint 6)** — open admin dashboard; tune `guide.rewards.hookComplete` from 20 → 25; create new test user; complete Hook; verify the new user got 25 TC. Reset to 20.
9. **CLI sanity (Sprint 5)** — `um status <user>` shows phase + isTestUser + grants + TC; `um testuser --audit` lists drifted users; `um rewards show <user>` lists discovery state.
10. **Flag kill switch (Sprint 6)** — admin UI flips `guide.v1.enabled` off; create another test user; complete a journey-credit-eligible action; verify NO credit is granted; flip back on; verify subsequent action credits normally.

**Concrete file ops:** `/doc/V1_Acceptance.md` + `.pdf`. Reference (don't duplicate) the existing `Sprint3_QA.md` / `Sprint4_QA.md` for screenshot details.

### Task #25 — Final regression + commit wrap

- Backend (target: 1199 + new tests from #21/#22)
- Landing (target: 109 + new tests from #21)
- Tournament (target: 67 unchanged)
- Manual run of the existing E2E specs would be nice (`guide-phase0`, `guide-hook`, `guide-curriculum`) but not required pre-wrap; the V1_Acceptance pass covers this.
- Final commit message: "Sprint 6 — V1 release-ready. All Sprints 1-6 code complete pending acceptance pass."

---

## 3. Critical context that would be lost in compact

### 3.1 The Sprint 5 module map (still valid, repeated for convenience)

- `backend/src/services/discoveryRewardsService.js` — `grantDiscoveryReward(userId, key, io?)`. Now also reads `guide.v1.enabled` (Sprint 6).
- `backend/src/services/journeyService.js` — `completeStep(userId, stepIndex, io?)`. Same flag.
- `backend/src/services/metricsSnapshotService.js` — `runMetricsSnapshot(now?)`, `startMetricsSnapshotCron()`, plus `computeNorthStar`, `computeFunnelCounts`, `computeSignupMethodSplit`, `computeTestUserCount`, `utcDate` (all named exports).
- `backend/src/routes/admin.js` — `GET /admin/guide-metrics` returns `{ now, history }`.
- `landing/src/pages/admin/GuideMetricsPage.jsx` — mounted at `/admin/guide-metrics`. Now exports `rollupTrend` for cohort slicer testing.
- `backend/src/cli/commands/{testuser.js, rewards.js}` — wired in `um.js`.
- `backend/src/scripts/backfillMetrics.js` — Sprint 6 addition. CLI entry; not auto-run.

### 3.2 The two known v1 placeholders (still unwired)

- `firstSpecializeAction` discovery reward — no production caller. Specialize UI is v1.1 / Sprint 7.
- `firstTemplateClone` discovery reward — no production caller. User-facing template-clone UI is v1.1.

Don't try to wire these in Sprint 6.

### 3.3 The cup-slot mix is curriculum design, not config

`guide.cup.sizeEntrants` SystemConfig is reserved/informational. The actual slot mix lives in `tournament/src/config/curriculumCupConfig.js` `CURRICULUM_CUP_CONFIG.opponentSlots` (3 entries → 4-bot bracket). Changing the SystemConfig won't change behaviour. The admin UI panel must render this key as disabled/read-only.

### 3.4 What NOT to touch in Sprint 6

- Same as Sprint 5: metricsSnapshot writer, discovery-rewards service core, journey-step trigger sites, reward popup / coaching card components, Phase 0 funnel surfaces.
- Plus: the cup/demo SystemConfig wiring landed in commit `e2b61bd` — don't re-do.
- Plus: the cohort slicer landed in `863f1d2` — extend, don't rewrite.

### 3.5 Docker quirks (unchanged)

- Backend tests: `docker compose exec backend npm test` (NOT `run --rm`).
- Tournament: `cd tournament && npm test`.
- Landing: `cd landing && npm test -- --run`.
- Pre-commit hook (`/dev` skill) runs landing + backend automatically.

### 3.6 Schema location reminder

Canonical Prisma schema: `packages/db/prisma/schema.prisma`. The `backend/prisma/schema.prisma` is a stale vendored copy — do NOT edit it. Sprint 5 hit this trap.

---

## 4. First action on resume (post-compact)

1. **Read this file end-to-end.** Confirm understanding of the 5 remaining tasks.
2. **Confirm with the user**: continue in suggested order (#21 → #22 → #23 → #24 → #25), or reorder? Default if no answer in 1 round-trip: proceed in order.
3. **Start task #21** (SystemConfig admin UI):
   - Glance at `backend/src/routes/admin.js` lines 752–~1170 (existing config endpoints) for the GET/PATCH pattern.
   - Glance at `landing/src/pages/admin/AdminDashboard.jsx` (`MLLimitsPanel`, `IdleConfigPanel`, `SessionIdlePanel`, `ReplayConfigPanel`) for the form pattern.
   - Glance at `backend/prisma/seed.js` `CONFIG_DEFAULTS` for the canonical key list.
4. Per process notes (`feedback_deploy_flow.md`): user handles all `git push` / `/stage` / `/promote`. Just commit on `dev`.
5. Per `feedback_compaction.md`: keep responses concise.

**Do not** start coding immediately on resume — confirm the plan with the user first.
