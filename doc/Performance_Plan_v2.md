<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# XO Arena — Performance Plan v2

v1 lives at `doc/archive/Performance_Plan.md` and is closed out (17 phases,
Ready ~330ms floor on the small surface set that existed at the time).

This v2 is a fresh pass against the *current* platform: Fly.io hosting, four
services (backend / landing / tournament / packages), SSE+POST realtime,
Tables-as-primitive, Multi-Skill Bots (Phase 3.8), the Intelligent Guide
journey, and a mobile UI. v1's numbers and assumptions are stale; this plan
re-baselines first and prescribes fixes second.

Goal: bear down on real *and* perceived performance across **every** user-
facing surface — desktop and mobile, cold and warm, anonymous and signed-in,
free play and tournament play.

---

## Targets (binding budgets)

Every page on Fly prod, p75 over a 7-day RUM window:

| Metric                 | Desktop  | Mobile (4G mid-range) |
|------------------------|----------|------------------------|
| FCP                    | ≤ 100ms  | ≤ 250ms                |
| Ready (spinner gone)   | ≤ 200ms  | ≤ 500ms                |
| LCP                    | ≤ 200ms  | ≤ 500ms                |
| INP (interaction p75)  | ≤ 100ms  | ≤ 200ms                |
| TTFB (HTML)            | ≤ 60ms   | ≤ 150ms                |

Backend p95 budgets (per endpoint, single-region):

| Endpoint family                          | p95     |
|------------------------------------------|---------|
| `GET /bots`, `/leaderboard`, `/puzzles`  | ≤ 30ms  |
| `GET /tournaments`, `/tournaments/:id`   | ≤ 100ms |
| `GET /users/*` (stats, history)          | ≤ 80ms  |
| `POST /rt/tables` (create)               | ≤ 120ms |
| `POST /rt/tables/:slug/move`             | ≤ 60ms  |
| SSE channel join → first event           | ≤ 80ms  |

Bundle budgets per route:

- Initial parse on `/`: ≤ 120 KB gz JS, ≤ 20 KB CSS
- Largest other route: ≤ +60 KB gz over baseline
- Hero image: ≤ 200 KB on mobile (today: `colosseum-bg.jpg` is **888 KB** — see Phase 3)

If a phase's measured win doesn't move at least one budgeted metric, mark it
*landed but ineffective* and revisit the assumption.

---

## Current baseline (2026-05-02 staging, cold-anon)

Full numbers + caveats: `doc/Performance_Snapshot_2026-05-02.md`. The
single-pass median across 13 routes:

| Metric           | Target (desktop) | Measured | Over by |
|------------------|------------------|----------|---------|
| FCP              | ≤ 100ms          | ~525ms   | 5.3×    |
| LCP              | ≤ 200ms          | ~640ms   | 3.2×    |
| Ready            | ≤ 200ms          | ~760ms   | 3.8×    |

| Metric           | Target (mobile)  | Measured | Over by |
|------------------|------------------|----------|---------|
| FCP              | ≤ 250ms          | ~1360ms  | 5.4×    |
| LCP              | ≤ 500ms          | ~1450ms  | 2.9×    |
| Ready            | ≤ 500ms          | ~1580ms  | 3.2×    |

**Every route is over budget on both devices.** Three load-bearing facts
from the snapshot drive the priorities below:

1. **One bundle, every page.** First-paint JS is ~493 KB gz on every
   route (`vendor-react` 82 KB + `main.supported` 411 KB). The
   `main.supported` chunk is **1,529 KB raw / 411 KB gzip** and contains
   the entire app — no per-route lazy splitting at the page level today.
   FCP / LCP / Ready collapse to within ~100ms of each other on every
   route, the fingerprint of a single bundle blocking the first paint.
2. **PlayVsBot is genuinely 600–700ms slower than the next-worst route**
   on both devices (10-run confirmation). Not noise. The `/play?action=
   vs-community-bot` path runs sequential: `getCommunityBot()` →
   `/api/v1/rt/tables` POST → redirect, all before the spinner clears.
3. **Image bytes were not counted.** `colosseum-bg.jpg` (888 KB) didn't
   appear in the static byte total — likely loads async after Ready
   resolves. Need to confirm before promoting Phase 3.

**The data does not support** chasing DB indexes (Phase 2), SSE latency
(Phase 5), or cross-service hops (Phase 4) yet — the bundle + parse
floor is currently dominating everything else by a ~10× margin. Those
phases stay in the plan but move to Tier 2.

---

## Pre-flight — before running Phase 0

Cold benchmark numbers are only meaningful if the environment is real and the
data is representative. Run this checklist before every measurement pass.

### Environment up

All three Fly apps + the staging DB must be reachable:

```bash
fly status -a xo-backend-staging \
  && fly status -a xo-landing-staging \
  && fly status -a xo-tournament-staging
curl -sf https://xo-backend-staging.fly.dev/api/version && echo OK
curl -sf https://xo-tournament-staging.fly.dev/api/health && echo OK
curl -sfI https://xo-landing-staging.fly.dev/ | head -1
```

### Warm the machines (don't measure cold-start as cold-page)

Fly auto-suspends idle staging machines. The first request after suspend
includes a multi-second machine boot — that's a *cold-start* number, not a
cold-page number, and it'll skew every percentile. Two options:

- **Recommended for a benchmark window:** disable auto-suspend on each app for
  the duration of the run, then re-enable.
  ```bash
  for app in xo-backend-staging xo-landing-staging xo-tournament-staging; do
    fly scale count 1 --max-per-region=1 -a "$app"  # ensure 1 machine running
    # disable auto_stop_machines in fly.toml or use the API; revert after
  done
  ```
