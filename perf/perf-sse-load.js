#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — Concurrent SSE Load Benchmark (Gap #3 + Phase 5 evidence)
 *
 * Companion to doc/Performance_Plan_v2.md, §F8 gap #3 (Live SSE under
 * realistic load) and §F4 (Phase 5 SSE round-trip decomposition).
 *
 * `perf-sse-rtt.js` measures **one** isolated move at a time. That tells
 * us the floor of the realtime path; it does not tell us whether the
 * 383 ms p50 publish→pickup we see on quiet prod is a static fanout
 * cost or a queueing artifact that gets worse under load. This script
 * answers that by spinning up N concurrent virtual users, each playing
 * a full HvB game, and capturing the same `Server-Timing` (`lookup`,
 * `apply`) and `_t` breadcrumb (`publishToPickupMs`, `pickupToWriteMs`)
 * fields per move — but tagged with the concurrency level seen at the
 * moment that move was observed.
 *
 * Output is stratified by load so we can read off:
 *   - publish→pickup p50/p95 at 1, 5, 10, 25, 50 concurrent
 *   - apply p95 (DB write contention)
 *   - bot move total (broker pickup→write under fan-out)
 *
 * Usage:
 *   node perf/perf-sse-load.js                              # local, c=5, 3 moves
 *   node perf/perf-sse-load.js --target=staging --concurrency=10
 *   node perf/perf-sse-load.js --target=staging --concurrency=25 --moves=4
 *   node perf/perf-sse-load.js --sweep=1,5,10,25 --target=staging
 *
 * --sweep=A,B,C  runs the harness once per concurrency level and emits
 *                 a single combined JSON so the F8 evidence table can
 *                 be filled in from one invocation. Each level uses the
 *                 same per-user move count.
 *
 * Output:
 *   perf/baselines/sse-load-<env>-<isoTimestamp>.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const args = process.argv.slice(2)
const positional = args.find(a => !a.startsWith('--'))
const TARGET      = (args.find(a => a.startsWith('--target='))?.split('=')[1]) ?? null
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '5')  || 5
const MOVES       = parseInt(args.find(a => a.startsWith('--moves='))?.split('=')[1]       ?? '3')  || 3
const RAMP_MS     = parseInt(args.find(a => a.startsWith('--ramp='))?.split('=')[1]        ?? '50') || 50
const SWEEP_RAW   = args.find(a => a.startsWith('--sweep='))?.split('=')[1] ?? null
const SWEEP       = SWEEP_RAW ? SWEEP_RAW.split(',').map(s => parseInt(s, 10)).filter(n => n > 0) : null

function resolveBase() {
  if (positional)              return positional
  if (TARGET === 'staging')    return 'https://xo-landing-staging.fly.dev'
  if (TARGET === 'prod')       return 'https://xo-landing-prod.fly.dev'
  return 'http://localhost:5174'
}
const BASE_URL = resolveBase()
const ENV_TAG  = TARGET ?? (BASE_URL.includes('staging') ? 'staging'
                : BASE_URL.includes('prod') ? 'prod' : 'local')

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
function colorMs(ms, goodTarget) {
  if (ms == null) return DIM('—')
  if (ms <= goodTarget)        return GREEN(`${String(ms).padStart(4)}ms`)
  if (ms <= goodTarget * 3)    return YELLOW(`${String(ms).padStart(4)}ms`)
  return RED(`${String(ms).padStart(4)}ms`)
}

function parseServerTiming(headerVal) {
  if (!headerVal) return {}
  const out = {}
  for (const seg of headerVal.split(',')) {
    const parts = seg.trim().split(';')
    const name = parts[0]
    for (const kv of parts.slice(1)) {
      const m = kv.trim().match(/^dur=([\d.]+)$/)
      if (m && name) out[name] = Math.round(parseFloat(m[1]))
    }
  }
  return out
}

/** Same SSE reader as perf-sse-rtt.js — duplicated to keep this script
 *  standalone (no shared imports between perf scripts today). */
