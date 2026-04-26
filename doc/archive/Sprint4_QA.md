---
title: "Sprint 4 QA Walkthrough — Curriculum Completion"
subtitle: "Intelligent Guide v1, Sprint 4 (Spar, Curriculum Cup, Coaching Card)"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## What this document covers

This is the manual QA script for **Sprint 4** of the Intelligent Guide v1 effort. It exercises the work that turns a Curriculum-step-4 user (Sprint 3 graduate — bot built, bot trained) into a Curriculum-step-7 graduate who has sparred their bot, run their first cup, and seen the post-cup coaching card.

This script is intended to run **immediately after `Sprint3_QA.md`** in a single combined QA session. Sprint 4 features naturally exercise Sprint 3 surfaces: the cup uses bots created via Quick Bot; the cup completion fires the same `guide:curriculum_complete` reward popup wired in Sprint 3.

Companion docs:

- **What** — `Intelligent_Guide_Requirements.md` (the spec)
- **How / when** — `Intelligent_Guide_Implementation_Plan.md` (sprints + checklists)
- **Sprint 3 QA** — `Sprint3_QA.md` (run this first; ends with the user at Curriculum step 4)
- **QA (this doc)** — concrete steps to confirm the Sprint 4 features work on local dev

---

## Stage 0 — Prereqs

1. Docker stack running — `docker compose ps` should show `backend`, `landing`, `tournament`, `postgres`, and `redis` all healthy.
2. A signed-in test user at Curriculum step 4 (bot trained). Either:
   - Run `Sprint3_QA.md` Stages A–C first (recommended — exercises the same surfaces), **or**
   - Take any existing test user and fast-forward: `um journey <user> --phase curriculum --step 3 --step 4` (lands at step 5).
3. The user must own at least one trained bot (intermediate tier) — that's the bot they'll spar and enter into the cup.
4. Open http://localhost:5174/ signed in as that user.
5. A terminal handy for `um`, `curl`, and `docker compose logs`.

---

## Stage F — Spar (§5.2)

The Spar endpoint pits the user's bot against a system bot at the chosen tier. The match runs through the existing BotGameRunner (same path as Demo Tables); the user spectates. On series completion, journey step 5 is credited.

### F1. Find your bot id

Browse to `/profile` (your profile page); click into one of your bots. The URL is `/bots/<id>` — note the `<id>`. Or via `um`:

```sh
um list-bots <your-username>
```

### F2. Click "Spar now" from the bot detail page

On the bot profile, find the **Spar your bot** panel (sits below the Train panel). It has three tier buttons (Easy · Rusty / Medium · Copper / Hard · Sterling) and a **Spar now** button.

1. Pick a tier (Medium is the default; Easy is the fastest match).
2. Click **Spar now**.
3. The browser navigates to `/play?join=<slug>`. You should see your bot vs the system bot playing live, with names and StatusLine like any other bot game.

### F3. Confirm the journey credit

After the series completes (~10–30 seconds for a single game at the default 1500ms pace), reload `/`.

```sh
um journey <your-username>
```

You should see `(5/7)` and orbs `●●●●●○○`. Phase remains `curriculum`.

### F4. Confirm one-active-spar replacement

While the spar is running (or right after starting it), open another browser tab and POST `/api/v1/bot-games/practice` again for the **same bot**:

```sh
curl -sS -X POST http://localhost:3000/api/v1/bot-games/practice \
  -H "Cookie: <paste your better-auth session cookie>" \
  -H "Content-Type: application/json" \
  -d '{"myBotId":"<your-bot-id>","opponentTier":"hard"}' | jq .
```

Two things should happen:

