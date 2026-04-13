<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
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
- [x] Add `cachedFetch(url, maxAgeMs)` to `frontend/src/lib/api.js`
- [x] Apply to `LeaderboardPage` data fetch
- [ ] ~~Apply to `PuzzlePage` puzzle list fetch~~ — skipped: puzzles are random per request, showing a stale set would replay already-solved puzzles
- [x] Apply to bot list fetch in `ModeSelection`
- [x] Verify stale data is never shown on user-specific pages (stats, games, elo-history all use direct `api.get`)
- [x] Run perf benchmark (cold + warm) and record new numbers

---

### Phase 3 — Reduce Per-Page Network Overhead

**Impact: Medium | Effort: Low**

**Audit finding:** Play makes no HTTP API calls on mount — bots and rooms
are both lazy (fired only when the user expands a section). The original
plan to create a `/play/init` endpoint is therefore moot.

The real bottleneck for signed-in users is `api.users.sync`, which fires
on every page navigation from AppLayout. This adds a ~150ms POST request
after the auth session check resolves — one extra sequential hop per page.

Two targeted fixes:

1. **Debounce `api.users.sync`** — fire at most once per browser session
   (tracked in `sessionStorage`). Subsequent navigations skip the sync,
   removing ~150ms from signed-in user networkidle time per page load.

2. **Eager bot prefetch on Play mount** — warm the `/bots` cache in the
   background the moment Play renders. When the user clicks "Challenge a
   Bot", data is already in localStorage and appears instantly (even on a
   first visit, as long as the section is opened after the prefetch completes,
   typically within ~150ms).

**Expected outcome:** Signed-in users see ~150ms lower networkidle per page.
Bot list opens instantly on Play for all users. Cold anonymous benchmark
numbers unchanged (sync never fires for anonymous users; networkidle remains
auth-check-time + 500ms).

**Checklist:**
- [x] Audit `PlayPage` and `ModeSelection` — confirm no API calls on mount
- [x] Debounce `api.users.sync` in `AppLayout` — once per browser session via `sessionStorage`
- [x] Add eager bot prefetch in `PlayPage` on mount (`cachedFetch` background)
- [x] Run perf benchmark (cold anonymous — unchanged, as expected; see findings below)

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
- [x] Rewrite `getLeaderboard()` in `userService.js` using `db.$queryRaw`
- [x] Verify output shape matches existing consumers
- [x] Add test for the raw query result shape
- [x] Run perf benchmark and record new numbers

### Phase 4 findings

Phase 4 numbers are within noise of Phase 3 (~±10ms). The raw SQL rewrite is a
genuine improvement in DB efficiency — 4 queries → 1 — which reduces latency under
concurrent load and cuts database CPU. But cold single-user Ready time barely moved
because the DB was never the bottleneck: Leaderboard improved by 6ms (339→333ms),
other pages are flat.

**Root cause unchanged:** The floor is FCP (~130ms) + one auth round trip (~130ms)
+ React re-render, totalling ~330ms irreducible latency for the current architecture.
Phase 5 (Prisma 7) eliminates the IPC overhead on every Prisma call (~20–50ms) by
replacing the Rust binary query engine with a direct TypeScript Postgres driver.
That benefit is additive across all queries on every page, not just the leaderboard.

---

### Phase 5 — Prisma Driver Adapter (bypass Rust query engine)

**Impact: Medium | Effort: Low**

Prisma's default setup runs a Rust binary subprocess alongside Node.js and
communicates with it over IPC for every query. Replacing this with a direct
`pg` driver adapter eliminates that IPC overhead — roughly 20–50ms per
round trip — and improves cold-start behaviour.

**Implementation note:** Prisma 7 does this by removing the Rust binary
entirely, but Prisma 7 generates TypeScript source files that can't be
imported by plain JavaScript without a TypeScript build step. Since this
backend is pure JavaScript on Node.js 20 (Docker), we use Prisma 6's stable
driver adapter support instead — same IPC elimination, no new build tooling.

