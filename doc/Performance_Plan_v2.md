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

**Until we re-measure, every "improvement" is a guess.** v1's `perf/perf.js`
ran 6 pages on Railway with 2 services. We now have ~20 routable surfaces on
Fly with 4 services and a totally different realtime stack.

### 0.1 Synthetic baseline (Playwright + WebPageTest)

- [ ] Extend `perf/perf.js` to cover the full route inventory:
  - `/`, `/play`, `/play?action=vs-community-bot`, `/leaderboard`, `/puzzles`,
    `/stats`, `/profile`, `/profile?section=bots`, `/gym`, `/tournaments`,
    `/tournaments/:liveCupId`, `/tables`, `/tables/:liveTableId`,
    `/bots/:builtinBotId`, `/spar`, `/settings`.
- [ ] Three contexts per route: `cold-anon`, `cold-signed-in`, `warm-signed-in`.
- [ ] Two device profiles: desktop (1080p, broadband) + mobile (Moto G4 / 4G via
      Playwright's emulation).
- [ ] Run against `xo-*-staging.fly.dev` and `xo-*-prod.fly.dev`. 5 runs each,
      report median + p95.
- [ ] Capture: TTFB, FCP, LCP, Ready, JS bytes (parsed), CSS bytes, image bytes,
      number of requests, longest task, INP for one scripted interaction per
      page (e.g. open a modal).
- [ ] Persist results into `perf/baselines/<date>.json` and check the file in.

### 0.2 RUM (real-user monitoring)

- [ ] Wire `web-vitals` into the landing app — POST `{ metric, value, route, deviceClass }`
      to a new `POST /api/v1/rum` endpoint with sampling (10% in prod, 100% in staging).
- [ ] Server stores into `RumSample` table (route, metric, value, percentile bucket,
      timestamp, country/region). Add Prisma model + migration.
- [ ] Admin dashboard panel: per-route p50/p75/p95 over 24h / 7d. (Reuse the
      existing admin metrics scaffold.)
- [ ] Define alert: any route's p75 Ready > 1.5× target for 30min → Slack.

### 0.3 Backend RED metrics (Rate / Errors / Duration)

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

### Phase 1 — Bundle audit + per-route splitting

Measure first (`vite build --mode production --report` or `rollup-plugin-visualizer`),
then act. v1 split the Gym tabs but a lot has been added since: tournament
brackets, recurring tournaments, journey UI, multi-skill bot UI, ML training
engines.

- [ ] Generate the bundle report; commit `perf/baselines/bundle-<date>.html`.
- [ ] Audit: `recharts` (Gym/Stats only?), the AlphaZero / DQN engines (Gym
      Train tab only?), Better Auth client, Sentry/observability, journey
      components.
- [ ] Move heavy pages to `React.lazy()` if not already (TournamentDetailPage,
      GymPage tabs, AdminUserProfilePage).
- [ ] Verify `vendor-*` chunks are stable (don't churn on minor changes).
- [ ] Add a CI bundle-size guard (`size-limit` or hand-rolled) — fail PR if a
      chunk grows > 5% without a justification label.

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

### Phase 3 — Hero image + asset diet

- [ ] `colosseum-bg.jpg` is 1920×1279, 888 KB JPEG. Convert to AVIF + WebP +
      JPEG fallback via `<picture>`; cap mobile delivery at ≤ 1280 wide.
- [ ] Audit other public images (`landing/public/`); drop anything unused.
- [ ] Add `loading="lazy"` and explicit `width`/`height` on every `<img>` to
      stop layout shift (CLS).
- [ ] Preload only what's needed for LCP (likely the hero image on `/`).
- [ ] Confirm font strategy: `font-display: swap` and self-hosted (no
      blocking Google fonts).

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
- [ ] Confirm HTTP/2 (or HTTP/3) is enabled on all Fly fronts.

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

Mobile is now first-class but never benchmarked.

- [ ] Identify any desktop-only assumption: large tables, hover-only UI,
      keyboard shortcuts, missed touch targets.
- [ ] Audit DOM size on the heaviest mobile pages (TournamentDetailPage,
      GymPage with tabs).
- [ ] Lighthouse mobile score ≥ 90 per route as a hard CI gate.
- [ ] Service Worker for offline-first shell (low-effort win for repeat users
      on bad networks).

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

### Phase 10 — Hover-intent prefetch + "warm next" patterns

v1 added hover prefetch on nav links. Extend:

- [ ] On `/tournaments`, hover-prefetch each tournament's detail JSON.
- [ ] On `/profile?section=bots`, hover-prefetch `/gym?bot=:id` chunks for
      each row.
- [ ] On match end (post-cup), prefetch the next likely route (next match,
      coaching card).
- [ ] On `/play`, after first move, prefetch the rematch flow's chunks.

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

### Phase 14 — Gym page perf

The Gym detail panel re-mounts whole tab trees on bot/skill switch.

- [ ] Ensure keep-alive (`display: none`) survives the new bot→skill drilldown.
- [ ] ML model fetch should stream — show training history first, then current
      model weights.
- [ ] Worker-thread ML inference (offload `getMoveForModel` to a Web Worker for
      ML bots) so the main thread never jank.

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

## Sequencing

Do these in order — each phase's value depends on the prior:

1. **Phase 0** (Re-baseline) — without it, nothing else has a benchmark.
2. **Phase 17** (CI gates) — prevent regressions while we work.
3. **Phase 1** (Bundle) — biggest expected win for cold pages.
4. **Phase 3** (Hero image) — biggest expected win for mobile LCP.
5. **Phase 13** (Tournament page) — heaviest single surface.
6. **Phase 8** (Skeletons new) — perceived win, quick.
7. Everything else, prioritized by what the Phase 0 numbers actually show.

Let the data, not the doc, drive the prioritization after step 5.
