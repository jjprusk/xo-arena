---
title: "Sprint 5 Kickoff — Discovery Rewards, Measurement, isTestUser"
subtitle: "Intelligent Guide v1, Sprint 5"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## Why this doc exists

This is a context primer written immediately before a `/compact` so that the post-compact Claude session has a self-contained brief on where we are and what to do next. **First action on resume: read this file end-to-end, then start Sprint 5 implementation per §3 below.**

---

## 1. Where we are

### Sprints complete (code on `dev`)

| Sprint | Code | Manual QA | DoD passed |
|---|---|---|---|
| 1 — Foundation               | done | done (Phase 1 QA)              | yes |
| 2 — Phase 0 funnel           | done | done (Phase 1 QA + QA pass D)  | yes |
| 3 — Hook + Quick Bot         | done | DEFERRED to unified v1 QA       | no  |
| 4 — Curriculum + Coaching    | done | DEFERRED to unified v1 QA       | no  |

### The agreed v1 strategy (decided this turn)

Per the user's Sprint-5 strategy call: **don't QA Sprint 5 or Sprint 6 individually**. Defer to a single unified v1 acceptance QA that walks Sprints 3 + 4 + 5 + 6 in one pass. Rationale:

- Sprint 5 is measurement infrastructure (orthogonal to user flows) — unit tests carry most of the regression weight.
- Sprint 6's own DoD *requires* unified QA anyway ("Staging validation period: 1 week minimum, 10+ internal users complete the full funnel"). So there's no separate Sprint 6 QA — the v1 acceptance pass IS Sprint 6's DoD.
- Mini-QAs between sprints would mostly retread surfaces the next sprint touches.

**Optional tripwire** the user is considering: a single `smoke.guide.spec.js` Playwright that signs up → runs one Hook step → confirms the credit fires. ~5 min run. If a sprint breaks the journey events catastrophically, this catches it without burning 30 min on a stage-by-stage walkthrough. The user did NOT yet confirm whether to add this — ask on resume before writing it.

### Latest dev branch state

Branch: `dev`. Latest commits (newest first):

- `62a5288` — doc: Sprint 4 QA walkthrough
- `4995ac6` — test(guide): Sprint 4 — guide-curriculum.spec.js E2E
- `1ba3f7c` — feat(guide): Sprint 4 — GC sweeps for spar TTL + cup retention
- `4e7be8e` — feat(guide): Sprint 4 — Coaching card on cup completion
- `1385331` — feat(guide): Sprint 4 — Curriculum Cup clone endpoint
- `fd8a9a2` — feat(guide): Sprint 4 — wire Curriculum step 6 on tournament registration
- `6d3ba3d` — feat(guide): Sprint 4 — Spar panel on BotProfilePage
- `f315a1e` — feat(guide): Sprint 4 — Spar endpoint (POST /bot-games/practice)
- `32c7129` — doc: Sprint 4 kickoff + archive Phase 1 QA docs

Test counts at this kickoff: **backend 1132/1132**, **tournament 67/67**, **landing 100/100**.

### Authoritative docs

- **What** — `doc/Intelligent_Guide_Requirements.md` (the spec; do not re-specify behavior)
- **How / when** — `doc/Intelligent_Guide_Implementation_Plan.md` (sprints + master checklist; update §9 as items complete)
- **Sprint 4 QA script** — `doc/Sprint4_QA.md` (will run as part of unified v1 QA)
- **Sprint 3 QA script** — `doc/Sprint3_QA.md` (ditto)
- **Sprint 4 kickoff** — `doc/Sprint4_Kickoff.md` (covers the journey-trigger map, reward popup wiring, EmailVerifyBanner styling, etc. — re-read §4 if any of those surfaces come up in Sprint 5 work)
- **This doc** — Sprint 5 kickoff context

---

## 2. The plan