function openSse(url) {
  const events = []
  const waiters = []
  let abortCtrl = new AbortController()
  let resolveOpen
  const opened = new Promise((r) => { resolveOpen = r })

  const pushEvent = (frame) => {
    const stamped = { ...frame, ts: performance.now() }
    if (waiters.length) waiters.shift()(stamped)
    else events.push(stamped)
  }

  ;(async () => {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream' }, signal: abortCtrl.signal })
    if (!res.ok || !res.body) { pushEvent({ event: 'error', data: { status: res.status } }); return }
    resolveOpen()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', curEvent = null, curData = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (line === '') {
          if (curEvent || curData) {
            let parsed = curData
            try { parsed = JSON.parse(curData) } catch {}
            pushEvent({ event: curEvent ?? 'message', data: parsed })
          }
          curEvent = null; curData = ''
        } else if (line.startsWith('event:'))  curEvent = line.slice(6).trim()
        else if (line.startsWith('data:'))     curData += (curData ? '\n' : '') + line.slice(5).trimStart()
      }
    }
  })().catch(err => pushEvent({ event: 'error', data: { err: String(err) } }))

  return {
    opened,
    nextEventMatching: async (predicate, timeoutMs = 8000) => {
      const deadline = performance.now() + timeoutMs
      while (true) {
        const remaining = deadline - performance.now()
        if (remaining <= 0) return null
        const evt = await Promise.race([
          (async () => events.length ? events.shift() : new Promise(r => waiters.push(r)))(),
          new Promise(r => setTimeout(() => r({ event: '__timeout', ts: performance.now() }), remaining)),
        ])
        if (evt.event === '__timeout') return null
        if (predicate(evt)) return evt
      }
    },
    close: () => abortCtrl.abort(),
  }
}

async function getCommunityBotId() {
  const res = await fetch(`${BASE_URL}/api/v1/bots?gameId=xo`)
  const json = await res.json()
  const bots = json.bots ?? []
  return (bots.find(b => !b.botOwnerId) ?? bots[0])?.id
}

// Move sequence — first available cell from this priority list. Center-
// first is the natural xo opening; the rest fall through if the bot took
// our preferred cell. With center + corners we always get ≥3 of our own
// moves on the board before the game terminates.
const MOVE_PRIORITY = [4, 0, 8, 2, 6, 1, 3, 5, 7]

function pickMove(boardCells, preferred) {
  // boardCells: array of 9 (null | 'X' | 'O'). preferred: array of indexes.
  for (const i of preferred) if (!boardCells[i]) return i
  for (let i = 0; i < 9; i++) if (!boardCells[i]) return i
  return -1
}

/**
 * One virtual user runs one full HvB game.
 *
 * Returns { moves: [...], failures, gameDuration } where each move record
 * carries its lookup/apply/publishToPickup/pickupToWrite/network legs and
 * the concurrency level seen at observation time.
 */