- **Or:** discard the first run of each route in the script (the warmup pass
  is built into `perf/perf.js` Phase 0.1 work).

### Test data shape

Heavy pages need representative rows. Staging may be sparse. Before the run,
seed (or confirm) at least:

- One in-progress 32-participant cup (for `TournamentDetailPage` worst-case).
- One user with 5+ bots, at least 2 of which have a trained ML skill (for
  `/profile?section=bots` and `/gym` heavy paths).
- ≥ 50 leaderboard entries with a mix of bots + humans (for `/leaderboard`
  disambiguation render cost).
- ≥ 1 active table (`/tables` list) and 1 spectator-joinable table.

If the data isn't there, document it in the snapshot — *don't pretend the
numbers reflect prod-shape*.

### Auth

`cold-signed-in` and `warm-signed-in` runs need a working test account on
staging:

```bash
# Required env vars (same ones e2e/qa.mjs uses):
echo "$TEST_USER_EMAIL"   # must resolve
echo "$TEST_USER_PASSWORD"

# Smoke the login flow once before the benchmark:
cd e2e && BASE_URL=https://xo-landing-staging.fly.dev npx playwright test smoke --project=chromium
```

### Quiesce other traffic

If anyone else is QAing on staging during the run, the numbers are noise.
Coordinate a window or run after-hours.

### Snapshot the build

Capture the staging git SHA so the snapshot is reproducible:

```bash
curl -s https://xo-backend-staging.fly.dev/api/version  # logs commit + version
```

Record it at the top of `Performance_Snapshot_<date>.md`.

---

## Post-flight — clean up after the run

Every change made for the benchmark must be reverted, or the next person to
hit staging gets a polluted environment (cost from pinned machines, polluted
metrics from seed data, locked test users, etc.). Run this checklist *every*
time, immediately after the snapshot is captured.

### Restore Fly machine policy

If you disabled auto-suspend for the warm pass, put it back:

```bash
for app in xo-backend-staging xo-landing-staging xo-tournament-staging; do
  # Either revert fly.toml + redeploy, or use the API to flip
  # auto_stop_machines back to "stop". Confirm via:
  fly status -a "$app"   # machines should return to suspended on idle
done
```

If you scaled machine count up, scale back down.

### Remove seeded benchmark data

Anything created *for the benchmark* must be deleted. The `um` CLI is the
canonical path so cascades fire correctly (TournamentParticipant rows get
cleaned up before User delete, etc.):

```bash
# Test cup created for TournamentDetailPage worst-case
docker compose exec -T backend node --experimental-transform-types --no-warnings \
  src/cli/um.js tournament:delete <cup-id>

# Bots minted for the heavy /profile + /gym runs
docker compose exec -T backend node --experimental-transform-types --no-warnings \
  src/cli/um.js bot:delete <botId>   # repeat per seeded bot

# Throwaway users (anything tagged isTestUser:true that isn't the persistent
# QA account) — confirm before bulk delete
```

If a Phase 0 helper script seeded the data, it should ship with a paired
`--cleanup` flag so the teardown is one command, not a manual list.

### Reset RUM ingest

Phase 0.2 wires `web-vitals` → `POST /api/v1/rum`. The benchmark's synthetic
runs will dump hundreds of fake samples into `RumSample` and skew the next
day's percentiles. Either:

- Tag every benchmark sample with `source: 'synthetic-baseline'` and exclude
  it from RUM dashboards by default; or
- Delete the rows the run produced:
  ```sql
  DELETE FROM "RumSample"
  WHERE "createdAt" >= '<run-start-ts>'
    AND "createdAt" <= '<run-end-ts>';
  ```

Same logic for backend RED metrics if they're persisted (Prometheus scrapes
are ephemeral, so usually nothing to do there).

### Restore CI / config drift

If you flipped any flag or env var on staging for the run (e.g. enabled extra
logging, raised a cache TTL to test something, turned off a feature gate),
revert before walking away. List them in the snapshot doc so nothing's
forgotten.

### Sanity check

One last pass to confirm staging is back to its normal shape:

```bash
fly status -a xo-backend-staging              # auto_stop policy normal
curl -s https://xo-backend-staging.fly.dev/api/version | grep -i version
docker compose exec -T backend node --experimental-transform-types --no-warnings \
  src/cli/um.js list --filter=isTestUser     # only persistent QA rows remain
```

Smoke the e2e suite once to confirm nothing regressed during cleanup:

```bash
cd e2e && BASE_URL=https://xo-landing-staging.fly.dev npx playwright test smoke --project=chromium
```

If anything fails, the snapshot is suspect — re-run after fixing.

---

## Phase 0 — Re-baseline

v1's `perf/perf.js` ran 6 pages on Railway with 2 services. We now have
~20 routable surfaces on Fly with 4 services and a totally different
realtime stack.

### 0.1 Synthetic baseline (Playwright)  *(done — 2026-05-02)*

Shipped in `perf/perf-v2.js`. First baseline captured against staging on
2026-05-02 — 130 measurements (13 routes × 2 device profiles × 5 runs)
written to `perf/baselines/perf-staging-2026-05-02T*.json`. Analysis in
`doc/Performance_Snapshot_2026-05-02.md`.

- [x] Extend `perf/perf.js` to cover the full route inventory.
- [x] Two device profiles: desktop (1280×800, broadband) + mobile
      (Moto G4 / 4G via CDP throttling).
