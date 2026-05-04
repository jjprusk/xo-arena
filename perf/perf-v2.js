#!/usr/bin/env node
/**
 * XO Arena — Page Load Performance Benchmark v2
 *
 * Companion to doc/Performance_Plan_v2.md, Phase 0.1.
 *
 * What's new vs perf.js (v1):
 *   - Full ~16-route inventory (was 6)
 *   - Multiple device profiles: desktop + Moto G4 mobile
 *   - Multiple contexts: cold-anon today; cold-signed-in / warm-signed-in
 *     when TEST_USER_EMAIL + TEST_USER_PASSWORD are present
 *   - Persists into perf/baselines/<date>.json (timestamped, never overwritten)
 *
 * Usage:
 *   node perf/perf-v2.js                         # localhost
 *   node perf/perf-v2.js --target=staging        # xo-*-staging.fly.dev
 *   node perf/perf-v2.js --target=prod           # xo-*-prod.fly.dev
 *   node perf/perf-v2.js https://example.com     # explicit URL
 *
 * Flags:
 *   --runs=N            Cold runs per (page × device × context). Default 5.
 *   --device=desktop    Only run desktop (default: both).
 *   --device=mobile     Only run mobile.
 *   --context=cold-anon Only that context (default: all available).
 *   --routes=foo,bar    Subset of route names (case-insensitive substring match).
 *   --warmup            Hit each base URL once before benchmarking (avoids
 *                       Fly cold-start contamination — does NOT replace
 *                       disabling auto_stop_machines for a clean run).
 *   --headed            Show browser (debugging).
 *
 * Output:
 *   perf/baselines/perf-<env>-<isoTimestamp>.json
 */

import { chromium, devices } from 'playwright'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2)
const positional = args.find(a => !a.startsWith('--'))
const TARGET    = (args.find(a => a.startsWith('--target='))?.split('=')[1]) ?? null
const RUNS      = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '5') || 5
const DEVICE_F  = args.find(a => a.startsWith('--device='))?.split('=')[1] ?? null
const CONTEXT_F = args.find(a => a.startsWith('--context='))?.split('=')[1] ?? null
const ROUTES_F  = args.find(a => a.startsWith('--routes='))?.split('=')[1]?.toLowerCase().split(',') ?? null
const WARMUP    = args.includes('--warmup')
const HEADED    = args.includes('--headed')
// When set, after Ready resolves we wait an extra `EXT_MS` and re-collect
// `performance.getEntriesByType('resource')`, exposing late-loading bytes
// (e.g. the colosseum hero, async-fetched avatars) that the cold-page
// numbers wouldn't otherwise count. The 2026-05-02 snapshot showed
// img_kb = 0 on every route — this flag is how we find out where the
// 888 KB hero is actually showing up.
const EXTENDED  = args.includes('--extended-resources')
const EXTENDED_MS = parseInt(args.find(a => a.startsWith('--extended-ms='))?.split('=')[1] ?? '5000') || 5000

// Map --target= shortcuts to the canonical landing host.
function resolveBaseUrl() {
  if (positional) return positional.replace(/\/$/, '')
  if (TARGET === 'staging') return 'https://xo-landing-staging.fly.dev'
  if (TARGET === 'prod')    return 'https://xo-landing-prod.fly.dev'
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '')
  return 'http://localhost:5174'
}
const BASE_URL = resolveBaseUrl()

const ENV_TAG = TARGET ?? (BASE_URL.includes('staging') ? 'staging'
                : BASE_URL.includes('prod') ? 'prod'
                : 'local')

// ── Route inventory ───────────────────────────────────────────────────────────
// Every public route gets cold-anon coverage. Routes that gate on auth are
// included on purpose — the spinner-then-empty-state experience IS the
// cold-anon experience for those pages, and that's what users see.
const ROUTES = [
  { name: 'Home',             path: '/' },
  { name: 'Play',             path: '/play' },
  { name: 'PlayVsBot',        path: '/play?action=vs-community-bot' },
  { name: 'Leaderboard',      path: '/leaderboard' },
  { name: 'Puzzles',          path: '/puzzles' },
  { name: 'Tournaments',      path: '/tournaments' },
  { name: 'Tables',           path: '/tables' },
  { name: 'Spar',             path: '/spar' },
  { name: 'Stats',            path: '/stats' },
  { name: 'Profile',          path: '/profile' },
  { name: 'ProfileBots',      path: '/profile?section=bots' },
  { name: 'Gym',              path: '/gym' },
  { name: 'Settings',         path: '/settings' },
]

// ── Device profiles ───────────────────────────────────────────────────────────
const DEVICE_PROFILES = [
  {
    id: 'desktop',
    label: 'Desktop',
    options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    network: null,    // no throttling — broadband baseline
  },
  {
    id: 'mobile',
    label: 'Mobile (Moto G4 / 4G)',
    // Moto G4 is Playwright's stock mid-range Android emulation.
    options: { ...devices['Moto G4'] },
    // 4G profile (~4Mbps down / 3Mbps up / 20ms RTT) applied via CDP.
    network: { downloadKbps: 4 * 1024, uploadKbps: 3 * 1024, latencyMs: 20 },
  },
]

