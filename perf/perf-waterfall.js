#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — Cold-Page Waterfall Benchmark
 *
 * Companion to doc/Performance_Plan_v2.md, Section F2 (REST response
 * preloading). Sizes the prize for `<link rel="preload" as="fetch">` and
 * "inline initial payload" by capturing, on a cold visit:
 *
 *   - When the route's primary `/api/*` call fires, relative to navStart
 *     (`requestStart`). Big number → preloading saves a lot.
 *   - How long that API call takes, end to end (`responseEnd - requestStart`).
 *     If `requestStart` is small but `responseEnd` is large, preloading
 *     can't help — server work is the bottleneck.
 *   - LCP and load-event-end for context.
 *
 * Per route × device, runs N cold visits and reports p50/p95 of:
 *
 *   apiStart    : requestStart of the primary API call (ms from navStart)
 *   apiTotal    : responseEnd − requestStart (network + server)
 *   apiEnd      : responseEnd of the primary API call (ms from navStart)
 *   lcp         : largest-contentful-paint (ms)
 *   loadEnd     : navigationTiming.loadEventEnd (ms)
 *
 * Headroom interpretation:
 *   - apiStart  → upper bound of what `<link rel="preload">` saves.
 *   - apiTotal  → upper bound of what inlining the payload saves.
 *
 * Usage:
 *   node perf/perf-waterfall.js                         # localhost
 *   node perf/perf-waterfall.js --target=staging
 *   node perf/perf-waterfall.js --target=prod
 *   node perf/perf-waterfall.js --runs=10 --device=desktop
 *
 * Output:
 *   perf/baselines/waterfall-<env>-<isoTimestamp>.json
 */

import { chromium, devices } from 'playwright'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const args      = process.argv.slice(2)
const positional = args.find(a => !a.startsWith('--'))
const TARGET    = (args.find(a => a.startsWith('--target='))?.split('=')[1]) ?? null
const RUNS      = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '5') || 5
const DEVICE_F  = args.find(a => a.startsWith('--device='))?.split('=')[1] ?? null
const HEADED    = args.includes('--headed')

function resolveBase() {
  if (positional)              return positional.replace(/\/$/, '')
  if (TARGET === 'staging')    return 'https://xo-landing-staging.fly.dev'
  if (TARGET === 'prod')       return 'https://xo-landing-prod.fly.dev'
  return 'http://localhost:5174'
}
const BASE_URL = resolveBase()
const ENV_TAG  = TARGET ?? (BASE_URL.includes('staging') ? 'staging'
                : BASE_URL.includes('prod') ? 'prod'
                : 'local')

// F2 candidate routes from Performance_Plan_v2 §F2. Each route has a
// "primary" API substring — the call we'd preload via `<link rel=preload>`.
// /profile is omitted because it requires auth (cold-anon won't fire it).
const ROUTES = [
  { name: 'Home',         path: '/',            primaryApi: '/api/v1/bots' },
  { name: 'Tournaments',  path: '/tournaments', primaryApi: '/api/tournaments' },
  { name: 'Rankings',     path: '/rankings',    primaryApi: '/api/v1/leaderboard' },
]

const DEVICE_PROFILES = [
  { id: 'desktop', label: 'Desktop',
    options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    network: null },
  { id: 'mobile', label: 'Mobile (Moto G4 / 4G)',
    options: { ...devices['Moto G4'] },
    network: { downloadKbps: 4 * 1024, uploadKbps: 3 * 1024, latencyMs: 20 } },
]

const BOLD   = s => `\x1b[1m${s}\x1b[0m`
const DIM    = s => `\x1b[2m${s}\x1b[0m`
const GREEN  = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const RED    = s => `\x1b[31m${s}\x1b[0m`

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s.length % 2 ? s[Math.floor(s.length / 2)] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}
function pctile(arr, p) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)
  return s[idx]
}
function colorMs(ms, goodTarget) {
  if (ms == null) return DIM('—')
  if (ms <= goodTarget)     return GREEN(`${ms}ms`)
  if (ms <= goodTarget * 3) return YELLOW(`${ms}ms`)
  return RED(`${ms}ms`)
}

