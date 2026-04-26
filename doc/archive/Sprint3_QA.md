---
title: "Sprint 3 QA Walkthrough — Hook + Quick Bot"
subtitle: "Intelligent Guide v1, Sprint 3 (Demo Table macro, Quick Bot wizard, JourneyCard rewrite, Hook reward popup)"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## What this document covers

This is the manual QA script for **Sprint 3** of the Intelligent Guide v1 effort. It exercises the work that turns a fresh Curriculum-step-3 user into one who has built their first bot, trained it, watched the JourneyCard react, and seen the Hook reward popup. Sprints 1 + 2 (the welcome funnel) are covered separately in `Welcome_Process_Phase1_QA.md`.

Companion docs:

- **What** — `Intelligent_Guide_Requirements.md` (the spec)
- **How / when** — `Intelligent_Guide_Implementation_Plan.md` (sprints + checklists)
- **QA (this doc)** — concrete steps to confirm the Sprint 3 features work on local dev

---

## Stage 0 — Prereqs

1. Docker stack running — `docker compose ps` should show `backend`, `landing`, `tournament`, `postgres`, and `redis` all healthy.
2. A signed-in user with Hook complete (so we land in Curriculum step 3). Either:
   - Run the Phase 1 QA script through Stage B to create a fresh user with Hook 2/2, **or**
   - Take any existing test user and fast-forward: `um journey <user> --phase curriculum` (sets steps 1-2 done, lands at step 3).
3. Open http://localhost:5174/ signed in as that user.
4. A terminal handy for `um` and `docker compose logs`.

---

## Stage A — Demo Table macro (§5.1)

The Demo Table is the server-driven bot-vs-bot match users can spin up to "watch" before they build. The hero arena on `/` is *not* the Demo Table — the Demo Table is opened via the explicit endpoint, lives at a real table URL, and is GC'd by `tableGcService`.

### A1. Create a Demo Table via the endpoint

From a terminal with cookies copied from the browser (or via the `um` shortcut if available):

```sh
curl -sS -X POST http://localhost:3000/api/v1/tables/demo \
  -H "Cookie: <paste your better-auth session cookie>" | jq .
```

You should get back a table object:

- `isDemo: true`
- `slug` — a mountain name (e.g. `everest`, `denali`)
- `players` — two bots from the curated allowlist (Copper Coil / Sterling Knight / Rusty Hinge / Polished Argent permutations)

### A2. Open the Demo Table in the browser

Navigate to `/play?join=<slug>` (or `/tables/<slug>` and join). The bot-vs-bot match should be playing live, with the same surface and StatusLine you see for any normal table.

### A3. Confirm one-active-per-user replacement

Hit `POST /api/v1/tables/demo` a second time as the **same user**. The previous Demo Table should be replaced (deleted), and you get back a brand-new table object. There should never be more than one active Demo Table per user.

Confirm in the DB or via `um list-tables`:

```sh
docker compose exec backend node -e "
const { prisma } = require('./src/lib/db.js');
prisma.table.findMany({ where: { isDemo: true }, select: { id: true, slug: true, ownerId: true } })
  .then(t => { console.log(JSON.stringify(t, null, 2)); process.exit(0); });
"
```

You should see exactly **one** demo table for your user.

### A4. Confirm creator-only visibility

As a different user (or signed out in another window), hit `GET /api/v1/tables`. The Demo Table should **not** appear in the list — it's filtered out for everyone except its creator.

### A5. Curated allowlist

Repeatedly POST `/api/v1/tables/demo` and check the resulting `players` field. The pairings should always be drawn from `backend/src/config/demoTableMatchups.js` — Copper/Sterling, Rusty/Copper, Copper/Copper, Sterling/Sterling. No other bot personas should ever appear.

### A6. GC sweep — manual

Force a sweep to confirm the GC behavior works without waiting an hour:

```sh
docker compose exec backend node -e "
const { runDemoTableSweep } = require('./src/services/tableGcService.js');
runDemoTableSweep().then(r => { console.log(r); process.exit(0); });
"
```

Expected: tables that completed > 2 minutes ago are deleted; tables created > 1 hour ago are deleted regardless of state. Tables in-flight (or recently completed) are kept.

