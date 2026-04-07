/**
 * Background worker for BOT_VS_BOT tournament matches.
 *
 * Polls the Redis job queue, runs bot matches server-side,
 * and records results via completeMatch.
 */

import db from '@xo-arena/db'
import logger from '../logger.js'
import { dequeueJob, acknowledgeJob, getActiveCount, reconcileOrphans } from './botJobQueue.js'
import { runBotMatchSeries } from './botMatchRunner.js'
import { completeMatch } from '../services/tournamentService.js'

const POLL_INTERVAL_MS = 2000   // when queue has items
const IDLE_INTERVAL_MS = 5000   // when queue is empty
const DEFAULT_CONCURRENCY = 4
const DEFAULT_PACE_MS = 0

// Per-tournament last-dispatch timestamp (in-memory pace control)
const lastDispatch = new Map()  // tournamentId → timestamp

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function getSystemConfig(key, defaultValue) {
  try {
    const row = await db.systemConfig.findUnique({ where: { key } })
    return row?.value ?? defaultValue
  } catch {
    return defaultValue
  }
}

async function applyPaceDelay(tournamentId) {
  const globalPaceMs = await getSystemConfig('tournament.botMatch.defaultPaceMs', DEFAULT_PACE_MS)

  // Per-tournament paceMs overrides global
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { paceMs: true },
  })
  const effectivePace = tournament?.paceMs ?? globalPaceMs
  if (effectivePace <= 0) return

  const last = lastDispatch.get(tournamentId) ?? 0
  const elapsed = Date.now() - last
  const wait = effectivePace - elapsed
  if (wait > 0) await sleep(wait)
  lastDispatch.set(tournamentId, Date.now())
}

async function runJob(job) {
  try {
    logger.info({ matchId: job.matchId, tournamentId: job.tournamentId }, 'Bot worker: running match')

    // Mark match IN_PROGRESS
    await db.tournamentMatch.update({
      where: { id: job.matchId },
      data: { status: 'IN_PROGRESS' },
    })

    const result = await runBotMatchSeries(job.matchId)

    await completeMatch(job.matchId, result.winnerId, {
      p1Wins: result.p1Wins,
      p2Wins: result.p2Wins,
      drawGames: result.drawGames,
    })

    await acknowledgeJob(job.matchId)
    logger.info({ matchId: job.matchId }, 'Bot worker: match completed')
  } catch (err) {
    logger.error({ err, matchId: job.matchId }, 'Bot worker: match failed')
    // Do NOT acknowledge — job stays in active, will be reconciled on next restart
  }
}

let _running = false

export async function startBotWorker() {
  if (_running) return
  _running = true

  logger.info('Bot worker started')

  // Reconcile orphaned jobs from previous run
  await reconcileOrphans()

  // Poll loop
  workerLoop().catch(err => logger.error({ err }, 'Bot worker loop crashed'))
}

async function workerLoop() {
  while (_running) {
    try {
      const concurrencyLimit = await getSystemConfig(
        'tournament.botMatch.globalConcurrencyLimit',
        DEFAULT_CONCURRENCY
      )
      const activeCount = await getActiveCount()

      if (activeCount >= concurrencyLimit) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      const job = await dequeueJob()
      if (!job) {
        await sleep(IDLE_INTERVAL_MS)
        continue
      }

      await applyPaceDelay(job.tournamentId)

      // Fire and forget — don't await; allows fetching next job immediately
      runJob(job)

      await sleep(POLL_INTERVAL_MS)
    } catch (err) {
      logger.error({ err }, 'Bot worker: poll error')
      await sleep(IDLE_INTERVAL_MS)
    }
  }
}

export function stopBotWorker() {
  _running = false
}
