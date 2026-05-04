#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — SSE Round-Trip Latency Benchmark
 *
 * Companion to doc/Performance_Plan_v2.md, Phase 5 input.
 *
 * Measures three latencies that together cover the realtime hot path:
 *   1. SSE connect → first session frame (`event: session`)
 *   2. POST `/rt/tables/<slug>/move` → SSE `state` event arrival on same client
 *   3. Bot response: previous SSE event → next SSE event (server compute +
 *      bot move POST + dispatch latency)
 *
 * F4 decomposition (since Performance_Plan_v2 §F4): also captures the
 * `Server-Timing` header on the move POST (`lookup`, `apply`) and the `_t`
 * breadcrumbs the broker injects into SSE payloads (`publishToPickupMs`,
 * `pickupToWriteMs`). With those, the SSE round-trip splits into:
 *
 *   POST RTT   = network_out + lookup + apply + network_back
 *   SSE leg    = (publish→pickup) Redis fanout
 *              + (pickup→write)   broker loop
 *              + network_to_client
 *
 * Runs as a guest. Spins up a fresh HvB table per run, plays one move,
 * captures the player-state event and the bot-response event, then closes.
 *
 * Usage:
 *   node perf/perf-sse-rtt.js                         # localhost
 *   node perf/perf-sse-rtt.js --target=staging        # via xo-landing-staging.fly.dev
 *   node perf/perf-sse-rtt.js --target=prod
 *   node perf/perf-sse-rtt.js --runs=50               # default 20
 *
 * Output:
 *   perf/baselines/sse-rtt-<env>-<isoTimestamp>.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const args = process.argv.slice(2)
const positional = args.find(a => !a.startsWith('--'))
const TARGET = (args.find(a => a.startsWith('--target='))?.split('=')[1]) ?? null
const RUNS   = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '20') || 20

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
  if (ms <= goodTarget) return GREEN(`${ms}ms`)
  if (ms <= goodTarget * 3) return YELLOW(`${ms}ms`)
  return RED(`${ms}ms`)
}

/** Parse a `Server-Timing` header value into `{ name: durMs }`. */
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