- [x] Run against `xo-*-staging.fly.dev`. 5 runs each, p50 + p95.
- [x] Capture: TTFB, FCP, LCP, Ready, JS bytes, image bytes, requests.
- [x] Persist results into `perf/baselines/<env>-<ts>.json`.
- [ ] **Open follow-ups** — these are real gaps, *not* blockers for
      Phase 1; tackle when their inputs become available:
  - [ ] Wire `cold-signed-in` and `warm-signed-in` contexts (needs
        `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` in env).
  - [ ] Run against `xo-*-prod.fly.dev` once Phase 3.8 is promoted.
  - [ ] Re-run on staging once it bumps past `1.3.0-alpha-8.0` so
        Sprint 3.8.B + 3.8.C are reflected.
  - [ ] Add INP measurement (one scripted interaction per page —
        open modal / click row / submit form).
  - [ ] Disable Fly auto-suspend on staging for the run, seed the
        four representative-data fixtures from the Pre-flight section.

### 0.2 RUM (real-user monitoring)  *(not started — Tier 1)*

- [ ] Wire `web-vitals` into the landing app — POST `{ metric, value, route, deviceClass }`
      to a new `POST /api/v1/rum` endpoint with sampling (10% in prod, 100% in staging).
- [ ] Server stores into `RumSample` table (route, metric, value, percentile bucket,
      timestamp, country/region). Add Prisma model + migration.
- [ ] Admin dashboard panel: per-route p50/p75/p95 over 24h / 7d. (Reuse the
      existing admin metrics scaffold.)
- [ ] Define alert: any route's p75 Ready > 1.5× target for 30min → Slack.

### 0.3 Backend RED metrics (Rate / Errors / Duration)  *(not started — Tier 2)*

- [ ] Add request-duration histogram middleware in `backend/src/index.js` and
      `tournament/src/index.js`. Bucket per route + status.
- [ ] Expose `/metrics` (Prometheus text format) — Fly already supports scraping.
- [ ] Backfill the Observability dashboard (`doc/Observability_Plan.md`) with
      p95 panels per endpoint family.
- [ ] Confirm SSE channel join + dispatch latency are instrumented (the
      realtime postmortem mentions per-channel timing — verify it lights up
      Grafana).

**Deliverable:** a single `Performance_Snapshot_<date>.md` checked in next to
this plan, showing where every route currently sits vs the targets above.
*Every subsequent phase compares against this baseline.*

---

## Section A — Real performance

Phases that move the actual latency floor (server time, network, parse,
render). Ordered by expected impact-to-effort.

### Phase 1 — Bundle audit + per-route splitting  *(Tier 0 — start here)*

The 2026-05-02 visualizer pass (run `VISUALIZE=1 npx vite build` in
`landing/`) showed `main.supported-*.js` at **1,529 KB raw / 411 KB gz**
holding the entire app. Only `vendor-react`, `game-xo`, `game-pong`, and
the Gym sub-tabs are split out — every page component is in `main`. Per-
route splitting is the highest-leverage fix in the entire plan; until
this lands, every other phase is a rounding error.

Concrete sub-steps (in order):

- [ ] **Per-route `React.lazy()` for every page in `App.jsx`.** PlayPage,
      GymPage, TournamentDetailPage, TournamentsPage, ProfilePage,
      BotProfilePage, PublicProfilePage, RankingsPage, StatsPage,
      SettingsPage, TablesPage, TableDetailPage, SparPage, PuzzlePage,
      plus all `/admin/*` pages. Wrap each `<Suspense fallback={<Skeleton/>}>`
      so the skeleton already aligns with Phase 8 work.
- [ ] **Vendor-split `@xo-arena/*`** in `manualChunks` —
      `xo`, `nav`, `ai`, `sdk`. They're currently bundled into
      `main.supported`. Promote each to its own chunk.
- [ ] **Audit Better Auth client.** Likely a meaningful chunk
      (auth-client + better-fetch + zod). If the auth flow is only
      relevant after a sign-in trigger, lazy-load the client module.
- [ ] **Audit `recharts`.** Only used in Gym Analytics + Stats.
      Confirm `vendor-charts` chunk separation; if it's leaking into
      `main`, fix the import boundary.
- [ ] **Audit ML engines (`@xo-arena/ai`).** Q-learning / DQN / AlphaZero
      should only load on Gym Train tab — already lazy at the tab level,
      but verify the engines aren't statically imported elsewhere.
- [ ] **Audit images / SVG / icons.** Anything imported as a JS module
      should be inspected; large inline SVGs should move to `<img>` or
      a sprite sheet (currently inline JSX SVGs ship inside the JS chunk).
- [ ] **Tactical library swaps.** Each of these has a measured-bytes
      payoff; do them as separate PRs so each can be validated:
  - `recharts` → `uplot` (~20× smaller, only used in Gym Analytics + Stats).
  - Audit `dayjs` boundary; nothing should pull `moment`, `luxon`, etc.
  - Subset `lodash` imports (`lodash-es/get`, not `lodash`); remove `lodash` if any path still uses it.
  - Audit `zod` boundary — only use on validators that actually run client-side.
- [ ] **Tree-shake hygiene.** Mark `sideEffects: false` on every
      internal `@xo-arena/*` package so unused exports drop. Audit
      duplicate deps (`npm ls react`, `npm ls zustand`).
- [ ] **Brotli at the edge.** Confirm Fly is serving Brotli, not just
      gzip — usually 15–20% smaller wire bytes for free.
- [ ] **Aggressive minifier.** Compare `esbuild` vs `swc` vs `terser`
      passes on `main.supported`. Cumulative ~5–10% gain typical.
