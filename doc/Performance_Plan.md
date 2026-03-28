# XO Arena — Performance Plan

## Baseline (2026-03-28, staging)

Measured with `perf/perf.js` — 5 cold runs per page, median reported.
"Ready" = navigation start → last spinner gone (DB data visible).

| Page        | Ready  | TTFB  | FCP    |
|-------------|--------|-------|--------|
| Play        | 638ms  | 60ms  | 132ms  |
| Leaderboard | 638ms  | 58ms  | 124ms  |
| Puzzles     | 637ms  | 57ms  | 132ms  |
| Stats       | 644ms  | 59ms  | 136ms  |
| Settings    | 623ms  | 57ms  | 120ms  |
| ML Gym      | 636ms  | 62ms  | 124ms  |

**Bottleneck:** FCP is ~120ms (JS loaded, React rendered). Ready is ~625ms.
The spinner is visible for ~500ms — that is almost entirely API round-trip time
(network + backend query + DB + React re-render).

Already done: gzip compression, code splitting, 1-year asset cache,
parallel DB queries (`Promise.all`), Prisma connection pre-warming.

**Target:** Ready ≤ 300ms for all pages.

---

## Work Items

Work items are ordered by impact-to-effort ratio. Do them in order.

---

### Phase 1 — Backend In-Memory Response Cache

**Impact: High | Effort: Low**

Cache the results of public, infrequently-changing endpoints in a simple
in-process `Map` with a TTL. No new dependencies, no infrastructure.
When data is served from cache the API round-trip drops from ~400ms to ~5ms.

Good candidates (data changes at most every few minutes):
- `GET /api/v1/leaderboard` — top-50 list
- `GET /api/v1/bots` — active bot roster
- `GET /api/v1/puzzles` — puzzle set

Not suitable (user-specific or must be fresh):
- `/api/v1/users/:id/stats`
- `/api/v1/users/:id/games`
- Any authenticated write endpoint

**Implementation:**

1. Create `backend/src/utils/cache.js` — a minimal TTL cache utility:
   ```js
   // cache.get(key), cache.set(key, value, ttlMs), cache.invalidate(key)
   ```
2. Wrap the three route handlers to check cache before hitting the DB,
   and populate cache on miss.
3. Invalidate leaderboard and bots cache on any game completion or bot update
   (or just let it expire — 60s staleness is acceptable for these).
4. Add a cache-hit response header (`X-Cache: HIT / MISS`) for debugging.

**Expected outcome:** Leaderboard, Puzzles, Play (bot list) → Ready ≤ 200ms.

**Checklist:**
- [x] Create `backend/src/utils/cache.js` with `get`, `set`, `invalidate`
- [x] Cache `GET /api/v1/leaderboard` (TTL 60s)
- [x] Cache `GET /api/v1/bots` (TTL 60s)
- [ ] ~~Cache `GET /api/v1/puzzles` (TTL 5 min)~~ — puzzles are pure JS computation, no DB call, skipped
- [x] Add `X-Cache` header to cached responses
- [x] Invalidate leaderboard cache after a game is recorded (`POST /api/v1/games`)
- [x] Invalidate bots cache after a bot is created/updated/deleted
- [ ] Run perf benchmark and record new numbers

---

### Phase 2 — Stale-While-Revalidate on the Frontend

**Impact: High | Effort: Medium**

Persist API responses in Zustand stores (to `localStorage`). On the next
visit, show the cached data immediately (zero wait) while silently
refreshing in the background. The page feels instant on repeat visits.

Best pages to target:
- **Leaderboard** — show last-known table immediately, refresh quietly
- **Puzzles** — puzzle set rarely changes, stale data is fine
- **Play** — bot roster, available rooms list

Not suitable for user-specific data (stats, profile) where stale
data could be confusing.

**Implementation:**

1. Add a `cachedFetch` helper to `frontend/src/lib/api.js`:
   - On call: return cached value immediately if present, then re-fetch
     and update cache in the background.
   - Cache keyed by URL, stored in `localStorage` with a timestamp.
   - Max age configurable per call site (e.g. 5 min for leaderboard).
2. Update `LeaderboardPage`, `PuzzlePage`, and the bot-list fetch in
   `ModeSelection` to use `cachedFetch`.
