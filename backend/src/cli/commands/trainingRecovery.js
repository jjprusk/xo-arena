// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// A3a.9 crash-recovery QA harness.
//
//   um training-recovery start              → launches a Quick qlearning session,
//                                             waits for the first checkpoint to land,
//                                             prints the session id and the "crash"
//                                             command to run next.
//   um training-recovery verify --session   → polls the session, asserts that the
//                                             orphan resumer picked it up after the
//                                             restart and the run finished cleanly.
//
// Designed to be re-run any time the training pipeline changes. The two-step
// split is forced by the test scenario itself: the runner is inside the very
// thing being restarted, so it can't observe its own death.

import db from '../lib/db.js'
import { ok, fail, umEnv } from '../lib/safety.js'
import { GAME_IDS } from '../../constants/games.js'

const SEED_USERNAME = 'qa-recovery-seed'
const SEED_BOT_NAME = 'QA Recovery Bot'
const SKILL_NAME    = 'QA Recovery Skill'

// QA harness delay is 60ms/episode (see backendBaseUrl/start endpoint),
// so 5000 episodes = ~300s total. After the first checkpoint at ~60s the
// operator restarts; verify watches the remaining ~240s. Generous slack.
const FIRST_CHECKPOINT_TIMEOUT_MS = 5 * 60 * 1000
const RESUME_TIMEOUT_MS           = 8 * 60 * 1000
const POLL_INTERVAL_MS            = 2000

function colorize(label, color) {
  const codes = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m' }
  return `${codes[color] ?? ''}${label}\x1b[0m`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function restartCommandFor(env) {
  if (env === 'staging') return 'fly apps restart xo-backend-staging'
  if (env === 'prod')    return 'fly apps restart xo-backend-prod'
  return 'docker compose restart backend'
}

/**
 * Backend base URL for the QA endpoint. We POST to the backend's HTTP
 * server (not the local CLI process) so the training loop lives in the
 * long-running backend — exactly the process the operator will restart.
 */
function backendBaseUrl(env) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL
  if (env === 'staging') return 'https://xo-backend-staging.fly.dev'
  if (env === 'prod')    return 'https://xo-backend-prod.fly.dev'
  return 'http://backend:3000'  // inside docker-compose network
}

/**
 * Pure state-machine helper for `verify`. Given a snapshot of the session +
 * botSkill, returns one of:
 *   { kind: 'pass',     anomalies: [...] }  — recovery succeeded (possibly
 *                                              with non-fatal anomalies to flag)
 *   { kind: 'fail',     reason: string }    — recovery clearly broken
 *   { kind: 'continue' }                    — still waiting; keep polling
 * Exported for unit tests. Keeps the I/O side and the decision side separable.
 */
export function evaluateVerifyState({ session, botSkill, startedFromCheckpoint }) {
  if (!session) return { kind: 'fail', reason: 'session disappeared' }
  if (session.status === 'COMPLETED') {
    const reachedEnd = session.checkpointEpisode >= session.iterations - 1000
    const summaryPopulated = session.summary
      && typeof session.summary === 'object'
      && Object.keys(session.summary).length > 0
    const completedWork = reachedEnd || summaryPopulated
    const skillUnlocked = botSkill?.status === 'IDLE'
    const anomalies = []
    if (!completedWork) anomalies.push('completed without finishing iterations')
    if (!skillUnlocked) anomalies.push(`BotSkill.status=${botSkill?.status} (expected IDLE)`)
    if (startedFromCheckpoint == null) anomalies.push('no checkpoint at start of verify')
    return { kind: 'pass', anomalies }
  }
  if (session.status === 'FAILED') {
    return { kind: 'fail', reason: `session FAILED. summary=${JSON.stringify(session.summary)}` }
  }
  if (session.status === 'CANCELLED') {
    return { kind: 'fail', reason: `session CANCELLED externally. summary=${JSON.stringify(session.summary)}` }
  }
  return { kind: 'continue' }
}