- [ ] *(Optional / longshot)* Preact compat alias — saves ~50 KB gz over
      React 18, but Better Auth + react-router compat needs verification.
      Land last, behind a feature flag.
- [ ] Generate updated visualizer report; commit at
      `perf/baselines/bundle-<date>.html` for diffing.
- [ ] Re-run `perf-v2.js` against staging — confirm `main` < 200 KB gz,
      per-route chunks 30–80 KB gz, and FCP / Ready drop on every page.
- [ ] **CI bundle-size guard.** Fail PR if any chunk grows > 5% over
      `main` without a `perf-ok` label. (`size-limit` or hand-rolled.)

**Expected outcome (data-driven hypothesis):**
- `main` chunk: 411 KB gz → ≤ 200 KB gz
- First-paint JS: 493 KB gz → ~280 KB gz on Home, lower per-route
- Mobile FCP: 1360ms → ~700ms (parse cost cut roughly proportional to
  byte cut on Moto G4 CPU)
- Desktop Ready: 760ms → ~400ms

If the second perf-v2 run does *not* show these moves, Phase 1 is
*landed but ineffective* and we go back to the visualizer to find what
else is stuck in `main`.

### Phase 1b — PlayVsBot deep-dive  *(Tier 0, immediate after Phase 1)*

The 10-run confirmation showed `/play?action=vs-community-bot` is
600–700ms slower than the next-worst route on both devices, *every
time*. The path is sequential and visible to a returning user every
time they click "Play vs Bot" cold:

```
mount → getCommunityBot() fetch → /api/v1/rt/tables POST → redirect → render
```

- [ ] Trace each step server-side and client-side; identify the longest
      synchronous wait.
- [ ] Render an interim board *shell* (skeleton board + "Finding bot…")
      *before* `getCommunityBot()` returns — the spinner detection then
      flips when the bot is ready, not 600ms later.
- [ ] Move `getCommunityBot()` cache warming into the route entry —
      hover-prefetch `/play` from the home CTA, fire the bot fetch then.
- [ ] Verify `/api/v1/rt/tables` POST is the actual path (not socket).
      Make sure the server returns the table id immediately and SSE
      backfill picks up state, instead of a single big response.
- [ ] Re-measure with the same `--routes=PlayVsBot --runs=10` invocation.
      Target: parity with `/play` (≤ 750ms desktop, ≤ 1600ms mobile).

### Phase 2 — Database query audit + indexing pass

The schema has grown a lot since v1. Audit slow queries across hot endpoints,
especially the new ones:

- [ ] Enable Postgres `pg_stat_statements`; collect 24h of staging traffic.
- [ ] Top 20 by total time + top 20 by mean time — review each.
- [ ] Critical paths to check: tournament list (`/api/tournaments`), tournament
      detail with rounds + participants + matches eager-loaded, leaderboard,
      bot list with skills, ML session list, table presence lookups.
- [ ] Add missing indexes (most likely: `TournamentMatch (tournamentId, roundId)`,
      `TournamentParticipant (tournamentId, status)`, `BotSkill (botId, gameId)` —
      verify the partial unique still covers reads).
- [ ] Convert any lingering N+1s to `findMany` + grouped indexing
      (`groupBy`/`include`).
- [ ] **Materialized view for the leaderboard.** The current SQL
      aggregates win counts on every request. Refresh the view on
      game-end (already a single hot path). Read becomes O(rows
      returned), write cost moves out of the request thread.
- [ ] **Read replica for hot reads** (Fly Postgres supports it).
      Public read endpoints (`/leaderboard`, `/bots`, `/tournaments`)
      go to the replica; writes + auth stay on primary. Cuts write-
      lock contention on busy windows.
- [ ] **Stream large responses.** `GET /api/tournaments/:id` currently
      returns the full eager tree as one payload. With Express
      `res.write()` chunks (or NDJSON), the client can paint the
      header → bracket → participant table → match history in stages
      instead of waiting on the longest one.
- [ ] **Worker queue for off-request work.** ML training kicks, ELO
      calibration, journey event publishing — every one of these blocks
      the request that triggered it today. Push to BullMQ-style queue
      (Redis-backed); the request returns immediately.
- [ ] **Pre-warm critical caches on boot, not first request.** Built-in
      bot roster, puzzles, system config — load on `app.listen` callback
      so the first user doesn't pay the miss.
- [ ] **Compress payload responses.** Confirm gzip/Brotli on JSON
      responses, not just static assets — cuts wire bytes 60–80% for
      tournament/leaderboard JSON.

### Phase 3 — Hero image + asset diet  *(Tier 1 — confirm impact first)*

The 2026-05-02 baseline showed **0 KB image bytes** on every route — the
`colosseum-bg.jpg` (888 KB) didn't appear in the static byte total. It
likely loads async after Ready resolves, or via a CSS background not
caught by the resource-type filter. Before sinking time into AVIF
encoding, confirm where and when the image actually lands.

- [ ] **Investigate first.** Open DevTools → Network on `/` cold, filter
      by Img. Confirm whether `colosseum-bg.jpg` loads at all on cold-
      anon, when it loads relative to FCP / Ready, and on which routes.
- [ ] If it loads after Ready: low-priority — it doesn't move the
      measured budget. Still worth shipping AVIF + responsive sizes for
      mobile data costs, but demote out of Tier 1.
- [ ] If it blocks LCP on `/`: keep in Tier 1 — convert to AVIF + WebP +
      JPEG fallback via `<picture>`; cap mobile delivery at ≤ 1280 wide;
      preload.
