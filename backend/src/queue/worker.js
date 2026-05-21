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

const HANDLERS = {
  ping: handlePing,
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

  const worker = new Worker(TRAINING_QUEUE_NAME, dispatch, {
    connection,
    // Single-job-at-a-time per worker for the spike. Concurrency tuning
    // lands in A3b.3 alongside the per-user cap enforcement.
    concurrency: 1,
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
