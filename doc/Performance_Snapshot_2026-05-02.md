<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Performance Snapshot — 2026-05-02 (staging)

Phase 0.1 baseline against `xo-*-staging.fly.dev`.
Companion to `doc/Performance_Plan_v2.md`.

## Run metadata

- **Date:** 2026-05-02
- **Target:** `https://xo-landing-staging.fly.dev`
- **Backend version on staging:** `1.3.0-alpha-8.0`
  *(predates Phase 3.8.B + 3.8.C — those are on `dev` only)*
- **Tool:** `perf/perf-v2.js --target=staging --warmup --runs=5`
- **Measurements:** 13 routes × 2 device profiles × 1 context × 5 runs = 130
- **Raw JSON:** `perf/baselines/perf-staging-2026-05-02T21-05-08-415Z.json`

## Caveats — read before drawing conclusions

1. **Cold-anon only.** `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` were not in
   the run env, so `cold-signed-in` and `warm-signed-in` contexts (the more
   informative ones for returning users) are missing.
2. **Test data is sparse.** No 32-bot cup, no multi-skill bot, leaderboard
   has whatever staging happens to hold. The heavy pages (`Tournaments`,
   `Gym`, `ProfileBots`) did **not** hit their worst case — those numbers
   are best-case-ish, not p95-realistic.
3. **One warmup pass only.** Did not disable Fly auto-suspend; some residual
   cold-start latency may be in the first run of each page (median should
   smooth most of it out, but the p95 column has a few obvious outliers).
4. **Staging build is two sprints behind dev.** 3.8.B (Gym sidebar
   drilldown, Profile→Gym nav, training auto-repoint) and 3.8.C (server-
   authoritative skill resolution, identity-scoped pickers) are not in
   these numbers.
5. **Desktop = 1280×800, no throttling.** **Mobile = Moto G4 emulation +
   4Mbps/3Mbps/20ms RTT** via CDP.

## Headline result

**Every route is over budget on both desktop and mobile.** The dominant cost
is the same on every route: **487 KB of JS on first visit**. FCP and LCP are
within ~100ms of each other on every page on every device, which is the
fingerprint of a single big bundle blocking the first paint.

| Metric           | Target (desktop) | Measured (median) | Over by |
|------------------|------------------|-------------------|---------|
| FCP              | ≤ 100ms          | ~525ms            | 5.3×    |
| LCP              | ≤ 200ms          | ~640ms            | 3.2×    |
| Ready            | ≤ 200ms          | ~760ms            | 3.8×    |

| Metric           | Target (mobile)  | Measured (median) | Over by |
|------------------|------------------|-------------------|---------|
| FCP              | ≤ 250ms          | ~1360ms           | 5.4×    |
| LCP              | ≤ 500ms          | ~1450ms           | 2.9×    |
| Ready            | ≤ 500ms          | ~1580ms           | 3.2×    |

## Per-route — Desktop (cold-anon)

| Route        | Ready p50 | Ready p95 | FCP    | LCP    | JS    | Reqs |
|--------------|-----------|-----------|--------|--------|-------|------|
| Home         | 745       | 775       | 516    | 608    | 487KB | 11   |
| Play         | 764       | 787       | 524    | 596    | 487KB | 11   |
| PlayVsBot    | **1340**  | 1452      | 528    | 528    | 487KB | 14   |
| Leaderboard  | 761       | 874       | 536    | 672    | 487KB | 11   |
| Puzzles      | 642       | 657       | 508    | 600    | 487KB | 9    |
| Tournaments  | 646       | 756       | 528    | 528    | 487KB | 9    |
| Tables       | 756       | 780       | 528    | 708    | 487KB | 12   |
| Spar         | 756       | 815       | 516    | 612    | 487KB | 11   |
| Stats        | 769       | 793       | 536    | 700    | 487KB | 10   |
| Profile      | 757       | 772       | 528    | 700    | 487KB | 10   |
| ProfileBots  | 740       | 770       | 528    | 680    | 487KB | 10   |
| Gym          | 763       | 787       | 528    | 528    | 487KB | 10   |
| Settings     | 767       | 833       | 540    | 684    | 487KB | 10   |

## Per-route — Mobile (cold-anon, Moto G4 / 4G)