### A7. GC sweep — overnight TTL (optional, slow)

If you want the real-world test: leave a Demo Table running, come back in an hour. It should be gone.

---

## Stage B — Quick Bot wizard (§5.3)

### B1. Open the wizard

In the Guide panel (right sidebar), the Curriculum step-3 card should read something like *"Create your first bot"* with a CTA. Click it. Alternatively, navigate directly to `/gym?action=quick-bot` if the wizard is mounted there.

The wizard is a 3-step modal:

1. **Name** — text input, validated to non-empty.
2. **Persona** — pick from a small set of starter personas (likely 3-4 flavors).
3. **Confirm** — review screen showing the chosen name + persona + "Your bot will start at novice difficulty."

### B2. Submit and observe the network call

Open DevTools → Network. Click `Create bot` on the confirm step. You should see:

- `POST /api/v1/bots/quick` with body `{ name, persona }`
- Response 201 with the new bot object
- `botModelId` on the response should match `user:<your-user-id>:minimax:novice`

### B3. Confirm journey step 3 fired

Reload `/`. The Guide panel's JourneyCard should now show step 3 as **completed**, with step 4 highlighted as the active next step.

Confirm via `um`:

```sh
um journey <your-username>
```

You should see `(3/7)` and the orb pattern should now be `●●●○○○○`. Phase remains `curriculum`.

### B4. Confirm bot exists in the user's list

Navigate to `/gym` (or wherever the bot list lives). Your new bot should appear, with a `Train your bot` button visible (Stage C).

### B5. Validation — empty name

Re-open the wizard and submit with an empty name on step 1. The wizard should refuse to advance to step 2.

---

## Stage C — Train your bot (depth bump)

### C1. Open the bot detail page

Click your newly-created bot from the gym list. You should be on `/bots/<id>` (or similar). The page should display a `Train your bot` panel — typically with a single CTA labelled `Train your bot` and a small explainer that this bumps the bot's lookahead depth from novice (1-ply) to intermediate (3-ply).

### C2. Click Train

Open DevTools → Network. Click `Train your bot`.

- `POST /api/v1/bots/:id/train-quick` should fire
- Response should include the updated `botModelId` — now ending in `:intermediate` instead of `:novice`
- The Train panel should switch to a "trained" / "Train more in the Gym" state

### C3. Confirm journey step 4 fired

Reload `/`. The JourneyCard should now show step 4 completed, step 5 highlighted.

```sh
um journey <your-username>
```

`(4/7)`, orbs `●●●●○○○`. Still phase `curriculum`.

### C4. Repeat-click idempotency

Click `Train your bot` a second time. The endpoint should either be hidden (no button) or no-op gracefully — bumping the same bot from intermediate to intermediate should not flip step 4 again or create duplicate journey records.

---

## Stage D — JourneyCard phase-aware rendering (§9.1)

The JourneyCard is the hero panel inside the Guide sidebar. It renders three different layouts depending on which phase the user is in.

### D1. Hook phase

Reset the user back to Hook:

```sh
um journey <your-username> --reset
```

Reload `/`. The JourneyCard should be a **single hero card** — large title ("Welcome to the Arena"), one CTA, no checklist preview. Phase tag in the header reads `Hook · 0/2`.

### D2. Curriculum phase

Fast-forward to Curriculum:

```sh
um journey <your-username> --phase curriculum
```

Reload. The JourneyCard should now show:

- The hero card on top (current Curriculum step's title + CTA)
- A **5-row checklist preview** below: steps 3-7
- Completed steps with a `✓`, the active step highlighted, future steps dimmed
- Phase tag reads `Curriculum · 2/7`

Bump a step:

```sh
um journey <your-username> --step 3
```

Reload. Step 3 should flip to ✓ in the checklist; the hero card should now reflect step 4. Phase tag `Curriculum · 3/7`.

### D3. Specialize phase

Graduate the user:

```sh
um journey <your-username> --graduate
```

Reload. The JourneyCard should render the **Specialize celebration** layout — a single celebratory hero ("You're a Specialist") with no checklist (the recommendation-stack UI ships in Sprint 7). Phase tag `Specialize · 7/7`.

### D4. Cleanup

```sh
um journey <your-username> --reset
```

Or `um journey <your-username> --phase curriculum` to leave the user ready for Stage E.

---

## Stage E — Hook reward popup

The RewardPopup listens on the guide socket channel for `guide:hook_complete` (+20 TC) and `guide:curriculum_complete` (+50 TC). When a user transitions across a phase boundary, the server emits the event and the popup fires client-side.

### E1. Trigger Hook completion via the journey

The cleanest test is to manually run a user across the Hook → Curriculum boundary:

```sh
um journey <your-username> --reset
um journey <your-username> --step 1
```

Reload `/` (or have it already open in another tab). Now in the terminal:

```sh
um journey <your-username> --step 2
```

In the browser tab, you should see a celebratory popup slide in within a second or two: title like *"Hook complete!"*, body referencing **+20 TC**, auto-dismiss timer (~5 sec), click-to-close.

### E2. Confirm idempotency

Trigger step 2 a second time (it'll no-op since it's already done). The popup should **not** re-fire — the server only emits `guide:hook_complete` on the actual transition.

### E3. Curriculum completion popup (preview)

Full Curriculum completion via the `--graduate` shortcut should also fire `guide:curriculum_complete` (+50 TC). The popup behavior is the same — distinct title and amount.

```sh
um journey <your-username> --reset
um journey <your-username> --graduate
```

Reload — popup should fire for the boundary crossing. (Note: in real Sprint 4 flow this is gated by the Curriculum Cup completing; the `--graduate` shortcut bypasses the Cup but still triggers the boundary event.)

### E4. Server log check

If the popup didn't fire, confirm the server actually emitted the event:

```sh
docker compose logs backend --tail 200 | grep -E 'guide:(hook|curriculum)_complete'
```

You should see the emission line. If the server emitted but the client didn't render, the bug is in `RewardPopup.jsx` or the socket subscription; if the server didn't emit, the bug is in `journeyService.js`.

---

## Stage F — E2E spec

The deterministic version of stages A (endpoint behavior) + part of B (journey step crediting):

```sh
cd e2e
npx playwright test guide-hook --project=chromium
```

Four scenarios cover:

1. `POST /api/v1/tables/demo` returns a valid demo table with a curated matchup
2. One-active-per-user replacement works on a second POST
3. PvAI completion credits journey step 1
4. Demo-watch ≥ 2 min credits journey step 2

The wizard, train-bump, JourneyCard rendering, and reward popup are covered by component-level tests (`QuickBotWizard.test.jsx`, `JourneyCard.test.jsx`, `RewardPopup.test.jsx`) — there isn't a full Sprint 3 E2E yet beyond `guide-hook.spec.js`.

---

## Known gaps (deferred to later sprints)

- **No Curriculum Cup, Spar, or Coaching card** — all Sprint 4. After Stage C the user is at Curriculum step 4 but can't progress to steps 5/6/7 through the polished UX (only via raw bot training + tournament entry).
- **No Specialize recommendations** — Sprint 7+. Stage D3 just shows the celebration card; the 3-card recommendation stack ships post-30-day-observation.
- **No reward popup history / TC ledger UI** — popup fires once per boundary; the +20/+50 TC are recorded but there's no in-app place to see your TC balance yet.
- **Quick Bot wizard is the only path to step 3** — the legacy "build a full bot in the Gym" path also fires step 3 via `bots.js`, but there's no QA coverage in this doc for that path.

---

## What "good" looks like

If you can run Stages A-E end-to-end against your local dev stack — Demo Table created and GC'd correctly, Quick Bot wizard creates a `:novice` bot and fires step 3, Train bumps it to `:intermediate` and fires step 4, JourneyCard re-renders correctly across all three phases, and the Hook reward popup appears on the phase-1→phase-2 transition — **Sprint 3 is working as intended**.

If anything in Stages A-E doesn't match this doc, note the deviation and check the implementation-plan checklist (`doc/Intelligent_Guide_Implementation_Plan.md` §9 Sprint 3) for whether the relevant deliverable is marked done.