- The previous spar slug is killed in the runner (the first browser tab's match disappears).
- The new POST returns a fresh `slug` and `displayName`.

### F5. Inactive bot guard

In a terminal, mark the bot inactive:

```sh
um bot <your-bot-id> --deactivate
```

Try **Spar now** again. The endpoint should return 409 with a message like `<bot displayName> is inactive`. Re-activate before continuing.

### F6. Other-user ownership guard

Sign in as a *different* user, copy that session cookie, and POST `/bot-games/practice` with the **first** user's bot id. The endpoint should return 403: `You do not own this bot`.

### F7. Spar games are excluded from ELO

Open `/profile` → your bot. The "Recent ELO changes" panel should not list the spar game. (Spar matches set `Game.isSpar=true`, and `eloService` skips those.) Verify in DB:

```sh
docker compose exec backend node -e "
const { default: db } = require('./src/lib/db.js');
db.game.findMany({ where: { isSpar: true }, select: { id: true, isSpar: true, mode: true, winnerId: true } })
  .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); });
"
```

You should see your spar match with `isSpar: true`.

---

## Stage G — Curriculum Cup (§5.4)

The Curriculum Cup spawns a 4-bot single-elimination tournament for the user: their bot vs three opponents drawn from curated name pools (2 Rusty-tier + 1 Copper-tier). Cup is private to the creator and starts immediately on clone.

### G1. Clone a cup via the endpoint

Through the landing dev proxy:

```sh
curl -sS -X POST http://localhost:5174/api/tournaments/curriculum-cup/clone \
  -H "Cookie: <paste your better-auth session cookie>" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

You should get back a `tournament` + 4 `participants`:

- `tournament.name` → "Curriculum Cup"
- `participants[0].isCallerBot` → `true`
- `participants.length` → 4
- The three opponent display names are themed (e.g. "Tarnished Bolt", "Verdigris Spire") drawn from `curriculumNamePools.js`. **No two opponents share a name within a single cup.**

### G2. Confirm immediate step 6

Within a few seconds:

```sh
um journey <your-username>
```

Should read `(6/7)`, orbs `●●●●●●○`. Step 6 fires from `tournament:participant:joined` → bridge → `completeStep(userId, 6)`. Idempotent — repeat clones don't re-fire.

### G3. Confirm visibility filter (private to creator)

Sign in as a different user (or use `?mine=true` query). `GET /api/tournaments` for someone else should NOT include the cup. As the creator, the cup IS visible. Admin-role users see all cups.

```sh
# As another user
curl -sS http://localhost:5174/api/tournaments \
  -H "Cookie: <other-user-cookie>" | jq '.tournaments[] | select(.isCup)'
# Should be empty.
```

### G4. Watch the cup run

Navigate to `/tournaments/<cup-id>` (the id from G1's response). The bracket should render with 4 participants and 2 round-1 matches in progress. With `paceMs: 1000` configured, each match takes ~10 seconds, so the whole cup runs in ~30 seconds.

### G5. Confirm step 7 + tournament COMPLETED

After the cup wraps:

```sh
um journey <your-username>
```

`(7/7)`, orbs `●●●●●●●`. Phase tag flips to `Specialize`.

```sh
curl -sS http://localhost:5174/api/tournaments/<cup-id> \
  -H "Cookie: <your-cookie>" | jq '.tournament | {status, name, isCup}'
```

Status should be `COMPLETED`, `isCup: true`.

### G6. Cup-clone bots are throwaway

Each cup spawns 3 fresh ownerless bot User rows (`bot-cup-<slug>-<suffix>`). Verify:

```sh
docker compose exec backend node -e "
const { default: db } = require('./src/lib/db.js');
db.user.findMany({ where: { username: { startsWith: 'bot-cup-' } }, select: { username: true, displayName: true } })
  .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); });