3. Show a subtle "updated just now" indicator when a background refresh
   completes (optional, but good UX).

**Expected outcome:** Repeat visits to Leaderboard, Puzzles → Ready < 50ms.

**Checklist:**
- [ ] Add `cachedFetch(url, options, maxAgeMs)` to `frontend/src/lib/api.js`
- [ ] Apply to `LeaderboardPage` data fetch
- [ ] Apply to `PuzzlePage` puzzle list fetch
- [ ] Apply to bot list fetch in `ModeSelection`
- [ ] Verify stale data is never shown on user-specific pages
- [ ] Run perf benchmark (cold + warm) and record new numbers

---

### Phase 3 — Combine Play Page API Calls

**Impact: Medium | Effort: Medium**

Play is the slowest page (638ms) because it fires multiple API calls on
mount: bot list, available rooms, possibly others. Each call is a separate
round trip. A single `/api/v1/play/init` endpoint returns everything in
one response, cutting one or more round trips.

**Implementation:**

1. Add `GET /api/v1/play/init` to the backend:
   - Returns `{ bots, rooms, puzzleCount }` (or whatever Play needs)
   - Runs all sub-queries in parallel with `Promise.all`
   - Cacheable for 30s (bots and rooms don't change per-second)
2. Replace the individual fetches in `PlayPage` / `ModeSelection` with
   a single call to the new endpoint.

**Expected outcome:** Play page Ready drops from ~638ms to ~400ms or below.

**Checklist:**
- [ ] Audit `PlayPage` and `ModeSelection` to list every API call on mount
- [ ] Create `GET /api/v1/play/init` combining those calls
- [ ] Apply backend cache (from Phase 1) to the new endpoint
- [ ] Update frontend to use the single endpoint
- [ ] Run perf benchmark and record new numbers

---

### Phase 4 — Raw SQL for the Leaderboard Query

**Impact: Low-Medium | Effort: Low**

`getLeaderboard()` currently issues 4 Prisma queries: 3 `groupBy` calls
(winners, player1 counts, player2 counts) plus 1 `findMany` for user
display names. These can be replaced with a single SQL query using a CTE,
cutting 3 of the 4 round trips for this one hot path.

```sql
WITH counts AS (
  SELECT player_id, SUM(games) AS total, SUM(wins) AS wins FROM (
    SELECT player1_id AS player_id, COUNT(*) AS games,
           COUNT(*) FILTER (WHERE winner_id = player1_id) AS wins
    FROM games GROUP BY player1_id
    UNION ALL
    SELECT player2_id, COUNT(*), COUNT(*) FILTER (WHERE winner_id = player2_id)
    FROM games WHERE player2_id IS NOT NULL GROUP BY player2_id
  ) sub GROUP BY player_id
)
SELECT u.id, u.display_name, u.avatar_url, u.is_bot,
       c.total, c.wins,
       ROUND(c.wins::numeric / NULLIF(c.total, 0), 4) AS win_rate
FROM counts c JOIN users u ON u.id = c.player_id
WHERE c.total >= 1
ORDER BY win_rate DESC, c.total DESC
LIMIT 50
```

**Checklist:**
- [ ] Rewrite `getLeaderboard()` in `userService.js` using `db.$queryRaw`
- [ ] Verify output shape matches existing consumers
- [ ] Add test for the raw query result shape
- [ ] Run perf benchmark and record new numbers

---

### Phase 5 — Upgrade to Prisma 7

**Impact: Medium | Effort: Medium**

Prisma 7 replaces the binary Rust query engine (a subprocess that
Node.js communicates with via IPC) with a pure TypeScript Postgres driver
that talks directly to the database over TCP. This eliminates the
IPC overhead on every query — roughly 20–50ms per round trip — and
improves cold-start behaviour.

This benefits all pages, not just specific ones.

See: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7

**Key breaking changes to review:**
- Client initialization API changes
- Some query API differences (check release notes)
- `prisma generate` output location may change

**Checklist:**
- [ ] Read Prisma 7 migration guide
- [ ] Upgrade `prisma` and `@prisma/client` in `backend/package.json`
- [ ] Update `backend/src/lib/db.js` client initialization if needed
- [ ] Run full test suite (`npm run test --workspace=backend`)
- [ ] Deploy to staging and run perf benchmark
- [ ] Record improvement vs Phase 4 baseline

---

## Results Tracking

Run `cd perf && node perf.js <url> --runs=5 --json` after each phase and fill in below.

### Ready time (ms) — navigation start → spinner gone

| Page        | Baseline | After Ph.1 | After Ph.2 | After Ph.3 | After Ph.4 | After Ph.5 |
|-------------|----------|------------|------------|------------|------------|------------|
| Play        | 638      | 638        |            |            |            |            |
| Leaderboard | 638      | 639        |            |            |            |            |
| Puzzles     | 637      | 634        |            |            |            |            |
| Stats       | 644      | 634        |            |            |            |            |
| Settings    | 623      | 637        |            |            |            |            |
| ML Gym      | 636      | 630        |            |            |            |            |

### TTFB (ms) — time to first byte

| Page        | Baseline | After Ph.1 | After Ph.2 | After Ph.3 | After Ph.4 | After Ph.5 |
|-------------|----------|------------|------------|------------|------------|------------|
| Play        | 60       | 67         |            |            |            |            |
| Leaderboard | 58       | 63         |            |            |            |            |
| Puzzles     | 57       | 60         |            |            |            |            |
| Stats       | 59       | 61         |            |            |            |            |
| Settings    | 57       | 59         |            |            |            |            |
| ML Gym      | 62       | 59         |            |            |            |            |

### FCP (ms) — first contentful paint

| Page        | Baseline | After Ph.1 | After Ph.2 | After Ph.3 | After Ph.4 | After Ph.5 |
|-------------|----------|------------|------------|------------|------------|------------|
| Play        | 132      | 136        |            |            |            |            |
| Leaderboard | 124      | 136        |            |            |            |            |
| Puzzles     | 132      | 124        |            |            |            |            |
| Stats       | 136      | 132        |            |            |            |            |
| Settings    | 120      | 128        |            |            |            |            |
| ML Gym      | 124      | 128        |            |            |            |            |

_Baseline measured 2026-03-28, Phase 1 measured 2026-03-28. Both on staging, 5 cold runs, median._

### Phase 1 findings

Phase 1 numbers are within noise of baseline (~±5ms). The backend cache **is working** —
repeat and concurrent requests to `/leaderboard` and `/bots` now return from memory —
but it does not improve cold first-visit times because the bottleneck is not the DB query.

**Root cause identified:** FCP is ~128ms but Ready is ~635ms on every page — including
Settings and Puzzles which have **no DB queries**. The ~500ms gap is common to all pages,
which means something in the shared page-load path is slow, not the page-specific data.

The most likely cause is **sequential API round trips through two Railway hops**
(browser → frontend server → backend server ≈ 100–150ms each):

1. Better Auth session check fires on mount (~150ms round trip)
2. Page-specific data fetch starts only after auth resolves (~150ms)
3. React re-renders content (~few ms)

Two sequential hops at ~150ms each = ~300–350ms of unavoidable wait after FCP.
The remaining ~150ms is React initialization and scheduling.

**Implication for the plan:** Phase 2 (stale-while-revalidate) and Phase 3
(combine Play API calls) directly attack this sequential-call problem and should
produce the biggest cold-visit improvement. Phase 1's value is in reducing DB load
under concurrent traffic, not reducing single-user latency.

---

## How to Measure

After each phase, run the benchmark and record results:

```bash
# Against staging
cd perf && node perf.js https://xo-arena-staging.up.railway.app --runs=5 --json

# Against prod (after promoting)
node perf.js https://xo-arena.up.railway.app --runs=5 --json
```

Fill in the tables above from the output summary.

---

## Not Doing (and Why)

| Option | Reason skipped |
|--------|---------------|
| **Drizzle** | Similar gain to Prisma 7 but requires rewriting ~200 queries. Not worth it. |
| **Redis / external cache** | Adds cost and ops overhead. In-process cache (Phase 1) gets 90% of the benefit at zero cost. |
| **PgBouncer** | Railway-managed Postgres already has a connection limit; adding a pooler adds latency for short queries. Prisma 7's driver is a better solution. |
| **CDN / edge caching** | Cost and admin complexity ruled out by user. |
| **SSR** | Major architectural change. Not appropriate at this stage. |