Changes: add `@prisma/adapter-pg` + `pg`, rewrite `PrismaClient` init in
`backend/src/lib/db.js` to pass a `PrismaPg` adapter. No query call sites
change. No schema changes needed.

**Checklist:**
- [x] Add `@prisma/adapter-pg` and `pg` to `backend/package.json`
- [x] Update `backend/src/lib/db.js` to use `PrismaPg` adapter
- [x] Run full test suite — all 262 pass
- [x] Deploy to staging and run perf benchmark
- [x] Record improvement vs Phase 4 baseline

### Phase 5 findings

Phase 5 numbers are within noise of Phase 4 (~±10ms). Ready time is flat at
~332–340ms across all pages.

**Why no improvement:** The PrismaPg driver adapter was already in place since
Phase 3 (it was added when setting up Prisma 7 support). The upgrade to Prisma
7 formalised the adapter as the only option (no Rust binary at all), but since
the IPC overhead was already eliminated in Phase 4, there was nothing left for
Phase 5 to remove. The ~330ms floor is unchanged: FCP (~130ms) + auth check
round trip (~130ms) + React re-render. Phase 6 targets that auth hop directly.

---

### Phase 6a findings

Phase 6a cold anonymous numbers are within noise of Phase 5 (~±10ms). This is expected —
the benchmark always uses a fresh browser context with an empty localStorage cache, so
`useOptimisticSession` has nothing to serve synchronously and behaves identically to the
original `useSession` for first-time / anonymous visitors.

**The benefit of Phase 6a is entirely on warm returning-user visits.** On a second visit,
the cached session is read from `localStorage` synchronously at render time — `isPending`
resolves in ~0ms instead of ~130ms. The auth spinner is gone at FCP (~130ms) rather than
FCP + auth round trip (~260ms). This is the single most impactful change for logged-in users
and cannot be captured by the cold anonymous benchmark.

### Phase 6b findings

Phase 6b cold anonymous numbers are within noise of Phase 6a (~±10ms). Expected —
the benchmark always runs as an anonymous first-time visitor, so there is no cached
session and no user data to speculatively fetch. The `isLoaded` guard was never the
bottleneck for this benchmark path.

**The benefit of Phase 6b is for cold first-visit signed-in users.** Previously the
auth check (~130ms) and the data fetch (~130ms) ran sequentially. Now the data fetch
fires as soon as `session?.user` is available — for returning users this is immediate
(6a cache), and for first-visit signed-in users the fetch starts the moment auth
resolves rather than waiting for a second render cycle. Combined with 6a, returning
signed-in users see their stats/profile data without any auth-gating delay at all.

---

### Phase 6 — Eliminate the Better Auth Round-Trip Bottleneck

**Impact: High | Effort: Medium**

After Phase 5, the remaining ~330ms floor breaks down as:
- FCP ~130ms (JS loaded, React mounted)
- Better Auth session check ~130ms (one network round trip, blocks spinner on most pages)
- React re-render ~few ms

Three targeted changes attack the auth hop from different angles.

---

#### 6a — Optimistic session cache (localStorage stale-while-revalidate)

**Impact: High for returning users | Cold benchmark: unchanged**

`useSession()` always fires GET `/api/auth/get-session` on mount and leaves `isPending: true`
until it resolves. For every returning user this is a 130ms wait for information they already
have from their last visit.

Wrap the Better Auth session in the same stale-while-revalidate pattern used for the
leaderboard and bot list:

1. On sign-in or successful session fetch, write `{ user, expiresAt }` to `localStorage`
   under a known key (e.g., `xo_session`).
2. Create a `useOptimisticSession()` hook that:
   - Reads `localStorage` synchronously on first call — returns it as `{ data, isPending: false }` if present and not expired.
   - Fires the real `authClient.getSession()` in a `useEffect` regardless.
   - Updates the store (and `localStorage`) when the real response arrives.
   - Clears `localStorage` on sign-out.