"
```

You should see 3 rows per cup. They're not eligible for general bracket fills (`botAvailable: false`) and get garbage-collected with the cup.

---

## Stage H — Reward popup (+50 TC) and Coaching card (§5.5)

When the cup completes and step 7 fires, the journeyService emits `guide:curriculum_complete` (Sprint 3 wiring) — the RewardPopup catches it and shows the +50 TC celebration. The bridge separately emits `guide:coaching_card` with a card chosen by the 4-branch decision tree in `coachingCardRules.js`.

### H1. Reward popup fires on cup completion

Have `/` (or any signed-in page) open in the browser when the cup completes. Within a second of step 7 firing, you should see:

- A celebratory popup near the top: title "Journey complete!", body referencing **+50 Tournament Credits**, with a "Specialize" hint. Auto-dismisses after 8 seconds; click-to-close also works.

If you missed it, the curriculum_complete event also writes a `guide:notification` row to the in-app stream (look in the Guide panel sidebar).

### H2. Coaching card renders alongside the popup

Right below the reward popup, a second card appears: the **CoachingCard** component (`landing/src/components/guide/CoachingCard.jsx`). Persistent — no auto-dismiss. The CTA navigates the user to the next sensible action.

The card you see depends on your bot's `finalPosition` in the cup:

| finalPosition | Card                | Title             | CTA                                |
|---|---|---|---|
| 1 | CHAMPION            | "Cup Champion!"   | Try Rookie Cup → `/guide/rookie-cup` |
| 2 | RUNNER_UP           | "So close."       | Train your bot deeper → `/profile?action=train` |
| 3+ | HEAVY_LOSS         | "Time to dig in." | Train your bot → `/profile?action=train` |

(There's a fourth branch — ONE_TRAIN_LOSS — that fires when `didTrainImprove=true`; v1 always passes `false` from the bridge, so it surfaces only via the unit tests. v1.1 will compute didTrainImprove from ML model history.)

### H3. Server log check

If neither popup nor card appeared, confirm the server emitted both events:

```sh
docker compose logs backend --tail 200 | grep -E 'guide:(curriculum_complete|coaching_card|specialize_start)'
```

You should see all three lines for the cup completion. If the server emitted but the client didn't render, the bug is in `RewardPopup.jsx` or `CoachingCard.jsx` (or the socket subscription); if the server didn't emit, the bug is in `journeyService.js` (popup) or `tournamentBridge.js` (card).

---

## Stage I — GC sweeps (§5.2 / §5.4)

Three new sweeps shipped this sprint. None of them are user-visible — verification is via the DB.

### I1. Spar 2-hour in-flight TTL

Catches stuck spar runner state. Force a sweep manually:

```sh
docker compose exec backend node -e "
const svc = require('./src/services/tableGcService.js');
svc.sweep(null).then(r => { console.log(r); process.exit(0); });
"
```

You should see a result object including `killedSpars: 0` (assuming no stuck spars). To exercise the 2-hour cap manually, you'd need to leave a spar running for 2+ hours — skip unless you specifically want to test the timeout.

### I2. Spar 30-day Game-row retention

Same sweep. The result also reports `deletedOldSpars` — count of `Game` rows where `isSpar=true` AND `endedAt` > 30 days ago. Fresh local DB will show 0; verify the query is firing:

```sh
docker compose logs backend --tail 60 | grep 'Table GC'
```

### I3. Curriculum Cup 30-day retention

Lives in the tournament service's sweep. Throttled to once per hour (not 60s). Force it:

```sh
docker compose exec tournament node -e "
const { sweepOldCups } = require('./src/lib/tournamentSweep.js');
sweepOldCups(new Date()).then(r => { console.log(r); process.exit(0); });
"
```

Returns `{ tournaments: 0, bots: 0 }` for a fresh local DB. To exercise it, manually pre-date a cup and re-run:

```sh
docker compose exec backend node -e "
const { default: db } = require('./src/lib/db.js');
db.tournament.updateMany({
  where: { isCup: true },
  data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
}).then(r => { console.log('Pre-dated:', r.count); process.exit(0); });
"
```

Then re-run the sweep. It should report `tournaments: <N>`, `bots: <N*3>` (each cup brings 3 cup-clone bots).

---

## Stage J — E2E spec

The deterministic version of stages F–G:

```sh
cd e2e
npx playwright test guide-curriculum --project=chromium
```

Three scenarios cover:

1. POST /bot-games/practice → series completes → step 5 credited
2. POST /tournaments/curriculum-cup/clone → 201 with cup + step 6 fires immediately
3. Cloned cup completes within the soak window → step 7 credited + tournament COMPLETED

The spar series uses `moveDelayMs: 200` to keep the test fast; the cup uses the default config `paceMs: 1000` (~30s end-to-end).

The reward popup + coaching card UI rendering are NOT in the E2E (asserting on socket-driven UI in Playwright is flaky). Their coverage is in the unit/component layer:

- `backend/src/lib/__tests__/tournamentBridge.coachingCard.test.js` — proves the server emits the right card per branch
- `backend/src/config/__tests__/coachingCardRules.test.js` — proves the decision tree returns the right card

---

## Known gaps (deferred to later sprints)

- **No didTrainImprove computation** — Sprint 4 always passes `false` from the bridge, so the ONE_TRAIN_LOSS coaching card never fires in production. The unit test still covers it; v1.1 (Sprint 7) computes the flag from ML model history.
- **No Specialize recommendations** — Sprint 7+. Step 7 lands the user in the Specialize phase, but the JourneyCard just shows the celebration card (per Sprint 3 D3). The 3-card recommendation stack ships post-30-day-observation.
- **Rookie Cup CTA is text-only** — the CHAMPION card's `/guide/rookie-cup` link is a placeholder. Full Rookie Cup ships in v1.1 Sprint 8.
- **No bot picker on cup clone** — the endpoint accepts an optional `myBotId`, but the `/clone` flow currently auto-picks the user's most-recent bot. There's no in-product UI yet to let the user choose; advanced users hit the API directly. Acceptable for v1 since most users have one bot.
- **No reward popup history / TC ledger UI** — popup fires once per boundary; the +20/+50 TC are recorded but there's no in-app place to see your TC balance yet.

---

## What "good" looks like

If you can run Stages F–H end-to-end against your local dev stack — sparring fires step 5, cloning a cup fires step 6 immediately and step 7 on completion, the +50 TC reward popup fires, and the coaching card surfaces with the right CTA for your bot's finishing position — **Sprint 4 is working as intended**.

If anything in Stages F–I doesn't match this doc, note the deviation and check the implementation-plan checklist (`doc/Intelligent_Guide_Implementation_Plan.md` §9 Sprint 4) for whether the relevant deliverable is marked done.
