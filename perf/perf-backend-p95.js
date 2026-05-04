#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — Backend Endpoint Latency Benchmark
 *
 * Companion to doc/Performance_Plan_v2.md, Phase 0.3 input. Measures p50/
 * p95/p99 of the hot read endpoints under modest concurrency, so we know
 * which DB / handler queries actually need attention before chasing
 * speculative indexes (Phase 2) or cross-service hops (Phase 4).
 *
 * Sends a fixed budget of requests per endpoint at a configurable
 * concurrency. Each request is timed end-to-end (DNS + TLS + handler +
 * TLS + body read).
 *
 * Usage:
 *   node perf/perf-backend-p95.js                         # localhost
 *   node perf/perf-backend-p95.js --target=staging
 *   node perf/perf-backend-p95.js --target=prod
 *   node perf/perf-backend-p95.js --requests=500 --concurrency=10
 *
 * Output:
 *   perf/baselines/backend-p95-<env>-<isoTimestamp>.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const args = process.argv.slice(2)
const positional = args.find(a => !a.startsWith('--'))
const TARGET = (args.find(a => a.startsWith('--target='))?.split('=')[1]) ?? null
const REQUESTS    = parseInt(args.find(a => a.startsWith('--requests='))?.split('=')[1]    ?? '200') || 200
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '5')   || 5
const WARMUP_REQS = parseInt(args.find(a => a.startsWith('--warmup='))?.split('=')[1]      ?? '10')  || 10

function resolveBase() {
  if (positional)              return positional
  if (TARGET === 'staging')    return { landing: 'https://xo-landing-staging.fly.dev',
                                       backend: 'https://xo-backend-staging.fly.dev',
                                       tournament: 'https://xo-tournament-staging.fly.dev' }
  if (TARGET === 'prod')       return { landing: 'https://xo-landing-prod.fly.dev',
                                       backend: 'https://xo-backend-prod.fly.dev',
                                       tournament: 'https://xo-tournament-prod.fly.dev' }
  return { landing: 'http://localhost:5174',
           backend: 'http://localhost:3000',
           tournament: 'http://localhost:3001' }
}
const BASES = resolveBase()
const ENV_TAG = TARGET ?? (BASES.landing.includes('staging') ? 'staging'
                : BASES.landing.includes('prod') ? 'prod' : 'local')

// Hot read endpoints — chosen because every cold-page benchmark touches
// at least one, and each one is what page-level optimizations rely on
// staying fast.
const ENDPOINTS = [
  { name: 'GET /api/version',                    base: 'backend',    path: '/api/version' },
  { name: 'GET /api/v1/bots?gameId=xo',          base: 'backend',    path: '/api/v1/bots?gameId=xo' },
  { name: 'GET /api/v1/leaderboard?game=xo',     base: 'backend',    path: '/api/v1/leaderboard?game=xo' },
  { name: 'GET /api/auth/get-session',           base: 'backend',    path: '/api/auth/get-session' },
  { name: 'GET /api/tournaments',                base: 'tournament', path: '/api/tournaments' },
]

const BOLD  = s => `\x1b[1m${s}\x1b[0m`
const DIM   = s => `\x1b[2m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const RED   = s => `\x1b[31m${s}\x1b[0m`

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
function colorMs(ms, target = 100) {
  if (ms == null) return DIM('—')
  if (ms <= target)        return GREEN(`${ms}ms`)
  if (ms <= target * 3)    return YELLOW(`${ms}ms`)
  return RED(`${ms}ms`)
}

async function timed(url) {
  const t0 = performance.now()
  let status = 0, sizeKb = 0
  try {
    const res = await fetch(url)
    status = res.status
    const buf = await res.arrayBuffer()
    sizeKb = Math.round(buf.byteLength / 1024)
  } catch {
    status = -1
  }
  return { ms: Math.round(performance.now() - t0), status, sizeKb }
}

async function bench(url, n, concurrency) {
  const samples = []
  const errors  = []
  let inflight = 0
  let dispatched = 0

  await new Promise((resolve) => {
    const tick = () => {
      while (inflight < concurrency && dispatched < n) {
        inflight++; dispatched++
        timed(url).then(r => {
          if (r.status >= 200 && r.status < 400) samples.push(r.ms)
          else errors.push({ status: r.status, ms: r.ms })
          inflight--
          if (samples.length + errors.length === n) resolve()
          else tick()
        })
      }
    }
    tick()
  })

  return { samples, errors }
}

async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')

  console.log()
  console.log(BOLD('XO Arena — Backend Endpoint Latency'))
  console.log(`  Target      : ${ENV_TAG}`)
  console.log(`  Requests    : ${REQUESTS} per endpoint  (concurrency ${CONCURRENCY}, warmup ${WARMUP_REQS})`)
  console.log()

  const results = []
  for (const ep of ENDPOINTS) {
    const url = BASES[ep.base] + ep.path
    process.stdout.write(`  ${ep.name.padEnd(40)} `)
    // Warmup
    for (let i = 0; i < WARMUP_REQS; i++) await timed(url)
    // Bench
    const { samples, errors } = await bench(url, REQUESTS, CONCURRENCY)
    const stats = {
      p50: median(samples),
      p95: pctile(samples, 95),
      p99: pctile(samples, 99),
      ok:  samples.length,
      err: errors.length,
    }
    console.log(
      `p50 ${colorMs(stats.p50,  60).padEnd(20)} ` +
      `p95 ${colorMs(stats.p95, 200).padEnd(20)} ` +
      `p99 ${colorMs(stats.p99, 500).padEnd(20)} ` +
      DIM(`(ok=${stats.ok}${errors.length ? `, err=${errors.length}` : ''})`)
    )
    results.push({ name: ep.name, url, base: ep.base, stats, errors: errors.slice(0, 5) })
  }
  console.log()

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `backend-p95-${ENV_TAG}-${isoStamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    timestamp:   startedAt.toISOString(),
    env:         ENV_TAG,
    bases:       BASES,
    requests:    REQUESTS,
    concurrency: CONCURRENCY,
    warmup:      WARMUP_REQS,
    results,
  }, null, 2))
  console.log(`  Saved → ${outPath.replace(process.cwd() + '/', '')}\n`)
}

run().catch(err => { console.error(err.stack || err.message); process.exit(1) })