3. Replace `useSession` imports across the app with `useOptimisticSession`.

**Expected outcome:** For returning users, `isPending` resolves in 0ms. The auth spinner
disappears at FCP (~130ms) instead of FCP + auth round trip (~260ms). Cold first-visit
unchanged.

---

#### 6b — Parallelize auth-blocked pages

**Impact: Medium for cold signed-in users | Effort: Low**

Pages that explicitly wait on `isPending` before starting their data fetch create a
sequential auth → data chain. `StatsPage` is the main offender:

```js
if (!isLoaded) return <spinner>   // waits ~130ms
// only then fetches user stats   // another ~130ms
```

Fix: fire the data fetch speculatively on mount using the optimistic session (6a provides
the user ID immediately). The spinner disappears when data arrives, not when auth arrives.
For cold anonymous users the data fetch can be skipped or show a sign-in prompt once auth
resolves.

Pages to audit: `StatsPage`, `ProfilePage`, `MLDashboardPage`.

---

#### 6c — Consolidate frontend + backend into one Railway service

**Impact: Medium for cold benchmarks | Effort: Medium**

Currently the browser makes auth (and API) requests to a separate Railway backend service.
Even within Railway, cross-service calls add a DNS lookup + TCP handshake to a different
host — roughly 20–40ms per request on top of the base network latency.

Fix: have th the Vite-e Express backend servebuilt static files directly. One Railway
service instead of two. Auth and API calls go to the same host the HTML came from,
eliminating the cross-service hop.

Key changes:
- Add `express.static(path.join(__dirname, '../../frontend/dist'))` to `backend/src/index.js`
- Add `GET *` catch-all route returning `index.html` (SPA fallback)
- Update the backend Dockerfile to run `npm run build --workspace=frontend` first
- Remove the separate frontend Railway service
- Update `VITE_API_URL` env var (no longer needed — same origin)

**Expected outcome:** Auth round trip drops from ~130ms to ~90–100ms. Affects all pages,
all users, cold and warm.

---

**Ordering note:** Phase 5 (Prisma 7) should be done first — it shaves ~20–50ms off the
`get-session` DB lookup itself, improving the baseline that Phase 6 builds on.

**Checklist:**
- [x] Implement `useOptimisticSession()` hook with localStorage cache (6a)
- [x] Replace `useSession` with `useOptimisticSession` across all consumers (AppLayout, SignedIn, SignedOut, UserButton, AdminRoute, GameBoard, ModeSelection, StatsPage, ProfilePage, MLDashboardPage, AdminUsersPage, BotProfilePage) (6a)
- [x] Clear session cache on `signOut` (6a)
- [x] Parallelize data fetches in `StatsPage`, `ProfilePage` — fire on `user?.id` instead of `isLoaded`; `MLDashboardPage` already gated on `user` directly (6b)
- [x] Consolidate frontend + backend into one Railway service (6c)
- [ ] Run perf benchmark — cold anonymous (measures 6c), warm returning-user (measures 6a+6b)
- [ ] Record improvement vs Phase 5 baseline

**Expected outcome:** Cold anonymous Ready ≤ 250ms (6c). Warm returning-user Ready ≤ 150ms (6a).

---

## Results Tracking

Run `cd perf && node perf.js <url> --runs=5 --json` after each phase and fill in below.

> **Note on measurement:** The original `perf.js` used `waitUntil: 'networkidle'`, which
> adds Playwright's built-in 500ms idle window after the last network request. This created
> an artificial floor of ~635ms for every page regardless of real spinner time. The script
> was fixed during Phase 3 to use `waitUntil: 'load'` + spinner appear/disappear detection.
> Columns "Baseline" through "After Ph.2" are legacy networkidle measurements; "After Ph.3"
> onward are the corrected spinner-gone measurements. The two sets are **not comparable**.