async function runOneUser({ botId, userIdx, getConcurrency }) {
  const moves = []
  let failures = 0

  // 1. Open SSE + wait for session.
  const sseStart = performance.now()
  const sse = openSse(`${BASE_URL}/api/v1/events/stream`)
  await sse.opened
  const sessionEvt = await sse.nextEventMatching(e => e.event === 'session', 8000)
  if (!sessionEvt) { sse.close(); return { moves, failures: 1, fatal: 'no-session' } }
  const sseConnectMs = Math.round(sessionEvt.ts - sseStart)
  const sessionId = sessionEvt.data?.sseSessionId
  if (!sessionId) { sse.close(); return { moves, failures: 1, fatal: 'no-session-id' } }

  // 2. Create + join HvB table.
  const createRes = await fetch(`${BASE_URL}/api/v1/rt/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SSE-Session': sessionId },
    body: JSON.stringify({ kind: 'hvb', botUserId: botId, spectatorAllowed: false }),
  })
  const create = await createRes.json()
  if (!create.slug) { sse.close(); return { moves, failures: 1, fatal: 'no-slug' } }

  const joinRes = await fetch(`${BASE_URL}/api/v1/rt/tables/${create.slug}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SSE-Session': sessionId },
    body: JSON.stringify({ role: 'player' }),
  })
  const join = await joinRes.json()
  const tableId = join.tableId
  if (!tableId) { sse.close(); return { moves, failures: 1, fatal: 'no-table-id' } }
  const stateChan = `table:${tableId}:state`

  // Track the local cell occupancy so we don't try to move into a taken cell.
  const board = Array(9).fill(null)
  let myMark = 'X' // creator is always X for hvb today
  let theirMark = 'O'

  for (let m = 0; m < MOVES; m++) {
    const cellIdx = pickMove(board, MOVE_PRIORITY)
    if (cellIdx < 0) break

    const concurrencyAtMove = getConcurrency()
    const movePostStart = performance.now()
    const moveRes = await fetch(`${BASE_URL}/api/v1/rt/tables/${create.slug}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SSE-Session': sessionId },
      body: JSON.stringify({ cellIndex: cellIdx }),
    })
    const movePostAckMs = Math.round(performance.now() - movePostStart)
    if (!moveRes.ok) { failures++; break }
    const st = parseServerTiming(moveRes.headers.get('server-timing'))

    const playerEvt = await sse.nextEventMatching(
      e => e.event === stateChan && e.data?.kind === 'moved' && e.data?.cellIndex === cellIdx,
      10000
    )
    const playerEventMs = playerEvt ? Math.round(playerEvt.ts - movePostStart) : null
    const t = playerEvt?.data?._t ?? null
    if (playerEvt) board[cellIdx] = myMark

    // Wait for bot response (next moved on same channel, different cell).
    const botEvt = await sse.nextEventMatching(
      e => e.event === stateChan && e.data?.kind === 'moved' && e.data?.cellIndex !== cellIdx,
      10000
    )
    const botMoveTotalMs = botEvt ? Math.round(botEvt.ts - movePostStart) : null
    if (botEvt && typeof botEvt.data?.cellIndex === 'number') board[botEvt.data.cellIndex] = theirMark

    moves.push({
      m, concurrency: concurrencyAtMove,
      sseConnectMs: m === 0 ? sseConnectMs : null,
      movePostAckMs, playerEventMs, botMoveTotalMs,
      lookupMs:          st.lookup ?? null,
      applyMs:           st.apply  ?? null,
      // F9 probe — granular apply bands + live pool stats. Surfaced via
      // Server-Timing as `apply.find / apply.update / apply.post / pool.*`
      // (counts smuggled through the `dur` field — see realtime.js).
      applyFindMs:       st['apply.find']   ?? null,
      applyUpdateMs:     st['apply.update'] ?? null,
      applyPostMs:       st['apply.post']   ?? null,
      poolTotal:         st['pool.total']   ?? null,
      poolIdle:          st['pool.idle']    ?? null,
      poolWaiting:       st['pool.waiting'] ?? null,
      publishToPickupMs: t?.publishToPickupMs ?? null,
      pickupToWriteMs:   t?.pickupToWriteMs   ?? null,
    })

    // Brief think-time so users aren't perfectly phase-locked. 50–150ms
    // jitter mimics a fast human clicker.
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100))

    // If the game is over, stop early.
    if (botEvt?.data?.terminal || playerEvt?.data?.terminal) break
  }

  sse.close()
  return { moves, failures, userIdx }
}

/**
 * Run one harness iteration at a fixed concurrency level. Emits a row
 * of summary stats. All move records returned for archival.
 */
async function runHarness({ botId, concurrency, label }) {
  let inflight = 0
  const getConcurrency = () => inflight

  console.log(BOLD(`  Concurrency ${String(concurrency).padStart(3)} — ${MOVES} moves/user`))
  process.stdout.write('  ')

  const promises = []
  for (let i = 0; i < concurrency; i++) {
    inflight++
    const p = runOneUser({ botId, userIdx: i, getConcurrency })
      .then(r => {
        inflight--
        if (r.fatal)        process.stdout.write(RED('!'))
        else if (r.failures) process.stdout.write(YELLOW('?'))
        else                process.stdout.write('.')
        return r
      })
      .catch(err => {
        inflight--
        process.stdout.write(RED('!'))
        return { moves: [], failures: 1, fatal: String(err?.message || err) }
      })
    promises.push(p)
    if (RAMP_MS && i + 1 < concurrency) await new Promise(r => setTimeout(r, RAMP_MS))
  }

  const results = await Promise.all(promises)
  console.log('')

  const allMoves = results.flatMap(r => r.moves || [])
  const fatalCount   = results.filter(r => r.fatal).length
  const partialCount = results.filter(r => !r.fatal && r.failures > 0).length

  function summarize(field) {
    const arr = allMoves.map(mv => mv[field]).filter(v => v != null)
    return { p50: median(arr), p95: pctile(arr, 95), p99: pctile(arr, 99), n: arr.length }
  }

  const summary = {
    movePostAck:     summarize('movePostAckMs'),
    playerEvent:     summarize('playerEventMs'),
    botMoveTotal:    summarize('botMoveTotalMs'),
    lookup:          summarize('lookupMs'),
    apply:           summarize('applyMs'),
    applyFind:       summarize('applyFindMs'),
    applyUpdate:     summarize('applyUpdateMs'),
    applyPost:       summarize('applyPostMs'),
    poolTotal:       summarize('poolTotal'),
    poolWaiting:     summarize('poolWaiting'),
    publishToPickup: summarize('publishToPickupMs'),
    pickupToWrite:   summarize('pickupToWriteMs'),
  }

  return {
    label, concurrency,
    movesObserved: allMoves.length,
    usersStarted:  concurrency,
    fatalUsers:    fatalCount,
    partialUsers:  partialCount,
    summary, allMoves,
  }
}

function printRow(level) {
  const s = level.summary
  console.log(
    `  c=${String(level.concurrency).padStart(3)}  n=${String(level.movesObserved).padStart(4)}` +
    `   apply ${colorMs(s.apply.p50, 30)}/${colorMs(s.apply.p95, 80)}` +
    `   pub→pick ${colorMs(s.publishToPickup.p50, 50)}/${colorMs(s.publishToPickup.p95, 200)}` +
    `   pick→wr ${colorMs(s.pickupToWrite.p50, 5)}/${colorMs(s.pickupToWrite.p95, 25)}` +
    `   moveAck ${colorMs(s.movePostAck.p50, 100)}/${colorMs(s.movePostAck.p95, 300)}` +
    `   bot ${colorMs(s.botMoveTotal.p50, 200)}/${colorMs(s.botMoveTotal.p95, 600)}`
  )
}

function printApplyBreakdown(level) {
  const s = level.summary
  // F9 probe: split apply into find/update/post + live pool stats. The
  // pool fields aren't real ms — they're counts smuggled through `dur`.
  console.log(
    `  c=${String(level.concurrency).padStart(3)}` +
    `   find ${colorMs(s.applyFind.p50, 5)}/${colorMs(s.applyFind.p95, 15)}` +
    `   update ${colorMs(s.applyUpdate.p50, 10)}/${colorMs(s.applyUpdate.p95, 30)}` +
    `   post ${colorMs(s.applyPost.p50, 5)}/${colorMs(s.applyPost.p95, 15)}` +
    `   pool.total ${String(s.poolTotal.p50 ?? '—').padStart(2)}/${String(s.poolTotal.p95 ?? '—').padStart(2)}` +
    `   pool.waiting ${String(s.poolWaiting.p50 ?? '—').padStart(2)}/${String(s.poolWaiting.p95 ?? '—').padStart(2)}`
  )
}

async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')

  console.log()
  console.log(BOLD('XO Arena — Concurrent SSE Load'))
  console.log(`  Target  : ${BASE_URL}  (${ENV_TAG})`)
  console.log(`  Mode    : ${SWEEP ? `sweep ${SWEEP.join(',')}` : `single c=${CONCURRENCY}`}, ${MOVES} moves/user, ${RAMP_MS}ms ramp`)
  console.log()

  const botId = await getCommunityBotId()
  if (!botId) { console.log(RED('  No community bot found — aborting')); process.exit(1) }
  console.log(DIM(`  Community bot: ${botId}`))
  console.log()

  const levels = []
  const concurrencyLevels = SWEEP || [CONCURRENCY]
  for (const c of concurrencyLevels) {
    const lv = await runHarness({ botId, concurrency: c, label: `c=${c}` })
    levels.push(lv)
    // Cooldown so consecutive levels don't bleed into each other.
    if (concurrencyLevels.length > 1) await new Promise(r => setTimeout(r, 2000))
  }

  console.log()
  console.log(BOLD('  Results — p50/p95 by load level'))
  console.log(DIM('  apply / publishToPickup / pickupToWrite / movePostAck / botMoveTotal'))
  for (const lv of levels) printRow(lv)
  console.log()
  console.log(BOLD('  Apply breakdown + pool stats — p50/p95'))
  console.log(DIM('  find / update / post / pool.total / pool.waiting (counts not ms)'))
  for (const lv of levels) printApplyBreakdown(lv)
  console.log()

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `sse-load-${ENV_TAG}-${isoStamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    timestamp: startedAt.toISOString(),
    env:       ENV_TAG,
    baseUrl:   BASE_URL,
    movesPerUser: MOVES,
    rampMs:    RAMP_MS,
    sweep:     SWEEP,
    levels:    levels.map(lv => ({
      concurrency: lv.concurrency,
      movesObserved: lv.movesObserved,
      usersStarted: lv.usersStarted,
      fatalUsers: lv.fatalUsers,
      partialUsers: lv.partialUsers,
      summary: lv.summary,
      // Keep raw moves so future analysis can re-stratify; trim noisy
      // fields if any single user's moves came back as garbage.
      moves: lv.allMoves,
    })),
  }, null, 2))
  console.log(`  Saved → ${outPath.replace(process.cwd() + '/', '')}\n`)
}

run().catch(err => { console.error(err.stack || err.message); process.exit(1) })
