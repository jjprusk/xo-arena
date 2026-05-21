// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Training worker entry point — A3b.1 spike.
 *
 * Boots a BullMQ Worker that listens on the `training` queue and routes
 * each job to the matching handler. Runs as a separate Node process from
 * the backend API (in local Docker compose: `training-worker` service;
 * in prod: the new `xo-training-*` Fly app).
 *
 * Shutdown: SIGTERM closes the worker gracefully — any in-flight job is
 * allowed to settle. A3b.4 will add SIGTERM checkpoint coordination for
 * the real training loop.
 */
import 'dotenv/config'
import { Worker } from 'bullmq'
import IORedis from 'ioredis'
import logger from '../logger.js'
import { TRAINING_QUEUE_NAME } from './trainingQueue.js'
import { handlePing } from './jobs/ping.js'
import { handleTrainingStart } from './jobs/trainingStart.js'
import { initSignalBus, requestPause } from '../lib/signalBus.js'
import { readWorkerOptions } from './workerOptions.js'
import { getActiveSessions } from './activeSessions.js'

const HANDLERS = {
  'ping':           handlePing,
  'training:start': handleTrainingStart,
}

async function dispatch(job) {
  const handler = HANDLERS[job.name]
  if (!handler) throw new Error(`unknown training job: ${job.name}`)
  return handler(job)
}

async function main() {
  const url = process.env.REDIS_URL
  if (!url) {
    logger.error('REDIS_URL not set — training worker cannot start')
    process.exit(1)
  }
  const connection = new IORedis(url, { maxRetriesPerRequest: null })
  connection.on('error', err => logger.error({ err }, 'training worker Redis error'))

  // A3b.2b — the worker is always a signalBus subscriber so backend-side
  // pauseSession/cancelSession reach the training loop running in this
  // process. The same module's in-memory Sets are read by `_runTraining`.
  await initSignalBus({ mode: 'redis' })

  // A3b.3 — concurrency + queue rate limit are SystemConfig-driven so an
  // admin can tune throughput without a redeploy. See workerOptions.js
  // for keys and defaults.
  const opts = await readWorkerOptions()
  logger.info(
    { concurrency: opts.concurrency, jobsPerSecond: opts.limiter.max },
    'training worker options resolved'
  )
  const worker = new Worker(TRAINING_QUEUE_NAME, dispatch, {
    connection,
    concurrency: opts.concurrency,
    limiter:     opts.limiter,
  })

  worker.on('ready',     ()    => logger.info({ queue: TRAINING_QUEUE_NAME }, 'training worker ready'))
  worker.on('completed', (job) => logger.info({ jobId: job.id, name: job.name }, 'training job completed'))
  worker.on('failed',    (job, err) => logger.error({ jobId: job?.id, name: job?.name, err }, 'training job failed'))

  // A3b.4 — graceful shutdown. For every in-flight training session,
  // raise the signalBus pause flag so the loop's next tick force-writes
  // a checkpoint and flips the row to PENDING + pausedAt. Then await
  // worker.close() — BullMQ won't let it resolve until each active job
  // either completes or throws. Because we paused first, the job
  // resolves normally (it sees the flag, force-checkpoints, returns).
  //
  // If worker.close() outruns its grace period, BullMQ marks any still
  // in-flight job stalled — and the next worker that picks it up will
  // resume from the checkpoint we just wrote. Either way, no work is
  // lost between checkpoints.
  let shuttingDown = false
  const shutdown = async (sig) => {
    if (shuttingDown) return
    shuttingDown = true
    const active = getActiveSessions()
    logger.info({ sig, activeSessions: active.length }, 'training worker shutting down')
    for (const sessionId of active) {
      try {
        requestPause(sessionId)
        logger.info({ sessionId }, 'pause requested for in-flight session')
      } catch (err) {
        logger.error({ err, sessionId }, 'failed to request pause during shutdown')
      }
    }
    try { await worker.close() } catch (err) { logger.error({ err }, 'worker close failed') }
    try { connection.disconnect() } catch {}
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

main().catch(err => {
  logger.error({ err }, 'training worker crashed at boot')
  process.exit(1)
})