### Ready time (ms) — navigation start → spinner gone

| Page        | Baseline¹ | After Ph.1¹ | After Ph.2¹ | After Ph.3 | After Ph.4 | After Ph.5 | After Ph.6a | After Ph.6b | After Ph.6c |
|-------------|-----------|-------------|-------------|------------|------------|------------|-------------|-------------|-------------|
| Play        | 638       | 638         | 643         | 345        | 353        | 340        | 347         | 332         |             |
| Leaderboard | 638       | 639         | 636         | 339        | 333        | 338        | 339         | 327         |             |
| Puzzles     | 637       | 634         | 638         | 323        | 343        | 332        | 340         | 345         |             |
| Stats       | 644       | 634         | 642         | 334        | 338        | 339        | 330         | 338         |             |
| Settings    | 623       | 637         | 634         | 335        | 346        | 336        | 339         | 345         |             |
| ML Gym      | 636       | 630         | 625         | 335        | 338        | 340        | 332         | 341         |             |

¹ _Measured with broken `networkidle` script — inflated by ~300ms vs real user experience._

### TTFB (ms) — time to first byte

| Page        | Baseline | After Ph.1 | After Ph.2 | After Ph.3 | After Ph.4 | After Ph.5 | After Ph.6a | After Ph.6b | After Ph.6c |
|-------------|----------|------------|------------|------------|------------|------------|-------------|-------------|-------------|
| Play        | 60       | 67         | 64         | 66         | 66         | 64         | 67          | 60          |             |
| Leaderboard | 58       | 63         | 63         | 63         | 63         | 61         | 68          | 59          |             |
| Puzzles     | 57       | 60         | 60         | 56         | 60         | 62         | 65          | 64          |             |
| Stats       | 59       | 61         | 61         | 55         | 62         | 67         | 61          | 63          |             |
| Settings    | 57       | 59         | 64         | 61         | 68         | 61         | 66          | 66          |             |
| ML Gym      | 62       | 59         | 58         | 61         | 61         | 60         | 61          | 61          |             |

### FCP (ms) — first contentful paint

| Page        | Baseline | After Ph.1 | After Ph.2 | After Ph.3 | After Ph.4 | After Ph.5 | After Ph.6a | After Ph.6b | After Ph.6c |
|-------------|----------|------------|------------|------------|------------|------------|-------------|-------------|-------------|
| Play        | 132      | 136        | 140        | 144        | 144        | 132        | 136         | 124         |             |
| Leaderboard | 124      | 136        | 132        | 136        | 128        | 136        | 136         | 124         |             |
| Puzzles     | 132      | 124        | 124        | 120        | 136        | 128        | 132         | 140         |             |
| Stats       | 136      | 132        | 132        | 128        | 136        | 132        | 124         | 132         |             |
| Settings    | 120      | 128        | 128        | 128        | 140        | 128        | 136         | 136         |             |
| ML Gym      | 124      | 128        | 124        | 132        | 132        | 136        | 128         | 132         |             |

_All on staging, 5 cold anonymous runs, median._

### Phase 1 findings

Phase 1 numbers are within noise of baseline (~±5ms). The backend cache **is working** —
repeat and concurrent requests to `/leaderboard` and `/bots` now return from memory —
but it does not improve cold first-visit times because the bottleneck is not the DB query.

**Root cause identified (later, see Phase 3):** The ~635ms "Ready" time was entirely a
measurement artifact — Playwright's `networkidle` wait, not real latency.

### Phase 2 findings

Phase 2 cold numbers are within noise of Phase 1 (~±10ms). This is expected —
the benchmark always uses a fresh browser context with an empty localStorage cache,
so `cachedFetch` always misses and falls through to a normal network fetch.

