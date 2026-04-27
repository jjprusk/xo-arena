# Table Slug Redesign + Table-Resource Hardening

**Status:** chunk 1 complete (on dev), chunks 2 & 3 pending
**Created:** 2026-04-27
**Chunk 1 landed:** 2026-04-27
**Branch target:** dev → staging → main
**Decision owner:** Joe Pruskowski

## Background

V1 acceptance QA surfaced a "table exhaustion" problem cluster, manifesting differently in Safari vs Chrome:

- "Unhandled socket error" toast on table create — root cause: `Invalid prisma.table.create() invocation: Unique constraint failed on the fields: (slug)` (Prisma P2002), surfaced via `socket.emit('error', ...)` in `backend/src/realtime/socketHandler.js` and logged by `landing/src/lib/useGameSDK.js:515`
- Tables not being released after games end
- Presence not clearing on disconnect
- Seats stuck occupied
- Symptoms behave differently in Safari vs Chrome (strong signal that the disconnect lifecycle is browser-sensitive)

## Why the slug bug exists

The mountain-name pool in `backend/src/realtime/mountainNames.js` is **in-memory** (resets every backend restart). The `Table.slug` column in `packages/db/prisma/schema.prisma:853` is **persistent with a unique index**. After a restart the fresh pool happily hands out `mt-everest` again, but the DB still has a row with that slug from a previous session → P2002.

There is an uncommitted `allocateTableSlug({ create })` helper in `mountainNames.js` that retries on P2002 with versioned suffixes (`mt-everest-2`, `-3`, …). This plan **deletes** that work in favor of a simpler design.

## Decisions (locked)

1. **Option A1** — drop themed table names entirely:
   - Replace mountain pool with `nanoid(8)` for `Table.slug`
   - **Drop `Table.displayName` column** — UI computes a label on read from real facts
   - Delete `mountainNames.js` (~250 lines, including the staged `allocateTableSlug` helper)
   - Remove the in-game "rename room" feature (Mt. → Mt. swap)
2. **Three sequenced chunks**, three PRs, with /stage soak between chunks 1–2
3. **Tests are part of every chunk** — remove obsolete tests, modify mocks, add new coverage for new code (per project convention: "Write tests for new backend endpoints and new service branches before declaring a feature complete")
4. **Per project convention**, work flows dev → staging → main. User invokes `/dev`, `/stage`, `/promote` — Claude does not push or deploy autonomously.

## Why the rest of the symptoms aren't fixed by Option A alone

Option A only fixes the slug-collision class. Seats stuck, presence stuck, and Safari/Chrome divergence are caused by the **disconnect / release** lifecycle on the other end of a table's life. That work lives in chunk 3.

---

# Chunk 1 — Slug + displayName redesign (Option A1)

## Schema changes (`packages/db/prisma/schema.prisma`)

- Drop `displayName String?` from `Table` (line 854)
- Keep `slug String? @unique` (line 853) — only the *content* of the column changes, not its shape
- New migration: `packages/db/prisma/migrations/20260427xxxxxx_drop_table_displayname/migration.sql`
  - `ALTER TABLE "tables" DROP COLUMN "displayName";`
- Run `docker compose run --rm backend npx prisma migrate deploy` after schema change (per project convention)

## Backend changes

### Files to delete
- `backend/src/realtime/mountainNames.js` (entire file, ~250 lines)
- `backend/src/realtime/__tests__/mountainNames.test.js`

### `backend/src/realtime/socketHandler.js` — changes by line
- **~line 491–493**: replace `mountainPool.acquire()` + `MountainNamePool.toSlug(name)` with `nanoid(8)`
- **~line 507**: `db.table.create` — drop `displayName` from `data`, slug becomes nanoid
- **~line 656**: same pattern (HvB room create path)
- **~line 743**: `db.table.create` for HvB — drop `displayName`
- **~line 1376–1392**: tournament PvP match table create — drop `displayName`, slug becomes nanoid
- **~line 1100–1130**: delete `room:rename` handler entirely (the Mt. → Mt. swap feature)
- **~lines 150, 450, 527, 645, 773**: emit payloads that include `displayName: table.displayName` — replace with `label: formatTableLabel(table, viewerId)`
- **~lines 1105, 1127, 1661, 1707, 1912**: drop `replace('Mt. ', '')` "roomName" sites — these become dead code

### New file: `backend/src/lib/tableLabel.js`
```js
// Pure function — no DB access. Pass already-loaded table + viewer id.
export function formatTableLabel(table, viewerId, opts = {}) {
  // HvB → "vs <BotName>"
  // PvP FORMING → "<HostName> · waiting"
  // PvP ACTIVE/COMPLETED → "<HostName> vs <OpponentName>"
  // Tournament → "<TournamentTitle> · Round N"
  // Demo → "Demo · <BotA> vs <BotB>"
  // Fallback (missing names) → "Table <slug.slice(0,6)>"
}
```

