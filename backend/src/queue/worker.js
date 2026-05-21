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
import { initSignalBus } from '../lib/signalBus.js'
import { readWorkerOptions } from './workerOptions.js'

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

  const shutdown = async (sig) => {
    logger.info({ sig }, 'training worker shutting down')
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