// ── Contexts ──────────────────────────────────────────────────────────────────
const HAVE_AUTH = !!(process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD)
const CONTEXTS = [
  { id: 'cold-anon', label: 'Cold anon', requiresAuth: false, warmCache: false },
  // signed-in contexts — only when creds are present
  { id: 'cold-signed-in',  label: 'Cold signed-in',  requiresAuth: true,  warmCache: false },
  { id: 'warm-signed-in',  label: 'Warm signed-in',  requiresAuth: true,  warmCache: true  },
]

// ── Stats helpers ─────────────────────────────────────────────────────────────
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
function pick(runs, key) { return runs.map(r => r[key]).filter(v => v != null && v > 0) }

// ── Formatting ────────────────────────────────────────────────────────────────
const BOLD   = s => `\x1b[1m${s}\x1b[0m`
const DIM    = s => `\x1b[2m${s}\x1b[0m`
const GREEN  = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const RED    = s => `\x1b[31m${s}\x1b[0m`

function colorReady(ms, deviceId) {
  // Targets per Performance_Plan_v2.md: 200ms desktop / 500ms mobile (p75 RUM).
  // For a single-run console signal: 1.5× target = green, 3× = yellow, more = red.
  const target = deviceId === 'mobile' ? 500 : 200
  if (ms <= target * 1.5) return GREEN(`${ms}ms`)
  if (ms <= target * 3)   return YELLOW(`${ms}ms`)
  return RED(`${ms}ms`)
}
function fms(n) { return n != null ? `${n}ms` : '—' }
function fkb(n) { return n != null ? `${n}KB` : '—' }

