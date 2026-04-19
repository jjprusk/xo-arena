<!-- Copyright (c) 2026 Joe Pruskowski. All rights reserved. -->
# Phase 3.4 / 3.5 QA Checklist

**Version:** v1.3.0-alpha-1.13 (pending)
**Date updated:** 2026-04-19

## Phase 3.4 scope (sections 1–10)
Tables are the single source of truth for all game sessions. The in-memory `roomManager` and `rooms.js` HTTP routes have been deleted. All game state lives in `Table.previewState`. **Status: implementation complete, manual QA pass done (items marked ✓).**

## Phase 3.5 scope (section 11)
Multi-game infrastructure, per-game bot skills, mobile sidebar auto-hide, active table preview thumbnails, admin skills column. **Status: implementation complete as of 2026-04-19, manual QA not yet run.**

Automated coverage: `e2e/tests/phase35.spec.js` — 6 tests run without auth (API + tables page DOM), 5 more activate when `TEST_USER_EMAIL` / `TEST_ADMIN_EMAIL` env vars are set.

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
- [ ] Register participants (4 test bots via **Fill test players**, or 2 real users for HVH)
- [ ] Participant count on the tournament detail page matches the number registered
- [ ] Start the tournament → status becomes **IN_PROGRESS**; round 1 bracket created (2 matches for 4 players, 1 match for 2)

### 8b. BOT_VS_BOT match (no manual play required)

Create the tournament with `mode: BOT_VS_BOT`, `bracketType: SINGLE_ELIM`, and 4 test bots.

- [ ] On start, backend logs show bot matches firing (`tournament:bot:match:ready`) — no `Failed to start bot tournament match` warnings
- [ ] Both round-1 matches complete automatically (no action needed)
- [ ] After both round-1 matches: round 2 auto-created with the 2 winners paired into the final
- [ ] Final match completes → tournament status moves to **COMPLETED**
- [ ] Winner gets `finalPosition: 1`; runner-up gets `finalPosition: 2`
- [ ] Bot owners receive a `tournament.completed` notification in the Guide drawer

### 8c. HVH match (requires 2 accounts)

Create the tournament with `mode: HVH`, register 2 real users, start it.

- [ ] Both participants receive a `tournament:match:ready` socket event and see a **"match.ready"** item in their Guide drawer
- [ ] Both players join via the match UI (emits `tournament:room:join`) → table created → game board visible to both
- [ ] Game plays to completion — no errors in browser console or backend logs
- [ ] Table status changes to **COMPLETED** after the series ends
- [ ] Both participants see a match result notification; tournament completes (2-player bracket = 1 match)

### 8d. ELO isolation

- [ ] Note both participants' ELO on the Rankings page **before** the match
- [ ] After the match completes, check Rankings again — ELO for both players is **unchanged**

### 8e. Odd-player bracket (optional)

Create a SINGLE_ELIM tournament with 3 participants (2 bots + 1 human, or 3 bots).

- [ ] One participant receives an automatic **bye** (COMPLETED match with no opponent, winner = bye recipient)
- [ ] Bracket advances correctly: bye recipient goes to round 2 alongside the winner of the real match

### 8f. Auto-cancellation (optional)

Create a tournament with `minParticipants: 4`, register only 1 user, set `registrationCloseAt` to a time 1–2 minutes in the future, wait.

- [ ] Tournament sweep (runs every 60s) auto-cancels the tournament after `registrationCloseAt` passes
- [ ] Status moves to **CANCELLED**
- [ ] Registered participant receives a `tournament.cancelled` notification in the Guide drawer

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

- [ ] Open the admin panel for a recurring tournament in `REGISTRATION_OPEN` status
- [ ] Navigate to the **Seed Bots** tab
- [ ] Click **Add Seed Bot**, enter a name (e.g. "Rusty Pete") and set skill level to `Rusty`
- [ ] Add a second bot (e.g. "Magnus Jr.") at skill level `Magnus`
- [ ] Verify both bots appear in the seed bot list with their configured skill levels
- [ ] Verify both bots are listed as participants in the **Participants** tab with `registrationMode: RECURRING` shown
- [ ] Verify each bot has a `TournamentSeedBot` config row: `SELECT * FROM tournament_seed_bots WHERE "tournamentId" = '<id>';`

