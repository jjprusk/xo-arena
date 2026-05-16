#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — PlayVsBot warm-anon ready-time benchmark, throttled-mobile variant.
 *
 * Companion to `perf-playvsbot.js`. Same measurements, but adds Fast-3G-class
 * network throttling + a mobile device profile to validate the platform's
 * mobile target (500 ms ready). The desktop variant routinely runs warm-anon
 * around ~900 ms on prod; this script tells us whether the structural collapse
 * in Future_Ideas item 3 actually translates into the bigger projected mobile
 * win (~450 ms over the slow path).
 *
 * What it measures, per run:
 *   tReady              — ms from navigation-start to the moment the XO
 *                         board's `Cell 1` button is visible.
 *   tPlayBot            — duration of `POST /api/v1/play/bot` (the
 *                         single-shot endpoint that replaced the 3-RTT chain).
 *   tCreate             — duration of `POST /api/v1/rt/tables` (should be 0
 *                         occurrences on the warm vs-community-bot path).
 *   joinPOSTs           — count of `POST /api/v1/rt/tables/<slug>/join`
 *                         (should be 0 post-fix).
 *   tokenGETs           — count of `GET /api/token` on the critical path.
 *   botsListGETs        — count of `GET /api/v1/bots?gameId=…` on the
 *                         critical path.
 *   tablesCreatePOSTs   — count of `POST /api/v1/rt/tables` (should be 0
 *                         post-collapse — replaced by /play/bot).
 *
 * Throttling profile — "Fast 3G" (Chrome DevTools preset):
 *   downloadThroughput : 1.6 Mbps
 *   uploadThroughput   : 750 Kbps
 *   latency            : 150 ms (round-trip)
 *
 * Device profile — Pixel 5 (375 × 851, DPR 3, mobile UA).
 *
 * Usage:
 *   node perf/perf-playvsbot-mobile.js                       # localhost
 *   node perf/perf-playvsbot-mobile.js --target=staging      # staging
 *   node perf/perf-playvsbot-mobile.js --target=prod         # prod
 *   node perf/perf-playvsbot-mobile.js --runs=10 --headed
 *
 * Output:
 *   perf/baselines/playvsbot-mobile-<env>-<isoTimestamp>.json
 */

import { chromium, devices } from 'playwright'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const args     = process.argv.slice(2)
const positional = args.find(a => !a.startsWith('--'))
const TARGET   = args.find(a => a.startsWith('--target='))?.split('=')[1] ?? null
const RUNS     = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '5') || 5
const HEADED   = args.includes('--headed')

function resolveBase() {
  if (positional)            return positional.replace(/\/$/, '')
  if (TARGET === 'staging')  return 'https://xo-landing-staging.fly.dev'
  if (TARGET === 'prod')     return 'https://xo-landing-prod.fly.dev'
  return 'http://localhost:5174'
}
const BASE_URL = resolveBase()
const ENV_TAG  = TARGET ?? (BASE_URL.includes('staging') ? 'staging'
              : BASE_URL.includes('prod') ? 'prod'
              : 'local')

const PLAY_URL = `${BASE_URL}/play?action=vs-community-bot`

