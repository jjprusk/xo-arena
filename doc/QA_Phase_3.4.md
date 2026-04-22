<!-- Copyright (c) 2026 Joe Pruskowski. All rights reserved. -->
# Phase 3.4 / 3.5 QA Checklist

**Version:** v1.3.0-alpha-1.18 (staging) / v1.3.0-alpha-1.19+ pending
**Date updated:** 2026-04-22

## Phase 3.4 scope (sections 1–10)
Tables are the single source of truth for all game sessions. The in-memory `roomManager` and `rooms.js` HTTP routes have been deleted. All game state lives in `Table.previewState`. **Status: implementation complete, manual QA pass done (items marked ✓).**

## Phase 3.5 scope (section 11)
Multi-game infrastructure, per-game bot skills, mobile sidebar auto-hide, active table preview thumbnails, admin skills column. **Status: implementation complete as of 2026-04-19. Automated Playwright coverage 36/36 against local stack + 12/12 staging smoke every `/stage`.**

Automated coverage: `e2e/tests/phase35.spec.js` — 6 tests run without auth (API + tables page DOM), 5 more activate when `TEST_USER_EMAIL` / `TEST_ADMIN_EMAIL` env vars are set.

---

## 📋 Open Items (not yet covered by automation)

As of v1.3.0-alpha-1.19 the next wave of open items is now automated in
`e2e/tests/open-items.spec.js` and extensions to
`e2e/tests/tournament-seed-bots.spec.js`. The remainder below is genuinely
manual — backend log inspection, Redis event payload checks, multi-minute
idle waits, or code-review items.

**Newly automated in this wave** (verify with `npm run test:e2e`):

- [x] 11b items 1, 2, 3, 5 — thumbnail absent on FORMING + COMPLETED, present on ACTIVE, reflects live `previewState.board`
- [x] 11c items 1, 2 — form dropdown renders with `xo` option and defaults to `xo`
- [x] 11d items 3, 4 — bot create form defaults to `xo`; BotSkill row appears in admin list after creation
- [x] 11f items 3, 4 — `none` renders for skill-less bots; badge exposes `title="xo: algorithm — STATUS"` tooltip
- [x] Section 9b — recurring human subscription carried to the next occurrence
- [x] Section 9d — removed seed bot absent from the next occurrence

**Still manual** (~10 min of hands-on work for a full pre-promotion QA pass):

- **11b item 4** — win-line amber highlight on a game that finished but whose
  table hasn't transitioned to COMPLETED. Narrow window via the idle timer;
  not worth racing the GC in a spec.
- **11c item 4** — "no hardcoded `'xo'` strings" in the tournament form. Static
  check; better as an ESLint rule than an e2e.
- **11d item 5** — "second game added to `gameRegistry.js` appears in dropdown
  without code changes." Speculative until a second game actually exists.
- **11e (all 3)** — server-side skill resolution. Better as backend vitest
  (`resolveSkillForGame` pure-function tests + a socketHandler test that
  ignores a client-supplied `botSkillId`) than e2e.
- **11g (all 3)** — Tournament `gameId` propagation in Redis events. Better
  as a backend vitest with a mocked pub/sub spy.
- **Sign-off row "Idle handling"** — 3+ min wall-clock waits. Would work
  with a test-only config hook that shortens the thresholds.
- **Sign-off row "Notifications"** — teal Table badge content and Guide
  drawer placement. Mostly covered by existing specs; the uncovered edge
  is per-user filtering (random users not seeing a Table notification).

---

## 1. HvB (Human vs Bot) — Core Path

The fastest validation that the new socketHandler is working end-to-end.

**URL:** `http://localhost:5174/play?action=vs-community-bot`

