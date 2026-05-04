#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — INP (Interaction-to-Next-Paint) Benchmark
 *
 * Companion to doc/Performance_Plan_v2.md, Phase 0.1 INP gap.
 *
 * For each route in INP_INTERACTIONS, opens the page, performs the defined
 * interaction (click a stable, non-navigating element), and captures every
 * PerformanceEventTiming entry with `interactionId` set. The max duration
 * across the captured set is the INP for that interaction.
 *
 * Reports p50 + p95 across N runs per route × device.
 *
 * Usage:
 *   node perf/perf-inp.js                         # localhost
 *   node perf/perf-inp.js --target=staging        # xo-*-staging.fly.dev
 *   node perf/perf-inp.js --target=prod           # xo-*-prod.fly.dev
 *
 * Flags:
 *   --runs=N            Runs per (route × device). Default 5.
 *   --device=desktop    Only desktop (default: both).
 *   --device=mobile     Only mobile.
 *   --warmup            Hit base URL once before benchmarking.
 *   --headed            Show browser.
 *
 * Output:
 *   perf/baselines/inp-<env>-<isoTimestamp>.json
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
const WARMUP    = args.includes('--warmup')
const HEADED    = args.includes('--headed')

function resolveBase() {
  if (positional)              return positional
  if (TARGET === 'staging')    return 'https://xo-landing-staging.fly.dev'
  if (TARGET === 'prod')       return 'https://xo-landing-prod.fly.dev'
  return 'http://localhost:5174'
}
const BASE_URL = resolveBase()
const ENV_TAG  = TARGET ?? (BASE_URL.includes('staging') ? 'staging'
                : BASE_URL.includes('prod') ? 'prod'
                : 'local')

// ── Per-route interactions ────────────────────────────────────────────────────
// Each interaction is a Playwright action that's stable, fast, and *does not
// navigate*. We want to measure INP, not next-page Ready.
const INP_INTERACTIONS = [
  {
    name: 'Home — refresh demo',
    path: '/',
    interact: async (page) => {
      // The "Watch another match" button refreshes the bot-vs-bot demo
      // without leaving the page. Real handler, real state change, no nav.
      await page.locator('button:has-text("Watch another match")').first().click({ timeout: 5_000 })
    },
  },
  {
    name: 'Home — open sign-in',
    path: '/',
    interact: async (page) => {
      // Opens the auth modal. Real handler, real DOM mutation.
      await page.locator('header button:has-text("Sign in"), header a:has-text("Sign in")').first().click({ timeout: 5_000 })
      await page.keyboard.press('Escape').catch(() => {})
    },
  },
  {
    name: 'Tournaments — filter click',
    path: '/tournaments',
    interact: async (page) => {
      // FilterBar renders {Open,Live,Completed} pills + a date range select.
      // After page load, allow extra time for the data fetch to mount the
      // filter row, then click "Completed" (always present).
      await page.waitForSelector('button:has-text("Completed")', { timeout: 8_000 })
      await page.locator('button:has-text("Completed")').first().click({ timeout: 5_000 })
    },
  },
  {
    name: 'Leaderboard — toggle bots',
    path: '/leaderboard',
    interact: async (page) => {
      await page.waitForSelector('button[role="switch"]', { timeout: 8_000 })
      await page.locator('button[role="switch"]').first().click({ timeout: 5_000 })
    },
  },
  {
    name: 'Puzzles — first button',
    path: '/puzzles',
    interact: async (page) => {
      await page.locator('main button').first().click({ timeout: 5_000 })
    },
  },
]

const DEVICE_PROFILES = [
  { id: 'desktop', label: 'Desktop',
    options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    network: null },
  { id: 'mobile', label: 'Mobile (Moto G4 / 4G)',
    options: { ...devices['Moto G4'] },
    network: { downloadKbps: 4 * 1024, uploadKbps: 3 * 1024, latencyMs: 20 } },
]

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