1. Implement Sprint 5 deliverables on `dev` per the implementation plan §5 Sprint 5.
2. Run unit + component tests at each milestone, commit in logical chunks (one feature per commit).
3. **No `Sprint5_QA.md`** — the surfaces are unit-testable, and any product-flow QA folds into the unified v1 pass.
4. Move directly to Sprint 6 when Sprint 5 is code-complete.
5. After Sprint 6 is code-complete, write a single `V1_Acceptance.md` that walks Sprints 3+4+5+6 in one pass.
6. User runs unified QA, then `/stage` for the joint promotion, then a 1-week staging soak per Sprint 6 DoD.

---

## 3. Sprint 5 deliverables (from Implementation Plan §5 Sprint 5)

**Sprint goal:** finish the v1 rewards system, start capturing metrics, and prevent internal-usage pollution.

### 3.1 Discovery rewards (§5.7)

- `discoveryRewardsGranted: string[]` on `userPreferences` (or wherever user-prefs live — check existing journey-progress field for the pattern).
- Event-triggered grant logic for **4 one-shot rewards**:
  - First Specialize recommendation acted on (+10 TC) — *placeholder for v1.1; logic ships now but no surface fires it yet*
  - First non-Curriculum tournament win (+25 TC)
  - First bot trained with non-default algorithm (+10 TC)
  - First template clone (+10 TC)