/**
 * Idempotent: returns the seed user + N distinct skills. Each skill gets its
 * own session, so N=3 lets us prove the orphan resumer handles multiple
 * concurrent recoveries. Skills have `createdBy=null` so the per-user
 * concurrency cap is skipped (mirrors admin-seeded behaviour).
 */
async function ensureSeedUserAndSkills(count = 1) {
  let user = await db.user.findUnique({ where: { username: SEED_USERNAME } })
  if (!user) {
    user = await db.user.create({
      data: {
        username:    SEED_USERNAME,
        email:       `${SEED_USERNAME}@arena.test`,
        displayName: 'QA Recovery Seed',
        isBot:       false,
      },
    })
  }

  const skills = []
  for (let i = 1; i <= count; i++) {
    const name = count === 1 ? SKILL_NAME : `${SKILL_NAME} ${i}`
    let skill = await db.botSkill.findFirst({ where: { name, createdBy: null } })
    if (!skill) {
      skill = await db.botSkill.create({
        data: {
          name,
          algorithm: 'qlearning',
          gameId:    GAME_IDS.TIC_TAC_TOE,
          weights:   {},
          config:    {},
          status:    'IDLE',
          createdBy: null,
        },
      })
    } else if (skill.status === 'TRAINING') {
      // Stale lock from a previous failed run — unstick.
      skill = await db.botSkill.update({
        where: { id: skill.id },
        data:  { status: 'IDLE' },
      })
    }
    skills.push(skill)
  }
  return { user, skills }
}

/** Remove any stale RUNNING/PENDING sessions left behind by a previous run. */
async function cleanupStaleSessions(skillId) {
  const stale = await db.trainingSession.findMany({
    where: { modelId: skillId, status: { in: ['RUNNING', 'PENDING'] } },
  })
  if (stale.length === 0) return 0
  await db.trainingSession.updateMany({
    where: { id: { in: stale.map(s => s.id) } },
    data:  { status: 'CANCELLED', completedAt: new Date(),
             summary: { cancelledBy: 'um training-recovery start (stale cleanup)' } },
  })
  return stale.length
}

/**
 * Fetch session status(es) over HTTP via the QA endpoint. Plural input,
 * map output keyed by sessionId. Throws on any network / auth error.
 */
async function fetchStatuses(baseUrl, qaSecret, sessionIds) {
  const url = `${baseUrl}/api/v1/admin/qa/training-recovery/status?` +
    sessionIds.map(id => `sessionId=${encodeURIComponent(id)}`).join('&')
  const res = await fetch(url, { headers: { 'x-qa-secret': qaSecret } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`status fetch failed (${res.status}): ${body}`)
  }
  const { sessions } = await res.json()
  const byId = {}
  for (const s of sessions) byId[s.sessionId] = s
  return byId
}