// Fast 3G profile — matches Chrome DevTools' built-in preset.
const NET_PROFILE = {
  offline:             false,
  downloadThroughput:  (1.6 * 1024 * 1024) / 8,   // 1.6 Mbps in bytes/sec
  uploadThroughput:    (750  * 1024)        / 8,  // 750 Kbps in bytes/sec
  latency:             150,                       // ms (additional)
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
const p50 = arr => pct([...arr].sort((a, b) => a - b), 50)
const p95 = arr => pct([...arr].sort((a, b) => a - b), 95)

function classify(url) {
  if (/\/api\/v1\/play\/bot\b/.test(new URL(url).pathname))              return 'play-bot'
  if (url.includes('/api/v1/rt/tables') && !/\/rt\/tables\/[^/]+/.test(new URL(url).pathname)) {
    return 'rt-tables-create'
  }
  if (/\/api\/v1\/rt\/tables\/[^/]+\/join/.test(new URL(url).pathname)) return 'rt-tables-join'
  if (url.includes('/api/v1/bots'))                                     return 'bots'
  if (url.includes('/api/token'))                                       return 'token'
  if (url.includes('/api/version'))                                     return 'version'
  if (url.includes('/api/v1/'))                                         return 'api'
  return 'other'
}

async function runOnce(browser, idx) {
  // Mobile context — Pixel 5 dimensions + UA, plus credentials/cookies
  // isolated per run (cold cache).
  const ctx = await browser.newContext({ ...devices['Pixel 5'] })
  const page = await ctx.newPage()

  // Throttle every page in this context. CDPSession is the only Playwright
  // entry point for emulateNetworkConditions; the high-level `route()` API
  // can simulate latency but not bandwidth.
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', NET_PROFILE)

  const apiCalls = []
  page.on('request', req => {
    const url = req.url()
    if (!url.includes('/api/')) return
    apiCalls.push({ url, method: req.method(), startedAt: Date.now() })
  })
  page.on('response', async resp => {
    const url = resp.url()
    if (!url.includes('/api/')) return
    const rec = apiCalls.findLast?.(c => c.url === url && c.endedAt === undefined)
                ?? apiCalls.find(c => c.url === url && c.endedAt === undefined)
    if (rec) {
      rec.status   = resp.status()
      rec.endedAt  = Date.now()
      rec.duration = rec.endedAt - rec.startedAt
    }
  })

  // 1) Warm the community-bot cache via HomePage — same flow as desktop.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  // Throttling makes the prefetch slower — give it 3 s (vs 1.5 s desktop)
  // so the cache is actually warm before /play navigation.
  await page.waitForTimeout(3000)

  // 2) Wallclock-tag navigation start. performance.now() resets across
  //    cross-document navigation, so we measure outside the page.
  const tNavStart = Date.now()
  await page.evaluate(url => { window.location.href = url }, PLAY_URL)

  // 3) Wait for the board to render.
  await page.waitForSelector('button[aria-label="Cell 1"]', { state: 'visible', timeout: 60_000 })
  const tReady = Date.now() - tNavStart

  const createCall = apiCalls.find(c =>
    classify(c.url) === 'rt-tables-create' && c.method === 'POST'
  )
  const playBotCall = apiCalls.find(c =>
    classify(c.url) === 'play-bot' && c.method === 'POST'
  )
  const joinCalls = apiCalls.filter(c =>
    classify(c.url) === 'rt-tables-join' && c.method === 'POST'
  )
  const tokenCalls = apiCalls.filter(c =>
    classify(c.url) === 'token' && c.method === 'GET'
  )
  const botsListCalls = apiCalls.filter(c =>
    classify(c.url) === 'bots' && c.method === 'GET' && c.url.includes('gameId=')
  )
  const tablesCreatePosts = apiCalls.filter(c =>
    classify(c.url) === 'rt-tables-create' && c.method === 'POST'
  )

  await ctx.close()

  return {
    run:               idx,
    tReady,
    tCreateMs:         createCall?.duration ?? null,
    tPlayBotMs:        playBotCall?.duration ?? null,
    joinPOSTs:         joinCalls.length,
    tokenGETs:         tokenCalls.length,
    botsListGETs:      botsListCalls.length,
    tablesCreatePOSTs: tablesCreatePosts.length,
    playBotPOSTs:      playBotCall ? 1 : 0,
    apiCalls:   apiCalls
      .filter(c => c.duration !== undefined)
      .map(c => ({
        kind:     classify(c.url),
        url:      c.url,
        method:   c.method,
        status:   c.status,
        duration: c.duration,
      })),
  }
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED })
  console.log(`PlayVsBot mobile-throttled benchmark`)
  console.log(`  base   : ${BASE_URL}`)
  console.log(`  env    : ${ENV_TAG}`)
  console.log(`  runs   : ${RUNS}`)
  console.log(`  device : Pixel 5`)
  console.log(`  net    : Fast 3G (1.6 Mbps down / 750 Kbps up / 150 ms RTT)`)
  console.log('')

  const results = []
  for (let i = 1; i <= RUNS; i += 1) {
    process.stdout.write(`  run ${i}/${RUNS} … `)
    try {
      const r = await runOnce(browser, i)
      results.push(r)
      console.log(
        `tReady=${r.tReady}ms ` +
        `tPlayBot=${r.tPlayBotMs ?? '—'}ms ` +
        `joinPOSTs=${r.joinPOSTs} ` +
        `tokenGETs=${r.tokenGETs} ` +
        `botsListGETs=${r.botsListGETs}`
      )
    } catch (err) {
      console.log(`FAILED — ${err.message}`)
      results.push({ run: i, error: err.message })
    }
  }
  await browser.close()

  const ok = results.filter(r => !r.error)
  if (ok.length === 0) {
    console.error('\nAll runs failed.')
    process.exit(1)
  }

  const tReadyP50    = p50(ok.map(r => r.tReady))
  const tReadyP95    = p95(ok.map(r => r.tReady))
  const tPlayBotP50  = p50(ok.map(r => r.tPlayBotMs).filter(v => v !== null))
  const joinPostsTot       = ok.reduce((s, r) => s + r.joinPOSTs, 0)
  const tokenGetsTot       = ok.reduce((s, r) => s + r.tokenGETs, 0)
  const botsListGetsTot    = ok.reduce((s, r) => s + r.botsListGETs, 0)
  const tablesCreatePostsTot = ok.reduce((s, r) => s + r.tablesCreatePOSTs, 0)
  const playBotPostsTot    = ok.reduce((s, r) => s + r.playBotPOSTs, 0)
  const slowestRun         = [...ok].sort((a, b) => b.tReady - a.tReady)[0]

  console.log('\n── Summary (Fast-3G mobile) ─────────────────────')
  console.log(`  tReady p50           : ${tReadyP50} ms`)
  console.log(`  tReady p95           : ${tReadyP95} ms`)
  console.log(`  play/bot p50         : ${tPlayBotP50 ?? '—'} ms`)
  console.log('')
  console.log(`  Structural collapse (across ${ok.length} runs):`)
  console.log(`    play/bot POSTs      : ${playBotPostsTot}    ${playBotPostsTot === ok.length ? '✓' : '⚠️  expected one per run'}`)
  console.log(`    rt-tables POSTs     : ${tablesCreatePostsTot}    ${tablesCreatePostsTot === 0 ? '✓ collapsed' : '⚠️  expected 0 post-collapse'}`)
  console.log(`    follow-up join POSTs: ${joinPostsTot}    ${joinPostsTot === 0 ? '✓' : '⚠️  expected 0'}`)
  console.log(`    /api/token GETs     : ${tokenGetsTot}    ${tokenGetsTot === 0 ? '✓ off critical path' : '(present — see waterfall)'}`)
  console.log(`    /bots?gameId= GETs  : ${botsListGetsTot}    ${botsListGetsTot === 0 ? '✓ off critical path' : '(present — see waterfall)'}`)

  console.log('\n── Slowest run waterfall ────────────────────────')
  console.log(`  run ${slowestRun.run} (tReady=${slowestRun.tReady}ms)`)
  for (const c of slowestRun.apiCalls) {
    const highlight = ['rt-tables-create', 'rt-tables-join', 'play-bot']
    const tag = highlight.includes(c.kind) ? `🔶 ${c.kind}` : c.kind
    console.log(`    ${c.method.padEnd(5)} ${c.duration.toString().padStart(5)}ms  ${tag}  ${new URL(c.url).pathname}`)
  }

  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outDir    = join(__dirname, 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(outDir, `playvsbot-mobile-${ENV_TAG}-${stamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    env:       ENV_TAG,
    base:      BASE_URL,
    runs:      RUNS,
    device:    'Pixel 5',
    network:   'Fast 3G (1.6 Mbps / 750 Kbps / 150 ms)',
    summary:   {
      tReadyP50, tReadyP95, tPlayBotP50,
      joinPostsTotal:          joinPostsTot,
      tokenGetsTotal:          tokenGetsTot,
      botsListGetsTotal:       botsListGetsTot,
      tablesCreatePostsTotal:  tablesCreatePostsTot,
      playBotPostsTotal:       playBotPostsTot,
    },
    results,
  }, null, 2))
  console.log(`\nBaseline → ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