// ── Measurement ───────────────────────────────────────────────────────────────
async function measure({ browser, url, profile, contextOpts }) {
  const browserContext = await browser.newContext({
    ...profile.options,
    ...contextOpts,    // storageState etc. for warm/signed-in
  })
  const page = await browserContext.newPage()

  // Network throttling via CDP (chromium only).
  if (profile.network) {
    const cdp = await browserContext.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: profile.network.downloadKbps * 128,    // KB→Bps
      uploadThroughput:   profile.network.uploadKbps   * 128,
      latency:            profile.network.latencyMs,
    })
  }

  // LCP observer + extended-resource flag.
  await page.addInitScript((captureLate) => {
    window.__lcp = 0
    window.__captureLate = !!captureLate
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) window.__lcp = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {}
  }, EXTENDED)

  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForSelector('header', { timeout: 5_000 }).catch(() => {})

  const spinnerAppeared = await page
    .waitForSelector('.animate-spin', { state: 'attached', timeout: 200 })
    .then(() => true)
    .catch(() => false)

  if (spinnerAppeared) {
    await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 10_000 })
      .catch(() => {})
  }

  const readyMs = Date.now() - t0

  if (EXTENDED) {
    // Wait for late-loading resources (hero image, avatars, async chunks
    // that mount after Ready resolves). Pure idle wait — no interaction.
    await page.waitForTimeout(EXTENDED_MS)
  }

  const perf = await page.evaluate(() => {
    const nav   = performance.getEntriesByType('navigation')[0]
    const paint = Object.fromEntries(
      performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)])
    )

    const STATIC = ['.js', '.css', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.ico']
    const resources = performance.getEntriesByType('resource')
    const staticBytes = resources
      .filter(r => STATIC.some(ext => r.name.split('?')[0].toLowerCase().endsWith(ext)))
      .reduce((sum, r) => sum + (r.transferSize || 0), 0)
    const jsBytes = resources
      .filter(r => r.name.split('?')[0].toLowerCase().endsWith('.js'))
      .reduce((sum, r) => sum + (r.transferSize || 0), 0)
    const imgBytes = resources
      .filter(r => ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg'].some(ext => r.name.split('?')[0].toLowerCase().endsWith(ext)))
      .reduce((sum, r) => sum + (r.transferSize || 0), 0)

    // Per-resource detail used when --extended-resources is set, so we
    // can see *which* late-loading images / chunks landed and at what
    // time relative to navigation start.
    const lateLoaded = resources
      .filter(r => r.startTime > 0)
      .map(r => ({
        name: r.name.replace(/^https?:\/\/[^/]+/, ''),
        type: r.initiatorType,
        startMs: Math.round(r.startTime),
        bytes:   r.transferSize || 0,
      }))
      .sort((a, b) => a.startMs - b.startMs)

    return {
      ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      fcp:  paint['first-contentful-paint'] ?? null,
      lcp:  Math.round(window.__lcp) || null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      requests: resources.length,
      staticKb: Math.round(staticBytes / 1024),
      jsKb:     Math.round(jsBytes / 1024),
      imgKb:    Math.round(imgBytes / 1024),
      // Only persisted when --extended-resources is set; otherwise empty.
      lateLoaded: typeof window.__captureLate === 'boolean' && window.__captureLate ? lateLoaded : [],
    }
  })

  await browserContext.close()
  return { readyMs, ...perf }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')
  console.log()
  console.log(BOLD('XO Arena — Page Load Benchmark v2'))
  console.log(`  Target  : ${BASE_URL}  (${ENV_TAG})`)
  console.log(`  Runs    : ${RUNS} per (page × device × context)`)
  console.log(`  Auth    : ${HAVE_AUTH ? 'TEST_USER_EMAIL set — signed-in contexts enabled' : 'no creds — cold-anon only'}`)
  console.log()

  // Filter
  const devicesToRun = DEVICE_PROFILES.filter(d => !DEVICE_F || d.id === DEVICE_F)
  const contextsToRun = CONTEXTS.filter(c =>
    (!CONTEXT_F || c.id === CONTEXT_F) && (!c.requiresAuth || HAVE_AUTH)
  )
  const routesToRun = ROUTES_F
    ? ROUTES.filter(r => ROUTES_F.some(f => r.name.toLowerCase().includes(f) || r.path.toLowerCase().includes(f)))
    : ROUTES

  if (!devicesToRun.length || !contextsToRun.length || !routesToRun.length) {
    console.log(RED('  Nothing to run — check filters'))
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: !HEADED })

  // Optional warmup — single hit per service so Fly cold-start doesn't pollute.
  if (WARMUP) {
    console.log(DIM('  Warming Fly machines (one HEAD each)…'))
    const warmCtx = await browser.newContext()
    const wp = await warmCtx.newPage()
    for (const path of ['/', '/api/version', '/api/v1/leaderboard']) {
      try { await wp.goto(BASE_URL + path, { waitUntil: 'load', timeout: 60_000 }) } catch {}
    }
    await warmCtx.close()
    console.log()
  }

  const results = []   // { route, device, context, runs[], median, p95 }

  for (const profile of devicesToRun) {
    console.log(BOLD(`▸ Device: ${profile.label}`))
    console.log()

    for (const ctx of contextsToRun) {
      console.log(BOLD(`  ◇ Context: ${ctx.label}`))

      // Build context once (shared storage state for signed-in / warm).
      // Auth flow + warm-cache pre-fill are stubs — wire when creds land.
      const contextOpts = {}
      if (ctx.requiresAuth) {
        // TODO Phase 0.1 follow-up: call signIn() helper from e2e/helpers.js
        // to mint a storage state, write to /tmp/perf-auth-<env>.json, reuse.
        // For now this branch is unreachable (HAVE_AUTH gates it out).
      }

      for (const route of routesToRun) {
        const url = BASE_URL + route.path
        const runs = []
        process.stdout.write(`    ${route.name.padEnd(16)} `)

        for (let i = 0; i < RUNS; i++) {
          try {
            const m = await measure({ browser, url, profile, contextOpts })
            runs.push(m)
            process.stdout.write('.')
          } catch (err) {
            process.stdout.write(RED('!'))
          }
        }

        if (!runs.length) {
          console.log(`  ${RED('all failed')}`)
          results.push({ route: route.name, path: route.path, device: profile.id, context: ctx.id, error: 'all-failed' })
          continue
        }

        const stats = {
          ready_p50: median(pick(runs, 'readyMs')),
          ready_p95: pctile(pick(runs, 'readyMs'), 95),
          ttfb_p50:  median(pick(runs, 'ttfb')),
          fcp_p50:   median(pick(runs, 'fcp')),
          lcp_p50:   median(pick(runs, 'lcp')),
          js_kb:     median(pick(runs, 'jsKb')),
          static_kb: median(pick(runs, 'staticKb')),
          img_kb:    median(pick(runs, 'imgKb')),
          requests:  median(pick(runs, 'requests')),
        }

        console.log(
          `  ready ${colorReady(stats.ready_p50, profile.id)} ` +
          DIM(`(p95 ${stats.ready_p95}ms)`) + '  ' +
          DIM(`fcp ${fms(stats.fcp_p50)}  lcp ${fms(stats.lcp_p50)}  js ${fkb(stats.js_kb)}  reqs ${stats.requests}`)
        )

        results.push({
          route:   route.name,
          path:    route.path,
          device:  profile.id,
          context: ctx.id,
          runs:    runs.length,
          stats,
          raw:     runs,
        })
      }
      console.log()
    }
  }

  await browser.close()

  // Persist
  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `perf-${ENV_TAG}-${isoStamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    timestamp: startedAt.toISOString(),
    env:       ENV_TAG,
    baseUrl:   BASE_URL,
    runs:      RUNS,
    auth:      HAVE_AUTH,
    warmup:    WARMUP,
    devices:   devicesToRun.map(d => d.id),
    contexts:  contextsToRun.map(c => c.id),
    results,
  }, null, 2))
  console.log(`  Saved → ${outPath.replace(process.cwd() + '/', '')}\n`)
}

run().catch(err => { console.error(err.stack || err.message); process.exit(1) })
