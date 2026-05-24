// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Phase A exit criterion #3 — one-shot verifier proving each TTT-trainable
// algorithm can complete end-to-end on the xo-training worker process.
//
//   um training-worker verify [--algos qlearning,sarsa,...] [--iterations N]
//                             [--per-algo-timeout-sec N]
//
// Mechanism: hits the existing QA_SECRET-gated `/qa/training-worker/start`
// endpoint (which enqueues `training:start` jobs directly — the worker
// path) once per algorithm, then polls `/qa/training-recovery/status`
// until each session reaches COMPLETED / FAILED / timeout. Prints a
// pass/fail table and exits non-zero on any fail.
//
// **No matrix flip required.** The QA endpoint always routes through the
// worker, so the verifier proves "the worker process can run this algo
// end-to-end" without touching `ml.runtimeMatrix`. The matrix-routing
// decision is a separate (heavily unit-tested) layer.
//
// Importable from QA scripts: `verifyWorkerRouting(...)` is exported as a
// pure async function so a future CI/QA harness can call it directly
// without spawning the CLI.

import { ok, fail, umEnv } from '../lib/safety.js'

/** Canonical TTT-trainable algorithms covered by Phase A exit criterion #3. */
export const TTT_TRAINABLE_ALGORITHMS = [
  'qlearning', 'sarsa', 'montecarlo', 'dqn', 'alphazero',
]

/**
 * Default per-algorithm iteration counts. Tuned so each run is just past
 * the first multi-curve eval (≥1000 eps — A3a EVAL_GAP) but small enough
 * that the full sweep finishes in roughly 5–15 minutes wall-clock on
 * staging. AlphaZero is genuinely slow per-episode; everything else
 * completes in tens of seconds.
 */
const DEFAULT_ITERATIONS = {
  qlearning:  1500,
  sarsa:      1500,
  montecarlo: 1500,
  dqn:        1200,
  alphazero:  1100,
}

const POLL_INTERVAL_MS = 2000

/**
 * Per-algorithm "this engine actually ran" assertions over the session
 * summary. Lives here because the engine-agnostic summary writer in
 * `_finishSession` packs every session into a uniform shape — same
 * fields for QL and AZ — so just checking `status === 'COMPLETED'`
 * blesses a session that silently ran QLearning in place of (e.g.)
 * AlphaZero. The signatures below pin a value the wrong engine
 * couldn't produce:
 *
 *   - **tabular** (qlearning/sarsa/montecarlo): expects a non-trivial
 *     state table AND visible epsilon decay. A wrong-engine run (e.g.
 *     AZ falling through to QL) would still pass this, which is fine
 *     — we don't care if the QL-shaped engine ran for a QL-named slot.
 *   - **dqn**: DQN engine declares `get stateCount() { return 0 }`, so
 *     a stateCount > 0 here means a *tabular* engine actually ran (the
 *     pre-fix worker-side bug). Combined with the slow default DQN
 *     decay (epsilonDecay ≈ 0.9999), epsilon barely moves from 1.0;
 *     a tabular run would have decayed it to ~0.05.
 *   - **alphazero**: AZ engine declares `get epsilon() { return 0 }`
 *     AND `get stateCount() { return 0 }`. A non-zero value for either
 *     field is proof the wrong engine ran (the headline pre-fix bug).
 */
