#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — Cold-Page Long-Task Profiler
 *
 * Companion to doc/Performance_Plan_v2.md, Phase 1 / Phase 1b. Captures
 * `PerformanceObserver({ type: 'longtask', buffered: true })` entries
 * during cold load and reports, per route × device:
 *
 *   countLT       : number of long tasks (>= 50ms by spec)
 *   sumLT         : total long-task time (ms)
 *   maxLT         : longest single long task (ms)
 *   tbtApprox     : Σ max(0, duration − 50)  — rough TBT approximation
 *
 * The point: INP tells us about interactions, but cold-page Ready cost
 * is dominated by main-thread work that locks up the page during JS
 * parse + React mount + first effects. If a route shows `sumLT` close
 * to its Ready time, that's the optimization target — a code split, a
 * deferred init, or an off-main-thread move.
 *
 * Output also includes the top 3 longest tasks per route with their
 * `attribution` records (frame name + container src) so we can tell
 * whether a third-party iframe / script is involved or it's all our
 * own bundle.
 *
 * Usage:
 *   node perf/perf-longtasks.js                         # localhost
 *   node perf/perf-longtasks.js --target=staging
 *   node perf/perf-longtasks.js --target=prod
 *   node perf/perf-longtasks.js --runs=10 --device=desktop
 *
 * Output:
 *   perf/baselines/longtasks-<env>-<isoTimestamp>.json
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

// Same five public routes the waterfall script covers, plus Play (which
// pulls in the XO bundle).
const ROUTES = [
  { name: 'Home',         path: '/' },
  { name: 'Play',         path: '/play' },
  { name: 'Tournaments',  path: '/tournaments' },
  { name: 'Rankings',     path: '/rankings' },
  { name: 'Tables',       path: '/tables' },
]

const DEVICE_PROFILES = [
  { id: 'desktop', label: 'Desktop',
    options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    network: null,
    // 1× = no throttle. Long-task counts will reflect the dev machine —
    // useful as a relative number for comparing routes, not as a real-user
    // proxy.
    cpuThrottle: 1 },
  { id: 'mobile', label: 'Mobile (Moto G4 / 4G, 4× CPU)',
    options: { ...devices['Moto G4'] },
    network: { downloadKbps: 4 * 1024, uploadKbps: 3 * 1024, latencyMs: 20 },
    // Lighthouse convention for "Slow 4G + Mid-tier mobile". Without this
    // a Playwright Moto-G4 profile is desktop-fast and won't show longtasks.
    cpuThrottle: 4 },
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

async function measureLongTasks({ browser, profile, route, base }) {
  const ctx = await browser.newContext({ ...profile.options })
  const page = await ctx.newPage()

  if (profile.network || (profile.cpuThrottle && profile.cpuThrottle > 1)) {
    const cdp = await ctx.newCDPSession(page)
    if (profile.network) {
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline:            false,
        downloadThroughput: profile.network.downloadKbps * 128,
        uploadThroughput:   profile.network.uploadKbps   * 128,
        latency:            profile.network.latencyMs,
      })
    }
    if (profile.cpuThrottle && profile.cpuThrottle > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottle })
    }
  }

  await page.addInitScript(() => {
    window.__longtasks = []
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__longtasks.push({
            start:    Math.round(e.startTime),
            duration: Math.round(e.duration),
            name:     e.name,
            attribution: (e.attribution || []).map(a => ({
              name:           a.name,
              containerType:  a.containerType,
              containerName:  a.containerName,
              containerSrc:   a.containerSrc,
            })),
          })
        }
      }).observe({ type: 'longtask', buffered: true })
    } catch {}
  })

  await page.goto(base + route.path, { waitUntil: 'load', timeout: 30_000 })
  // Settle for 2s after load to catch tasks triggered by deferred init,
  // image decode, late hydration. Cold-load is the focus, not idle.
  await page.waitForTimeout(2000)

  const tasks = await page.evaluate(() => window.__longtasks || [])
  await ctx.close()
  return tasks
}

async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')
  console.log()
  console.log(BOLD('XO Arena — Cold-Page Long-Task Profiler'))
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
      const samples = { count: [], sum: [], max: [], tbt: [] }
      let topTasksAcrossRuns = []
      process.stdout.write(`    ${route.name.padEnd(14)} `)
      for (let i = 0; i < RUNS; i++) {
        try {
          const tasks = await measureLongTasks({ browser, profile, route, base: BASE_URL })
          const count = tasks.length
          const sum   = tasks.reduce((s, t) => s + t.duration, 0)
          const max   = tasks.reduce((m, t) => Math.max(m, t.duration), 0)
          const tbt   = tasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0)
          samples.count.push(count)
          samples.sum  .push(sum)
          samples.max  .push(max)
          samples.tbt  .push(tbt)
          // Track top-3 longest of this run; merge across runs and re-trim.
          for (const t of tasks) topTasksAcrossRuns.push(t)
          process.stdout.write('.')
        } catch {
          process.stdout.write(RED('!'))
        }
      }
      // Top 3 across all runs by duration (helpful when a hot task only
      // shows on some runs).
      topTasksAcrossRuns.sort((a, b) => b.duration - a.duration)
      const top3 = topTasksAcrossRuns.slice(0, 3)
      const stats = {
        countLT: { p50: median(samples.count), p95: pctile(samples.count, 95) },
        sumLT:   { p50: median(samples.sum),   p95: pctile(samples.sum, 95)   },
        maxLT:   { p50: median(samples.max),   p95: pctile(samples.max, 95)   },
        tbt:     { p50: median(samples.tbt),   p95: pctile(samples.tbt, 95)   },
      }
      console.log(
        ` count ${String(stats.countLT.p50 ?? '—').padEnd(4)}` +
        ` sum ${colorMs(stats.sumLT.p50, 200).padEnd(20)}` +
        ` max ${colorMs(stats.maxLT.p50, 100).padEnd(20)}` +
        ` tbt ${colorMs(stats.tbt.p50,   200).padEnd(20)}` +
        DIM(`(p95 sum ${stats.sumLT.p95 ?? '—'}ms, n=${samples.count.length})`)
      )
      results.push({
        route:   route.name,
        path:    route.path,
        device:  profile.id,
        runs:    RUNS,
        stats,
        raw:     samples,
        top3,
      })
    }
    console.log()
  }

  await browser.close()

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `longtasks-${ENV_TAG}-${isoStamp}.json`)
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