async function measureWaterfall({ browser, profile, route, base }) {
  const ctx = await browser.newContext({ ...profile.options })
  const page = await ctx.newPage()

  if (profile.network) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline:            false,
      downloadThroughput: profile.network.downloadKbps * 128,
      uploadThroughput:   profile.network.uploadKbps   * 128,
      latency:            profile.network.latencyMs,
    })
  }

  // Inject LCP observer before any script runs.
  await page.addInitScript(() => {
    window.__lcp = null
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        if (entries.length) {
          window.__lcp = Math.round(entries[entries.length - 1].startTime)
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {}
  })

  await page.goto(base + route.path, { waitUntil: 'load', timeout: 30_000 })
  // Settle: give async data calls a chance to land + LCP to stabilize.
  await page.waitForTimeout(1500)

  const data = await page.evaluate((apiPattern) => {
    const nav = performance.getEntriesByType('navigation')[0] ?? {}
    const resources = performance.getEntriesByType('resource').map(r => ({
      name:          r.name,
      startTime:     Math.round(r.startTime),
      requestStart:  Math.round(r.requestStart),
      responseStart: Math.round(r.responseStart),
      responseEnd:   Math.round(r.responseEnd),
      transferSize:  r.transferSize || 0,
    }))
    const allApi   = resources.filter(r => r.name.includes('/api/'))
    const matching = resources.filter(r => r.name.includes(apiPattern))
    return {
      navTiming: {
        fetchStart:               Math.round(nav.fetchStart ?? 0),
        responseStart:            Math.round(nav.responseStart ?? 0),
        responseEnd:              Math.round(nav.responseEnd ?? 0),
        domContentLoadedEventEnd: Math.round(nav.domContentLoadedEventEnd ?? 0),
        loadEventEnd:             Math.round(nav.loadEventEnd ?? 0),
      },
      lcp: window.__lcp ?? null,
      primaryApi: matching[0] ?? null,
      apiCount:   allApi.length,
      apiSummary: allApi.slice(0, 8).map(r => ({
        name:         r.name.replace(/^https?:\/\/[^/]+/, ''),
        requestStart: r.requestStart,
        responseEnd:  r.responseEnd,
      })),
    }
  }, route.primaryApi)

  await ctx.close()
  return data
}

async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')
  console.log()
  console.log(BOLD('XO Arena — Cold-Page Waterfall'))
  console.log(`  Target  : ${BASE_URL}  (${ENV_TAG})`)
  console.log(`  Runs    : ${RUNS} per (route × device)`)
  console.log()

  const devicesToRun = DEVICE_PROFILES.filter(d => !DEVICE_F || d.id === DEVICE_F)
  if (!devicesToRun.length) { console.log(RED('Nothing to run')); process.exit(1) }

  const browser = await chromium.launch({ headless: !HEADED })
  const results = []

  for (const profile of devicesToRun) {
    console.log(BOLD(`▸ Device: ${profile.label}`))
    for (const route of ROUTES) {
      const samples = {
        apiStart: [], apiTotal: [], apiEnd: [],
        lcp:      [], loadEnd:  [],
      }
      let misses = 0
      process.stdout.write(`    ${route.name.padEnd(14)} → ${route.primaryApi.padEnd(26)} `)
      let lastApiSummary = null
      for (let i = 0; i < RUNS; i++) {
        try {
          const r = await measureWaterfall({ browser, profile, route, base: BASE_URL })
          if (r.primaryApi) {
            samples.apiStart.push(r.primaryApi.requestStart)
            samples.apiTotal.push(r.primaryApi.responseEnd - r.primaryApi.requestStart)
            samples.apiEnd  .push(r.primaryApi.responseEnd)
            process.stdout.write('.')
          } else {
            misses++
            process.stdout.write('-')
          }
          if (r.lcp != null) samples.lcp.push(r.lcp)
          if (r.navTiming.loadEventEnd) samples.loadEnd.push(r.navTiming.loadEventEnd)
          lastApiSummary = r.apiSummary
        } catch {
          misses++
          process.stdout.write(RED('!'))
        }
      }
      const stats = {
        apiStart: { p50: median(samples.apiStart), p95: pctile(samples.apiStart, 95), n: samples.apiStart.length },
        apiTotal: { p50: median(samples.apiTotal), p95: pctile(samples.apiTotal, 95), n: samples.apiTotal.length },
        apiEnd:   { p50: median(samples.apiEnd),   p95: pctile(samples.apiEnd,   95), n: samples.apiEnd.length },
        lcp:      { p50: median(samples.lcp),      p95: pctile(samples.lcp,      95), n: samples.lcp.length },
        loadEnd:  { p50: median(samples.loadEnd),  p95: pctile(samples.loadEnd,  95), n: samples.loadEnd.length },
      }
      console.log(
        ` start ${colorMs(stats.apiStart.p50, 100).padEnd(20)}` +
        ` total ${colorMs(stats.apiTotal.p50,  60).padEnd(20)}` +
        ` end ${colorMs(stats.apiEnd.p50,    300).padEnd(20)}` +
        ` lcp ${colorMs(stats.lcp.p50,      1500).padEnd(20)}` +
        DIM(`(n=${stats.apiStart.n}${misses ? `, miss=${misses}` : ''})`)
      )
      results.push({
        route:      route.name,
        path:       route.path,
        primaryApi: route.primaryApi,
        device:     profile.id,
        runs:       RUNS,
        stats,
        raw:        samples,
        apiSummary: lastApiSummary,
      })
    }
    console.log()
  }

  await browser.close()

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `waterfall-${ENV_TAG}-${isoStamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    timestamp: startedAt.toISOString(),
    env:       ENV_TAG,
    baseUrl:   BASE_URL,
    runs:      RUNS,
    results,
  }, null, 2))
  console.log(`  Saved → ${outPath.replace(process.cwd() + '/', '')}\n`)
}

run().catch(err => { console.error(err.stack || err.message); process.exit(1) })
