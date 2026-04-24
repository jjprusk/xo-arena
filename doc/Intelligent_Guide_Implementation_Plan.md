# Intelligent Guide — Implementation Plan

**Status:** v1 Draft
**Author:** Joe Pruskowski (with Claude)
**Date:** 2026-04-24
**Requirements source:** [`Intelligent_Guide_Requirements.md`](./Intelligent_Guide_Requirements.md) — that doc is the *what*; this doc is the *how* and *when*.

---

## 1. Purpose & Scope

This plan translates the Intelligent Guide Requirements into an actionable engineering roadmap. It:

- Breaks the work into **v1 (ship first)** and **v1.1 (ship post-data)** releases
- Organises each release into **2-week sprints** with concrete deliverables
- Attaches **testing requirements** to every sprint (unit, component, E2E, smoke)
- Provides a **master progress checklist** so both sides stay aligned on what's done
- Flags **risks and critical-path dependencies** so nothing gets blocked silently

**What this doc is not:** a re-specification of the features. For any detail ("what are the 4 discovery rewards?" "what does the archetype detection formula look like?") → read the requirements doc section referenced by each task.

---

## 2. Release Strategy & Rationale

### v1 vs v1.1 — why we split

The full requirements doc covers a lot of ground, much of which only makes sense with real user data. **Shipping Specialize phase pre-launch means tuning the archetype thresholds, cross-bucket disqualifiers, and recommendation catalog *blind*** — we have no data on what users actually do. Better to:

1. Ship **v1** (visitor → registered → Curriculum-graduated) — the funnel that generates the data
2. Observe **30 days of production usage** — actual archetype distributions, drop-off points, feature engagement
3. Ship **v1.1** (Specialize + depth features) — thresholds calibrated from real distributions, not guessed

### v1 Scope (ship first — the funnel)

- Phase 0 — Visitor → Registered User (§3.5 of requirements)
- New 7-step journey, Hook + Curriculum (§4)
- Supporting features: Demo Table, Spar, Quick Bot, Curriculum Cup, Coaching card, Journey migration (§5.1–§5.6)
- Discovery rewards — 4-item subset (§5.7)
- `isTestUser` flag + uniform metrics filter (§2 pollution prevention)
- SystemConfig keys for all above tunables (§8.4)
- Basic measurement dashboard (North Star, funnel, signup methods, time-to-signup)
- `um` CLI: journey-phase shortcuts, `testuser`, `rewards` (§10.6)
- Testing: backend unit tests, UI component tests, E2E (guide-hook + guide-curriculum) (§10.1–§10.3)

### v1.1 Scope (ship second — the depth)

- Specialize phase (recommendation engine, 4 buckets, scoring, dismissal) (§6, §7.1–§7.3)
- Stagnation handling — decay + wildcard modes (§7.4)
- Progressive intensity escalation (§7.5)
- Rookie Cup template + deterministic bracket seeding (§5.8, §5.9)
- Admin experience — opt-in player Guide + role-gated tiles (§9.5)
- Dashboard additions: per-bucket archetype score histograms, cohort slicer
- `um specialize` command + remaining `um` enhancements
- Re-engagement nudges (14-day inactivity socket + orb pulse)
- Testing: bucket detection, stagnation, Explorer archetype E2Es (§10.3)

### Explicitly out of both v1 and v1.1 (defer to v2)

- Magic-link signin (§3.5 deferred)
- Social-proof counters on landing (§3.5 deferred)
- Archetype-seeded SlotGrid defaults (§13 Q12 — deferred with data trigger)
- Admin recommendation stack (§9.5 deferred — tiles are enough)
- Q&A mode / conversational coach (§2 non-goals)

---

## 3. Execution Model & Sprint Assumptions

### Who does the work

**Model B: Claude Code as primary implementer, with selective sub-agent parallelism.**

- **Joe (product owner):** directional decisions, go/no-go on designs, UX feedback, all `git push` / deploy operations (per established flow), final sign-off on each sprint's Definition of Done.
- **Claude Code (primary implementer):** writes the code, runs the tests, commits to `dev`, renders docs, updates the master checklist in §9 as items complete, reports blockers.
- **Sub-agents (selective use):** spawned only for specific patterns where they pay off.

### When sub-agents are used (and when they aren't)

**Used for:**

1. **Bounded codebase research** — Explore agents for questions like "find all current callers of `journeyService.completeStep` and summarize their expected interface." Saves context in the main session and parallelizes research-heavy sprint kickoffs.
2. **Truly parallel implementation tracks** — isolated-worktree general-purpose agents when two sprint deliverables touch disjoint file sets and can run concurrently. Example: Sprint 3's Demo Table endpoint (backend, `backend/src/routes/`) and JourneyCard rewrite (frontend, `landing/src/components/`) could run in parallel worktrees. Claude reviews each sub-agent's output before merging.

**Not used for:**

- Ongoing ownership of a sprint or a feature — sub-agents don't retain state between invocations; coordination overhead dominates
- Cross-cutting changes that span backend + frontend + tests — single sequential pass is faster
- Work requiring real-time back-and-forth with the product owner — that's the main session

### Sprint cadence

- **Sprint length:** 2 weeks
- **Velocity:** roughly equivalent to 1 full-stack engineer working ~full-time, with ~1.3× effective throughput when parallelism kicks in (conservative; sub-agent coordination adds overhead)
- **Staging deploy:** after every sprint (user-driven per the existing `/stage` flow)
- **Production deploy:** v1 at end of Sprint 6, v1.1 at end of Sprint 11 (user-driven)

Timeline estimate if assumptions hold:

| Release | Sprints | Calendar time |
|---|---|---|
| v1 | 6 sprints | ~12 weeks |
| *(30-day observation window)* | — | ~4 weeks |
| v1.1 | 5 sprints | ~10 weeks |
| **Total** | **11 sprints + observation** | **~26 weeks (~6 months)** |

Actual pace will vary — some sprints (e.g. Sprint 2 Phase 0) may stretch, others (e.g. Sprint 5 rewards) compress. Adjust as reality emerges.

---

## 4. Critical Path & Dependencies

Not all work can run in parallel. The dependency graph:

```
Sprint 1 (schema + journey service)
    ↓
Sprint 2 (Phase 0 — depends on journey infra)
    ↓
Sprint 3 (Hook + Quick Bot — depends on journey)
    ↓
Sprint 4 (Curriculum Cup + Coaching — depends on Hook working)
    ↓
Sprint 5 (Discovery rewards + measurement + isTestUser — partly parallel with Sprint 4)
    ↓
Sprint 6 (polish + release)
    ↓ (30-day observation)
Sprint 7 (Specialize core — depends on v1 data)
    ↓
Sprint 8 (Rookie Cup — depends on Specialize Competitor bucket being live)
    ↓
Sprint 9 (Stagnation + Admin experience — partly parallel)
    ↓
Sprint 10 (Full measurement + re-engagement)
    ↓
Sprint 11 (v1.1 polish + release)
```

**Critical-path items** (if these slip, everything after them slips):
- Sprint 1: schema + journey rewrite (all v1 features depend on it)
- Sprint 2: Phase 0 signup flow (without registered users, nothing works)
- Sprint 7: recommendationService (all v1.1 Specialize features depend on it)

---

## 5. V1 Sprint Plan

### Sprint 1 — Foundation: Schema + Journey Service Rewrite

**Sprint goal:** lay the foundation all other v1 work sits on. Every subsequent sprint depends on this.

**Deliverables:**