export function assertSummarySignature(algorithm, summary) {
  if (!summary || typeof summary !== 'object') return { ok: false, reason: 'no summary' }
  const { stateCount, finalEpsilon } = summary
  const alg = String(algorithm || '').toLowerCase().replace(/_/g, '')
  if (alg === 'alphazero' || alg === 'az') {
    if (stateCount > 0)   return { ok: false, reason: `stateCount=${stateCount} (AZ should be 0 — wrong engine ran)` }
    if (finalEpsilon > 0) return { ok: false, reason: `finalEpsilon=${finalEpsilon} (AZ should be 0 — wrong engine ran)` }
    return { ok: true }
  }
  if (alg === 'dqn') {
    if (stateCount > 0)            return { ok: false, reason: `stateCount=${stateCount} (DQN should be 0 — tabular engine ran)` }
    if (finalEpsilon != null && finalEpsilon < 0.5) {
      return { ok: false, reason: `finalEpsilon=${finalEpsilon} (DQN default decay is slow; <0.5 means a tabular engine ran)` }
    }
    return { ok: true }
  }
  // Tabular runners (qlearning / sarsa / montecarlo / policygradient).
  if (!(stateCount > 0)) {
    return { ok: false, reason: `stateCount=${stateCount} (tabular engine expected non-zero state coverage)` }
  }
  if (finalEpsilon != null && finalEpsilon > 0.5) {
    return { ok: false, reason: `finalEpsilon=${finalEpsilon} (tabular engine should have decayed below 0.5)` }
  }
  return { ok: true }
}

function colorize(s, color) {
  const codes = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' }
  return `${codes[color] ?? ''}${s}\x1b[0m`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function defaultBaseUrl(env) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL
  if (env === 'staging') return 'https://xo-backend-staging.fly.dev'
  if (env === 'prod')    return 'https://xo-backend-prod.fly.dev'
  return 'http://backend:3000'
}

/**
 * Kick off one session via the QA worker-start endpoint. Returns the
 * minted session id; throws with the server body on non-2xx.
 */
async function startWorkerSession({ baseUrl, qaSecret, algorithm, iterations, slot }) {
  const res = await fetch(`${baseUrl}/api/v1/admin/qa/training-worker/start`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-qa-secret': qaSecret },
    body:    JSON.stringify({ slot, algorithm, iterations, delayMs: 0 }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`start ${algorithm} → ${res.status}: ${body}`)
  }
  return res.json()
}

/**
 * Batch-fetch status for many session ids. Returned as a map keyed by
 * session id so callers can correlate without scanning an array.
 */
async function fetchStatuses(baseUrl, qaSecret, sessionIds) {
  const qs = sessionIds.map(id => `sessionId=${encodeURIComponent(id)}`).join('&')
  const res = await fetch(`${baseUrl}/api/v1/admin/qa/training-recovery/status?${qs}`, {
    headers: { 'x-qa-secret': qaSecret },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`status fetch failed (${res.status}): ${body}`)
  }
  const { sessions } = await res.json()
  return Object.fromEntries(sessions.map(s => [s.sessionId, s]))
}

/**
 * Verify each `algorithms[i]` can train to completion on the worker.
 *
 * Pure async (no `process.exit`, no I/O beyond `fetch` and the optional
 * `log` callback) so it can be imported into QA scripts, dev harnesses,
 * or CI gates without re-implementing the polling state machine.
 *
 * Returns `{ pass, fail, results }`:
 *   - `pass` / `fail`: integer counts.
 *   - `results`: one row per algorithm —
 *       `{ algorithm, sessionId, ok, status, durationMs, summary, error }`.
 *
 * The caller decides exit semantics.
 */
