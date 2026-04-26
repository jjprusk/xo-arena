---
title: "Sprint 4 Kickoff — Curriculum Completion"
subtitle: "Intelligent Guide v1, Sprint 4 (Spar, Curriculum Cup, Coaching Card)"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## Why this doc exists

This is a context primer written immediately before a `/compact` so that the post-compact Claude session has a self-contained brief on where we are and what to do next. **First action on resume: read this file end-to-end, then start Sprint 4 implementation per §3 below.**

---

## 1. Where we are

### Sprints complete (code on `dev`)

| Sprint | Code | Manual QA | DoD passed |
|---|---|---|---|
| 1 — Foundation | done | done (Phase 1 QA) | yes |
| 2 — Phase 0 funnel | done | done (Phase 1 QA + QA pass D) | yes |
| 3 — Hook + Quick Bot | done | **DEFERRED — to be combined with Sprint 4 QA** | no |

Sprint 3 QA was deferred deliberately. Plan: implement Sprint 4, then run **combined Sprint 3 + Sprint 4 QA** in one session because Sprint 4 features naturally exercise Sprint 3 surfaces (Curriculum Cup → uses bots created via Quick Bot; Coaching card → exercises JourneyCard reward surface; tournament completion → fires the `guide:curriculum_complete` reward popup that Sprint 3 wired).

### Latest dev branch state

- Branch: `dev`
- Latest commits (newest first):
  - `cb0797c` — doc: add Sprint 3 QA walkthrough
  - `77e9212` — doc: regenerate Intelligent_Guide_Implementation_Plan.pdf
  - `fde68f3` — doc: mark Sprints 1 & 2 complete
  - `32cc2fa` — fix(landing): EmailVerifyBanner — slate wash, road-sign icon, no dismiss
  - `a9168be` — chore: bundled Phase 0 QA pass (D)
- Tests: backend 1092/1092 green, landing 100/100 green

### Authoritative docs

- **What** — `doc/Intelligent_Guide_Requirements.md` (the spec; do not re-specify behavior)
- **How / when** — `doc/Intelligent_Guide_Implementation_Plan.md` (sprints + master checklist; update §9 as items complete)
- **Sprint 3 QA script** — `doc/Sprint3_QA.md`
- **Sprint 1+2 QA script** — `doc/archive/Welcome_Process_Phase1_QA.md` (archived, format reference)
- **This doc** — Sprint 4 kickoff context

---

## 2. The plan we agreed to

1. Implement Sprint 4 deliverables on `dev` per the implementation plan §5 Sprint 4.
2. Run unit + component + E2E tests at each milestone, commit in logical chunks (one feature per commit).
3. When Sprint 4 is code-complete, write `doc/Sprint4_QA.md` mirroring the Sprint 3 doc structure.
4. User then runs **combined Sprint 3 + Sprint 4 QA** in one session — Sprint 3 doc covers stages A-E (Demo Table, Quick Bot, Train, JourneyCard, Hook popup), Sprint 4 doc adds stages F-onward (Spar, Curriculum Cup, Coaching card, +50 TC popup).
5. After QA passes, mark both sprints' DoD complete in §9.
6. User runs `/stage` for the joint Sprint 1+2+3+4 promotion (per §11 staging cadence).

---

## 3. Sprint 4 deliverables (from Implementation Plan §5 Sprint 4)

**Sprint goal:** complete the Curriculum funnel — users can spar, enter their first tournament, and receive coached feedback.

### 3.1 Spar (§5.2)

- `POST /api/v1/bot-games/practice` accepting `{ myBotId, opponentTier: 'easy' | 'medium' | 'hard' }`
- Ownership + role checks (caller must own `myBotId`; opponent is a system bot at the requested tier)
- `isSpar = true` on the created `BotGame` row (column already exists from Sprint 1 migration)
- One-active-spar-per-bot semantic guard: if a previous spar for this bot is still in flight, replace it
- 30-day retention sweep — add to `tournamentSweep` (or wherever `botGame` GC lives)
- 2-hour TTL for in-flight safety (kill stuck-running spars)
- "Spar now" button on the bot detail page (`landing/src/pages/BotProfilePage.jsx` next to the existing "Train your bot" button)
- Guide card at Curriculum step 5: "Spar against a stronger bot"
- Fires journey step 5 on spar match completion (server-side hook in the bot-game completion flow)

### 3.2 Curriculum Cup (§5.4)