- [ ] Audit other public images (`landing/public/`); drop anything
      unused.
- [ ] Add `loading="lazy"` and explicit `width`/`height` on every `<img>`
      to stop layout shift (CLS).
- [ ] Confirm font strategy: `font-display: swap` and self-hosted (no
      blocking Google fonts).
- [ ] **Subset fonts** to the glyphs actually used. A full Latin Inter
      subset is ~25 KB; full font is ~120 KB.
- [ ] **SVG sprite sheet** for icons. Inline JSX `<svg>` ships inside
      the JS chunk — moving icons to an external sprite (`<use href />`)
      lets them stream + cache separately and shrinks `main.supported`.
- [ ] **Skip the hero on mobile entirely.** A CSS gradient or solid
      colour as fallback; serve the real image only at ≥ 1024 viewport.
      Cuts ~200 KB off mobile data on `/`.

### Phase 4 — Cross-service network shape

The landing server proxies `/api/(classification|recurring|tournaments)/*` to
the tournament service. Each proxied call adds a hop.

- [ ] Measure: cross-service p50/p95 vs same-service.
- [ ] If the gap is meaningful, consider:
  - Direct browser → tournament service via a `tournament.<env>.fly.dev`
    subdomain + CORS (saves the proxy hop).
  - Or, push read-mostly endpoints (recurring list) into the backend with
    Redis-backed sharing.
- [ ] Audit `Connection: keep-alive` between landing↔backend, landing↔tournament
      — don't pay TLS handshake on every request.
- [ ] Confirm **HTTP/3 (QUIC)** is enabled on all Fly fronts. Cuts
      handshake latency on flaky mobile connections (vs HTTP/2's
      head-of-line blocking).
- [ ] **Same-origin auth cookie path.** Better Auth sometimes triggers a
      CORS preflight `OPTIONS` for `/api/auth/get-session`. If the
      cookie domain is set tight, this is `Access-Control-Max-Age` away
      from a noticeable savings (or eliminate the preflight entirely).
- [ ] **Audit cookie size.** Better Auth tokens can balloon (esp. with
      provider claims). Every request carries them — keep < 4 KB.
- [ ] **Combine cold-start API calls into `/api/v1/init`.** A returning
      signed-in user fires session check + bots + tournaments + journey
      progress in parallel; one combined endpoint lets the server fan
      out + return one payload, cutting N waterfalls to 1.

### Phase 5 — SSE channel + POST round-trip latency

The realtime layer was rewritten between v1 and v2 (see
`doc/Realtime_Migration_Postmortem.md`). It needs its own performance lens:

- [ ] Measure: `EventSource` open → first event latency; channel join → server
      ack; client POST move → server ack → SSE state event arrival.
