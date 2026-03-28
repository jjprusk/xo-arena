# XO Arena — Page Load Benchmark

Measures how long each page takes until the last spinner disappears and DB data is visible.

## Setup (once)

```bash
cd perf
npm install
npx playwright install chromium
```

## Running

```bash
# Against local dev server (frontend preview on port 4173)
npm run local

# Against staging
npm run staging

# Against production
npm run prod

# Any custom URL
node perf.js https://your-url.railway.app

# More runs + save JSON baseline
node perf.js https://your-url.railway.app --runs=5 --json

# Debug a page (shows browser window)
node perf.js --headed
```

## What it measures

| Metric  | Definition |
|---------|-----------|
| **Ready** | Navigation start → last `.animate-spin` gone from DOM. This is the full round trip: page load + API calls + React render. **The primary benchmark.** |
| TTFB    | Time to First Byte — server latency |
| FCP     | First Contentful Paint — first text or image visible |
| LCP     | Largest Contentful Paint — main content rendered |
| Static  | Compressed JS/CSS/fonts/images transferred on first visit |

Each run uses a **fresh browser context** (no cache, no cookies) to simulate a new visitor.
Median across N runs is reported.

## Thresholds

- Ready ≤ 1500ms — good
- Ready ≤ 3000ms — acceptable
- Ready > 3000ms — needs work
