#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — PlayVsBot warm-anon ready-time benchmark.
 *
 * Companion to the "PlayVsBot — 6-step serial join chain" entry in
 * Future_Ideas.md. The route-level Ready/LCP rebaseline doesn't measure
 * this specific path (it exercises HomePage / Tournaments / Rankings),
 * so this script targets it directly.
 *
 * What it measures, per run:
 *   tReady   — ms from navigation-start to the moment the XO board's
 *              `Cell 1` button is visible (the user-perceived "ready"
 *              moment when the game becomes playable).
 *   tCreate  — duration of `POST /api/v1/rt/tables` (HvB create).
 *   joinPOSTs — count of follow-up `POST /api/v1/rt/tables/<slug>/join`
 *              after the create. **Should be 0 post-fix.** (Was 1
 *              pre-fix, adding ~170 ms to the chain.)
 *   waterfall — list of every /api/v1/* request with offset + duration,
 *              dumped for the slowest run so you can eyeball the chain.
 *
 * Methodology:
 *   1. Per run, spin a fresh Chromium context (cold caches + fresh SSE
 *      session) so we measure warm-anon-from-HomePage realistically.
 *   2. Visit HomePage first — that triggers `prefetchCommunityBot()`
 *      on mount, so the `/api/v1/bots?gameId=xo` RTT is warm. This
 *      matches the prod trace from 2026-05-13.
 *   3. Then navigate to `/play?action=vs-community-bot` and wait for
 *      `aria-label="Cell 1"` to be visible.
 *
 * Usage:
 *   node perf/perf-playvsbot.js                       # localhost
 *   node perf/perf-playvsbot.js --target=staging      # staging
 *   node perf/perf-playvsbot.js --target=prod         # prod
 *   node perf/perf-playvsbot.js --runs=10 --headed    # tweak run count
 *
 * Output:
 *   perf/baselines/playvsbot-<env>-<isoTimestamp>.json
 */

import { chromium } from 'playwright'
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

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
const p50 = arr => pct([...arr].sort((a, b) => a - b), 50)
const p95 = arr => pct([...arr].sort((a, b) => a - b), 95)

function classify(url) {
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
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

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

  // 1) Warm the community-bot cache via HomePage (matches the prod scenario
  //    where users land on Home before clicking Play). Use domcontentloaded
  //    not networkidle — long-lived SSE streams never let staging idle.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  // HomePage fires `prefetchCommunityBot()` from useEffect on mount — give
  // it a beat to land before we navigate so the cache is actually warm.
  await page.waitForTimeout(1500)

  // 2) Tag the navigate-start moment with wallclock outside the page —
  //    using performance.now() inside doesn't work because it resets
  //    across the cross-document navigation.
  const tNavStart = Date.now()
  await page.evaluate(url => { window.location.href = url }, PLAY_URL)

  // 3) Wait for the XO board's first cell to be visible. That's the
  //    user-perceived "ready" moment.
  await page.waitForSelector('button[aria-label="Cell 1"]', { state: 'visible', timeout: 30_000 })
  const tReady = Date.now() - tNavStart

  // 5) Tabulate the network calls. tCreate / joinPOSTs come from
  //    the captured /api/v1/* events.
  const createCall = apiCalls.find(c =>
    classify(c.url) === 'rt-tables-create' && c.method === 'POST'
  )
  const joinCalls = apiCalls.filter(c =>
    classify(c.url) === 'rt-tables-join' && c.method === 'POST'
  )

  await ctx.close()

  return {
    run:        idx,
    tReady,
    tCreateMs:  createCall?.duration ?? null,
    joinPOSTs:  joinCalls.length,
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
  console.log(`PlayVsBot benchmark`)
  console.log(`  base : ${BASE_URL}`)
  console.log(`  env  : ${ENV_TAG}`)
  console.log(`  runs : ${RUNS}`)
  console.log('')

  const results = []
  for (let i = 1; i <= RUNS; i += 1) {
    process.stdout.write(`  run ${i}/${RUNS} … `)
    try {
      const r = await runOnce(browser, i)
      results.push(r)
      console.log(
        `tReady=${r.tReady}ms ` +
        `tCreate=${r.tCreateMs ?? '—'}ms ` +
        `joinPOSTs=${r.joinPOSTs}`
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
  const tCreateP50   = p50(ok.map(r => r.tCreateMs).filter(v => v !== null))
  const joinPostsTot = ok.reduce((s, r) => s + r.joinPOSTs, 0)
  const slowestRun   = [...ok].sort((a, b) => b.tReady - a.tReady)[0]

  console.log('\n── Summary ──────────────────────────────────────')
  console.log(`  tReady p50           : ${tReadyP50} ms`)
  console.log(`  tReady p95           : ${tReadyP95} ms`)
  console.log(`  rt-tables create p50 : ${tCreateP50} ms`)
  console.log(`  follow-up join POSTs : ${joinPostsTot} across ${ok.length} runs`)
  if (joinPostsTot === 0) {
    console.log(`    ✓ HvB join-chain trim is effective on ${ENV_TAG}`)
  } else {
    console.log(`    ⚠️  unexpected — expected 0 join POSTs post-fix`)
  }

  console.log('\n── Slowest run waterfall ────────────────────────')
  console.log(`  run ${slowestRun.run} (tReady=${slowestRun.tReady}ms)`)
  for (const c of slowestRun.apiCalls) {
    const tag = (c.kind === 'rt-tables-create' || c.kind === 'rt-tables-join')
      ? `🔶 ${c.kind}` : c.kind
    console.log(`    ${c.method.padEnd(5)} ${c.duration.toString().padStart(5)}ms  ${tag}  ${new URL(c.url).pathname}`)
  }

  // Write baseline JSON.
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const outDir    = join(__dirname, 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(outDir, `playvsbot-${ENV_TAG}-${stamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    env:       ENV_TAG,
    base:      BASE_URL,
    runs:      RUNS,
    summary:   {
      tReadyP50, tReadyP95, tCreateP50,
      joinPostsTotal: joinPostsTot,
    },
    results,
  }, null, 2))
  console.log(`\nBaseline → ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