- [ ] Look for redundant subscriptions in `useEventStream` (one channel per
      tab vs one shared singleton — the postmortem mentioned a singleton fix;
      verify it's still in place).
- [ ] Move idle/heartbeat traffic to a long-poll or coalesce into one channel
      to keep open connections low (Fly per-instance HTTP limits).
- [ ] Backpressure: under load, what happens when one slow consumer holds an
      SSE write? Add a watchdog.

### Phase 6 — Backend cold start / warm path

Fly machines suspend on idle. First-request latency after suspend can
dominate Ready for low-traffic regions.

- [ ] Measure cold-start time per service (backend, tournament, landing).
- [ ] Decide per service: `auto_stop_machines = false` for hot services
      (backend), keep for cold (admin?). Document the cost trade-off.
- [ ] Pre-warm critical caches (built-in bots, puzzles) on boot, not on first
      request.
- [ ] Move synchronous init out of the request path
      (Prisma engine load, journey config load).

### Phase 7 — Mobile-specific

Mobile is now first-class but never benchmarked. The 2026-05-02 snapshot
showed Mobile FCP at ~1360ms — that's the parse cost on a Moto G4 CPU.
After Phase 1 cuts the bundle, the remaining mobile gap will come from
critical-path render and CSS.

- [ ] Identify any desktop-only assumption: large tables, hover-only UI,
      keyboard shortcuts, missed touch targets.
- [ ] Audit DOM size on the heaviest mobile pages (TournamentDetailPage,
      GymPage with tabs).
- [ ] Lighthouse mobile score ≥ 90 per route as a hard CI gate.
- [ ] **Critical CSS inlined into `<head>`.** Most CSS is render-blocking
      today (`<link>` tag → server round-trip on bad networks). Extract
      the above-the-fold subset and inline it; defer the rest. Likely
      saves 50–150ms on Moto G4 / 4G FCP.
- [ ] **`touch-action: manipulation`** on tappable areas. Eliminates
      any residual 300ms tap delay; cheap one-liner.
- [ ] **Transform-only animations.** Audit any animation that uses
      `top`/`left`/`width`/`height` — replace with `transform` so it
      runs on the compositor thread, not main.
- [ ] **`content-visibility: auto`** on long off-screen sections (the
      tournament participant table when collapsed, the leaderboard rows
      below the fold, the Gym session list). Free skip-render for
      non-visible content; one CSS line per container.
- [ ] **Reduce DOM nodes** on mobile-heavy pages. TournamentDetailPage's
      1900 lines render hundreds of nodes — split via Suspense and only
      mount visible sections.
- [ ] Service Worker for offline-first shell (covered in Phase 21 below).

---

## Section B — Perceived performance

These don't move the latency floor but make the platform *feel* faster.
v1 covered skeletons, hover prefetch, optimistic moves, optimistic writes
— all good and shipped. v2 extends to the new surfaces.

### Phase 8 — Skeletons everywhere new

Every page added since v1 should have a content-shaped skeleton, not a
spinner.

- [ ] `TournamentsPage` — list of tournament cards skeletons.
- [ ] `TournamentDetailPage` — header + bracket + participant table skeletons.
- [ ] `BotProfilePage` — bot header + skill cards + ELO chart.
- [ ] `Profile` — accordion frames render with skeletons inside.
- [ ] `Spar` / `Tables` — table card skeletons.
- [ ] Audit: any place where a `<Spinner />` is the first thing rendered after
      route change is a skeleton candidate.

### Phase 9 — Optimistic / streaming everywhere

- [ ] Tournament register: optimistic "Registered ✓" pill before the server
      ack (with rollback on NO_SKILL etc.).
- [ ] Bot create: bot card appears immediately with a faded "saving…" badge.
- [ ] Skill add: pill appears in `setBots` optimistic merge (already done in
      Profile — verify Gym uses the same path).
- [ ] Move events: already optimistic for player; verify bot moves animate
      smoothly when the SSE event arrives.
- [ ] Streaming responses for large GETs (tournament detail with 100+
      matches) — render the bracket as JSON streams in.
- [ ] **Partial-UI loading states.** Replace `Loading…` with progress
      narration: "Found bot, building table…" / "Bracket ready, fetching
      participants…". Same wait time, lower perceived latency.
- [ ] **Animation cover during fetch.** A 200ms fade/slide on route
      change can hide a 200ms fetch entirely — the wait reads as polish.

### Phase 10 — Hover-intent prefetch + "warm next" patterns

v1 added hover prefetch on nav links. Extend:

- [ ] On `/tournaments`, hover-prefetch each tournament's detail JSON.
- [ ] On `/profile?section=bots`, hover-prefetch `/gym?bot=:id` chunks for
      each row.
- [ ] On match end (post-cup), prefetch the next likely route (next match,
      coaching card).
- [ ] On `/play`, after first move, prefetch the rematch flow's chunks.
- [ ] **Pre-render the next likely route** in a hidden iframe / shadow
      DOM during idle time on slow paths (post-cup celebrations, match
      results). Click feels instant.

### Phase 11 — Route transition polish

- [ ] Re-evaluate the v1 fade transition under React 18 Suspense — does it
      conflict with streaming UI?
- [ ] Add `view-transitions` API where supported (Chrome) for snap-zero
      route transitions on the same-document navigations.

### Phase 12 — In-game feel

- [ ] Confirm sound latency is still nailed (the capture-phase pointerdown
      listener in `soundStore.js` — per CLAUDE.md, must not be removed).
- [ ] Animation budgets: every move, popup, modal — none > 200ms.
- [ ] Reduce-motion respect on every animation.

---

## Section C — Newly heavy surfaces (deserve their own pass)

### Phase 13 — Tournament page perf

`TournamentDetailPage` is the heaviest page in the app (1900+ lines, eager
loads rounds + participants + matches + their users). It runs before / during /
after the cup journey and shows under load on Cup days.

- [ ] Hard target: cold mobile Ready ≤ 600ms even with 32 participants and
      a full bracket.
- [ ] Split the page: bracket + participant table + match history are
      independent, render each behind its own Suspense boundary.
- [ ] Server: paginate completed matches; only the current round needs full
      detail.
- [ ] Memoize bracket layout math; profile re-renders when SSE events fire.
- [ ] Confirm `ParticipantTable` disambiguation (just shipped in 3.8.C) doesn't
      do per-render allocation.
- [ ] **`useDeferredValue`** on the bracket + participant lists when SSE
      pushes a new event. Render the new state at lower priority than
      user input (React 18).
- [ ] **Memoize `BracketMatch`** — currently re-renders on every SSE
      event for the whole bracket, even matches that didn't change.
- [ ] **`content-visibility: auto`** on rounds the user has scrolled
      past or off-screen.

### Phase 14 — Gym page perf + ML compute

The Gym detail panel re-mounts whole tab trees on bot/skill switch, and
ML inference today runs on the main thread (jank during play).

- [ ] Ensure keep-alive (`display: none`) survives the new bot→skill drilldown.
- [ ] ML model fetch should stream — show training history first, then current
      model weights.
- [ ] **Web Worker for ML inference.** Offload `getMoveForModel` for ML
      bots to a worker so the main thread never janks during a move.
- [ ] **WASM minimax / AlphaZero.** Could move bot move latency from
      ~30ms to <5ms. Compile the minimax engine to WASM behind a flag;
      benchmark vs JS. Bigger payoff once Connect4 lands (state space
      grows).
- [ ] **OffscreenCanvas for game render** (where applicable). Frees
      main thread for UI during high-FPS games like Pong.
- [ ] **`requestIdleCallback`** for journey events, telemetry, and
      RUM flushes — never compete with user input.

### Phase 15 — Intelligent Guide journey

The journey adds bus events, popups, scrim spotlights, and re-renders on
every step trigger. Measure — it's a likely INP regressor.

- [ ] INP audit on each step trigger; confirm < 100ms.
- [ ] Memoize `JourneyCard` re-renders.
- [ ] Lazy-load step-specific components (TrainGuidedModal, BotCreatedPopup).
- [ ] Confirm guide store mutations don't cascade through the whole tree
      (split selectors).

### Phase 16 — Tables-as-primitive overhead

Tables underlie spar, journey demos, PvB, PvP, and tournament HvB. Verify the
common path is hot:

- [ ] `tablePresence` lookups: O(1) per join? Memory footprint at 1000 active
      tables?
- [ ] `botGameRunner`: parallel runs OK at 50 concurrent demo tables?
- [ ] `createTableTracked` resource counter overhead — single Redis call or
      multi-hop?

---

## Section C2 — Compute, cache, and architecture (added from brainstorm)

These are bigger swings than the per-phase tactics above. Each one is a
"could be a project" rather than a checklist item, but they're listed
here so the option is visible when the data points to them.

### Phase 19 — Compute relocation

Today, all heavy compute runs on the user's main thread:

- ML training (Q-learning, DQN, AlphaZero) — browser-only.
- ML inference (`getMoveForModel`) — main thread.
- Game logic (minimax, AlphaZero MCTS) — main thread JS.
- Journey events, ELO calibration — request thread on backend.

Targets after this phase:

- [ ] **Web Worker for ML inference.** Offload to a worker; main thread
      never janks during a move. Pairs with Phase 14.
- [ ] **WASM for minimax / AlphaZero.** Compile the engines to WASM
      behind a feature flag; benchmark vs the JS engines. Expected
      10–100× faster move computation. Critical for Connect4 (tied to
      `doc/Connect4_Ship_Checklist.md` Spike A on TF.js).
- [ ] **OffscreenCanvas for game render.** When games like Pong land,
      keep the render loop off the main thread.
- [ ] **Move ML training to a backend worker.** Tracked in
      `doc/Connect4_Ship_Checklist.md` Spike B — perf is one input;
      architectural decision is broader (mobile training, headless
      cluster runs, training on devices that can't keep a tab open).
- [ ] **`requestIdleCallback`** for journey events, telemetry, RUM
      flushes — never compete with user input on the main thread.

### Phase 20 — Cache & app shell

Today: warm visits read from `localStorage` for some stores, but the
HTML / JS / CSS still hits the network every time.

- [ ] **Service Worker app shell.** Cache the index HTML + the vendor
      chunks; serve from cache on second visit; revalidate in background.
      Repeat-visit Ready ≈ 0ms. Highest-leverage perceived-perf change
      not yet in v2.
- [ ] **IndexedDB for tournament/leaderboard JSON.** Faster than
      localStorage at size; survives reload. Stale-while-revalidate
      directly off IDB.
- [ ] **Edge response cache** on Fly for public reads (`/leaderboard`,
      `/bots`, `/tournaments`). Backend never sees cached requests.
- [ ] **HTTP `immutable` cache headers** on hashed asset URLs
      (`max-age=31536000, immutable`). Confirm Fly is doing this.
- [ ] **Persist Zustand stores** so warm boot has full state — guide
      progress, sound prefs, ui sort orders, etc.

### Phase 21 — Architecture experiments (longshots)

Each is a meaningful re-architecture; pursue only if Tier 0 + Tier 1
data shows the gap they'd close. Listed for completeness.

- [ ] **Server-side render the landing page (`/`) only.** It's mostly
      static. React 19 RSC or a tiny SSR shell could deliver Ready ≈
      TTFB. Other routes stay SPA.
- [ ] **Edge functions for `/leaderboard` / `/bots`.** Fly Functions
      could serve these from cache without touching the Node process,
      cutting cold-start exposure entirely.
- [ ] **Replace JSON-over-HTTP with gRPC-Web** for hot endpoints —
      smaller payloads, schema validation, generated clients.
- [ ] **Migrate hot read endpoints off Express to Hono on the edge** —
      lower per-request overhead than full Express middleware stack.
- [ ] **React Server Components for static-ish pages** — Settings,
      Puzzles, parts of Profile. Cut their JS to ~0 KB.

---

## Section D — Instrumentation as a first-class deliverable

Performance work without instrumentation is fishing in the dark. v1 measured
synthetically once and stopped. v2 makes measurement continuous.

### Phase 17 — Per-PR perf gates

- [ ] CI runs `perf/perf.js` against a preview env on every PR; comments the
      diff vs `main`.
- [ ] Bundle-size guard fails PR if any chunk grows > 5% without an
      explicit `perf-ok` label.
- [ ] Backend test suite asserts p95 < budget for the 5 hottest endpoints
      (run against an in-memory load generator).

### Phase 18 — Production perf dashboard

- [ ] Public-internal Grafana page: per-route Ready p75/p95 (RUM), per-endpoint
      backend p95, SSE channel health, error budgets.
- [ ] Weekly "perf review" cadence — owner reviews against budgets, files
      issues for any breach > 7 days.

---

## Out of scope (and why)

| Option                         | Reason skipped                                                                |
|--------------------------------|-------------------------------------------------------------------------------|
| **SSR / Next.js**              | Major rewrite. Current SPA already hits FCP ~130ms; SSR's wins (LCP) are addressable cheaper via Phase 3 (image) + Phase 1 (bundle). Revisit only if mobile LCP > 700ms after Phases 1+3. |
| **CDN / Cloudflare in front of Fly** | Discussed in v1 — still ruled out for cost / ops; Fly's anycast already gets us most of the way. Revisit when international traffic is non-trivial. |
| **Redis / external cache**     | Same call as v1 — in-process cache + per-service warmth is enough. SSE pubsub already uses Redis. |
| **Drizzle / Prisma rewrite**   | Same call as v1 — query rewrite cost > expected gain. Phase 5 (driver) already in. |
| **Move ML training to backend** | Tracked separately in `doc/Connect4_Ship_Checklist.md` Spike B — perf is one input but architectural decision is broader. |
| **Tensorflow.js conversion**   | Same — `doc/Connect4_Ship_Checklist.md` Spike A. |

---

## Sequencing  *(updated 2026-05-02 from snapshot data)*

The original sequencing was a guess; the snapshot data lets us tier the
phases by expected impact. **Tier 0 must land before Tier 1 even gets a
benchmark slot** — otherwise the bundle floor masks any other win.

### Tier 0 — bundle floor (run today)

Single-bundle blocking is so dominant in the data that no other phase
will register a measurable win until this is fixed.

1. **Phase 1** — Bundle audit + per-route splitting. Concrete sub-steps
   come from the visualizer; expected to drop `main` from 411 KB gz to
   ≤ 200 KB gz and Mobile FCP from 1360ms to ~700ms.
2. **Phase 1b** — PlayVsBot deep-dive (independent path bug — different
   root cause than bundle, but same blast radius for that one user
   journey).
3. **Phase 17** — CI bundle-size guard. Fail PR on > 5% chunk growth.
   Lock in Tier 0's gains before any new feature work bloats them back.

### Tier 1 — confirm budget after Tier 0, then attack what the data still shows

After Tier 0, **re-run `perf-v2.js`** and re-measure. The remaining gap
between the new numbers and the budgets table determines what comes
next. Likely candidates, not committed:

4. **Phase 0.2** — RUM wiring. Until prod numbers exist, we're guessing
   from synthetic. Code-only work, ships independently of Tier 0.
5. **Phase 8** — Skeletons everywhere new (TournamentDetailPage,
   TournamentsPage, BotProfilePage, ProfilePage). Pairs with Phase 1's
   `<Suspense>` boundaries — the skeleton *is* the fallback.
6. **Phase 3** — Hero image. *Investigate first* (the snapshot showed
   0 KB image bytes, suggesting the image loads after Ready). Promote
   only if DevTools confirms it blocks LCP.
7. **Phase 13** — Tournament page. The heaviest single surface; Phase 1
   should already lazy-load it, but the page itself still has a 1900-line
   render path that needs Suspense splitting + memo / pagination.
8. **Phase 7** — Mobile-specific. Mobile FCP is ~3× desktop today —
   parse cost on Moto G4 CPU. If Phase 1 doesn't bring it to budget,
   critical-CSS extraction + transform-only animations are the next levers.

### Quick wins — high leverage, can run alongside any tier

These don't need to wait for Tier 0 and don't conflict with later work.
Order by gut-feel impact, ranked from the brainstorm:

- **Service Worker app shell** (Phase 20). Repeat-visit Ready ≈ 0ms.
  Highest-leverage perceived-perf change in the plan.
- **Critical CSS inlined into `<head>`** (Phase 7). Cheap mobile FCP
  win the platform never had.
- **Materialized view for the leaderboard** (Phase 2). Kills a hot DB
  path forever; simple Postgres feature.
- **WASM minimax / AlphaZero** (Phase 19). Bot move latency from ~30ms
  to <5ms. Becomes load-bearing once Connect4 lands.
- **`content-visibility: auto`** on long off-screen sections (Phase 7,
  Phase 13). One CSS line per container; free render skip.
- **Brotli at the edge** (Phase 1). 15–20% smaller wire bytes for free.
- **Pre-warm caches on boot** (Phase 2). Built-in bots, puzzles, system
  config. The first user stops paying the miss.

### Tier 2 — promote *only* when data shows them as a bottleneck

These were Tier 1 in the original draft but the snapshot doesn't
support attacking them yet. Promote to Tier 1 only when re-measurement
shows them on the critical path.

- **Phase 2** — DB index pass. Backend p95 wasn't measured yet (Phase
  0.3 work). Until RED metrics show DB time > target, this is
  speculative.
- **Phase 4** — Cross-service network shape. Same — needs measurement
  before it earns a slot.
- **Phase 5** — SSE channel + POST round-trip. Same — needs measurement,
  and the user journeys most affected (PvP move latency) aren't on the
  cold-page benchmark at all.
- **Phase 6** — Backend cold start. Needs cold-start measurement to
  know whether `auto_stop_machines = false` is worth the cost.

### Tier 3 — perceived-perf polish, after the floor moves

These look like wins on a fast platform but reading "Refreshing…" on a
2-second cold page just adds noise. Land after Tier 0 + Tier 1.

- Phase 9 (optimistic / streaming everywhere)
- Phase 10 (hover prefetch on tournament cards / bot rows)
- Phase 11 (route transition polish — view-transitions API)
- Phase 12 (in-game animation budgets)
- Phase 14 (Gym worker-thread inference + WASM)
- Phase 15 (Guide INP audit)
- Phase 16 (Tables-as-primitive overhead)
- Phase 18 (production perf dashboard) — wait for RUM data first.

### Tier 4 — architecture experiments (Phase 21)

These are re-architectures, not phases. Pursue only if Tier 0 + Tier 1
+ Tier 2 + Tier 3 data still shows the gap they would close.

- SSR / RSC for `/`
- Edge functions for hot reads
- gRPC-Web on hot endpoints
- Hono on the edge for read paths
- Preact compat alias (longshot from Phase 1)

### Re-measure cadence

- After Tier 0 lands → run `perf-v2.js --target=staging --warmup`
  and append a new `Performance_Snapshot_<date>.md`.
- After each Tier 1 phase → same.
- Tier 2 phases require Phase 0.3 RED metrics to be in place first.

Let the data drive every promotion. If a phase lands and the next
snapshot doesn't show movement, the phase is *landed but ineffective*
and the assumption gets revisited.