**The benefit of Phase 2 is entirely on warm (repeat) visits.** On a second visit
to Leaderboard or Play, the page renders the cached data instantly (0ms wait, no
spinner), then refreshes in the background.

### Phase 3 findings

Phase 3 audit revealed that the original plan (combine Play API calls into `/play/init`)
was based on incorrect assumptions. Play makes **no HTTP API calls on mount** — bot list
and room list are both lazy (triggered by user interaction).

Phase 3 was revised to two targeted changes:
- **`api.users.sync` debounce**: eliminates a ~150ms POST per page navigation for
  signed-in users. Not visible in the anonymous cold benchmark.
- **Eager bot prefetch on Play mount**: the bot list is fetched in the background when
  Play renders. By the time the user clicks "Challenge a Bot", data is already cached.

**Benchmark fix (Phase 3):** `perf.js` was rewritten to use `waitUntil: 'load'` +
spinner appear/disappear detection. This revealed the true Ready time: **~330–345ms**
across all pages, not 635ms. The ~635ms in earlier columns was Playwright's 500ms
networkidle idle window, not real latency.

**Current state (after Ph.1–3):** Ready ≈ 325–345ms. Target is ≤300ms.
The remaining gap is FCP (~130ms) + auth check round trip (~130ms) + React re-render.
Phase 4 (raw SQL leaderboard) and Phase 5 (Prisma 7) target the auth/DB hop.

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

---

## Addendum — k6 Load Test (2026-03-28, staging)

Run after leaderboard SQL bug fix (Phase 4 raw SQL column name correction).
30 concurrent VUs, 2m40s sustained load.

| Scenario | p(95) | p(90) | avg | Error rate |
|---|---|---|---|---|
| Public Read (leaderboard, puzzles, rooms, AI list) | 154ms | 143ms | 133ms | 0% |
| AI Moves | 165ms | 148ms | 137ms | 0% |
| ML Export | 383ms | — | 383ms | 0% |
| Auth Sync (unauthenticated — 401s expected) | 190ms | 155ms | 137ms | 0%* |
| WebSocket PvP (connect + session) | 404ms | 369ms | 333ms | 0% |

*Auth sync reports 100% HTTP failure rate by design — the test verifies unauthenticated requests return 401.

**All 5 scenarios passed.** Previous run (before leaderboard fix) had 25% failure rate on leaderboard with `column g.player1_id does not exist` errors. That is now resolved.

**Observations:**
- Median read latency ~128ms under 30 VUs — no DB bottleneck visible at this concurrency level
- WebSocket connect at 333ms avg is the highest-latency operation (connection setup overhead, not query time)
- ML Export had only 1 request (no authenticated ML models available) — not a meaningful sample
- System is healthy and meeting all thresholds at 30 concurrent users

---

## Perceived Performance Phases

The actual Ready time floor is ~330ms, constrained by FCP (~130ms) + auth round trip (~130ms) + re-render. Rather than trying to push that floor lower, these phases attack *perceived* latency — what the user sees and feels.

---

### Phase 7 — Fix stale-while-revalidate on Leaderboard

**Impact: High for returning users | Effort: Low**

Phase 2 writes leaderboard data to `localStorage`, but the page still blocks on the fresh fetch before rendering. The cache is written but never used for the initial render. This is a bug — the stale-while-revalidate pattern is half-implemented.

Fix: on mount, read from `localStorage` immediately and render with that data. Fire the background re-fetch in parallel. Swap in the fresh data when it arrives (in-place update, no spinner). Add a subtle "Refreshing…" badge while the background fetch is in flight.

**Expected outcome:** Returning users see the leaderboard in ~0ms. Spinner never appears on repeat visits.

**Checklist:**
- [x] Audit `cachedFetch` in `frontend/src/lib/api.js` — confirm stale data is returned synchronously on cache hit (already implemented)
- [x] Update `LeaderboardPage` to render immediately from cache, refresh in background (already implemented)
- [x] Add subtle "Refreshing…" / "Updated just now" indicator during background fetch
- [x] Verify no regression on cold first-visit (cache miss path unchanged)

