#!/usr/bin/env node
/**
 * XO Arena — Page Load Performance Benchmark
 *
 * "Ready" = from navigation start until the last spinner (.animate-spin)
 * disappears from the DOM. This captures full DB round-trip time.
 *
 * Usage:
 *   node perf/perf.js                                    # localhost:4173
 *   node perf/perf.js https://xo-arena-staging.up.railway.app
 *   BASE_URL=https://... node perf/perf.js --runs=5 --json
 *
 * Flags:
 *   --runs=N   Cold runs per page (default 3). Median is reported.
 *   --json     Also save perf/results.json (good for tracking over time)
 *   --headed   Show browser (useful for debugging a failing page)
 *
 * First-time setup:
 *   cd perf && npm install && npx playwright install chromium
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2)
const BASE_URL  = (args.find(a => !a.startsWith('--')) ?? process.env.BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '')
const RUNS      = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '3') || 3
const JSON_OUT  = args.includes('--json')
const HEADED    = args.includes('--headed')

// ── Pages to benchmark ────────────────────────────────────────────────────────
// Auth-required pages (stats, settings, ml) will still load and settle —
// they show an empty/login state once the auth check resolves.
const PAGES = [
  { name: 'Play',        path: '/play' },
  { name: 'Leaderboard', path: '/leaderboard' },
  { name: 'Puzzles',     path: '/puzzles' },
  { name: 'Stats',       path: '/stats' },
  { name: 'Settings',    path: '/settings' },
  { name: 'ML Gym',      path: '/ml' },
]

// ── Measurement ───────────────────────────────────────────────────────────────
async function measurePage(browser, url) {
  // Fresh context = no cache, no cookies — simulates a new visitor every run.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page    = await context.newPage()

  // Inject LCP observer before any navigation
  await page.addInitScript(() => {
    window.__lcp = 0
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) window.__lcp = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {}
  })

  const t0 = Date.now()

  // 1. Wait for all network activity to settle (API calls included)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })

  // 2. Wait for any spinner still in the DOM to disappear.
  //    If no spinner is present this resolves immediately.
  //    If React is still re-rendering after the last API response this catches it.
  await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 8_000 })
    .catch(() => { /* page has no spinner or never showed one */ })

  const readyMs = Date.now() - t0

  // Collect timing from the browser's Performance API
  const perf = await page.evaluate(() => {
    const nav   = performance.getEntriesByType('navigation')[0]
    const paint = Object.fromEntries(
      performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)])
    )

    // Total compressed wire bytes for static assets (not XHR)
    const STATIC = ['.js', '.css', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.svg', '.ico', '.wav', '.mp3']
    const staticBytes = performance.getEntriesByType('resource')
      .filter(r => STATIC.some(ext => r.name.split('?')[0].endsWith(ext)))
      .reduce((sum, r) => sum + (r.transferSize || 0), 0)

    return {
      ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      fcp:  paint['first-contentful-paint'] ?? null,
      lcp:  Math.round(window.__lcp) || null,
      staticKb: Math.round(staticBytes / 1024),
    }
  })

  await context.close()
  return { readyMs, ...perf }
}

// ── Stats helpers ─────────────────────────────────────────────────────────────
function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s.length % 2 ? s[Math.floor(s.length / 2)] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}
function pick(runs, key) { return runs.map(r => r[key]).filter(v => v != null && v > 0) }

// ── Formatting ────────────────────────────────────────────────────────────────
const BOLD   = s => `\x1b[1m${s}\x1b[0m`
const DIM    = s => `\x1b[2m${s}\x1b[0m`
const GREEN  = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const RED    = s => `\x1b[31m${s}\x1b[0m`

function colorReady(ms) {
  const s = `${ms}ms`
  if (ms <= 1500) return GREEN(s)
  if (ms <= 3000) return YELLOW(s)
  return RED(s)
}