const BOLD = s => `\x1b[1m${s}\x1b[0m`
const DIM  = s => `\x1b[2m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const RED = s => `\x1b[31m${s}\x1b[0m`

// Per Web Vitals: good ≤ 200ms, needs improvement 200–500ms, poor > 500ms.
function colorINP(ms) {
  if (ms == null)    return DIM('—')
  if (ms <= 200)     return GREEN(`${ms}ms`)
  if (ms <= 500)     return YELLOW(`${ms}ms`)
  return RED(`${ms}ms`)
}

async function measureINP({ browser, base, profile, item }) {
  const ctx = await browser.newContext({ ...profile.options })
  const page = await ctx.newPage()

  if (profile.network) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: profile.network.downloadKbps * 128,
      uploadThroughput:   profile.network.uploadKbps   * 128,
      latency:            profile.network.latencyMs,
    })
  }

  // Inject the event-timing observer before any script runs.
  await page.addInitScript(() => {
    window.__inpEntries = []
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.interactionId) {
            window.__inpEntries.push({
              type:     e.name,
              duration: Math.round(e.duration),
              start:    Math.round(e.startTime),
              proc:     Math.round(e.processingEnd - e.processingStart),
            })
          }
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: true })
    } catch {}
  })

  await page.goto(base + item.path, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForSelector('header', { timeout: 5_000 }).catch(() => {})
  // Wait for any cold spinner to clear.
  await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 8_000 }).catch(() => {})
  // A small settle so the route has actually painted before we click.
  await page.waitForTimeout(300)

  let interactionOk = false
  try {
    await item.interact(page)
    interactionOk = true
  } catch (err) {
    // Selector miss — record so we know which routes need a different anchor.
    interactionOk = false
  }

  // Give the browser one frame + a buffer to flush the entry.
  await page.waitForTimeout(500)

  const entries = await page.evaluate(() => window.__inpEntries || [])
  await ctx.close()

  if (!entries.length) return { ok: false, ms: null, count: 0, interactionOk }
  const inp = entries.reduce((m, e) => Math.max(m, e.duration), 0)
  return { ok: true, ms: inp, count: entries.length, interactionOk, entries }
}

async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')
  console.log()
  console.log(BOLD('XO Arena — INP Benchmark'))
  console.log(`  Target  : ${BASE_URL}  (${ENV_TAG})`)
  console.log(`  Runs    : ${RUNS} per (route × device)`)
  console.log()

  const devicesToRun = DEVICE_PROFILES.filter(d => !DEVICE_F || d.id === DEVICE_F)
  if (!devicesToRun.length) { console.log(RED('Nothing to run')); process.exit(1) }

  const browser = await chromium.launch({ headless: !HEADED })

  if (WARMUP) {
    console.log(DIM('  Warming…'))
    const wctx = await browser.newContext()
    const wp = await wctx.newPage()
    try { await wp.goto(BASE_URL + '/', { waitUntil: 'load', timeout: 30_000 }) } catch {}
    await wctx.close()
    console.log()
  }

  const results = []
  for (const profile of devicesToRun) {
    console.log(BOLD(`▸ Device: ${profile.label}`))
    for (const item of INP_INTERACTIONS) {
      const samples = []
      let interactionMisses = 0
      process.stdout.write(`    ${item.name.padEnd(34)} `)
      for (let i = 0; i < RUNS; i++) {
        try {
          const r = await measureINP({ browser, base: BASE_URL, profile, item })
          if (!r.interactionOk) interactionMisses++
          if (r.ok) { samples.push(r.ms); process.stdout.write('.') } else process.stdout.write('-')
        } catch {
          process.stdout.write(RED('!'))
        }
      }
      const stats = {
        inp_p50: median(samples),
        inp_p95: pctile(samples, 95),
        samples: samples.length,
        misses:  interactionMisses,
      }
      console.log(`  inp ${colorINP(stats.inp_p50)} ` + DIM(`(p95 ${stats.inp_p95 ?? '—'}ms, n=${stats.samples}${stats.misses ? `, misses=${stats.misses}` : ''})`))
      results.push({ name: item.name, path: item.path, device: profile.id, runs: RUNS, stats, raw: samples })
    }
    console.log()
  }

  await browser.close()

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `inp-${ENV_TAG}-${isoStamp}.json`)
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