- Migration: seed "Curriculum Cup" template — 4 slots (1 user placeholder + 2 Rusty + 1 Copper)
- `POST /api/v1/tournaments/curriculum-cup/clone` endpoint (reuses existing template-clone machinery)
- Themed name pools — `tournament/src/config/curriculumNamePools.js` with 24 curated names across 3 tiers (Rusty / Copper / Sterling, though Cup itself only uses Rusty + Copper)
- `isCup = true` on clones (column from Sprint 1)
- Private to creator (visibility filter)
- Immediate-start on clone (no manual registration phase — the user's slot is auto-filled and the bracket runs)
- GC sweep phase for 30-day retention
- Fires journey step 6 on tournament registration; step 7 on tournament completion with `finalPosition`
- Reward popup for step 7 (+50 TC) — `RewardPopup.jsx` already listens for `guide:curriculum_complete`, server emission already wired in Sprint 1's `tournamentBridge.js` on `tournament:completed`. Verify it fires for `isCup` tournaments specifically.

### 3.3 Coaching Card (§5.5)

- `backend/src/config/coachingCardRules.js` with the 4-branch decision tree:
  - **Champion** (won the Cup) → CTA: "Try Rookie Cup" *(text-only in v1; full Rookie Cup ships v1.1 Sprint 8)*
  - **Runner-up** (lost the final) → CTA: "Train your bot deeper"
  - **1-train-loss** (lost in semis but bot improved during training) → CTA: "Switch algorithm"
  - **Heavy-train-loss** (lost early, bot didn't improve) → CTA: "Try a different algorithm"
- Card displayed on step-7 completion — server sends card data alongside the reward event so the popup + card render together
- Four CTA actions wired (Rookie Cup is text-only placeholder; the other three navigate to bot detail / gym)

### 3.4 Tests (per §10 + Sprint 4 testing requirements)

- `backend/src/routes/__tests__/spar.test.js` — role check, ownership, tier selection, concurrent guard, GC
- `backend/src/routes/__tests__/curriculumCup.test.js` — clone produces expected bracket shape, name-pool draw without duplicates, isCup flag set, immediate-start, journey step 6/7 firing
- `backend/src/config/__tests__/coachingCardRules.test.js` — all 4 branches hit with expected title/body/CTA
- E2E: `e2e/guide-curriculum.spec.js` — full Curriculum run from step 3 to step 7 with reward popup and coaching card asserted
- Integration: confirm journey steps 5, 6, 7 fire in correct order

### 3.5 Definition of Done

- A user who graduates from Sprint 3's state can reach step 7 and see a coaching card in under 5 minutes (excluding the ~2 min the Cup itself runs)
- Coaching card correctly identifies user as champion / runner-up / 1-train-loss / heavy-train-loss based on state
- Reward popup fires with +50 TC
- User lands in "Specialize placeholder" state (full Specialize ships v1.1)

---

## 4. Critical context that would be lost in compact

### 4.1 Journey-step trigger map (shipped in Sprint 1)

The journey was renumbered in Sprint 1. Current trigger sources:

| Step | Trigger | Code location |
|---|---|---|
| 1 | PvAI game complete (HvB only, NOT PvP) | `games.js`, `socketHandler.js` |
| 2 | Demo Table watched ≥ 2 min | guest: `DemoArena.jsx` localStorage; signed-in: not yet wired (see §4.6) |
| 3 | Bot created (Quick Bot or full Gym) | `bots.js`, `bots/quick.js` |
| 4 | Bot trained (depth bump or real ML run) | `mlService.js`, `skillService.js`, train-quick endpoint |
| 5 | Spar match completed | **Sprint 4 to wire** in the bot-game completion path |
| 6 | Tournament registration | `tournamentBridge.js` on `tournament:participant:joined` (already supports userId payload) |
| 7 | Tournament completion with `finalPosition` | `tournamentBridge.js` on `tournament:completed` |

**Important:** the client-triggered `POST /api/v1/guide/journey/step` endpoint was removed in Sprint 1. All step transitions must come from server-detected events. Do not re-introduce the client endpoint.

### 4.2 Reward popup wiring (Sprint 3)

`landing/src/components/guide/RewardPopup.jsx` listens on the guide socket channel for:
- `guide:hook_complete` → +20 TC popup (fires on Hook→Curriculum boundary)
- `guide:curriculum_complete` → +50 TC popup (fires on Curriculum→Specialize boundary)

Both are emitted from `journeyService.js` when `deriveCurrentPhase()` flips. Sprint 4 doesn't need to add new emissions — just verify the curriculum-complete one actually fires when the user finishes the Cup (since that's the natural Curriculum→Specialize trigger in v1).

### 4.3 EmailVerifyBanner styling (post QA pass D)

`landing/src/components/ui/EmailVerifyBanner.jsx` final state:
- Background: `var(--color-slate-200)` (#B8CBE3 — cool blue-gray, contrasts with warm colosseum hero)
- Border: 2px `var(--color-slate-600)`
- Text: `var(--color-slate-800)`, `font-medium`
- Icon: 16x16 SVG triangle, road-sign style — `#FACC15` yellow fill with `#1a1a1a` border + glyph
- **No dismiss button** (sessionStorage dismiss removed). Banner persists every session until `user.emailVerified === true`.

Don't revert any of this during Sprint 4 work.

### 4.4 Phase-aware leave destination (PlayPage, post QA pass D)

`landing/src/pages/PlayPage.jsx` `leaveHref` branches on:
1. Tournament context → `/tournaments/:id`
2. Hook-phase user (or guest, who derives to `'hook'`) → `/`
3. Curriculum or Specialize → `/tables`

Used by Leave Table, abandoned, opponent-left navigations + the Back chip in PlatformShell. Sprint 4 testing should not break this — Curriculum-phase users entering a Cup → finishing → returning should land on `/tables` (or `/tournaments/<id>`, depending on context).

### 4.5 BotProfilePage layout

The "Train your bot" button (Sprint 3) lives in a panel on `landing/src/pages/BotProfilePage.jsx`. Sprint 4 adds "Spar now" right next to it. The two should be a coherent action row, not stacked separately.

### 4.6 Demo-watch step 2 for signed-in users — known gap

`DemoArena.jsx` only records Hook step 2 to `guideGuestJourney` localStorage. For a signed-in user lingering on `/`, step 2 is *not* credited (we explicitly added an `isAuthed` guard during QA pass D to prevent re-populating the cleared guest state). This is intentional for v1 — signed-in users are expected to have already crossed Hook via the guest funnel. Don't try to "fix" this in Sprint 4.

### 4.7 Post-signup contextual landing — deferred

The "Build your own bot" CTA opens the signup modal with `context="build-bot"` for **copy only**. After signup, the user lands on whatever page hosted the modal — there is no contextual `navigate('/gym?action=quick-bot')` on success. We discussed this and parked it as a Sprint 4 follow-up (or beyond). Mention it again at the end of Sprint 4 if there's time.

---

## 5. Process notes

### 5.1 Workflow

- User handles all `git push` / `/stage` / `/promote` / Railway operations. Never run those unless explicitly invoked. Per `feedback_deploy_flow.md`.
- `/dev` skill commits + pushes to `dev`. Pre-commit hook runs the full test suite (landing + backend in docker). Use it for end-of-feature commits.
- For ad-hoc commits during a feature, plain `git commit` + `git push origin dev` is fine.
- Always promote `dev → staging → main`, never reverse. Per `feedback_stage_direction.md`.

### 5.2 Database migrations

- DB is not reachable from host — Prisma migrations must run inside the backend container:
  ```sh
  docker compose run --rm backend npx prisma migrate deploy
  ```
- Per `feedback_db_migrations.md`. After any schema change, also regenerate the Prisma client.

### 5.3 Tests

- Backend: `docker compose run --rm backend npm test` (1092 baseline)
- Landing: `cd landing && npm test -- --run` (100 baseline)
- E2E: `cd e2e && npx playwright test <name> --project=chromium`
- Per `feedback_tests_before_completion.md`: write tests for all new backend endpoints and service branches **before** declaring a feature complete.

### 5.4 Docs

- All `.md` documentation files go in `/doc` (not `/docs`). Per `feedback_doc_directory.md`.
- Every `/doc/<name>.md` must have a matching `<name>.pdf` rendered via pandoc+xelatex with the tuned command. Commit them together. Per `feedback_doc_pdf_companion.md` and `feedback_pandoc_pdf_quality.md`.
- The pandoc command for /doc files (matches what was used for this kickoff doc and the Sprint 3 QA doc):
  ```sh
  cd /Users/joe/Desktop/xo-arena/doc && pandoc <NAME>.md -o <NAME>.pdf \
    --pdf-engine=xelatex \
    -V mainfont="Times New Roman" -V monofont="Menlo" \
    -V geometry:margin=0.75in \
    -V colorlinks=true -V linkcolor=blue -V urlcolor=blue \
    --toc --toc-depth=3 \
    -H pdf_header.tex
  ```

### 5.5 Compaction discipline

- Per `feedback_compaction.md`: keep responses concise. Verbose output grows context faster and triggers compaction sooner.

---

## 6. First action on resume (post-compact)

1. **Read this file end-to-end.** Confirm understanding of §3 (Sprint 4 scope) and §4 (critical context).
2. Read the implementation plan §5 Sprint 4 (lines ~283-326 of `doc/Intelligent_Guide_Implementation_Plan.md`) to confirm nothing changed.
3. Brief glance at:
   - `backend/src/services/journeyService.js` — confirm step 5/6/7 emission shape
   - `backend/src/lib/tournamentBridge.js` — confirm `tournament:completed` event payload includes `userId` and `finalPosition`
   - `landing/src/pages/BotProfilePage.jsx` — find the Train panel, plan the Spar button placement
   - `landing/src/components/guide/JourneyCard.jsx` — confirm Curriculum checklist row 5 is wired to actual step 5 state
4. Propose an implementation order. Suggested:
   1. Spar endpoint + tests (smallest, isolated)
   2. Spar button + Guide card
   3. Curriculum Cup template migration + clone endpoint + tests
   4. Coaching card rules config + display
   5. Wire it all together, run full regression
   6. Write `Sprint4_QA.md` + render PDF
5. Confirm the order with the user before writing code (per the project's "match scope of actions to what was actually requested" guidance).

**Do not** start coding immediately on resume — confirm the plan with the user first. They might want to adjust priorities or split the sprint.
