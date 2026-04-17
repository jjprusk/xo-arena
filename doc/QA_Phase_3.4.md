<!-- Copyright (c) 2026 Joe Pruskowski. All rights reserved. -->
# Phase 3.4 QA Checklist — Retire In-Memory Room Layer

**Version:** v1.3.0-alpha-1.13 (pending)
**Date:** 2026-04-16
**Scope:** Tables are now the single source of truth for all game sessions. The in-memory `roomManager` and `rooms.js` HTTP routes have been deleted. All game state lives in `Table.previewState` (DB-backed JSON blob). Socket event names and payloads are unchanged — frontend code was not modified.

---

## 1. HvB (Human vs Bot) — Core Path

The fastest validation that the new socketHandler is working end-to-end.

**URL:** `http://localhost:5174/play?action=vs-community-bot`

- [ ] Board loads within ~1s (no spinner hang)
- [ ] You are X, bot is O (or vice versa) — marks display correctly
- [ ] Click a cell -> X appears immediately, bot responds with O after brief delay
- [ ] Sound plays exactly once per move (no doubling)
- [ ] Play to a **win** -> win line highlights, scores update, Rematch / Leave Table buttons appear
- [ ] Play to a **draw** -> draw banner shows, Rematch / Leave Table appear
- [ ] Click **Rematch** -> board resets, round increments, opening player alternates, scores carry over
- [ ] Click **Leave Table** -> returns to `/`
- [ ] **Focused mode**: `<- Back` and expand button visible at top of game area
- [ ] **Chrome-present mode** (click expand): sidebar shows game title, status, seated players (You + Bot), Gym/Puzzles links
- [ ] Toggle focused <-> chrome-present preserves board state (X's and O's don't disappear)

---

## 2. PvP (Player vs Player)

Requires two browser contexts (e.g., normal window + incognito).

**Tab A (host):** `http://localhost:5174/play` (signed in)
**Tab B (guest):** incognito window, sign in as a different user

- [ ] Tab A: creates a room, shows "Waiting for opponent to join..." with a share URL
- [ ] Tab B: paste the share URL -> joins as O
- [ ] Both tabs see the board with correct marks
- [ ] Moves alternate correctly between tabs
- [ ] Sound plays on the opponent's move (not your own echo)
- [ ] Game completes -> both tabs see the result (win/loss/draw)
- [ ] Rematch works from either side
- [ ] **Disconnect test**: close Tab B -> Tab A sees "Opponent disconnected" notice -> after ~60s, auto-forfeit fires and Tab A wins
- [ ] **Spectator test** (optional): open a third tab with the share URL as spectator -> sees the board live, no input allowed

---

## 3. Tables Page Integration

**URL:** `http://localhost:5174/tables`

- [ ] Tables list loads (no errors in console)
- [ ] Click **+ Create table** -> modal opens, create an XO table
- [ ] New table appears in list with **Forming** badge
- [ ] Click into the table detail page -> seats show correctly
- [ ] **Join a seat** -> seat updates in real time
- [ ] Second user joins (incognito) -> status changes to **In play** when both seats filled
- [ ] **Cross-tab sync**: seat changes in one tab appear in the other without refresh
- [ ] **Share button** copies `/tables/:id` URL to clipboard
- [ ] **Delete a table** you created (Forming or Completed status)
- [ ] Creator sees their own private tables in the list; other users do not
- [ ] **Watcher count**: creator alone = 0 watching; second browser opens detail page = 1 watching

---

## 4. Seat Display Names

- [ ] When another user joins your table, their **real display name** appears (not `User ba_user_xyz`)
- [ ] Bot seats show **Bot** with a BOT badge
- [ ] Your own seat shows **You**

---

## 5. Notifications

- [ ] When someone joins your table, you get a teal **Table** notification in the Guide drawer (not "Admin")
- [ ] When someone leaves your table, same teal notification
- [ ] Your own join/leave actions do NOT generate a notification for yourself
- [ ] Random users not associated with the table do NOT get notifications
- [ ] `table.created`, `spectator.joined`, `table.empty`, `table.deleted` do NOT appear as notifications

---

## 6. Idle / Stale Room Handling

- [ ] After ~3 minutes of no moves, you get an idle warning
- [ ] If you continue idling past the grace period, the game ends with "Room ended due to inactivity"
- [ ] If you click a cell after the room was idle-kicked, you see an "abandoned" notice and get redirected home (no silent failure / frozen board)

---

## 7. Table GC (Background Service)

These are harder to test manually — verify via admin health or DB queries.

- [ ] FORMING tables with all empty seats older than 30 min are auto-deleted
- [ ] COMPLETED tables older than 24 hr are auto-deleted
- [ ] ACTIVE tables idle past the configured threshold are marked COMPLETED
- [ ] Tournament tables in FORMING state are NOT auto-deleted (they wait for bridge players)
- [ ] Backend logs: `Table GC: deleted N forming, N completed, abandoned N active` (only when something was cleaned up)

---

## 8. Tournament Match (if convenient)

Requires the tournament service running and 2+ registered users/bots.

- [ ] Create a tournament, register 2 participants
- [ ] Start the tournament -> `match:ready` fires -> both players get notification
- [ ] Both players join via `tournament:room:join` -> game starts
- [ ] Play the match to completion -> result recorded
- [ ] Table status changes to COMPLETED after the match
- [ ] Bracket advances correctly
- [ ] ELO is NOT updated for tournament games (tournament ELO is separate)

---

## 9. Things That Should NOT Happen

- [ ] No `Room not found` errors in browser console
- [ ] No `400 Bad Request` polling errors on socket.io
- [ ] No stale socket reconnect cascades
- [ ] No "Admin" badge on seat-change notifications (should be "Table" badge, teal)
- [ ] No references to "room" in user-facing UI (except the waiting-for-opponent share URL which still says `/play?join=...`)
- [ ] No `roomManager` imports anywhere in the codebase (deleted)

---

## 10. Regression Checks

These existed before Phase 3.4 and should still work:

- [ ] Sign in / sign out works
- [ ] Navigation: Tables, Tournaments, Rankings, Profile, About all load
- [ ] Gym page loads at `/gym`
- [ ] Puzzles page loads at `/puzzles`
- [ ] Rankings page shows per-game ELO
- [ ] Bot profile pages load
- [ ] Replay page loads for completed games
- [ ] Admin health dashboard shows table metrics (Forming/Active/Completed/Stale/Watchers)

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
| Regressions | | | | |