- [x] Board loads within ~1s (no spinner hang)
- [x] You are X, bot is O (or vice versa) — marks display correctly
- [x] Click a cell -> X appears immediately, bot responds with O after brief delay
- [x] Sound plays exactly once per move (no doubling)
- [x] Play to a **win** -> win line highlights, scores update, Rematch / Leave Table buttons appear
- [x] Play to a **draw** -> draw banner shows, Rematch / Leave Table appear
- [x] Click **Rematch** -> board resets, round increments, opening player alternates, scores carry over
- [x] Click **Leave Table** -> returns to `/`
- [x] **Focused mode**: `<- Back` and expand button visible at top of game area
- [x] **Chrome-present mode** (click expand): sidebar shows game title, status, seated players (You + Bot), Gym/Puzzles links
- [x] Toggle focused <-> chrome-present preserves board state (X's and O's don't disappear)

---

## 2. PvP (Player vs Player) — via Tables

Phase 3.4 makes Tables the PvP front door. Requires two browser contexts
(e.g., normal window + incognito) signed in as two different users.

**Tab A (host):**
1. Sign in
2. Go to `http://localhost:5174/tables`
3. Click **+ Create table**, choose XO, create

**Tab B (guest):**
1. Sign in as a different user in incognito
2. Paste the table URL (`/tables/:id`) OR find the table in the public list

- [x] Tab A: creates the table with "Forming" status, sits in seat 1
- [x] Tab B: opens the table detail page, clicks **Take this seat** on seat 2
- [x] Status changes to **In play** on both tabs
- [x] Both tabs see the board with correct marks
- [x] Moves alternate correctly between tabs
- [x] Sound plays on the opponent's move (not your own)
- [x] Game completes → both tabs see the result (win/loss/draw)
- [x] Rematch works from either side
- [x] **Disconnect test**: close Tab B → Tab A sees "Opponent disconnected" notice → after ~60s, auto-forfeit fires and Tab A wins
- [x] **Spectator test** (optional): open a third tab to `/tables/:id` → sees the board live, no input allowed

---

## 3. Tables Page Integration

**URL:** `http://localhost:5174/tables`

- [x] Tables list loads (no errors in console)
- [x] Click **+ Create table** -> modal opens, create an XO table
- [x] New table appears in list with **Forming** badge
- [x] Click into the table detail page -> seats show correctly
- [x] **Join a seat** -> seat updates in real time
- [x] Second user joins (incognito) -> status changes to **In play** when both seats filled
- [x] **Cross-tab sync**: seat changes in one tab appear in the other without refresh
- [x] **Share button** copies `/tables/:id` URL to clipboard
- [x] **Delete a table** you created (Forming or Completed status)
- [x] Creator sees their own private tables in the list; other users do not
- [x] **Watcher count**: creator alone = 0 watching; second browser opens detail page = 1 watching

---

## 4. Seat Display Names

- [x] When another user joins your table, their **real display name** appears (not `User ba_user_xyz`)
- [x] Bot seats show **Bot** with a BOT badge
- [x] Your own seat shows **You**

---

## 5. Notifications

- [x] When someone joins your table, you get a teal **Table** notification in the Guide drawer (not "Admin")
- [x] When someone leaves your table, same teal notification
- [x] Your own join/leave actions do NOT generate a notification for yourself
- [x] Random users not associated with the table do NOT get notifications
- [x] `table.created`, `spectator.joined`, `table.empty`, `table.deleted` do NOT appear as notifications

---

## 6. Idle / Stale Room Handling

- [x] After ~3 minutes of no moves, you get an idle warning
- [x] If you continue idling past the grace period, the game ends with "Room ended due to inactivity"
- [x] If you click a cell after the room was idle-kicked, you see an "abandoned" notice and get redirected home (no silent failure / frozen board)

---

## 7. Table GC (Background Service)

These are scripted — run `./doc/qa-scripts/table-gc.sh` (all 5 tests, 10 assertions).

- [x] FORMING tables with all empty seats older than 30 min are auto-deleted
- [x] COMPLETED tables older than 24 hr are auto-deleted
- [x] ACTIVE tables idle past the configured threshold are marked COMPLETED
- [x] Tournament tables in FORMING state are NOT auto-deleted (they wait for bridge players)
- [x] Backend logs: `Table GC: deleted N forming, N completed, abandoned N active` (only when something was cleaned up)

---

## 8. Tournament Match

Requires the tournament service running (`docker compose up tournament`) and connected to the same
Redis instance as the backend. For **BOT_VS_BOT** tests, seed test bots first if not already present:

```
docker compose exec backend node backend/src/cli/um.js test-bots
```

### 8a. Lifecycle

Sign in as a tournament admin. Use the Tournaments UI at `http://localhost:5174/admin/tournaments`, or call the tournament API directly at `http://localhost:3001/api/tournaments` (API-only service — returns raw JSON; browsing to the root `/` returns 404).

- [x] Create a tournament in DRAFT status
- [x] Publish it (`POST /api/t/tournaments/:id/publish`) → status becomes **REGISTRATION_OPEN**; connected clients receive a tournament notification in the Guide drawer
- [x] Register participants (4 test bots via **Fill test players**, or 2 real users for HVH)
- [x] Participant count on the tournament detail page matches the number registered
- [x] Start the tournament → status becomes **IN_PROGRESS**; round 1 bracket created (2 matches for 4 players, 1 match for 2)

### 8b. BOT_VS_BOT match (no manual play required)

Create the tournament with `mode: BOT_VS_BOT`, `bracketType: SINGLE_ELIM`, and 4 test bots.

- [x] On start, backend logs show bot matches firing (`tournament:bot:match:ready`) — no `Failed to start bot tournament match` warnings
- [x] Both round-1 matches complete automatically (no action needed)
- [x] After both round-1 matches: round 2 auto-created with the 2 winners paired into the final
- [x] Final match completes → tournament status moves to **COMPLETED**
- [x] Winner gets `finalPosition: 1`; runner-up gets `finalPosition: 2`
- [x] Bot owners receive a `tournament.completed` notification in the Guide drawer

### 8c. HVH match (requires 2 accounts)

Create the tournament with `mode: HVH`, register 2 real users, start it.

- [x] Both participants receive a `tournament:match:ready` socket event and see a **"match.ready"** item in their Guide drawer
- [x] Both players join via the match UI (emits `tournament:room:join`) → table created → game board visible to both
- [x] Game plays to completion — no errors in browser console or backend logs
- [x] Table status changes to **COMPLETED** after the series ends
- [x] Both participants see a match result notification; tournament completes (2-player bracket = 1 match)

### 8d. ELO isolation

- [x] Note both participants' ELO on the Rankings page **before** the match
- [x] After the match completes, check Rankings again — ELO for both players is **unchanged**

### 8e. Odd-player bracket (optional)

Create a SINGLE_ELIM tournament with 3 participants (2 bots + 1 human, or 3 bots).

- [x] One participant receives an automatic **bye** (COMPLETED match with no opponent, winner = bye recipient)
- [x] Bracket advances correctly: bye recipient goes to round 2 alongside the winner of the real match

### 8f. Auto-cancellation (optional)

Create a tournament with `minParticipants: 4`, register only 1 user, set `registrationCloseAt` to a time 1–2 minutes in the future, wait.

- [x] Tournament sweep (runs every 60s) auto-cancels the tournament after `registrationCloseAt` passes
- [x] Status moves to **CANCELLED**
- [x] Registered participant receives a `tournament.cancelled` notification in the Guide drawer

---

## 9. Things That Should NOT Happen

- [x] No `Room not found` errors in browser console
- [x] No `400 Bad Request` polling errors on socket.io
- [x] No stale socket reconnect cascades
- [x] No "Admin" badge on seat-change notifications (should be "Table" badge, teal)
- [x] No references to "room" in user-facing UI (except the waiting-for-opponent share URL which still says `/play?join=...`)
- [x] No `roomManager` imports anywhere in the codebase (deleted)

---

## 10. Regression Checks

These existed before Phase 3.4 and should still work:

- [x] Sign in / sign out works
- [x] Navigation: Tables, Tournaments, Rankings, Profile, About all load
- [x] Gym page loads at `/gym`
- [x] Puzzles page loads at `/puzzles`
- [x] Rankings page shows per-game ELO
- [x] Bot profile pages load
- [x] Replay page loads for completed games
- [x] Admin health dashboard shows table metrics (Forming/Active/Completed/Stale/Watchers)

---

## 9. Tournament Seed Bots

Seed bots are admin-configured bot accounts that are automatically registered as participants in every recurring tournament occurrence, ensuring matches can run even with low human attendance.

### 9a. Add seed bots to a recurring tournament

> **Automated** — `e2e/tests/tournament-seed-bots.spec.js` test "9a/9e: add seed bots across all skill levels". Run with `./scripts/run-qa.sh tournament-seed-bots`.

- [x] Open the admin panel for a recurring tournament in `REGISTRATION_OPEN` status
- [x] Navigate to the **Seed Bots** tab
- [x] Click **Add Seed Bot**, enter a name (e.g. "Rusty Pete") and set skill level to `Rusty`
- [x] Add a second bot (e.g. "Magnus Jr.") at skill level `Magnus`
- [x] Verify both bots appear in the seed bot list with their configured skill levels
- [x] Verify both bots are listed as participants in the **Participants** tab with `registrationMode: RECURRING` shown
- [x] Verify each bot has a `TournamentSeedBot` config row: `SELECT * FROM tournament_seed_bots WHERE "tournamentId" = '<id>';`

### 9b. Seed bots propagate to new recurring occurrences

> **Automated** — `tournament-seed-bots.spec.js` test "9b: seed bots propagate to the next recurring occurrence". Uses the admin `POST /api/tournaments/:id/admin/force-complete` and `POST /api/tournaments/admin/scheduler/check-recurring` endpoints (both added in the same sweep) to avoid having to play out a full bracket or wait for the 60s scheduler tick.

- [x] Mark the current recurring tournament COMPLETED (or wait for natural completion)
- [x] Wait for the scheduler to run (up to 1 min) or trigger manually: `checkRecurringOccurrences()`
- [x] Verify a new occurrence is created with `status: REGISTRATION_OPEN`
- [x] Verify the new occurrence's participant list includes both seed bots
- [x] Verify `tournament_seed_bots` rows exist on the **new occurrence** (not just the template)
- [x] Verify recurring human participants are also carried over (if any) — automated in `tournament-seed-bots.spec.js` "9b: recurring human subscription propagates to the next occurrence"

### 9c. Seed bots participate in BOT_VS_BOT automated play

> **Automated** — `tournament-seed-bots.spec.js` test "9c: BOT_VS_BOT tournament with seed bots produces round-1 match that can complete". The bot-runner timing itself is covered by the vitest suite in 9f; the e2e verifies the bracket wiring and match-completion flow with seed bots as participants.

- [x] Start a `BOT_VS_BOT` tournament that includes seed bots as participants
- [x] Trigger tournament start (auto at `startTime` or manual via admin)
- [x] Verify the bracket is generated and first-round matches are created
- [x] Open the bot game spectator URL for a seed-bot match  *(manual — not automated)*
- [x] Verify the game plays to completion automatically (moves appear with ~1.5s delay)
- [x] Verify the match result is reported back to the tournament bracket
- [x] Verify the losing bot is eliminated and the bracket advances correctly

### 9d. Remove a seed bot from a tournament

> **Automated** — `tournament-seed-bots.spec.js` test "9d: remove seed bot withdraws participant and clears config".

- [x] In the admin panel, click **Remove** next to a seed bot
- [x] Verify the bot disappears from the seed bot list
- [x] Verify the bot's participant row is set to `WITHDRAWN`
- [x] Verify that subsequent new occurrences do **not** include the removed bot — automated in `tournament-seed-bots.spec.js` "9d: removed seed bot is absent from the next recurring occurrence"

### 9e. Seed bot skill levels map correctly

> **Automated** — same test as 9a; every skill level is exercised and asserted against the `botModelId` suffix. `parseBotModelId()` is covered by the vitest suite in 9f.

| Admin skill label | Expected `botModelId` suffix | Expected AI difficulty |
|---|---|---|
| Rusty | `novice` | novice (easy) |
| Copper | `intermediate` | intermediate |
| Sterling | `advanced` | advanced |
| Magnus | `master` | master (hardest) |

- [x] Verify `botModelId` in DB matches `seed:{username}:{skill}` format for each level
- [x] Verify `parseBotModelId('seed:rusty-pete-abc123:novice')` returns `{ impl: 'minimax', difficulty: 'novice' }`

### 9f. Scheduler unit tests pass

> **Automated** — runs as part of the default `npm test` (wired into the top-level workspace script). Invoked standalone with `npm run test:tournament`. File: `packages/tournament/src/__tests__/seedBots.test.js`.

- [x] Run `npx vitest run src/__tests__/seedBots.test.js` from `packages/tournament/` — all 3 tests pass

---

---

## 10a. Post-v1.13 additions (2026-04-21 → 2026-04-22)

Items landed after the original Phase 3.4 QA pass. Marked ✓ where the user has
confirmed against staging on the indicated device.

### Web Push (Tier 3 transport) — opt-in notifications

- [x] VAPID public key served from `/api/v1/push/public-key`
- [x] Service worker registered at `landing/public/sw.js`
- [x] Subscribe + unsubscribe via Settings page push section
- [ ] Receive a push notification when offline and a match fires (requires granting OS permission on a real device)

### iOS audio path

- [x] Silent-buffer AudioContext unlock inside pointerdown gesture (soundStore)
- [x] Silent-buffer unlock mirrored into notifSoundStore (notification pings)
- [x] `document.hasFocus()` gate bypassed on touch devices — iOS Safari often reports false even for active pages
- [x] `_maybeStale` flag ignores statechange events from replaced (closed) contexts — previously re-raised stale=true right after createFreshCtx cleared it
- [x] ctx() returns the context when state is `'suspended'` so oscillator scheduling queues onto the context and plays when resume() completes
- [x] Game move sound plays only for the opponent's move — own-click sound removed (was double-beeping per round on iOS after the unlock worked)
- [ ] iOS Safari first-turn sound audible on a fresh tab (re-verify against v1.3.0-alpha-1.19+ once the double-beep fix ships)

### Audio debug overlay (`?audioDebug=1`)

- [x] Activate via URL query param; persists in sessionStorage across SPA nav
- [x] Shows live AudioContext state, `_maybeStale`, master gain, volume, pack, last-play key+result+age
- [x] Mirror block for notifSoundStore (gestureHappened, state, last-play)
- [x] ENV block: touchDevice, hasFocus, visibilityState
- [x] "Test move" and "Test notif" buttons fire the respective `play()` calls in isolation from any socket event

### Guide / Journey

- [x] `POST_JOURNEY_SLOTS` default tiles install on hydrate for accounts whose journey is dismissed but stored slots are empty (legacy accounts)
- [x] `99+` badge cap (was showing `9+` but count was accurate under the hood)
- [x] "Clear all" button in the notification stack when > 1 notification present

### Admin tournaments polish

- [x] Test-tournament `isTest` flag — hidden from users, visible to admins
- [x] Admin per-row action menu (View/Edit/Publish/Start/Cancel/Mark test) replacing the per-row button cluster
- [x] Admin multi-select status filter (was a row of pills)
- [x] Bulk-actions bar with row checkboxes + Purge Cancelled + Purge Test buttons
- [x] Admin "Check Recurring" trigger endpoint + button

### Tournaments page (user side)

- [x] Converted to ListTable with fill mode (bound scroll; no outer scrollbar)
- [x] Date-filter dropdown + search box + pagination
- [x] Registration modal (narrow-window usable; previously inline, barely tappable)

### Recurring tournaments

- [x] `recurrencePaused` toggle to skip a template without cancelling
- [x] Dropped CUSTOM interval (was half-implemented, always set)
- [x] Scheduler ported into the live `tournament/` service (previously only in the orphaned `packages/tournament/` module — never ran in prod)
- [x] Admin scheduler-trigger endpoint + button to force a recurring sweep
- [x] Daily cap removed
- [x] Inherits `isTest` flag from template to new occurrences
- [x] User recurring-subscriptions section on Profile

### Backend / transport

- [x] `SSE_MAX_CONNECTIONS_PER_USER` raised 2 → 8 (tab refreshes no longer 429)
- [x] sseBroker XREAD liveness signal + `resourceCounters` alert (stale XREAD > 90s while clients connected)
- [x] Phase D: retired socket Tier 2 channels in favor of SSE
- [x] Retry on mountain-pool slug collision in `POST /api/v1/tables` (pool is in-memory; restart leaves old slugs in DB)
- [x] PvP table-flow fix: socketHandler seats creator at seat 0, defers ACTIVE until both seats occupied, initializes `previewState` via `makePreviewState`, broadcasts `room:spectatorJoined` so sidebar watcher count updates

### E2E

- [x] Full local suite 36/38 passing (2 skipped = staging deploy-gate tests that fire during `/stage` smoke)
- [x] Rewritten `pvp.spec.js` for two authed users + Tables API (old spec used deleted auto-room paradigm)
- [x] `tournament-seed-bots.spec.js` covering QA Section 9a/b/c/d/e
- [x] Every `/stage` runs the 12-test smoke against live staging Fly deploys

### Mobile layout (in-flight as of 2026-04-22)

- [ ] Both player pods symmetric — top + bottom both overlap panel edge (currently only top visibly overlaps)
- [ ] Status rows collapsed from 3 lines to 1 (`X Your turn · Round 1 · 0–0`)
- [ ] Rematch/Leave/Forfeit controls moved up — no longer clipped by Safari's bottom URL chrome
- [ ] Emoji reaction becomes a floating icon (top-right over board) instead of anchoring a full row at the bottom

---

## 11. Phase 3.5 Additions

> **Implementation status:** Code-complete as of 2026-04-19. As of 2026-04-21 the full Playwright suite (`npm run test:e2e`) passes 36/36 against a fresh local stack (2 skipped are the deploy-gate tests that only run against staging). Automated coverage is noted inline below. Items that remain unchecked are manual-only by nature (live board thumbnails, Redis payload inspection, backend log checks, DB queries, tooltip hover).

### 11a. Mobile sidebar auto-hide

> Automated: `phase35.spec.js` — "sidebar auto-hides on mobile when game starts" + "sidebar does NOT auto-hide on desktop" (both require `TEST_USER_EMAIL`).

Requires a mobile viewport (≤ 767 px) or browser devtools mobile emulation.

- [x] Start an HvB game on a mobile viewport → sidebar is hidden automatically when the game transitions to `playing`
- [x] Toggle button is visible at the top of the board area → tap it → sidebar slides in
- [x] Tap toggle again → sidebar hides again; board fills the full width
- [x] On a desktop viewport (≥ 768 px) the sidebar does **not** auto-hide when the game starts

### 11b. Active table preview thumbnail


> Not automated (requires live active table state). Manual test only. The `phase35.spec.js` tables page test confirms the Game column exists but not thumbnail rendering.

**URL:** `http://localhost:5174/tables`

- [x] A table in **Forming** status shows the game label only (no thumbnail) — automated in `open-items.spec.js` §11b
- [x] A table in **Active** status shows a 3×3 mini board thumbnail alongside the game label — automated
- [x] The thumbnail reflects the current board state (X/O marks visible at the correct cells) — automated
- [ ] Win line cells are highlighted in amber when a game ends before the table completes  *(manual — narrow window between game-end and idle-GC completion)*
- [x] Thumbnail does **not** appear for Completed tables — automated (skips cleanly when no COMPLETED rows exist)

### 11c. Multi-game infrastructure — Tournament form

> Automated (partial): `phase35.spec.js` — skills API endpoint and `gameId` filter checks run without auth. Tournament form UI check requires admin auth (set `TEST_ADMIN_EMAIL`).

- [x] Open the **Create Tournament** form (admin or user) — automated in `open-items.spec.js` §11c
- [x] **Game** dropdown is present and populated from `gameRegistry.js` (currently shows XO only) — automated (defaults to `xo`)
- [x] Create a tournament with game = XO → `game` field stored correctly in DB (covered transitively by `tournament-mixed.spec.js`, `tournament-mixed-ui.spec.js`, and `tournament-seed-bots.spec.js` — all create + fetch round-trip tournaments with `game: 'xo'`)
- [ ] No hardcoded `'xo'` strings remain in the tournament form component  *(manual — better as ESLint rule; not an e2e)*

### 11d. Bot creation — Game field

> Automated: `phase35.spec.js` — "bot creation panel has a Game dropdown" (requires `TEST_USER_EMAIL`).

**URL:** `http://localhost:5174/profile` (signed in, non-bot user)

- [x] Open the **My Bots** section → click **+ Create Bot**
- [x] **Game** dropdown is present, showing all registered games (currently XO only)
- [x] Default selection is XO — automated in `open-items.spec.js` §11d
- [x] Create a bot with Game = XO → `BotSkill` row created with `game_id = 'xo'` — automated via admin `/api/v1/admin/bots` round-trip (`skills` array includes `gameId: 'xo'`)
- [ ] When a second game is added to `gameRegistry.js`, it appears in the dropdown without any other code changes  *(manual — speculative until a second game exists)*

### 11e. Multi-skill bots — Server-side skill resolution

> Not automated (requires backend log inspection). Manual test only.

These verify that the HvB path resolves skill server-side rather than trusting a client value.

- [ ] Start an HvB game via `?action=vs-community-bot` — game plays normally (skill resolved from `BotSkill` table)
- [ ] Confirm backend log shows no `resolveSkillForGame returned null` warning for community bots (they always have an XO skill)
- [ ] Manually POST `room:create:hvb` with a fake `botSkillId` — server ignores it and resolves the real skill from DB

### 11f. Multi-skill bots — Admin skills column

> Automated: `phase35.spec.js` — "admin bots table has Skills column" + "admin bots API returns skills array per bot" (both require `TEST_ADMIN_EMAIL`).

**URL:** `http://localhost:5174/admin/bots`

- [x] Bot list table has a **Skills** column (visible at ≥ 1024 px viewport)
- [x] Each bot row shows a teal `XO` badge for any bot that has an XO skill
- [x] Bots with no `BotSkill` rows show `none` in the Skills column — automated in `open-items.spec.js` §11f
- [x] Hovering a badge shows a tooltip with `gameId: algorithm — status` (e.g., `xo: ml — TRAINED`) — automated via title-attribute assertion

### 11g. Multi-skill bots — Tournament `gameId` propagation

> Not automated (requires Redis event payload inspection). Manual test only.

Requires a `BOT_VS_BOT` tournament. Run after section 8b passes.

- [ ] Start a BOT_VS_BOT tournament → check backend logs for `tournament:bot:match:ready` events — each event payload includes `gameId: 'xo'`
- [ ] After round completion, bracket-advancement path fires a new `tournament:bot:match:ready` event — it also includes `gameId`
- [ ] `recoverPendingBotMatches` on backend restart re-publishes events with `gameId` included (check logs)

---

## Sign-off

"Automated e2e" means the area has passing Playwright specs in `e2e/tests/`;
runs against a local stack via `npm run test:e2e` and again against staging
via the `/stage` smoke subset. "Manual" rows require a human runthrough.

| Area | Tested by | Date | Pass/Fail | Notes |
|------|-----------|------|-----------|-------|
| HvB core path | automated e2e (`pvai.spec.js`) + manual | 2026-04-21 | Pass | 4/4 specs |
| PvP | automated e2e (`pvp.spec.js`) | 2026-04-21 | Pass | 3/3 specs, incl. spectator |
| Tables page | automated e2e (`phase35.spec.js` tables-page tests) | 2026-04-21 | Pass | Manual watcher + cross-tab sync still useful |
| Seat display names | manual | | | |
| Notifications | manual | | | Guide drawer content, teal Table badge |
| Idle handling | manual | | | Depends on 3-min waits |
| Table GC | scripted (`doc/qa-scripts/table-gc.sh`) | 2026-04-21 | Pass | 5 tests / 10 assertions |
| Tournament | automated e2e (`tournament-mixed.spec.js`, `tournament-mixed-ui.spec.js`) | 2026-04-21 | Pass | MIXED lifecycle + UI smoke |
| Tournament Seed Bots | automated e2e (`tournament-seed-bots.spec.js`) + vitest (`packages/tournament/src/__tests__/seedBots.test.js`) | 2026-04-21 | Pass | 9a/b/c/d/e/f automated |
| Mobile sidebar auto-hide | automated e2e (`phase35.spec.js`) | 2026-04-21 | Pass | Mobile + desktop variants |
| Active table preview | manual | | | Live board state; not automatable without match orchestration |
| Multi-game infrastructure | automated e2e (skills API in `phase35.spec.js` + game-field round-trip via tournament specs) | 2026-04-21 | Pass (partial) | Form-UI dropdown check still manual |
| Bot creation game field | automated e2e (`phase35.spec.js`) | 2026-04-21 | Pass (partial) | Default selection + DB verification manual |
| Admin skills column | automated e2e (`phase35.spec.js`) | 2026-04-21 | Pass (partial) | None-state + tooltip hover manual |
| Tournament gameId propagation | manual | | | Requires Redis event inspection |
| Regressions | automated e2e (full suite) | 2026-04-21 | Pass | 36/38 passing, 2 skipped (deploy-gate staging-only) |