export async function verifyWorkerRouting({
  baseUrl,
  qaSecret,
  algorithms       = TTT_TRAINABLE_ALGORITHMS,
  iterations       = DEFAULT_ITERATIONS,
  perAlgoTimeoutMs = 15 * 60 * 1000,  // 15 min — AlphaZero is genuinely slow
  pollIntervalMs   = POLL_INTERVAL_MS,  // injectable so unit tests don't sleep 2s
  log              = () => {},
} = {}) {
  if (!qaSecret) throw new Error('qaSecret is required')
  if (!baseUrl)  throw new Error('baseUrl is required')

  const startedAt = Date.now()

  // Phase 1 — kick off every algorithm in parallel. Each gets its own
  // slot so the per-algorithm seed skills don't collide.
  log(`Kicking off ${algorithms.length} worker sessions in parallel…`)
  const started = await Promise.all(algorithms.map(async (algo, i) => {
    const itersForAlgo = iterations[algo] ?? DEFAULT_ITERATIONS[algo] ?? 1100
    try {
      const r = await startWorkerSession({
        baseUrl, qaSecret,
        algorithm:  algo,
        iterations: itersForAlgo,
        slot:       100 + i,  // 100+ avoids collision with the soak harness's 1-10 range
      })
      log(`  ${algo}: started session ${r.sessionId} (${itersForAlgo} eps)`)
      return { algorithm: algo, sessionId: r.sessionId, iterations: itersForAlgo, started: Date.now() }
    } catch (err) {
      log(`  ${algo}: FAILED to start — ${err.message}`)
      return { algorithm: algo, sessionId: null, iterations: itersForAlgo, error: err.message }
    }
  }))

  // Phase 2 — poll until every session reaches a terminal state or its
  // per-algo deadline. Polling all session ids in one round-trip keeps
  // network chatter to one request per `POLL_INTERVAL_MS` regardless of
  // how many algorithms we're verifying.
  const liveIds = started.filter(s => s.sessionId).map(s => s.sessionId)
  const idToRow = new Map(started.filter(s => s.sessionId).map(s => [s.sessionId, s]))
  const deadlines = new Map(started.filter(s => s.sessionId).map(s => [s.sessionId, s.started + perAlgoTimeoutMs]))
  const terminal = new Map()  // sessionId → final status row

  const lastSeen = new Map()
  while (liveIds.some(id => !terminal.has(id))) {
    const pending = liveIds.filter(id => !terminal.has(id))
    let map
    try {
      map = await fetchStatuses(baseUrl, qaSecret, pending)
    } catch (err) {
      log(`  status poll failed: ${err.message}; retrying`)
      await sleep(pollIntervalMs)
      continue
    }
    for (const id of pending) {
      const s = map[id]
      const meta = idToRow.get(id)
      if (!s) {
        terminal.set(id, { status: 'GONE', summary: { error: 'session disappeared' } })
        continue
      }
      const seenKey = `${s.status}@${s.checkpointEpisode ?? 0}`
      if (lastSeen.get(id) !== seenKey) {
        log(`  ${meta.algorithm}: ${s.status} checkpoint=${s.checkpointEpisode ?? 0}/${s.iterations}`)
        lastSeen.set(id, seenKey)
      }
      if (s.status === 'COMPLETED' || s.status === 'FAILED' || s.status === 'CANCELLED') {
        terminal.set(id, s)
      } else if (Date.now() > deadlines.get(id)) {
        terminal.set(id, { ...s, status: 'TIMEOUT' })
      }
    }
    if (liveIds.some(id => !terminal.has(id))) await sleep(pollIntervalMs)
  }

  // Phase 3 — assemble the result rows. Algorithms that never even
  // started land here as `ok:false` with the start-side error.
  const results = started.map(meta => {
    if (!meta.sessionId) {
      return {
        algorithm:  meta.algorithm,
        sessionId:  null,
        ok:         false,
        status:     'START_FAILED',
        durationMs: 0,
        summary:    null,
        error:      meta.error,
      }
    }
    const s = terminal.get(meta.sessionId) ?? { status: 'UNKNOWN' }
    const completed = s.status === 'COMPLETED'
    // Even a COMPLETED session can be a silent fall-through to the wrong
    // engine (the pre-fix worker bug). The signature check rejects the
    // session if the summary shape disagrees with what `algorithm` was
    // supposed to run.
    const sig = completed ? assertSummarySignature(meta.algorithm, s.summary) : null
    const isOk = completed && sig.ok
    let error = null
    if (!isOk) {
      if (completed && !sig.ok) error = sig.reason
      else if (s.summary?.error) error = s.summary.error
      else error = `terminal status=${s.status}`
    }
    return {
      algorithm:  meta.algorithm,
      sessionId:  meta.sessionId,
      ok:         isOk,
      status:     completed && !sig.ok ? 'WRONG_ENGINE' : s.status,
      durationMs: Date.now() - meta.started,
      summary:    s.summary ?? null,
      error,
    }
  })

  const pass = results.filter(r => r.ok).length
  const failCount = results.length - pass
  log(`Verifier completed in ${Math.round((Date.now() - startedAt) / 1000)}s — ${pass}/${results.length} passed`)
  return { pass, fail: failCount, results }
}