Bot/user names come from already-joined data on `Table` (seats with `displayName`) or a passed-in lookup, NOT a fresh DB query inside the helper.

### `backend/package.json`
- Add `nanoid` (verify it isn't already a transitive dep)

## Frontend changes (`landing/src/`)

### Files to add
- `landing/src/lib/tableLabel.js` — mirror of the backend helper, takes the payload shape returned over the socket

### Files to modify
- `landing/src/pages/TableDetailPage.jsx` — replace any read of `table.displayName` / `room.displayName` in headers with `formatTableLabel(...)`
  - Note: `seat.displayName` at line 362 is the *player* name — leave alone
- `landing/src/pages/PlayPage.jsx` — replace any in-game floating "Mt. ..." label
- `landing/src/pages/TablesPage.jsx` — replace table-list rendering of displayName
  - Note: line 600 `b.displayName` is the *bot* name — leave alone
- `landing/src/lib/useGameSDK.js` — accept new `label` field in `room:created` / `room:joined` payloads instead of `displayName`
- Any "Rename room" UI button + handler + i18n strings — delete

### NOT to change
- `ListTable.jsx:9` (user displayName)
- `AdminTournamentsPage.jsx:486` (player displayName)
- `TableDetailPage.jsx:362` (seat displayName)

## Test plan

### Delete
- `backend/src/realtime/__tests__/mountainNames.test.js` — entire file

### Modify (replace `slug: 'mt-everest'`/`displayName: 'Mt. Everest'` mocks with opaque slugs / no displayName)
- `backend/src/routes/__tests__/tablesDemo.test.js:187`
- `backend/src/realtime/__tests__/botGameRunner.test.js`
- `backend/src/routes/__tests__/spar.test.js`
- Any frontend test asserting on the `Mt.` string in headers

### Add
- `backend/src/lib/__tests__/tableLabel.test.js` — one case per branch (HvB, PvP-FORMING, PvP-ACTIVE, tournament, demo, missing-name fallback)
- `landing/src/lib/__tests__/tableLabel.test.js` — same cases on the frontend mirror
- Slug allocator unit test: 1000 generations are unique, length 8, URL-safe charset
- Regression test: a P2002 from `db.table.create` (simulated by throwing) does NOT crash the socket and is surfaced as a structured error

## Migration safety

- Existing rows keep their `mt-everest`-style slugs — they're still unique, URL-resolvable, and `formatTableLabel` ignores them
- Dropping `displayName` is destructive but safe because every consumer is updated in the same PR
- No FK references to `displayName`
- URLs pasted from before the deploy still resolve (the slug column survives)

## Acceptance criteria for chunk 1

- [ ] No reference to "Mt. " in any rendered UI string (run a search of the built bundle)
- [ ] Restart the backend twice in a row and create 100 tables — no P2002s observed
- [ ] All existing backend + frontend test suites green
- [ ] Manual smoke: create PvP table, join, leave, refresh; HvB table, finish a game, leave; tournament match table renders correct label

---

# Chunk 2 — Instrumentation (5 fixes)

All changes scoped to: `backend/src/lib/resourceCounters.js`, `backend/src/services/tableGcService.js`, `backend/src/routes/admin.js`.

## Fix #1 — `table.create` error counter keyed by code

- New counter `_tableCreateErrors = { P2002: 0, P2003: 0, OTHER: 0 }` in `resourceCounters.js`
- Wrap the 3 `db.table.create` sites with try/catch that increments and rethrows (or move them through a single helper that handles the counter)
- Surface in the snapshot
- **Tests**: simulate each error code → counter increments

## Fix #2 — Stale-FORMING alert

- `resourceCounters.js:138-141` — remove the "not yet a leak alert" comment
- Add threshold (e.g. `tablesStaleForming: 10`) to the `_thresholds` map
- Wire into existing `_alerts` map alongside `sockets`/`redisConnections`/`memoryMb`
- **Tests**: snapshot crosses threshold → alert flips true; drops below → flips false

## Fix #3 — Per-mode `tablesActive` breakdown

- `takeTablesSnapshot()` in `resourceCounters.js:145` — replace single ACTIVE count with grouped query keyed on `(isHvb, isTournament, isDemo)`
- New snapshot keys: `tablesActive_pvp`, `tablesActive_hvb`, `tablesActive_tournament`, `tablesActive_demo`
- Keep aggregate `tablesActive` as the sum (back-compat for any consumer)
- **Tests**: seed 1 of each mode → snapshot returns correct breakdown

## Fix #4 — `GET /api/v1/admin/health/tables` endpoint

- New route in `backend/src/routes/admin.js`, mirroring the `/health/sockets` pattern at line 63
- Returns: latest snapshot's table-related fields + alert booleans + GC last-success timestamp + GC failure count
- Admin-gated (same middleware as `/health/sockets`)
- **Tests**: auth required (401 for unauth, 403 for non-admin, 200 for admin); shape assertion on the response

## Fix #5 — GC failure counter + alert

- `tableGcService.js:61` — increment `_gcFailures` counter on caught error
- Track last-success timestamp; alert if `(now - lastSuccess) > 10 min`
- Expose via the new `/health/tables` endpoint
- **Tests**: force `deleteStaleForming` to throw → sweep returns error shape, counter increments, alert fires after configurable threshold

## Acceptance criteria for chunk 2

- [ ] `/health/tables` returns expected shape under load
- [ ] All five counters/alerts have unit-test coverage
- [ ] Synthetic test: seed 11 stale FORMING tables → alert fires; GC sweep clears them → alert clears
- [ ] Synthetic test: throw inside GC sweep → failure counter increments, alert fires after threshold

---

# Chunk 3 — Disconnect / release-path audit

## Investigative pass (produces findings, not a PR yet)

Enumerate every code path that should release a seat or transition a table to COMPLETED:

1. `socket.on('disconnect')` in `backend/src/realtime/socketHandler.js`
2. `room:leave` socket event
3. "Leave Table" button in `landing/src/pages/PlayPage.jsx` (and any equivalent in tournament/spar UIs)
4. `game:end` → `markTableCompleted`
5. Guest-table `deleteIfGuestTable` on disconnect
6. GC sweeps in `tableGcService.js` (already covered by chunk 2 telemetry)
7. Admin force-stop (`DELETE /api/v1/admin/tables/:id` at `admin.js:1427`)

For each path, document: what triggers it, what cleanup it runs, which browser events fire it, and whether Safari `pagehide` + BFCache reaches it.

## Behavioral fixes (driven by findings)

- **Frontend**: ensure `pagehide` (not just `beforeunload` / `unload`) emits a graceful `room:leave` or socket close. Audit `landing/src/lib/socket.js` (already in working tree) and any page-level lifecycle hooks
- **Backend**: any cleanup currently gated on `disconnect` only that should also be reachable via `room:leave`
- **New counter**: `table.released{reason}` where reason ∈ `{ disconnect, leave, game-end, gc-stale, gc-idle, admin, guest-cleanup }`
- **State-transition log**: per-table audit-trail entries for COMPLETED transitions

## Test plan

- One scenario test per release reason — simulate the trigger, assert seat freed + status transitioned + counter incremented
- Specifically: simulated `pagehide` mid-game releases the seat (the Safari path)
- E2E (`e2e/`): backgrounded Safari mid-HvB — assert the table reaches COMPLETED within one GC window

## Acceptance criteria for chunk 3 — closes the V1 acceptance scenario

- [ ] Run V1 acceptance flow (per `doc/V1_Acceptance.md`) in Safari and Chrome side by side
- [ ] In both browsers: seats clear after Leave; presence count decrements on close; no abandoned ACTIVE tables after a 60s GC cycle
- [ ] `table.released{reason}` distribution looks healthy in `/health/tables` (no single reason dominates unexpectedly)

---

# Sequencing & gates

1. Ship **chunk 1** to dev; smoke-test create/join/leave; confirm no `Mt.` strings in the UI; user invokes `/stage`
2. **Soak chunk 1 in staging ~24h** while building chunk 2 (the new dashboards become more useful once the slug bug is gone)
3. Ship **chunk 2** to dev → staging; verify snapshots populate; alerts fire on synthetic load; `/health/tables` returns expected shape
4. Use **chunk 2 metrics to scope chunk 3** — per-mode breakdown will show which release path is leaking before tracing
5. Ship **chunk 3**; close out V1 acceptance in both browsers

# Reference: pre-decision Q&A summary

- **Why are tables a managed DB resource?** Game state must survive disconnects/reconnects; tournaments need persistent match→table linking; `Move` model FK-references games; admin/GC operate on rows. Only `tablePresence` (spectator counts) and `_socketToTable` (reconnect map) are in-memory.
- **Why does the bug surface as a "websocket error"?** The transport is fine; `socketHandler.js` catches the Prisma exception and re-emits it as a socket-level `error` event, which `useGameSDK.js:515` logs.
- **Why opaque slug instead of dropping `slug` entirely?** cuids are 25 chars and ugly in URLs; nanoid keeps URLs short and stable while preserving the unique index as a backstop.
- **Why drop `displayName` entirely (A1) instead of nullable (A2)?** No table type currently benefits from a curated name once the rooms paradigm is dead; computing on read avoids a stored field that can drift.