/**
 * Open an SSE stream and return a controller that hands out parsed event
 * frames to whoever calls `nextEvent()`. Each event is timestamped with
 * `now()` *as soon as the data line lands*, so RTT measurement is honest.
 */
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
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: abortCtrl.signal,
    })
    if (!res.ok || !res.body) {
      pushEvent({ event: 'error', data: { status: res.status } })
      return
    }
    resolveOpen()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let curEvent = null
    let curData  = ''
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
        } else if (line.startsWith('event:')) {
          curEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          curData += (curData ? '\n' : '') + line.slice(5).trimStart()
        }
      }
    }
  })().catch(err => pushEvent({ event: 'error', data: { err: String(err) } }))

  return {
    opened,
    nextEvent: () => {
      if (events.length) return Promise.resolve(events.shift())
      return new Promise(r => waiters.push(r))
    },
    nextEventMatching: async (predicate, timeoutMs = 8000) => {
      const deadline = performance.now() + timeoutMs
      while (true) {
        const remaining = deadline - performance.now()
        if (remaining <= 0) return null
        const evt = await Promise.race([
          (async () => {
            if (events.length) return events.shift()
            return new Promise(r => waiters.push(r))
          })(),
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
  // Prefer a non-owned built-in.
  return (bots.find(b => !b.botOwnerId) ?? bots[0])?.id
}

async function singleRun(botId) {
  // 1. Open SSE; wait for session frame.
  const sseStart = performance.now()
  const sse = openSse(`${BASE_URL}/api/v1/events/stream`)
  await sse.opened
  const sessionEvt = await sse.nextEventMatching(e => e.event === 'session', 5000)
  if (!sessionEvt) { sse.close(); return null }
  const sseConnectMs = Math.round(sessionEvt.ts - sseStart)
  const sessionId = sessionEvt.data?.sseSessionId
  if (!sessionId) { sse.close(); return null }

  // 2. Create HvB table.
  const createRes = await fetch(`${BASE_URL}/api/v1/rt/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SSE-Session': sessionId },
    body: JSON.stringify({ kind: 'hvb', botUserId: botId, spectatorAllowed: true }),
  })
  const create = await createRes.json()
  if (!create.slug) { sse.close(); return null }

  // 3. Join (we want the canonical tableId for the channel filter).
  const joinRes = await fetch(`${BASE_URL}/api/v1/rt/tables/${create.slug}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SSE-Session': sessionId },
    body: JSON.stringify({ role: 'player' }),
  })
  const join = await joinRes.json()
  const tableId = join.tableId
  if (!tableId) { sse.close(); return null }
  const stateChan = `table:${tableId}:state`

  // 4. Player move (cell 4) — time POST → state event arrival.
  const movePostStart = performance.now()
  const moveRes = await fetch(`${BASE_URL}/api/v1/rt/tables/${create.slug}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SSE-Session': sessionId },
    body: JSON.stringify({ cellIndex: 4 }),
  })
  const movePostAckMs = Math.round(performance.now() - movePostStart)
  if (!moveRes.ok) { sse.close(); return null }

  // F4: split the POST RTT via the `Server-Timing` header the move handler
  // emits. `lookup` = caller resolution + db.table.findFirst.
  // `apply` = applyMove (DB writes + game logic + Redis XADD publish).
  const st = parseServerTiming(moveRes.headers.get('server-timing'))

  // First state event after move POST is the player's "moved" echo.
  const playerEvt = await sse.nextEventMatching(
    e => e.event === stateChan && e.data?.kind === 'moved' && e.data?.cellIndex === 4,
    8000
  )
  const playerEventMs = playerEvt ? Math.round(playerEvt.ts - movePostStart) : null

  // F4: split the SSE delivery via the `_t` breadcrumbs the broker injects.
  // `publishToPickupMs` = Redis fanout (XADD → broker XREAD wakes).
  // `pickupToWriteMs`   = broker loop iteration + filter + before res.write.
  const t = playerEvt?.data?._t ?? null

  // 5. Bot response — next moved event from the same channel. Time from
  // the original POST start so we capture the *total* end-to-end latency
  // a real player feels: their click → bot's move on the board.
  // (Measuring from the player's SSE event isn't useful because the
  // backend dispatches both events synchronously in the same handler;
  // they always arrive ~0ms apart from the SSE consumer's POV.)
  const botEvt = await sse.nextEventMatching(
    e => e.event === stateChan && e.data?.kind === 'moved' && e.data?.cellIndex !== 4,
    8000
  )
  const botMoveTotalMs = botEvt ? Math.round(botEvt.ts - movePostStart) : null

  sse.close()
  return {
    sseConnectMs,
    movePostAckMs,
    playerEventMs,
    botMoveTotalMs,
    lookupMs:          st.lookup ?? null,
    applyMs:           st.apply  ?? null,
    publishToPickupMs: t?.publishToPickupMs ?? null,
    pickupToWriteMs:   t?.pickupToWriteMs   ?? null,
  }
}

async function run() {
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')

  console.log()
  console.log(BOLD('XO Arena — SSE Round-Trip Latency'))
  console.log(`  Target  : ${BASE_URL}  (${ENV_TAG})`)
  console.log(`  Runs    : ${RUNS}`)
  console.log()

  const botId = await getCommunityBotId()
  if (!botId) { console.log(RED('  No community bot found — aborting')); process.exit(1) }
  console.log(DIM(`  Community bot: ${botId}`))
  console.log()

  const samples = {
    sseConnectMs: [], movePostAckMs: [], playerEventMs: [], botMoveTotalMs: [],
    // F4 server-internal breakdowns:
    lookupMs: [], applyMs: [], publishToPickupMs: [], pickupToWriteMs: [],
  }
  let failures = 0

  process.stdout.write('  ')
  for (let i = 0; i < RUNS; i++) {
    try {
      const r = await singleRun(botId)
      if (!r) { failures++; process.stdout.write(RED('!')); continue }
      for (const k of Object.keys(samples)) if (r[k] != null) samples[k].push(r[k])
      process.stdout.write('.')
    } catch {
      failures++
      process.stdout.write(RED('!'))
    }
  }
  console.log('\n')

  function summarize(arr) {
    return { p50: median(arr), p95: pctile(arr, 95), n: arr.length }
  }

  const summary = {
    sseConnect:       summarize(samples.sseConnectMs),
    movePostAck:      summarize(samples.movePostAckMs),
    playerEvent:      summarize(samples.playerEventMs),
    botMoveTotal:     summarize(samples.botMoveTotalMs),
    lookup:           summarize(samples.lookupMs),
    apply:            summarize(samples.applyMs),
    publishToPickup:  summarize(samples.publishToPickupMs),
    pickupToWrite:    summarize(samples.pickupToWriteMs),
  }

  // F4 derived: per-run network estimates.
  const postNetSamples = []
  const sseNetSamples  = []
  for (let i = 0; i < samples.movePostAckMs.length; i++) {
    const ack = samples.movePostAckMs[i]
    const lk  = samples.lookupMs[i]
    const ap  = samples.applyMs[i]
    if (ack != null && lk != null && ap != null) postNetSamples.push(Math.max(0, ack - lk - ap))
  }
  for (let i = 0; i < samples.playerEventMs.length; i++) {
    const ev  = samples.playerEventMs[i]
    const ack = samples.movePostAckMs[i]
    const p2p = samples.publishToPickupMs[i]
    const p2w = samples.pickupToWriteMs[i]
    if (ev != null && ack != null && p2p != null && p2w != null) {
      // SSE event is referenced from movePostStart, ack ≈ same wallclock as
      // publish (publish is the last step in apply). So ack→event includes
      // p2p + p2w + sse_network.
      sseNetSamples.push(Math.max(0, ev - ack - p2p - p2w))
    }
  }
  summary.postNetwork = summarize(postNetSamples)
  summary.sseNetwork  = summarize(sseNetSamples)

  console.log(BOLD('  Phase                       p50         p95     n'))
  console.log(    `  SSE connect → session       ${colorMs(summary.sseConnect.p50,    100).padEnd(20)} ${colorMs(summary.sseConnect.p95,    300).padEnd(20)} ${summary.sseConnect.n}`)
  console.log(    `  POST move → ack             ${colorMs(summary.movePostAck.p50,    60).padEnd(20)} ${colorMs(summary.movePostAck.p95,   180).padEnd(20)} ${summary.movePostAck.n}`)
  console.log(    `  POST move → SSE state evt   ${colorMs(summary.playerEvent.p50,   100).padEnd(20)} ${colorMs(summary.playerEvent.p95,   300).padEnd(20)} ${summary.playerEvent.n}`)
  console.log(    `  POST move → bot move evt    ${colorMs(summary.botMoveTotal.p50,  200).padEnd(20)} ${colorMs(summary.botMoveTotal.p95,  600).padEnd(20)} ${summary.botMoveTotal.n}`)
  console.log()
  console.log(BOLD('  F4 decomposition            p50         p95     n'))
  console.log(    `    server.lookup             ${colorMs(summary.lookup.p50,         5).padEnd(20)} ${colorMs(summary.lookup.p95,        15).padEnd(20)} ${summary.lookup.n}`)
  console.log(    `    server.apply (incl XADD)  ${colorMs(summary.apply.p50,         30).padEnd(20)} ${colorMs(summary.apply.p95,         80).padEnd(20)} ${summary.apply.n}`)
  console.log(    `    network (POST RTT − srv)  ${colorMs(summary.postNetwork.p50,   30).padEnd(20)} ${colorMs(summary.postNetwork.p95,   80).padEnd(20)} ${summary.postNetwork.n}`)
  console.log(    `    redis publish→pickup      ${colorMs(summary.publishToPickup.p50, 5).padEnd(20)} ${colorMs(summary.publishToPickup.p95, 25).padEnd(20)} ${summary.publishToPickup.n}`)
  console.log(    `    broker pickup→write       ${colorMs(summary.pickupToWrite.p50,  3).padEnd(20)} ${colorMs(summary.pickupToWrite.p95,  10).padEnd(20)} ${summary.pickupToWrite.n}`)
  console.log(    `    network (ack→event − srv) ${colorMs(summary.sseNetwork.p50,    30).padEnd(20)} ${colorMs(summary.sseNetwork.p95,    80).padEnd(20)} ${summary.sseNetwork.n}`)
  console.log()
  if (failures) console.log(YELLOW(`  ${failures} run(s) failed`))

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `sse-rtt-${ENV_TAG}-${isoStamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    timestamp: startedAt.toISOString(),
    env:       ENV_TAG,
    baseUrl:   BASE_URL,
    runs:      RUNS,
    failures,
    summary,
    samples,
  }, null, 2))
  console.log(`  Saved → ${outPath.replace(process.cwd() + '/', '')}\n`)
}

run().catch(err => { console.error(err.stack || err.message); process.exit(1) })