### 9b. Seed bots propagate to new recurring occurrences

- [ ] Mark the current recurring tournament COMPLETED (or wait for natural completion)
- [ ] Wait for the scheduler to run (up to 1 min) or trigger manually: `checkRecurringOccurrences()`
- [ ] Verify a new occurrence is created with `status: REGISTRATION_OPEN`
- [ ] Verify the new occurrence's participant list includes both seed bots
- [ ] Verify `tournament_seed_bots` rows exist on the **new occurrence** (not just the template)
- [ ] Verify recurring human participants are also carried over (if any)

### 9c. Seed bots participate in BOT_VS_BOT automated play

- [ ] Start a `BOT_VS_BOT` tournament that includes seed bots as participants
- [ ] Trigger tournament start (auto at `startTime` or manual via admin)
- [ ] Verify the bracket is generated and first-round matches are created
- [ ] Open the bot game spectator URL for a seed-bot match
- [ ] Verify the game plays to completion automatically (moves appear with ~1.5s delay)
- [ ] Verify the match result is reported back to the tournament bracket
- [ ] Verify the losing bot is eliminated and the bracket advances correctly

### 9d. Remove a seed bot from a tournament

- [ ] In the admin panel, click **Remove** next to a seed bot
- [ ] Verify the bot disappears from the seed bot list
- [ ] Verify the bot's participant row is set to `WITHDRAWN`
- [ ] Verify that subsequent new occurrences do **not** include the removed bot

### 9e. Seed bot skill levels map correctly

| Admin skill label | Expected `botModelId` suffix | Expected AI difficulty |
|---|---|---|
| Rusty | `novice` | novice (easy) |
| Copper | `intermediate` | intermediate |
| Sterling | `advanced` | advanced |
| Magnus | `master` | master (hardest) |

- [ ] Verify `botModelId` in DB matches `seed:{username}:{skill}` format for each level
- [ ] Verify `parseBotModelId('seed:rusty-pete-abc123:novice')` returns `{ impl: 'minimax', difficulty: 'novice' }`

### 9f. Scheduler unit tests pass

- [ ] Run `npx vitest run src/__tests__/seedBots.test.js` from `packages/tournament/` — all 3 tests pass

---

---

## 11. Phase 3.5 Additions

> **Implementation status:** All items below are code-complete as of 2026-04-19. None have been manually QA tested yet. Automated Playwright coverage noted inline where applicable.

### 11a. Mobile sidebar auto-hide

> Automated: `phase35.spec.js` — "sidebar auto-hides on mobile when game starts" + "sidebar does NOT auto-hide on desktop" (both require `TEST_USER_EMAIL`).

Requires a mobile viewport (≤ 767 px) or browser devtools mobile emulation.

- [ ] Start an HvB game on a mobile viewport → sidebar is hidden automatically when the game transitions to `playing`
- [ ] Toggle button is visible at the top of the board area → tap it → sidebar slides in
- [ ] Tap toggle again → sidebar hides again; board fills the full width
- [ ] On a desktop viewport (≥ 768 px) the sidebar does **not** auto-hide when the game starts

### 11b. Active table preview thumbnail

> Not automated (requires live active table state). Manual test only. The `phase35.spec.js` tables page test confirms the Game column exists but not thumbnail rendering.

**URL:** `http://localhost:5174/tables`

- [ ] A table in **Forming** status shows the game label only (no thumbnail)
- [ ] A table in **Active** status shows a 3×3 mini board thumbnail alongside the game label
- [ ] The thumbnail reflects the current board state (X/O marks visible at the correct cells)
- [ ] Win line cells are highlighted in amber when a game ends before the table completes
- [ ] Thumbnail does **not** appear for Completed tables