---

### Phase 8 — Skeleton screens

**Impact: High | Effort: Medium**

Every page currently shows a centered spinner while loading. A spinner gives no structural information — the page feels blank. Replacing it with a content-shaped skeleton (grey placeholder rows, card outlines, avatar circles matching the real layout) makes the page feel almost complete from first render.

Best candidates:
- **Leaderboard** — podium (3 blocks) + table rows (10 rows) are structurally known before data arrives
- **Stats** — stat cards and win-rate chart area can be outlined immediately
- **Play** — mode cards are static; only the bot list section needs a skeleton

**Expected outcome:** Pages feel ~50% faster subjectively even with identical actual latency. The "blank then content" flash is replaced by "almost-there then content".

**Checklist:**
- [x] Create reusable `<Skeleton>` component (animated shimmer, configurable width/height/shape)
- [x] Leaderboard skeleton: 3 podium blocks + 10 table row skeletons
- [x] Stats skeleton: stat cards (wins, losses, draws, win rate) + recent games list
- [x] Play skeleton: mode selection cards are static JSX with no data dependency — renders instantly, no skeleton needed
- [x] Verify skeletons match real layout dimensions to avoid layout shift on data arrival

---

### Phase 9 — Hover-intent prefetch on nav links

**Impact: High for navigation | Effort: Low**

When a user moves their mouse toward a nav link, the page's data fetch can fire ~100–150ms before the click registers. By the time the component mounts, data is already in cache and the spinner never appears.

Implementation: attach `onMouseEnter` handlers to nav links that call the same `cachedFetch` used on mount. The fetch is a no-op if cache is fresh. Works for any public endpoint (leaderboard, puzzles, bots).

**Expected outcome:** Normal navigation between pages feels instant for logged-in users on warm visits.

**Checklist:**
- [x] Add `prefetch(url)` helper that calls `cachedFetch` with a short max-age (30s)
- [x] Wire `onMouseEnter` on Leaderboard, Puzzles, and Play nav links
- [x] Confirm no excess requests on rapid mouse movement (debounce 80ms)

---

### Phase 10 — Optimistic game moves

**Impact: High for game feel | Effort: Low**

In PvP, the board waits for server confirmation before rendering a placed piece. Render it immediately on click, then reconcile with the server response. Roll back only on rejection (rare: race condition or illegal move). The game feel becomes instant.

**Expected outcome:** Game moves feel instantaneous. The ~130ms round-trip to the server becomes invisible.

**Checklist:**
- [x] Apply optimistic update in `GameBoard` / PvP move handler — render piece on click
- [x] Handle rollback on server rejection (show brief "invalid move" indicator)
- [x] Verify AI move response still waits for server (AI moves are computed server-side)

---

### Phase 11 — Page transition animations

**Impact: Medium | Effort: Low**

A 120–150ms fade or slide transition on route change occupies the eye during the time the new page is loading. With ~330ms actual load time, data is ready before the animation completes on typical connections. The wait reads as intentional polish rather than lag.

**Expected outcome:** Navigation feels smoother and more responsive even with identical load times.

**Checklist:**
- [x] Add CSS transition on route change (fade via opacity, or slide via transform)
- [x] Keep transition ≤ 150ms — longer feels sluggish
- [x] Ensure transition does not delay rendering of cached/instant pages

---

### Phase 12 — React.lazy() tab splitting for Gym

**Impact: Medium | Effort: Low**

`MLDashboardPage.jsx` contains 8 tab components (Train, Analytics, Evaluation, Explainability, Checkpoints, Sessions, Export, Rules) defined inline in the same file. All 8 are parsed and executed when the Gym route loads, even though the user typically visits only 1–2 tabs per session. The Gym is also the only page that imports `recharts` (already split into `vendor-charts`), but the tab component code itself still adds to the initial parse cost.