function fms(n) { return n != null ? `${n}ms` : '—' }
function fkb(n) { return n != null ? `${n}KB` : '—' }

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const startedAt = new Date().toISOString()
  console.log()
  console.log(BOLD('XO Arena — Page Load Benchmark'))
  console.log(`  Target : ${BASE_URL}`)
  console.log(`  Runs   : ${RUNS} cold per page (fresh browser context, no cache)`)
  console.log(`  Ready  : measured until last spinner (.animate-spin) leaves DOM`)
  console.log()

  const browser = await chromium.launch({ headless: !HEADED })
  const summary = []

  for (const { name, path } of PAGES) {
    const url  = BASE_URL + path
    const runs = []

    // ── Per-page header ──────────────────────────────────────────────────────
    console.log(BOLD(`  ── ${name}  ${DIM(path)}`))

    for (let i = 1; i <= RUNS; i++) {
      process.stdout.write(`     run ${i}  `)
      try {
        const m = await measurePage(browser, url)
        runs.push(m)
        console.log(
          `ready ${colorReady(m.readyMs)}  ` +
          `ttfb ${DIM(fms(m.ttfb))}  ` +
          `fcp ${DIM(fms(m.fcp))}  ` +
          `lcp ${DIM(fms(m.lcp))}  ` +
          `static ${DIM(fkb(m.staticKb))}`
        )
      } catch (err) {
        console.log(RED(`FAILED — ${err.message.split('\n')[0]}`))
      }
    }

    if (!runs.length) {
      console.log(`     ${RED('All runs failed — skipping')}\n`)
      summary.push({ name, path, error: true })
      continue
    }

    // ── Per-page median ──────────────────────────────────────────────────────
    const med = {
      ready:    median(pick(runs, 'readyMs')),
      ttfb:     median(pick(runs, 'ttfb')),
      fcp:      median(pick(runs, 'fcp')),
      lcp:      median(pick(runs, 'lcp')),
      staticKb: median(pick(runs, 'staticKb')),
    }

    console.log(
      `     ${BOLD('median')}  ready ${colorReady(med.ready)}  ` +
      `ttfb ${fms(med.ttfb)}  fcp ${fms(med.fcp)}  lcp ${fms(med.lcp)}  static ${fkb(med.staticKb)}`
    )
    console.log()

    summary.push({ name, path, ...med, runs: runs.length, raw: runs })
  }

  await browser.close()

  // ── Summary table ─────────────────────────────────────────────────────────
  const W = { name: 14, ready: 10, ttfb: 8, fcp: 8, lcp: 8, kb: 8 }
  const hr = '─'.repeat(Object.values(W).reduce((a, b) => a + b + 2, 0) + 2)

  console.log(BOLD('  Summary'))
  console.log(`  ${hr}`)
  console.log(
    `  ${'Page'.padEnd(W.name)}  ${'Ready'.padStart(W.ready)}  ${'TTFB'.padStart(W.ttfb)}  ${'FCP'.padStart(W.fcp)}  ${'LCP'.padStart(W.lcp)}  ${'Static'.padStart(W.kb)}`
  )
  console.log(`  ${hr}`)

  for (const r of summary) {
    if (r.error) {
      console.log(`  ${r.name.padEnd(W.name)}  ${RED('ERROR')}`)
      continue
    }
    const ready = colorReady(r.ready)
    const pad   = n => n != null ? `${n}ms`.padStart(W.ttfb) : '—'.padStart(W.ttfb)
    console.log(
      `  ${r.name.padEnd(W.name)}  ${String(r.ready + 'ms').padStart(W.ready)}  ${pad(r.ttfb)}  ${pad(r.fcp)}  ${fms(r.lcp).padStart(W.lcp)}  ${fkb(r.staticKb).padStart(W.kb)}`
    )
  }

  console.log(`  ${hr}`)
  console.log()
  console.log(DIM('  Ready = navigation start → last spinner gone (DB requests complete)'))
  console.log(DIM('  TTFB  = server response start (network latency)'))
  console.log(DIM('  FCP   = first content painted  |  LCP = largest content painted'))
  console.log(DIM('  Static = compressed JS/CSS/fonts/images (first visit, wire bytes)'))
  console.log()
  console.log(DIM('  Ready thresholds:  ≤1500ms good · ≤3000ms acceptable · >3000ms slow'))
  console.log()

  // ── JSON output ───────────────────────────────────────────────────────────
  if (JSON_OUT) {
    const outPath = join(dirname(fileURLToPath(import.meta.url)), 'results.json')
    writeFileSync(outPath, JSON.stringify({
      timestamp: startedAt,
      baseUrl: BASE_URL,
      runs: RUNS,
      pages: summary.map(({ raw, ...rest }) => rest),
    }, null, 2))
    console.log(`  Results saved → perf/results.json\n`)
  }
}

run().catch(err => { console.error(err.message); process.exit(1) })