- SystemConfig keys: `guide.rewards.discovery.specializeAct`, `guide.rewards.discovery.nonCurriculumWin`, `guide.rewards.discovery.nonDefaultAlgorithmTrain`, `guide.rewards.discovery.firstTemplateClone` (or similar — check existing key naming convention in `seed.js`'s `CONFIG_DEFAULTS`).
- Idempotent grants — never double-pay. The `discoveryRewardsGranted` array is the dedupe key.

### 3.2 `isTestUser` flag + metrics-pollution prevention (§2)

- Migration is already in place from Sprint 1 — the column exists. Sprint 5 wires the **defaults**:
  - Users with admin role → default `isTestUser: true` on role-assignment
  - Users created via `seed.js` / `setup-qa-users.sh` → `isTestUser: true` on creation
  - Users matching `metrics.internalEmailDomains` → `isTestUser: true` on creation
- Admin setting toggle: "Include my activity in platform dashboards" (default off for admins).
- New SystemConfig key: `metrics.internalEmailDomains` (default empty array).

### 3.3 MetricsSnapshot cron job

- Daily UTC-midnight aggregator. Computes:
  - **North Star metric** — definition lives in `Intelligent_Guide_Requirements.md` (verify, but I think it's "weekly active users who completed Hook" or similar)
  - 7-step funnel completion (counts at each step)
  - Signup method split (build-bot CTA vs. plain "Sign in")
  - Time-to-signup median
- All aggregations filter `WHERE user.isTestUser = false`.

### 3.4 Admin dashboard `/admin/guide-metrics`

- North Star metric + 30-day trend line
- 7-step funnel with drop-off per step
- Signup method split
- Time-to-signup distribution
- Footer: "excluding N test users"

### 3.5 `um` CLI enhancements (§10.6)

- `um testuser` (`on` / `off` / `list` / `audit`)
- `um rewards` (`show` / `grant` / `revoke` / `reset`)
- `um status` additions (phase, isTestUser, discovery grants, TC balance) — extend, don't replace

### 3.6 Tests (per §10 + Sprint 5 testing requirements)

- `discoveryRewards.test.js` — all 4 events trigger correctly, idempotent
- `isTestUser.test.js` — auto-flag on admin role, email-domain match, seed creation
- `metricsSnapshot.test.js` — correct aggregation vs fixture, isTestUser exclusion, idempotent re-run
- `guideMetrics.test.js` — dashboard endpoint shape, requires admin role
- Component: `GuideMetricsPage.test.jsx` — renders with fixture, handles empty state

### 3.7 Definition of Done (Sprint 5 only — no QA gate)

- All Sprint 5 unit tests green
- Dashboard renders with seeded test data
- `um` extensions work end-to-end against local dev
- No regression in backend/landing/tournament suites
- DoD-pass-from-QA gate is *not* this sprint — it's part of the unified v1 acceptance

---

## 4. Critical context that would be lost in compact

### 4.1 Journey-step trigger map (current, post-Sprint 4)

| Step | Trigger | Code location |
|---|---|---|
| 1 | PvAI game complete (HvB, NOT PvP)                | `games.js`, `socketHandler.js` |
| 2 | Demo Table watched ≥ 2 min OR seen to completion | `DemoArena.jsx` (guests, localStorage); `botGameRunner._recordGame` (signed-in viewers credited on demo completion) |
| 3 | Bot created (Quick Bot or full Gym)              | `bots.js`, `bots/quick.js` |
| 4 | Bot trained (depth bump or real ML run)          | `mlService.js`, `skillService.js`, train-quick endpoint |
| 5 | Spar match completed                             | `botGameRunner._recordGame` when `game.isSpar && game.sparUserId` |
| 6 | Tournament registration                          | `tournamentBridge.js` on `tournament:participant:joined` (publish payload now includes `userId` per Sprint 4) |
| 7 | Tournament completion with `finalPosition`       | `tournamentBridge.js` on `tournament:completed` |

**Important:** the client-triggered `POST /api/v1/guide/journey/step` endpoint was removed in Sprint 1. All step transitions must come from server-detected events. Do not re-introduce.

### 4.2 Reward popup + Coaching card wiring (Sprints 3 + 4)

- `landing/src/components/guide/RewardPopup.jsx` — listens for `guide:hook_complete` (+20 TC) and `guide:curriculum_complete` (+50 TC). Both emitted by `journeyService.js` when `deriveCurrentPhase()` flips.
- `landing/src/components/guide/CoachingCard.jsx` — listens for `guide:coaching_card`. Emitted by `tournamentBridge.js` on `tournament:completed` for `isCup` tournaments only. Card chosen by `pickCoachingCard()` in `backend/src/config/coachingCardRules.js`.

Sprint 5 doesn't need to add new emissions — but the **Discovery reward** grant probably wants its own client-visible popup or in-stack notification. Check whether `dispatch({type: 'guide.notification', ...})` (the existing in-stack toast bus) is sufficient, or if a new popup variant is warranted. Lean toward in-stack — discovery rewards are smaller (+10/+25 TC) and shouldn't take over the screen the way the Hook/Curriculum boundary popups do.

### 4.3 Curriculum Cup is in-code config, NOT a template row

Sprint 4 deviated from the kickoff plan: the Cup spawns from constants in `tournament/src/config/curriculumCupConfig.js` rather than a `TournamentTemplate` DB row. Reasons documented in commit `1385331`. **Implication for Sprint 5:** the metrics snapshot can NOT count cups by joining on a template id — it must filter `WHERE isCup = true`. Same for any "first cup completed" discovery reward (none planned, but if added).

### 4.4 Cup-clone bot accumulation

Each cup spawns 3 ownerless `bot-cup-*` User rows. The 30-day GC sweep (`tournament/src/lib/tournamentSweep.js → sweepOldCups`) deletes them with the cup. **Implication for Sprint 5 metrics:** counts of "active bots" should filter `WHERE isBot = false OR (isBot = true AND username NOT LIKE 'bot-cup-%')` to avoid inflating bot population by cup activity.

### 4.5 `didTrainImprove` is a Sprint 4 placeholder

`tournamentBridge.js` always passes `didTrainImprove: false` to `pickCoachingCard()` in v1. The `ONE_TRAIN_LOSS` coaching card branch is unit-tested but never fires in production. Sprint 7 (v1.1) computes the flag from ML model history. **Don't try to wire this in Sprint 5.** It's a known gap in the Sprint 4 commit message.

### 4.6 The two suites + the docker container quirks

- Backend tests: run via `docker compose exec backend npm test`. Do NOT use `docker compose run --rm backend ...` — fresh container has stale node_modules missing `web-push` (a known infra gap from Sprint 4). The pre-commit hook uses `exec`.
- Tournament tests: `cd tournament && npm test` (host).
- Landing tests: `cd landing && npm test -- --run` (host).

### 4.7 Memory entry — DB migrations

After any schema change (Discovery rewards likely needs none if `discoveryRewardsGranted` is a JSON column on existing `userPreferences`; isTestUser column already exists from Sprint 1), run migrations inside the backend container:

```sh
docker compose run --rm backend npx prisma migrate deploy
```

DB is unreachable from host. Per `feedback_db_migrations.md`.

### 4.8 What NOT to touch in Sprint 5

- The Curriculum Cup endpoint, BotGameRunner, Coaching card rules — all Sprint 4 work, stable.
- The journey-step trigger sites (games.js, bots.js, mlService.js, tournamentBridge.js, botGameRunner.js) — all wired correctly. Only adding Discovery-reward grant calls into existing event paths.
- The reward popup at the Hook/Curriculum boundaries — that's the `journeyService._handleCurriculumComplete` path, separate from Discovery rewards.

---

## 5. Process notes

### 5.1 Workflow

- User handles all `git push` / `/stage` / `/promote` / Fly operations. Never run those unless explicitly invoked. Per `feedback_deploy_flow.md`.
- `/dev` skill commits + pushes to `dev`. Pre-commit hook runs the full test suite. Use it for end-of-feature commits.
- For ad-hoc commits during a feature, plain `git commit` (no push) is fine — user pushes when ready.
- Always promote `dev → staging → main`, never reverse. Per `feedback_stage_direction.md`.

### 5.2 Tests

- Backend: `docker compose exec backend npm test` (1132 baseline)
- Landing: `cd landing && npm test -- --run` (100 baseline)
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

1. **Read this file end-to-end.** Confirm understanding of §3 (Sprint 5 scope) and §4 (critical context).
2. **Ask the user about the tripwire smoke spec** (mentioned in §1) — they did NOT confirm whether to add `smoke.guide.spec.js` before starting Sprint 5. Before any code, ask: "Tripwire smoke spec first, or straight to Sprint 5 code?"
3. Read implementation plan §5 Sprint 5 (lines 332–386 of `doc/Intelligent_Guide_Implementation_Plan.md`) to confirm nothing changed.
4. Brief glance at:
   - `backend/src/services/journeyService.js` — to find where Discovery-reward grant calls would attach (likely a sibling helper to `_handleCurriculumComplete`)
   - `backend/prisma/seed.js` `CONFIG_DEFAULTS` — for the SystemConfig key naming convention
   - `backend/src/middleware/auth.js` and `backend/src/routes/admin.js` — for where the admin-role-on-assign hook lives (isTestUser auto-flag)
   - `backend/src/services/userService.js` `createGame` — for the "first non-default-algo train" trigger site
   - `landing/src/pages/admin/AdminTournamentsPage.jsx` (or equivalent) — for the admin-page layout pattern to mirror in `/admin/guide-metrics`
   - `um` CLI source (likely `scripts/um/` or similar) — for the existing command pattern to extend
5. Propose an implementation order. Suggested:
   1. SystemConfig keys + Discovery-rewards service module + tests (smallest, isolated)
   2. Wire Discovery-reward grant calls into the 3 server-side event paths
   3. isTestUser auto-flag on admin role + seed/email-domain → tests
   4. MetricsSnapshot cron + aggregation logic → tests
   5. `/admin/guide-metrics` API endpoint + tests
   6. `GuideMetricsPage.jsx` component + tests
   7. `um` CLI extensions
   8. Run full regression
6. Confirm the order with the user before writing code (per the project's "match scope of actions to what was actually requested" guidance).

**Do not** start coding immediately on resume — confirm the plan with the user first.