### 11c. Multi-game infrastructure — Tournament form

> Automated (partial): `phase35.spec.js` — skills API endpoint and `gameId` filter checks run without auth. Tournament form UI check requires admin auth (set `TEST_ADMIN_EMAIL`).

- [ ] Open the **Create Tournament** form (admin or user)
- [ ] **Game** dropdown is present and populated from `gameRegistry.js` (currently shows XO only)
- [ ] Create a tournament with game = XO → `game` field stored correctly in DB (`SELECT game FROM tournaments WHERE id = '<id>'`)
- [ ] No hardcoded `'xo'` strings remain in the tournament form component

### 11d. Bot creation — Game field

> Automated: `phase35.spec.js` — "bot creation panel has a Game dropdown" (requires `TEST_USER_EMAIL`).

**URL:** `http://localhost:5174/profile` (signed in, non-bot user)

- [ ] Open the **My Bots** section → click **+ Create Bot**
- [ ] **Game** dropdown is present, showing all registered games (currently XO only)
- [ ] Default selection is XO
- [ ] Create a bot with Game = XO → `BotSkill` row created with `game_id = 'xo'`
  - Verify: `SELECT game_id FROM bot_skills WHERE bot_id = (SELECT id FROM users WHERE display_name = '<botname>')`
- [ ] When a second game is added to `gameRegistry.js`, it appears in the dropdown without any other code changes

### 11e. Multi-skill bots — Server-side skill resolution

> Not automated (requires backend log inspection). Manual test only.

These verify that the HvB path resolves skill server-side rather than trusting a client value.

- [ ] Start an HvB game via `?action=vs-community-bot` — game plays normally (skill resolved from `BotSkill` table)
- [ ] Confirm backend log shows no `resolveSkillForGame returned null` warning for community bots (they always have an XO skill)
- [ ] Manually POST `room:create:hvb` with a fake `botSkillId` — server ignores it and resolves the real skill from DB

### 11f. Multi-skill bots — Admin skills column

> Automated: `phase35.spec.js` — "admin bots table has Skills column" + "admin bots API returns skills array per bot" (both require `TEST_ADMIN_EMAIL`).

**URL:** `http://localhost:5174/admin/bots`

- [ ] Bot list table has a **Skills** column (visible at ≥ 1024 px viewport)
- [ ] Each bot row shows a teal `XO` badge for any bot that has an XO skill
- [ ] Bots with no `BotSkill` rows show `none` in the Skills column
- [ ] Hovering a badge shows a tooltip with `gameId: algorithm — status` (e.g., `xo: ml — TRAINED`)

### 11g. Multi-skill bots — Tournament `gameId` propagation

> Not automated (requires Redis event payload inspection). Manual test only.

Requires a `BOT_VS_BOT` tournament. Run after section 8b passes.

- [ ] Start a BOT_VS_BOT tournament → check backend logs for `tournament:bot:match:ready` events — each event payload includes `gameId: 'xo'`
- [ ] After round completion, bracket-advancement path fires a new `tournament:bot:match:ready` event — it also includes `gameId`
- [ ] `recoverPendingBotMatches` on backend restart re-publishes events with `gameId` included (check logs)

---

## Sign-off

| Area | Tested by | Date | Pass/Fail | Notes |
|------|-----------|------|-----------|-------|
| HvB core path | | | | |
| PvP | | | | |
| Tables page | | | | |
| Seat display names | | | | |
| Notifications | | | | |
| Idle handling | | | | |
| Table GC | | | | |
| Tournament | | | | |
| Tournament Seed Bots | | | | |
| Mobile sidebar auto-hide | | | | |
| Active table preview | | | | |
| Multi-game infrastructure | | | | |
| Bot creation game field | | | | |
| Admin skills column | | | | |
| Tournament gameId propagation | | | | |
| Regressions | | | | |