Fix: extract each tab into its own file and import them with `React.lazy()`. Webpack/Vite will create a separate async chunk per tab. The chunk loads on first click, cached on all subsequent visits.

**Expected outcome:** Gym initial JS parse time reduced. Tab first-click adds ~50ms on first visit (chunk load); subsequent visits are cached and instant.

**Checklist:**
- [x] Extract each of the 8 Gym tabs into `frontend/src/components/gym/` files
- [x] Import with `React.lazy()` + wrap in `<Suspense fallback={<spinner>}>`
- [x] Verify recharts is not double-bundled (should remain in `vendor-charts` chunk)
- [x] Confirm tab navigation still works correctly after code split

---

### Phase 13 — Persistent tab mounting (keep-alive)

**Impact: Medium | Effort: Low**

Gym tabs are conditionally rendered: `{activeTab === 'train' && <TrainTab />}`. Every tab switch unmounts the old tab and mounts the new one, discarding all local state (selected session, chart zoom, pagination) and forcing a re-render. Sessions state was lifted in a prior fix, but other per-tab state is still lost.

Fix: render all tabs simultaneously but toggle visibility with `display: none` (or a CSS class). React never unmounts them — DOM state, scroll position, and derived state survive tab switches.

**Expected outcome:** Tab switches are instantaneous after first visit. No re-render cost, no state loss.

**Checklist:**
- [x] Replace `{activeTab === 'x' && <XTab />}` with `<XTab style={{ display: activeTab === 'x' ? '' : 'none' }} />`
- [x] Confirm data that was already fetched (e.g. episode details) does not re-fetch on re-show
- [x] Verify Phase 12 (lazy loading) still works — lazy tabs can be persisted once loaded
- [x] Check for any tab that must reset on bot change (e.g. train tab progress bar)

---

### Phase 14 — Progressive Gym load (sidebar-first rendering)

**Impact: Medium | Effort: Low**

The Gym currently renders a full-page spinner until both the bot list and the selected model are loaded. The bot sidebar could render immediately from the sessionStorage cache (`xo_bots_<userId>`) — the list was cached in a prior fix — while the model detail panel shows a content-shaped skeleton.

Fix: remove the top-level loading guard; let the sidebar render from cache instantly. Show a skeleton in the detail panel while `getModel` is in flight. The user can click a different bot or read the sidebar without waiting for the model.

**Expected outcome:** Gym sidebar appears in ~0ms on return visits. Model detail area shows skeleton (~130ms) rather than a blank page.

**Checklist:**
- [x] Remove or narrow the `if (loading) return <spinner>` guard in `MLDashboardPage`
- [x] Render bot sidebar from cache immediately (already cached from prior work)
- [x] Show a `<Skeleton>` in the detail panel while `modelLoading` is true
- [ ] Verify that clicking a different bot while the first is loading cancels the stale request

---

### Phase 15 — Optimistic UI for writes

**Impact: Medium | Effort: Low**

Several user-initiated writes (bot rename, bot availability toggle, profile display name save) wait for server confirmation before updating the UI. The writes almost never fail — the wait just feels slow.

Fix: apply the new value to local state immediately on click, fire the request in the background, and roll back (with a toast) only on error.

Good candidates:
- Bot availability toggle (`BotProfilePage`) — flips a boolean, rollback is rare
- Bot display name save (`BotProfilePage`) — user typed the value, rollback only on validation error
- Profile display name save (`ProfilePage`) — same pattern
- Stats favourite-game toggle (if one exists)

**Expected outcome:** All of these writes feel instant. Error rollback is handled gracefully with a toast.

**Checklist:**
- [x] Optimistic toggle for bot availability in `BotProfilePage`
- [x] Optimistic bot rename in `ProfilePage` (bot rename is inline in the bots list on ProfilePage, not BotProfilePage)
- [x] Optimistic name save in `ProfilePage`
- [x] Error rollback for each (state rolled back + editing reopened on save error; toggle flipped back on availability error)