| Route        | Ready p50 | Ready p95 | FCP    | LCP    | JS    | Reqs |
|--------------|-----------|-----------|--------|--------|-------|------|
| Home         | 1580      | 2030      | 1384   | 1388   | 487KB | 9    |
| Play         | 1574      | 2041      | 1360   | 1372   | 487KB | 9    |
| PlayVsBot    | **2116**  | 2146      | 1356   | 1356   | 487KB | 13   |
| Leaderboard  | 1585      | 2052      | 1368   | 1368   | 487KB | 9    |
| Puzzles      | 2031      | 2070      | 1356   | 1448   | 487KB | 9    |
| Tournaments  | 2016      | 2035      | 1368   | 1368   | 487KB | 10   |
| Tables       | 1658      | 2052      | 1376   | 1544   | 487KB | 11   |
| Spar         | 1571      | 1578      | 1360   | 1360   | 487KB | 9    |
| Stats        | 1549      | 2041      | 1352   | 1528   | 487KB | 8    |
| Profile      | 1564      | 2066      | 1360   | 1544   | 487KB | 8    |
| ProfileBots  | 1547      | 2025      | 1360   | 1524   | 487KB | 8    |
| Gym          | 1558      | 1580      | 1360   | 1360   | 487KB | 8    |
| Settings     | 1552      | 2010      | 1352   | 1508   | 487KB | 8    |

## Patterns worth flagging

1. **One big bundle.** 487 KB on *every* route, including `Settings` (a tiny
   page that should be 30 KB). Per-route lazy splitting from v1's Phase 12
   covered Gym tabs but didn't push higher up the route tree. Phase 1 of v2
   should land first — biggest expected win.
2. **`PlayVsBot` is the slowest on both devices** (~1340ms desktop, ~2116ms
   mobile) — by 600ms over the next-slowest. The action handler does an
   extra `getCommunityBot()` fetch + a `/rt/tables` POST + a redirect
   before Ready resolves. Worth a targeted look (Phase 13-ish).
3. **`Puzzles` and `Tournaments` are the *fastest* on desktop** (~640ms)
   but among the *slowest* on mobile (~2030ms) — same JS load, but they
   apparently render less above-the-fold so FCP fires earlier on desktop
   and Ready follows it tightly. Mobile has CPU/parse dominating, so the
   savings disappear. Mobile parse cost is the real ceiling.
4. **No image bytes counted.** `colosseum-bg.jpg` (888 KB, flagged in v2
   Phase 3) didn't show up in the static byte total — likely loaded async
   after Ready resolved, or via CSS background not seen by the resource
   filter. Need to confirm; if it's loading lazily, mobile LCP will get
   worse on slower networks where it lands during the interaction window.

## Recommended next moves (data-driven, in order)

These come from the snapshot, not the plan:

1. **Phase 1 — Bundle audit.** Generate the rollup-visualizer report. The
   "487 KB on every route" tells us we're not splitting per-route at the
   top level. Likely candidates: a top-level `import` in `App.jsx`, eagerly
   loaded auth/SDK modules, or non-lazy game packages.
2. **Phase 3 — Hero image.** Confirm the 888 KB `colosseum-bg.jpg` actually
   loads and when. AVIF + responsive sizes; could shave another ~200ms off
   mobile LCP if it's currently late-binding.
3. **PlayVsBot deep-dive.** Why is the cold-anon path 600ms slower than
   the rest? Probably `getCommunityBot()` cold-cache + route redirect
   before render — needs trace. Consider rendering an interim board
   shell *before* the bot resolves.
4. **Mobile FCP audit.** Mobile FCP is 1360ms on every page — that's our
   real floor on mobile. Bundle parse + main-thread work. Tackle with
   Phase 1 (smaller initial JS) and Phase 7 (mobile-specific).

## What's still missing for a real baseline

To turn this from "first look" into "trustworthy baseline":

- [ ] Re-run with `TEST_USER_EMAIL` set so the signed-in contexts have data.
- [ ] Disable Fly auto-suspend on the three staging apps for the run window
      (and re-enable after — see Post-flight in `Performance_Plan_v2.md`).
- [ ] Seed staging with the four heavy fixtures (32-bot cup, multi-skill
      user, full leaderboard, active tables) — page numbers for
      `TournamentDetailPage` / `Gym` / `ProfileBots` will move.
- [ ] Re-run after staging is bumped past `1.3.0-alpha-8.0` so 3.8.B + 3.8.C
      are reflected.
- [ ] Add an INP measurement for one scripted interaction per page (open
      modal / click row / submit form) — the v2 plan calls for it; the
      script doesn't have it yet.
- [ ] Wire RUM (Phase 0.2) so we get prod numbers, not just synthetic.

Numbers above are good enough to start Phase 1 and pick the next phase
from data. They're **not** good enough to claim a binding baseline yet.