// ── CLI shell ────────────────────────────────────────────────────────────────

function formatTable(results) {
  const rows = results.map(r => ({
    algo:   r.algorithm.padEnd(11),
    status: r.status.padEnd(13),
    dur:    `${(r.durationMs / 1000).toFixed(1)}s`.padStart(8),
    sid:    r.sessionId ?? '(no session)',
    note:   r.error ?? '',
  }))
  const lines = [
    `  ${colorize('algorithm   status         duration  sessionId / error', 'bold')}`,
    ...rows.map((r, i) => {
      // Source of truth is the raw `results[i].ok`, not the padded
      // `r.status` string (a prior bug compared padded "COMPLETED   "
      // to "COMPLETED" and every row rendered as FAIL).
      const tag = results[i].ok ? colorize('PASS', 'green') : colorize('FAIL', 'red')
      return `  [${tag}] ${r.algo} ${r.status.padEnd(13)} ${r.dur}  ${r.sid}${r.note ? ` — ${r.note}` : ''}`
    }),
  ]
  return lines.join('\n')
}

async function runCli(opts) {
  const env = umEnv ?? 'local'
  const qaSecret = process.env.QA_SECRET
  if (!qaSecret) throw new Error('QA_SECRET env var is required (set in .env / .env.<name>)')
  const baseUrl = defaultBaseUrl(env)

  const algorithms = opts.algos
    ? String(opts.algos).split(',').map(s => s.trim()).filter(Boolean)
    : TTT_TRAINABLE_ALGORITHMS

  const perAlgoTimeoutMs = (parseInt(opts.perAlgoTimeoutSec, 10) || 900) * 1000

  // --iterations N applies the same count to every algorithm; finer tuning
  // happens via the importable function's per-algo `iterations` map.
  let iterations = DEFAULT_ITERATIONS
  if (opts.iterations) {
    const n = parseInt(opts.iterations, 10)
    if (n > 0) iterations = Object.fromEntries(algorithms.map(a => [a, n]))
  }

  process.stderr.write(colorize(`[ training-worker verify ]`, 'yellow') +
    ` env=${env} algos=${algorithms.join(',')} timeout=${perAlgoTimeoutMs / 1000}s/algo\n`)

  const { pass, fail: failCount, results } = await verifyWorkerRouting({
    baseUrl,
    qaSecret,
    algorithms,
    iterations,
    perAlgoTimeoutMs,
    log: (msg) => process.stderr.write(colorize(`  ${msg}\n`, 'dim')),
  })

  process.stderr.write('\n' + formatTable(results) + '\n\n')

  if (failCount === 0) {
    ok(`All ${pass}/${results.length} algorithms completed on the worker.`)
  } else {
    fail(`${failCount}/${results.length} algorithms failed — Phase A exit criterion #3 not met.`)
    process.exitCode = 1
  }
}

export function trainingWorkerVerifyCommand(program) {
  program
    .command('training-worker')
    .description('Phase A exit criterion #3 — worker-routing verifier')
    .command('verify')
    .description('Train each TTT algorithm end-to-end on the worker and report pass/fail')
    .option('--algos <list>',              'Comma-separated algorithm list (default: all five)')
    .option('--iterations <n>',            'Override iterations per algorithm (one value applied to all)')
    .option('--per-algo-timeout-sec <n>',  'Per-algorithm timeout in seconds (default: 900 = 15 min)', '900')
    .action(async (opts) => {
      try { await runCli(opts) } catch (err) { fail(err.message); process.exitCode = 1 }
    })
}