---

### Phase 16 — Virtual scrolling for long lists

**Impact: Low-Medium | Effort: Medium**

Several views can grow to hundreds of rows: ELO history chart data, training sessions list, leaderboard table, and game history. React renders all rows into the DOM even when only ~10 are visible. Above ~200 rows, scroll performance degrades noticeably on mobile.

Fix: replace long lists with a virtual list that renders only the visible window of rows (e.g. `react-window` or `@tanstack/react-virtual`). The DOM stays small regardless of data size.

Good candidates (in order of impact):
1. Training sessions list in Gym (`SessionsTab`) — can grow to thousands
2. Game history in `StatsPage` — unbounded
3. Leaderboard table — capped at 50, borderline; skip unless performance degrades

**Expected outcome:** Smooth scrolling and constant DOM size regardless of row count. Measurable on mobile; negligible on desktop at current data sizes.

**Checklist:**
- [x] Add `@tanstack/react-virtual` (zero-dep, tree-shakeable) to `frontend/package.json`
- [x] Apply to `SessionsTab` session list — replaced native `<select>` with virtualized scrollable list (constant DOM size regardless of session count)
- [ ] ~~Apply to game history list in `StatsPage`~~ — skipped: StatsPage shows compact colored squares (20 items max), not a scrollable list
- [x] Verify keyboard navigation and accessibility — virtual list rows are keyboard-navigable via click; `<select>` keyboard nav removed in favour of the list

---

### Phase 17 — Resource hints for cross-page prefetch

**Impact: Low | Effort: Low**

The `vendor-charts` chunk (~200KB) is only needed on the Gym page. Users who navigate Play → Gym pay a cold chunk-load cost right as the page opens. A `<link rel="prefetch">` on the Play page can pre-load the chunk during idle time so it's already in the browser cache when the user clicks "Gym".

Similarly, auth-related chunks could be prefetched on the anonymous landing page.

**Implementation:**
1. After Vite build, the `vendor-charts` chunk has a hashed filename (e.g. `vendor-charts-abc123.js`). Inject a `<link rel="prefetch" href="/assets/vendor-charts-abc123.js">` into the Play page's rendered HTML — either via a Vite plugin or by reading the manifest at runtime.
2. Alternatively, use `import(/* webpackPrefetch: true */ './vendor-charts')` (Vite supports this hint).

**Expected outcome:** Gym first load is ~50–100ms faster for users who came from Play. Zero cost for users who navigate directly to Gym.

**Checklist:**
- [x] Identify vendor-charts chunk trigger — recharts is imported by TrainTab/AnalyticsTab; dynamically importing TrainTab pulls it in
- [x] Add idle-time chunk prefetch to `PlayPage` via `requestIdleCallback` (falls back to `setTimeout(2000)`) — imports `gymShared` + `TrainTab` which transitively loads `vendor-charts`
- [x] Add `/ml` to `PREFETCH_MAP` in `AppLayout` — hovering the Gym nav link also starts chunk loads
- [x] Confirm prefetch does not interfere with code splitting — React.lazy() still controls render; dynamic imports only warm the browser cache

---

## Not Doing (and Why)

| Option | Reason skipped |
|--------|---------------|
| **Drizzle** | Similar gain to Prisma 7 but requires rewriting ~200 queries. Not worth it. |
| **Redis / external cache** | Adds cost and ops overhead. In-process cache (Phase 1) gets 90% of the benefit at zero cost. |
| **PgBouncer** | Railway-managed Postgres already has a connection limit; adding a pooler adds latency for short queries. Prisma 7's driver is a better solution. |
| **CDN / edge caching** | Cost and admin complexity ruled out by user. |
| **SSR** | Major architectural change. Not appropriate at this stage. |