async function waitForFirstCheckpoint(baseUrl, qaSecret, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastReportedEpisode = -1
  while (Date.now() < deadline) {
    const map = await fetchStatuses(baseUrl, qaSecret, [sessionId])
    const s = map[sessionId]
    if (!s) throw new Error(`session ${sessionId} disappeared`)
    if (s.status === 'FAILED' || s.status === 'CANCELLED') {
      throw new Error(`session ${sessionId} entered ${s.status} before first checkpoint`)
    }
    if (s.checkpointEpisode != null && s.checkpointEpisode >= 1000) {
      return s.checkpointEpisode
    }
    if (s.checkpointEpisode !== lastReportedEpisode) {
      process.stderr.write(colorize(`  …episode ${s.checkpointEpisode ?? 0}\n`, 'dim'))
      lastReportedEpisode = s.checkpointEpisode
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`timed out waiting for first checkpoint (${timeoutMs}ms)`)
}

async function startCmd(opts) {
  const env = umEnv ?? 'local'
  const count = Math.max(1, Math.min(parseInt(opts.count, 10) || 1, 8))
  console.error(colorize(`[ training-recovery ]`, 'yellow') + ` env=${env} count=${count}`)

  const qaSecret = process.env.QA_SECRET
  if (!qaSecret) {
    throw new Error('QA_SECRET env var is required (set in .env / .env.<name>)')
  }
  const baseUrl = backendBaseUrl(env)

  // The endpoint now also handles seed prep when called with {slot:N},
  // so the CLI doesn't need direct DB access — required for remote envs
  // (staging/prod) where the CLI can't reach the database.
  const started = await Promise.all(Array.from({ length: count }, (_, i) => i + 1).map(async (slot) => {
    const res = await fetch(`${baseUrl}/api/v1/admin/qa/training-recovery/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-qa-secret': qaSecret },
      body:    JSON.stringify({ slot, delayMs: 60 }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`backend rejected start for slot ${slot} (${res.status}): ${body}`)
    }
    const session = await res.json()
    session.id = session.sessionId
    return { slot, session }
  }))

  for (const { slot, session } of started) {
    process.stderr.write(`Started session ${colorize(session.id, 'green')} on skill ${session.skillId} (slot ${slot})\n`)
  }
  process.stderr.write(`Waiting for first checkpoint on all ${count} session(s) (timeout ${FIRST_CHECKPOINT_TIMEOUT_MS / 1000}s)…\n`)

  // Wait for every session to hit its first checkpoint. Partial-success is
  // useful diagnostic data so we settle all, then report.
  const results = await Promise.allSettled(
    started.map(r => waitForFirstCheckpoint(baseUrl, qaSecret, r.session.id, FIRST_CHECKPOINT_TIMEOUT_MS))
  )
  let anyFailed = false
  results.forEach((r, idx) => {
    const sid = started[idx].session.id
    if (r.status === 'fulfilled') {
      ok(`[${sid}] checkpoint landed at episode ${r.value}`)
    } else {
      anyFailed = true
      fail(`[${sid}] ${r.reason?.message ?? r.reason}`)
    }
  })
  if (anyFailed) {
    throw new Error('one or more sessions failed to checkpoint — see above')
  }

  const sessionIds = started.map(r => r.session.id)
  const verifyCmd = `um training-recovery verify ${sessionIds.map(id => `--session ${id}`).join(' ')}`

  process.stderr.write('\n')
  process.stderr.write(colorize('Next steps:', 'yellow') + '\n')
  process.stderr.write(`  1. Trigger a "crash":  ${colorize(restartCommandFor(env), 'green')}\n`)
  process.stderr.write(`  2. Verify recovery:    ${colorize(verifyCmd, 'green')}\n`)
  if (env !== 'local') {
    process.stderr.write(`     (prepend --env ${env} after \`um\`)\n`)
  }

  // Space-separated session ids on stdout for shell piping.
  console.log(sessionIds.join(' '))
}

async function verifyCmd(opts) {
  const sessionIds = Array.isArray(opts.session) ? opts.session : [opts.session].filter(Boolean)
  if (sessionIds.length === 0) {
    fail('--session <id> is required (repeat the flag for multiple sessions)')
    return
  }
  const env = umEnv ?? 'local'
  console.error(colorize(`[ training-recovery ]`, 'yellow') + ` env=${env} sessions=${sessionIds.length}`)

  const qaSecret = process.env.QA_SECRET
  if (!qaSecret) throw new Error('QA_SECRET env var is required')
  const baseUrl = backendBaseUrl(env)

  // Snapshot the checkpointEpisode each session was at when verify started.
  // Used both as the "resumed from" diagnostic + to flag sessions that have
  // no checkpoint at all (no resume possible).
  const initialMap = await fetchStatuses(baseUrl, qaSecret, sessionIds)
  const initial = {}
  for (const sid of sessionIds) {
    const row = initialMap[sid]
    if (!row) { fail(`session ${sid} not found`); return }
    if (!row.checkpointEpisode) {
      fail(`session ${sid} has no checkpoint — did 'start' actually wait for one? (last status=${row.status})`)
      return
    }
    initial[sid] = row.checkpointEpisode
  }

  process.stderr.write(`Polling ${sessionIds.length} session(s) for resume → completion (timeout ${RESUME_TIMEOUT_MS / 1000}s)…\n`)
  const deadline = Date.now() + RESUME_TIMEOUT_MS
  const pending = new Set(sessionIds)
  const results = {}   // sessionId → { decision, finalState, botSkillStatus }
  const lastSeen = {}  // sessionId → { status, episode }

  while (pending.size > 0 && Date.now() < deadline) {
    const map = await fetchStatuses(baseUrl, qaSecret, [...pending])
    for (const sid of [...pending]) {
      const s = map[sid]
      if (!s) {
        results[sid] = { decision: { kind: 'fail', reason: 'disappeared' }, finalState: null, botSkillStatus: null }
        pending.delete(sid)
        continue
      }
      const seen = lastSeen[sid] ?? { status: null, episode: null }
      if (s.status !== seen.status || s.checkpointEpisode !== seen.episode) {
        process.stderr.write(colorize(
          `  [${sid}] status=${s.status} checkpoint=${s.checkpointEpisode ?? 'null'}\n`, 'dim'))
        lastSeen[sid] = { status: s.status, episode: s.checkpointEpisode }
      }
      if (s.status === 'COMPLETED' || s.status === 'FAILED' || s.status === 'CANCELLED') {
        const decision = evaluateVerifyState({
          session: s,
          botSkill: { status: s.botSkillStatus },
          startedFromCheckpoint: initial[sid],
        })
        results[sid] = { decision, finalState: s, botSkillStatus: s.botSkillStatus }
        pending.delete(sid)
      }
    }
    if (pending.size > 0) await sleep(POLL_INTERVAL_MS)
  }

  // Anything still in `pending` is a timeout fail.
  for (const sid of pending) {
    results[sid] = {
      decision: { kind: 'fail', reason: `still ${lastSeen[sid]?.status} after ${RESUME_TIMEOUT_MS / 1000}s` },
      finalState: null, botSkill: null,
    }
  }

  let passes = 0, fails = 0
  for (const sid of sessionIds) {
    const { decision, finalState, botSkillStatus } = results[sid]
    if (decision.kind === 'pass') {
      passes++
      const anomalyNote = decision.anomalies.length > 0 ? ` (anomalies: ${decision.anomalies.join('; ')})` : ''
      ok(`[${sid}] PASSED — resumed from ep ${initial[sid]} → final ep ${finalState?.checkpointEpisode}/${finalState?.iterations}, skill ${botSkillStatus}${anomalyNote}`)
    } else {
      fails++
      fail(`[${sid}] FAILED — ${decision.reason}`)
    }
  }
  process.stderr.write('\n')
  if (fails === 0) {
    ok(`All ${passes}/${sessionIds.length} sessions recovered.`)
  } else {
    fail(`${fails}/${sessionIds.length} session(s) failed to recover.`)
  }
}

export function trainingRecoveryCommand(program) {
  const cmd = program
    .command('training-recovery')
    .description('A3a.9 crash-recovery QA harness (start + verify)')

  // Repeatable --session collector for verify (commander treats the variadic
  // function as accumulating values across all --session flags).
  const collect = (value, prior) => prior.concat([value])

  cmd
    .command('start')
    .description('Start N Quick training sessions and wait for first checkpoint on each')
    .option('--count <n>', 'Number of concurrent sessions to start (1–8, default 1)', '1')
    .action(async (opts) => {
      try { await startCmd(opts) } catch (err) { fail(err.message) }
    })

  cmd
    .command('verify')
    .description('Poll one or more sessions until each completes after a backend restart')
    .requiredOption('--session <id>', 'Session id from `start` (repeat for multiple)', collect, [])
    .action(async (opts) => {
      try { await verifyCmd(opts) } catch (err) { fail(err.message) }
    })
}