- [x] Prisma migration adding new fields (`20260424130000_intelligent_guide_v1_foundation`):
  - [x] `Table.isDemo` (boolean default false) — §8.4
  - [x] `Game.isSpar` (boolean default false) — *[note: per-field correction — bot games aren't persisted as their own table; isSpar lives on the completed Game row]*
  - [x] `Tournament.isCup` (boolean default false)
  - [x] `Tournament.seedingMode` + `TournamentTemplate.seedingMode` (enum `TournamentSeedingMode`: `random` | `deterministic`, default `random`)
  - [x] `User.isTestUser` (boolean default false)
  - [x] `metrics_snapshots` table `{ id, date, metric, value, dimensions (JSON), createdAt }`
- [x] Rewrite `backend/src/services/journeyService.js`:
  - [x] 7-step spec per §4 with server-detectable triggers
  - [x] Hook/Curriculum/Specialize phase state derivation (`deriveCurrentPhase`)
  - [x] Reward grants at step 2 (+20 TC) and step 7 (+50 TC), both admin-configurable
  - [x] Emit `guide:hook_complete`, `guide:curriculum_complete`, `guide:specialize_start` events
- [x] Remove `POST /api/v1/guide/journey/step` (no more client-triggered steps)
- [x] Wipe existing `journeyProgress` on deploy (folded into the migration itself)
- [x] SystemConfig keys seeded (via `backend/prisma/seed.js`):
  - [x] `guide.rewards.hookComplete` (20)
  - [x] `guide.rewards.curriculumComplete` (50)
  - [x] `guide.quickBot.defaultTier` (`"novice"`)
  - [x] `guide.quickBot.firstTrainingTier` (`"intermediate"`)
- [x] Additional step-trigger remapping across callers (games.js, socketHandler.js, bots.js, mlService.js, skillService.js, tournamentBridge.js) — not originally scoped but required by the step-number renumbering
- [x] `um journey` enhancements — `--phase hook|curriculum|specialize`, `--graduate` alias, deeper `--reset` (clears `discoveryRewardsGranted` + `specializeState`), richer output with phase label and next-step hint (§10.6)

**Testing requirements:**

- [x] `journeyService.test.js` — 25 new tests: constants, phase derivation, step completion, both rewards with admin-config override, event emissions, error handling (§10.1)
- [x] `guide.test.js` updated — removed auto-step-1-on-hydration assertion, added POST /journey/step 404 assertion (7 tests touched)
- [x] Migration test via the seed test suite (`prisma/__tests__/seed.test.js` passed)
- [x] Migration applied in the docker-compose Postgres; `prisma generate` ran clean
- [ ] **Staging smoke** — user-driven via `/stage` flow when ready

**Definition of Done:**

- [x] All backend tests pass (**1064 tests green**, +32 new, zero regressions)
- [x] All landing tests pass (**50 tests green**)
- [x] Migration runs clean on the Docker Compose DB (to be re-verified against staging DB at `/stage` time)
- [x] `um journey alice --phase specialize` successfully transitions a test user through all 7 steps (manually verified via the richer output format; unit tests cover the underlying state transitions)

**Shipped as commit `d33eb50` on `dev`.**

---

### Deferred from Sprint 1 (by design — parked for the right sprint)

- **Step 6 trigger** (tournament entry for *non-Cup* tournaments) — requires upgrading the `tournament:participant:joined` event payload to include userId so `tournamentBridge.js` can fire `completeStep(userId, 6)`. Moved to **Sprint 4** alongside Curriculum Cup, where the clone endpoint fires step 6 directly on the same pass.
- **Step 2 and Step 5 triggers** (Hook demo-watch + Curriculum spar) — require features that ship in Sprints 3 & 4 respectively (Demo Table macro §5.1, public Spar endpoint §5.2). Trigger wiring lands with those features.

---

### Sprint 2 — Phase 0: Visitor → Registered User

**Sprint goal:** the highest-leverage work in v1 — convert landing visitors into registered users with a live demo, guest mode, and contextual signup.

**Deliverables:**

- [ ] Landing page redesign (`landing/src/pages/HomePage.jsx`):
  - [ ] Live bot-vs-bot demo arena as the hero (reuses §5.1 Demo Table infrastructure — plumbing built this sprint, full macro in Sprint 3)
  - [ ] Progressive CTA ladder: "Watch another match" / "Play against a bot" / "Build your own bot"
  - [ ] Replace existing generic hero copy
- [ ] Guest mode (client-only, localStorage):
  - [ ] `guideGuestJourney` localStorage schema
  - [ ] Step 1 recording on PvAI game completion
  - [ ] Step 2 recording on demo-match watched ≥ 2 min
- [ ] Guest → user transfer:
  - [ ] `POST /api/v1/guide/guest-credit` endpoint
  - [ ] Client-side call on successful signup
  - [ ] localStorage cleared on success
- [ ] Signup modal updates (`landing/src/components/ui/SignInModal.jsx`):
  - [ ] Defer email verification — user logged in immediately post-signup
  - [ ] Soft banner: "Verify your email to enter tournaments"
  - [ ] Contextual copy variant when opened from "Build a bot" CTA
  - [ ] Email verification gate on tournament entry (backend middleware check on tournament register endpoint)

**Testing requirements:**

- [ ] Component test: `HomePage.test.jsx` — new CTAs render, demo embed present
- [ ] Component test: `SignInModal.test.jsx` — deferred verification behavior, contextual copy variants
- [ ] Backend test: `guideGuestCredit.test.js` — idempotency, only Hook steps eligible, invalid data rejected
- [ ] Backend test: tournament-entry endpoint rejects users with unverified email (201 → 403 with action message)
- [ ] E2E test: `guide-phase0.spec.js` — new spec covering visitor → PvAI → demo-watch → "Build a bot" click → signup → lands in Curriculum step 3 with Hook credited

**Definition of Done:**

- On staging, a visitor can complete the full visitor → Curriculum step 3 flow in under 5 minutes without hitting errors
- Hook steps 1 and 2 visibly credited to the new user's `journeyProgress`
- No account can enter a tournament without a verified email
- Metrics for "landing → signup within 7 days" start being recorded

---

### Sprint 3 — Hook + Quick Bot Wizard

**Sprint goal:** make Hook completion natural and get users to their first bot via Quick Bot.

**Deliverables:**

- [ ] Demo Table macro (§5.1) — full implementation:
  - [ ] `POST /api/v1/tables/demo` endpoint
  - [ ] Curated allowlist in `tournament/src/config/demoTableMatchups.js` (Copper/Sterling, Rusty/Copper, Copper/Copper, Sterling/Sterling)
  - [ ] `isDemo` flag on created tables, creator-only visibility filter on public tables list
  - [ ] GC sweep: 1 active per user (replace existing on new), match-complete+2min grace, 1-hour TTL
- [ ] Quick Bot wizard (§5.3):
  - [ ] 3-step UI in `landing/` (Name → Persona → Confirm)
  - [ ] `POST /api/v1/bots/quick` backend endpoint
  - [ ] Sets `botModelId = user:<userId>:minimax:novice` by default
  - [ ] Fires journey step 3 completion
- [ ] Quick Bot "training" flow (difficulty bump):
  - [ ] "Train your bot" button on the bot detail page triggers the depth bump to `intermediate`
  - [ ] Fires journey step 4 completion (from Quick Bot flow — complementing the existing mlService trigger for real ML)
- [ ] `JourneyCard` rewrite (§9.1):
  - [ ] Phase-aware rendering: `phase` prop with `'hook' | 'curriculum' | 'specialize'`
  - [ ] Hook phase: single hero card, no preview
  - [ ] Curriculum phase: hero card + 5-row checklist with current highlighted, completed ✓, future dimmed
- [ ] Reward popup firing for step 2 completion (+20 TC)

**Testing requirements:**

- [ ] Backend: `tablesDemo.test.js` (endpoint behavior, rate, GC), `botsQuick.test.js` (wizard flow, validation)
- [ ] Component: `JourneyCard.test.jsx` (Hook/Curriculum render variants), `QuickBotWizard.test.jsx` (3-step flow)
- [ ] E2E: `guide-hook.spec.js` (new signup → PvAI → demo table watch → step 1 + 2 + reward)
- [ ] Integration: confirm journey step 3 fires on Quick Bot creation (not just on full bot form)

**Definition of Done:**

- A user who completes Phase 0 lands in Curriculum step 3 and can finish it in under 2 minutes via Quick Bot
- Demo tables get GC'd correctly (verify by leaving one running overnight — should be deleted next day)
- JourneyCard visibly shows "Step 3 of 5" with checklist preview

---

### Sprint 4 — Curriculum Cup, Spar, Coaching Card

**Sprint goal:** complete the Curriculum funnel — users can spar, enter their first tournament, and receive coached feedback.

**Deliverables:**

- [ ] Spar endpoint (§5.2):
  - [ ] `POST /api/v1/bot-games/practice` accepts `{ myBotId, opponentTier: 'easy' | 'medium' | 'hard' }`
  - [ ] Ownership + role checks
  - [ ] `isSpar` flag on created BotGame
  - [ ] One-active-spar-per-bot semantic guard (replaces previous in-flight spar)
  - [ ] 30-day retention (added to tournamentSweep)
  - [ ] 2-hour TTL for in-flight safety
- [ ] "Spar now" button on bot detail page + Guide card at Curriculum step 5
- [ ] Fires journey step 5 on spar match completion
- [ ] Curriculum Cup (§5.4):
  - [ ] Migration: seed "Curriculum Cup" template (4 slots — 1 user placeholder + 2 Rusty + 1 Copper)
  - [ ] `POST /api/v1/tournaments/curriculum-cup/clone` endpoint (reuses existing template-clone machinery)
  - [ ] Themed name pools in `tournament/src/config/curriculumNamePools.js` (24 curated names across 3 tiers)
  - [ ] `isCup = true` on clones, private to creator
  - [ ] Immediate-start on clone (no manual registration phase)
  - [ ] GC sweep phase for 30-day retention
- [ ] Fires journey step 6 on tournament registration; step 7 on tournament completion with finalPosition
- [ ] Reward popup for step 7 (+50 TC)
- [ ] Coaching card (§5.5):
  - [ ] `backend/src/config/coachingCardRules.js` with the 4-branch decision tree
  - [ ] Card displayed on step-7 completion (server sends card data alongside reward event)
  - [ ] Four CTA actions wired: Rookie Cup placeholder (text CTA only in v1 — full Rookie Cup ships v1.1), Train Again, Switch Algorithm

**Testing requirements:**

- [ ] Backend: `spar.test.js` (role check, ownership, tier selection, concurrent guard, GC)
- [ ] Backend: `curriculumCup.test.js` (clone produces expected bracket shape, name-pool draw without duplicates, isCup flag set)
- [ ] Backend: `coachingCardRules.test.js` (all 4 branches hit with expected title/body/CTA)
- [ ] E2E: `guide-curriculum.spec.js` — full Curriculum run from step 3 to step 7 with reward popup and coaching card asserted
- [ ] Integration: journey steps 5, 6, 7 fire in correct order

**Definition of Done:**

- A user who graduates from Sprint 3's state can reach step 7 and see a coaching card in under 5 minutes (not counting the ~2 min the Cup itself runs)
- Coaching card correctly identifies user as champion / runner-up / 1-train-loss / heavy-train-loss based on state
- Reward popup fires with +50 TC
- User lands in "Specialize placeholder" state (full Specialize ships v1.1)

---

### Sprint 5 — Discovery Rewards, Measurement Foundation, `isTestUser`

**Sprint goal:** finish the v1 rewards system, start capturing metrics, and prevent internal-usage pollution.

**Deliverables:**

- [ ] Discovery rewards (§5.7):
  - [ ] `discoveryRewardsGranted` array on user preferences
  - [ ] Event-triggered grant logic for the 4 one-shot rewards:
    - First Specialize recommendation acted on (+10 TC) — placeholder for v1.1, logic ships now
    - First non-Curriculum tournament win (+25 TC)
    - First bot trained with non-default algorithm (+10 TC)
    - First template clone (+10 TC)
  - [ ] SystemConfig keys for each reward amount (`guide.rewards.discovery.*`)
  - [ ] Idempotent grants (never double-pay)
- [ ] `isTestUser` flag + metrics pollution prevention (§2):
  - [ ] Migration already done in Sprint 1; now wire the defaults:
    - Users with admin role → default true on role-assignment
    - Users created via `seed.js` / `setup-qa-users.sh` → true on creation
    - Users matching `metrics.internalEmailDomains` → true on creation
  - [ ] Admin setting toggle: "Include my activity in platform dashboards" (default off for admins)
  - [ ] SystemConfig key: `metrics.internalEmailDomains` (default empty array)
- [ ] MetricsSnapshot cron job:
  - [ ] Daily UTC-midnight aggregator
  - [ ] Computes: North Star metric, 7-step funnel completion, signup method split, time-to-signup median
  - [ ] All aggregations filter `WHERE user.isTestUser = false`
- [ ] Basic admin dashboard `/admin/guide-metrics`:
  - [ ] North Star metric + 30-day trend line
  - [ ] 7-step funnel with drop-off per step
  - [ ] Signup method split
  - [ ] Time-to-signup distribution
  - [ ] "excluding N test users" footer
- [ ] `um` CLI enhancements (§10.6):
  - [ ] `um testuser` command (on / off / list / audit)
  - [ ] `um rewards` command (show / grant / revoke / reset)
  - [ ] `um status` additions (phase, isTestUser, discovery grants, TC balance)

**Testing requirements:**

- [ ] Backend: `discoveryRewards.test.js` (all 4 events trigger correctly, idempotent)
- [ ] Backend: `isTestUser.test.js` (auto-flag on admin role, email domain match, seed creation)
- [ ] Backend: `metricsSnapshot.test.js` (correct aggregation vs fixture, isTestUser exclusion, idempotent re-run)
- [ ] Backend: `guideMetrics.test.js` (dashboard endpoint shape, requires admin role)
- [ ] Component: basic `GuideMetricsPage.test.jsx` (renders given fixture data, handles empty state)
- [ ] `um testuser` + `um rewards` + `um status` unit tests

**Definition of Done:**

- The dashboard is live on staging and shows data from staging activity
- `um testuser --audit` correctly identifies any drift
- Running the daily cron for a day shows metrics rows appearing in `metricsSnapshot` table
- All metrics exclude test users (verifiable via the footer count)

---

### Sprint 6 — V1 Polish + Release

**Sprint goal:** shake out bugs, document operational procedures, ship v1 to production.

**Deliverables:**

- [ ] Dashboard cohort slicer with admin-selectable granularity (Day / Week / Month, default Week) (§2)
- [ ] Backfill script for any metrics derivable from raw events (so day-1 dashboard isn't empty)
- [ ] A/B hook points instrumented in `recommendationService` (placeholder) and `journeyService` for future experiments
- [ ] SystemConfig UI — admin settings page gains the 14 v1 SystemConfig keys with inline editing
- [ ] Operational runbook: `/doc/Guide_Operations.md`:
  - Incident response: what to do if the funnel drops
  - How to tune SystemConfig values safely
  - How to read the dashboard
  - When to escalate
- [ ] Staging validation period (1 week minimum):
  - [ ] 10+ internal users complete the full funnel
  - [ ] Dashboard metrics sane
  - [ ] No critical bugs

**Testing requirements:**

- [ ] Full regression: all backend tests, all UI component tests, all E2E tests
- [ ] Staging smoke-test sequence — `guide-phase0`, `guide-hook`, `guide-curriculum`
- [ ] Load test (basic): 100 concurrent fake signups via script, verify no race conditions in journey-state updates
- [ ] Dashboard stress test: 30 days of snapshot data rendered without hang

**Definition of Done — V1 Acceptance Criteria:**

- [ ] **Conversion:** 2× baseline landing-to-signup conversion in staging comparison (14-day window)
- [ ] **Funnel:** ≥ 60% of new signups arrive with Hook pre-credited
- [ ] **Time-to-signup:** median < 10 minutes
- [ ] **Journey completion:** Staging internal testers: ≥ 80% complete Hook (steps 1-2) in first session; ≥ 30% complete full Curriculum in 7 days
- [ ] **Metrics:** Dashboard populated, exclude test users, cohort slicer works
- [ ] **No critical bugs:** P0/P1 bugs at zero during staging validation week
- [ ] **Tests:** All Sprint 1-6 test suites green
- [ ] **Deployed:** production behind a feature flag (`guide.v1.enabled`), flag flipped on for all users

---

## 6. V1 → V1.1 Transition (Observation Window)

**Duration:** ≥ 30 days of production data

**What happens during this window:**

- Daily monitoring of dashboard metrics (does the funnel behave as predicted?)
- Bug fixes as issues surface
- Early tuning of SystemConfig values (reward amounts, Quick Bot tier, demo table allowlist)
- Collecting archetype distribution data (even though Specialize isn't live, we can pre-compute scores)
- QA feedback on `um` tooling
- No Specialize-phase work starts until this data is in hand

**Go/no-go for V1.1:**

- Dashboard shows a healthy funnel (not catastrophically failing at any step)
- Archetype score histograms show distinct producer-bucket shapes (not everyone at 0 or everyone at 1)
- Internal admin users have exercised `um` commands without blockers

If any of these fail, stop and fix v1 before starting v1.1.

---

## 7. V1.1 Sprint Plan

### Sprint 7 — Specialize Core: Recommendations, Scoring, Dismissal

**Sprint goal:** activate the Specialize phase — fresh Curriculum graduates start seeing the 3-card recommendation stack.

**Deliverables:**

- [ ] `backend/src/services/recommendationService.js`:
  - [ ] `getRecommendations(userId) → Card[]` returning up to 3 cards per §7.1
  - [ ] Bucket-specific surfacing rules (dominant / balanced / fresh-graduate)
  - [ ] Cross-bucket disqualifiers (§6.2–§6.5)
  - [ ] Dismissal 7-day suppression with -0.2 score penalty (§7.3)
- [ ] `backend/src/services/userActivitySummary.js`:
  - [ ] `summarize(userId) → { botsCreated, trainingRuns, tournamentsEntered, spectatedMatches, followsCount, rankingsViews, lossStreak, ... }`
  - [ ] Cached per-session (invalidated on activity events)
  - [ ] Archetype score computation from these signals using §6.1 formulas
- [ ] `backend/src/config/featureCatalog.js`:
  - [ ] Populated with all 20 recommendations across 4 buckets (4 Designer + 5 Trainer + 6 Competitor + 5 Explorer) per §6
  - [ ] Each entry: `id`, `bucket`, `title`, `body`, `ctaLabel`, `ctaAction`, `prereqCheck(ctx)`, `disqualifier(ctx)`
- [ ] Endpoints:
  - [ ] `GET /api/v1/guide/recommendations` (server-authoritative)
  - [ ] `POST /api/v1/guide/recommendations/:id/dismiss`
- [ ] Archetype normalization SystemConfig keys:
  - [ ] `guide.archetypes.designer.normalizationThreshold` (3)
  - [ ] `guide.archetypes.trainer.normalizationThreshold` (10)
  - [ ] `guide.archetypes.competitor.normalizationThreshold` (3)
  - [ ] `guide.archetypes.explorer.minActivityFloor` (5)
  - [ ] `guide.archetypes.balancedTopTwoEpsilon` (0.1)
- [ ] `JourneyCard` Specialize-phase rendering (§9.1):
  - [ ] 3-card stack vertically
  - [ ] Each card: title, body, CTA button, small dismiss button
- [ ] Admin-config UI for the new SystemConfig keys

**Testing requirements:**

- [ ] Backend: `recommendationService.test.js` (fresh-graduate balanced producer, dominant bucket mixes, balanced top-two, cross-bucket disqualifiers — dedicated unit per disqualifier per §10.5)
- [ ] Backend: `userActivitySummary.test.js` (signal aggregation correctness, cache invalidation)
- [ ] Backend: `featureCatalog.test.js` (schema, no duplicate IDs, ≥ 3 entries per bucket)
- [ ] Component: `JourneyCard.test.jsx` Specialize variant
- [ ] E2E: `guide-specialize.spec.js` (graduate → 3 cards surface → dismiss → replacement appears → time-warp 7 days → re-appears with penalty)

**Definition of Done:**

- Fresh graduates see 3 cards (1 Designer + 1 Trainer + 1 Competitor) per §7.1 balanced-producer rule
- Dismissing a card removes it and surfaces a replacement within the same request
- All cross-bucket disqualifiers have dedicated test coverage and visibly change the surface

---

### Sprint 8 — Rookie Cup + Deterministic Bracket Seeding

**Sprint goal:** give Competitor-bucket users a meaningful second tournament with a Sterling boss.

**Deliverables:**

- [ ] Deterministic bracket seeding (§5.9):
  - [ ] `seedingMode` enum (migration done Sprint 1; wire the behavior now)
  - [ ] Bracket-generator branch: when `seedingMode == 'deterministic'`, place participants by `slotIndex` (no shuffle)
  - [ ] Admin UI toggle on template editor
- [ ] Rookie Cup template + clone (§5.8):
  - [ ] Migration: seed "Rookie Cup" template (8 slots — 1 user + 4 Rusty + 2 Copper + 1 Sterling with Sterling at slot 8)
  - [ ] Sterling pool exercised (from existing `curriculumNamePools.js`)
  - [ ] `seedingMode = 'deterministic'` on this template
  - [ ] `POST /api/v1/tournaments/rookie-cup/clone` endpoint
  - [ ] `isCup = true` on clones, same GC + visibility rules as Curriculum Cup
- [ ] Wire Competitor recommendation #1 — "Enter Rookie Cup" — to clone endpoint
- [ ] Coaching card "Champion" branch CTA wired to Rookie Cup clone

**Testing requirements:**

- [ ] Backend: `deterministicSeeding.test.js` (bracket generator places slot 8 in opposite arm from slot 1)
- [ ] Backend: `rookieCup.test.js` (clone produces 8-slot bracket with Sterling in correct position, name-pool draw works)
- [ ] E2E: `guide-rookiecup.spec.js` — fresh Curriculum graduate follows Competitor rec #1 → Rookie Cup clones → user wins → final includes Sterling match

**Definition of Done:**

- A champion of Curriculum Cup can click Rookie Cup CTA and is dropped into a playable 8-slot bracket
- Sterling is always in the opposite bracket arm from the user (verify across 5 test runs)
- Existing (non-Rookie) tournaments with `seedingMode = 'random'` still shuffle participants correctly

---

### Sprint 9 — Stagnation Handling + Admin Experience

**Sprint goal:** handle long-tail user behavior (decay / exhaustion) and make the Guide admin-aware.

**Deliverables:**

- [ ] Stagnation handling (§7.4):
  - [ ] Decay mode: after 30 days of dismissal-only behavior, drop Specialize card stack to 1 card, suspend orb pulse
  - [ ] Wildcard mode: catalog exhausted in dominant bucket → single wildcard card from non-dominant bucket, rotate every 7 days
  - [ ] Both revert instantly on positive user action
  - [ ] SystemConfig keys:
    - `guide.stagnation.dismissalStreakDays` (30)
    - `guide.stagnation.decayCardCount` (1)
    - `guide.exhaustion.wildcardRotationDays` (7)
- [ ] Admin experience (§9.5):
  - [ ] `slotActions.js` gets `requiredRole` metadata on admin tiles
  - [ ] Tile-picker UI filters by role
  - [ ] SlotGrid render filters out tiles with unsatisfied `requiredRole`
  - [ ] Admin tile set seeded (6 tiles: stuck tournaments, runaway dashboard, incident log, support queue, system config, guide metrics)
  - [ ] Settings toggle "Show player Guide" (default off for admins, on for regular users)
  - [ ] Admin-supplemented default tiles at graduation (2 admin tiles pre-pinned for users with admin role)
- [ ] `um specialize` CLI command (§10.6):
  - [ ] `--bucket <name>` seeds synthetic activity for archetype testing
  - [ ] `--dismissal-streak <days>` simulates decay state
  - [ ] `--wildcard-mode` simulates exhaustion
  - [ ] `--reset` clears Specialize state

**Testing requirements:**

- [ ] Backend: `stagnation.test.js` (decay trigger after N dismissal events, wildcard trigger on catalog exhaustion, reversion on positive action)
- [ ] Backend: `adminTiles.test.js` (tile filtering by role at picker and render)
- [ ] Component: `SettingsPage.test.jsx` (player-Guide toggle shows for admins, flips behavior)
- [ ] Component: `SlotGrid.test.jsx` (admin tiles invisible for non-admins)
- [ ] E2E: `guide-admin.spec.js` (admin default state: Guide hidden; flip toggle: Guide appears; admin tiles accessible)

**Definition of Done:**

- Dismissing all Specialize cards for 30 days triggers decay mode (visible: 1 card instead of 3, no orb pulse)
- Admin user lands without player Guide by default; flip toggle → full Guide appears
- Non-admin users never see admin tiles in the picker or elsewhere

---

### Sprint 10 — Full Measurement + Re-engagement

**Sprint goal:** complete the dashboard and ship the background nudge system.

**Deliverables:**

- [ ] Dashboard additions:
  - [ ] Per-bucket archetype score histograms
  - [ ] Full Specialize metrics: bucket distribution, click-through / dismissal rates per bucket, card-refresh rate
  - [ ] SlotGrid customization metrics (edit rate, which tiles added/removed, archetype correlation)
  - [ ] Phase 0 conversion-funnel drill-down
- [ ] Re-engagement nudges (§7.5):
  - [ ] 14-day inactivity detection (no Specialize action)
  - [ ] Socket-delivered `guide:notification` event
  - [ ] GuideOrb pulse animation on receipt
  - [ ] Non-modal slide-in panel escalation after 2 min of inaction
  - [ ] SystemConfig key: `guide.inactivityNudgeDays` (14)
- [ ] Backfill script for historical metrics (runs once, populates snapshots from raw events)
- [ ] Dashboard cohort slicer: add histograms to the cohort view

**Testing requirements:**

- [ ] Backend: `inactivityNudge.test.js` (14-day trigger, socket emit, cooldown prevents spam)
- [ ] Component: `GuideOrb.test.jsx` pulse animation
- [ ] Component: `GuideMetricsPage.test.jsx` histogram rendering
- [ ] E2E: `guide-reengagement.spec.js` (simulate 14-day inactivity → orb pulses → click opens recommendations)

**Definition of Done:**

- Archetype histograms on the dashboard for all 4 buckets with real staging data
- A test user with 14+ days of no Specialize action receives exactly one nudge
- Dashboard loads cleanly even with 30+ days of snapshot data

---

### Sprint 11 — V1.1 Polish + Release

**Sprint goal:** ship v1.1 to production.

**Deliverables:**

- [ ] Full regression pass
- [ ] Performance audit — N+1 queries in `recommendationService`, slow cron runs
- [ ] Dashboard-in-production test with 60+ days of cumulative data
- [ ] Runbook updates for operational patterns that emerged post-v1
- [ ] V1.1 feature flag (`guide.v1_1.enabled`) for staged rollout if desired
- [ ] Staging validation period: 1 week minimum

**Testing requirements:**

- [ ] Full regression: every spec file passes (backend + UI + E2E)
- [ ] Staging smoke — all 6 `guide-*.spec.js` scenarios green
- [ ] Load test: 1000 users simulated with Specialize activity, dashboard remains responsive

**Definition of Done — V1.1 Acceptance Criteria:**

- [ ] **Specialize activation:** ≥ 40% of Specialize-phase users click a recommendation within first session in Specialize
- [ ] **Dismissal health:** ≤ 40% of surfaced recommendations get dismissed without action
- [ ] **Rookie Cup uptake:** ≥ 50% of Curriculum graduates who see the Rookie Cup recommendation attempt the Cup
- [ ] **Re-engagement:** 14-day nudge increases retention by ≥ 5 percentage points vs no-nudge control
- [ ] **Admin experience:** admin testers confirm opt-in Guide works + admin tiles visible + non-admins don't see them
- [ ] **Zero P0/P1 bugs:** staging validation week clean
- [ ] **Tests:** all sprint 7-11 test suites green; no regressions in v1 suites
- [ ] **Deployed:** production behind flag, flag flipped on

---

## 8. Testing Strategy Summary

### Test layer expectations per sprint

| Sprint | Backend unit | UI component | E2E | Smoke/integration |
|---|---|---|---|---|
| 1 — Foundation | 6–8 files (journey, migration, um) | — | — | manual: register, confirm DB state |
| 2 — Phase 0 | 3 files (guestCredit, email-gate, phase0 flow) | 2 files | `guide-phase0.spec.js` | staging: visitor → signup |
| 3 — Hook | 3 files (tablesDemo, botsQuick, journey step 3) | 3 files | `guide-hook.spec.js` | staging: full Hook |
| 4 — Curriculum | 4 files (spar, cup, coaching, journey 5-7) | 1 file | `guide-curriculum.spec.js` | staging: full Curriculum |
| 5 — Measurement | 5 files (rewards, isTestUser, metrics, cron, dashboard) | 1 file | — | staging: dashboard shows real data |
| 6 — V1 Release | Regression of all above | Regression | All v1 specs green | staging validation week |
| 7 — Specialize | 3 files (recommendation, summary, catalog) | 1 file | `guide-specialize.spec.js` | — |
| 8 — Rookie Cup | 2 files (seeding, rookieCup) | — | `guide-rookiecup.spec.js` | — |
| 9 — Stagnation + Admin | 3 files (stagnation, adminTiles, um specialize) | 2 files | `guide-admin.spec.js` | — |
| 10 — Re-engagement | 2 files (inactivityNudge, histograms) | 2 files | `guide-reengagement.spec.js` | — |
| 11 — V1.1 Release | Regression | Regression | All v1 + v1.1 specs | staging validation week |

### Test anti-goals

Don't chase vanity metrics (line coverage %). The requirements doc (§10.5) spells out the *real* coverage bar:

- Every global disqualifier has a dedicated unit test
- Every journey step trigger has a dedicated unit test
- At least one E2E covers the full fresh-signup → Specialize path
- The dashboard never crashes on empty/partial data

---

## 9. Master Progress Checklist

This is the consolidated view of every task across all sprints. Check items off as they complete. Periodically sync both sides against this list to stay aligned.

### V1

#### Sprint 1 — Foundation

- [x] Schema migration (7 columns + 1 new table) — `20260424130000_intelligent_guide_v1_foundation`
- [x] `journeyService` rewrite — 7-step spec with phase derivation, dual rewards, server-detectable triggers
- [x] Remove client-triggered `/journey/step` endpoint
- [x] Wipe existing `journeyProgress` — included in the migration
- [x] 4 Sprint-1 SystemConfig keys seeded
- [x] `um journey` phase shortcuts (`--phase hook|curriculum|specialize`, `--graduate`, deeper `--reset`, richer output with phase label)
- [x] `journeyService.test.js` complete (25 new tests — constants, phase derivation, step completion, rewards, events, error handling)
- [x] Existing callers remapped: `games.js` step 3→1, `socketHandler.js` step 3→1 (HvB only, dropped PvP firing), `bots.js` step 5→3, `mlService.js` + `skillService.js` step 6→4
- [x] Step 7 trigger wired via `tournamentBridge.js` on `tournament:completed` event (for any tournament with finalPosition)
- [x] Guide-route tests updated: removed "auto-completes step 1 on hydration", added "POST /journey/step returns 404" assertion
- [x] Migration applied to docker-compose DB; `prisma generate` ran clean
- [ ] Staging deploy + smoke (user-driven via `/stage` when ready)
- [x] **Sprint 1 code DoD:** 1064 backend tests pass (+32 new, zero regressions)

#### Sprint 2 — Phase 0

- [ ] Landing page redesign — live demo hero + CTA ladder
- [ ] Guest mode (localStorage)
- [ ] `POST /api/v1/guide/guest-credit` endpoint
- [ ] Signup modal — deferred email verification
- [ ] Signup modal — contextual "Build a bot" copy
- [ ] Tournament-entry email-verification gate
- [ ] Phase 0 component tests
- [ ] `guide-phase0.spec.js` E2E
- [ ] Staging deploy + smoke
- [ ] **Sprint 2 DoD passed**

#### Sprint 3 — Hook + Quick Bot

- [ ] Demo Table macro endpoint + GC
- [ ] Demo Table curated allowlist
- [ ] Quick Bot wizard (UI + endpoint)
- [ ] Quick Bot "training" difficulty bump
- [ ] `JourneyCard` Hook + Curriculum rendering
- [ ] Hook reward popup
- [ ] Hook + Quick Bot unit tests
- [ ] `guide-hook.spec.js` E2E
- [ ] Staging deploy + smoke
- [ ] **Sprint 3 DoD passed**

#### Sprint 4 — Curriculum Completion

- [ ] Spar endpoint + semantic guards
- [ ] Spar UI button + Guide card
- [ ] Curriculum Cup template migration
- [ ] Cup clone endpoint
- [ ] Themed name pools config
- [ ] Cup GC sweep phase
- [ ] Coaching card rules config + logic
- [ ] Step 7 reward popup
- [ ] Curriculum unit tests
- [ ] `guide-curriculum.spec.js` E2E
- [ ] Staging deploy + smoke
- [ ] **Sprint 4 DoD passed**

#### Sprint 5 — Rewards + Measurement + isTestUser

- [ ] 4 discovery rewards implemented
- [ ] `discoveryRewardsGranted` on user prefs
- [ ] `isTestUser` auto-flagging logic
- [ ] Admin "count my activity" toggle
- [ ] `MetricsSnapshot` daily cron
- [ ] Admin `/admin/guide-metrics` dashboard
- [ ] "excluding N test users" footer
- [ ] `um testuser` command
- [ ] `um rewards` command
- [ ] `um status` enhancements
- [ ] Measurement + isTestUser tests
- [ ] Staging deploy + smoke
- [ ] **Sprint 5 DoD passed**

#### Sprint 6 — V1 Release

- [ ] Cohort slicer with granularity picker
- [ ] Backfill script
- [ ] A/B hook points instrumented
- [ ] SystemConfig admin UI
- [ ] Operational runbook written
- [ ] Full regression passed
- [ ] Staging validation week completed
- [ ] Production deploy (flag)
- [ ] Flag flipped on
- [ ] **V1 Acceptance Criteria met**

### V1 → V1.1 Observation Window

- [ ] 30+ days production data collected
- [ ] Archetype score histograms pre-computed
- [ ] Funnel health verified
- [ ] Go/no-go for V1.1 made

### V1.1

#### Sprint 7 — Specialize Core

- [ ] `recommendationService` implemented
- [ ] `userActivitySummary` implemented
- [ ] `featureCatalog` populated (20 entries across 4 buckets)
- [ ] `GET /api/v1/guide/recommendations` endpoint
- [ ] `POST /dismiss` endpoint
- [ ] 5 archetype SystemConfig keys
- [ ] `JourneyCard` Specialize rendering
- [ ] Specialize tests (unit + component + E2E)
- [ ] Staging deploy + smoke
- [ ] **Sprint 7 DoD passed**

#### Sprint 8 — Rookie Cup + Seeding

- [ ] Deterministic-seeding bracket generator branch
- [ ] Admin UI toggle for `seedingMode`
- [ ] Rookie Cup template migration
- [ ] Rookie Cup clone endpoint
- [ ] Competitor rec #1 wired to clone
- [ ] Coaching card champion CTA wired
- [ ] Rookie Cup tests + `guide-rookiecup.spec.js`
- [ ] Staging deploy + smoke
- [ ] **Sprint 8 DoD passed**

#### Sprint 9 — Stagnation + Admin

- [ ] Decay mode implementation
- [ ] Wildcard mode implementation
- [ ] 3 stagnation SystemConfig keys
- [ ] `slotActions.js` `requiredRole` metadata
- [ ] Tile picker + render filtering
- [ ] Admin tile set seeded
- [ ] "Show player Guide" toggle
- [ ] Admin default-tile supplement at graduation
- [ ] `um specialize` CLI
- [ ] Stagnation + admin tests
- [ ] Staging deploy + smoke
- [ ] **Sprint 9 DoD passed**

#### Sprint 10 — Full Measurement + Re-engagement

- [ ] Archetype score histograms on dashboard
- [ ] Full Specialize metrics
- [ ] SlotGrid customization metrics
- [ ] Phase 0 funnel drill-down
- [ ] 14-day inactivity nudge
- [ ] Orb pulse animation
- [ ] Slide-in panel escalation
- [ ] Backfill script for historical metrics
- [ ] Re-engagement tests
- [ ] Staging deploy + smoke
- [ ] **Sprint 10 DoD passed**

#### Sprint 11 — V1.1 Release

- [ ] Full regression passed
- [ ] Performance audit + fixes
- [ ] Runbook updates
- [ ] V1.1 feature flag
- [ ] Staging validation week completed
- [ ] Production deploy (flag)
- [ ] Flag flipped on
- [ ] **V1.1 Acceptance Criteria met**

---

## 10. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Sprint 2 Phase 0 rewrite breaks current homepage/signup | Medium | High — no signups = no data | Feature-flag entire Phase 0 path; ability to revert to current flow instantly |
| 2 | Sprint 1 journey rewrite breaks existing `guideStore.js` behavior | Medium | Medium — UI errors for existing users | Pre-launch; wipe `journeyProgress` on deploy; monitor staging thoroughly |
| 3 | Sprint 5 `isTestUser` false positives flag real admins-who-dogfood out of metrics | Low | Low | Admin opt-in toggle; `um testuser --audit` catches drift |
| 4 | Sprint 7 Specialize threshold constants calibrated wrong for real traffic | High — we're guessing | Low — admin-tunable | 30-day observation window + histograms show us where to tune |
| 5 | Sprint 8 deterministic seeding regresses random-seeded tournaments | Low | Medium | Default `seedingMode='random'` preserves existing behavior; backward compat tests |
| 6 | Sprint 10 re-engagement nudges feel spammy to users | Medium | Medium | SystemConfig-tunable; can disable entirely via `guide.inactivityNudgeDays = 0` |
| 7 | Any sprint: test infrastructure too slow, E2E flakes slow down releases | Medium | Medium | Per-sprint time-boxed — move flakes to `.skip` + file a cleanup task, don't block release |
| 8 | V1.1 not justified — v1 data shows archetypes don't meaningfully differ | Low | Low — v1 still valuable | Acceptable outcome; de-scope v1.1 if data doesn't support it |

---

## 11. Rollout & Communication

### V1 Launch

- Pre-launch: announce internally + to any existing users (email or in-app) about the journey refresh
- Launch day: flip `guide.v1.enabled = true` for 100% of users (no gradual ramp — this is pre-launch, no users to stage)
- First 48 hours: monitor the dashboard constantly for funnel breakage
- Week 1: SystemConfig tuning based on observed drop-offs

### V1.1 Launch

- Gradual rollout via the v1.1 feature flag: 10% → 50% → 100% over one week
- Monitor dashboard daily for Specialize engagement metrics
- Rollback plan: flip flag off returns users to v1 Specialize-placeholder state

### Communication during build

- **End-of-sprint:** Claude commits the completed checklist updates (§9) to this doc, writes a brief sprint recap in the commit message, and posts a short summary to Joe on what shipped + what's next.
- **Mid-sprint blockers:** Claude flags directly in the main session as soon as they surface — doesn't wait for end-of-sprint.
- **Staging walkthrough:** before the v1 and v1.1 production deploys (end of Sprints 6 and 11), Claude walks Joe through the full funnel on staging; Joe flips the production flag.
- **Sub-agent results:** when a sub-agent is spawned, Claude summarizes its output in the main session before acting on it — no invisible parallel work.

---

## 12. How to Use This Doc

- **For Joe (product owner):** the master checklist in §9 is the fastest pulse-check. Each `[ ]` is one item; each `[x]` is done. Directional decisions get raised in the main session as they come up. The requirements doc stays the source of truth for feature behavior — this doc is execution-only.
- **For Claude (implementer):** this doc drives sprint planning. Update the checklist as items complete. Treat it as living — revise sprint scope or the risk register when reality emerges. If a sub-agent is useful (per §3), spawn one; summarize its output before merging.
- **Testing bar:** the "Testing requirements" section of each sprint is the *minimum*. The test scenarios in §10.6 of the requirements doc (`um` CLI) describe quick state-setup for manual testing — use them.
- **When in doubt about feature behavior:** open `Intelligent_Guide_Requirements.md`. This implementation plan never re-specifies behavior — it only indexes it.

---

## Appendix A — Glossary

(Same glossary as Requirements doc Appendix A — repeated here so this doc stands alone.)

- **TC** — Tournament Credits, earned activity-score metric (not spent)
- **Journey** — 7-step sequence covering Hook + Curriculum phases
- **Phase** — one of {Hook, Curriculum, Specialize}; Phase 0 = pre-signup
- **Bucket / Archetype** — Designer / Trainer / Competitor / Explorer (§6)
- **Card** — Specialize-phase recommendation rendered in the Guide
- **Cup** — curated-field tournament (Curriculum Cup 4-slot; Rookie Cup 8-slot)
- **Spar** — user's bot in a non-tournament practice match
- **DoD** — Definition of Done

## Appendix B — Traceability Matrix

Each requirements-doc section maps to specific sprint deliverables:

| Requirements § | Implements in Sprint |
|---|---|
| §2 Measurement | 5 (basic), 10 (full) |
| §3.5 Phase 0 | 2 |
| §4 Journey spec | 1 (service), 3-4 (UI) |
| §5.1 Demo Table | 3 |
| §5.2 Spar | 4 |
| §5.3 Quick Bot | 3 |
| §5.4 Curriculum Cup | 4 |
| §5.5 Coaching card | 4 |
| §5.6 Journey migration | 1 |
| §5.7 Discovery rewards | 5 |
| §5.8 Rookie Cup | 8 |
| §5.9 Deterministic seeding | 8 |
| §6 Four buckets | 7 |
| §7.1-7.3 Scoring/dismissal | 7 |
| §7.4 Stagnation | 9 |
| §7.5 Progressive intensity | 10 |
| §8 Backend architecture | 1, 5, 7 |
| §9 UI changes | 3-4, 7 |
| §9.5 Admin experience | 9 |
| §10 Testing | ongoing each sprint |
| §10.6 `um` CLI | 1 (journey), 5 (rewards+testuser), 9 (specialize) |
