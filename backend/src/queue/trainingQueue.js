// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Training queue — producer-side handle used by backend routes/services.
 *
 * A3b.1 (spike): single BullMQ queue, one job name (`ping`). Future PRs
 * (A3b.2a/2b) add the real `training:start` job and route mlService
 * through this same queue.
 *
 * Why a thin wrapper module instead of constructing the Queue inline at
 * each call site: tests can swap the export, and we get a single place
 * to apply queue-wide defaults (job options, removal policy) when those
 * arrive in A3b.4 (retry/dead-letter) and A3b.5 (observability).
 */
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import logger from '../logger.js'

export const TRAINING_QUEUE_NAME = 'training'

let _queue       = null
let _connection  = null

function ensureConnection() {
  if (_connection) return _connection
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL not set — training queue disabled')
  // BullMQ requires `maxRetriesPerRequest: null` on the producer
  // connection so internal commands don't get cancelled mid-flight.
  _connection = new IORedis(url, { maxRetriesPerRequest: null })
  _connection.on('error', err => logger.error({ err }, 'training queue Redis error'))
  return _connection
}

export function getTrainingQueue() {
  if (_queue) return _queue
  _queue = new Queue(TRAINING_QUEUE_NAME, { connection: ensureConnection() })
  return _queue
}

/**
 * Enqueue a ping job — the spike's smoke test. Returns the BullMQ Job.
 *
 * @param {string} message — payload visible to the worker handler.
 */
export async function enqueuePing(message) {
  const queue = getTrainingQueue()
  return queue.add('ping', { message, enqueuedAt: Date.now() })
}

// Test-only: close producer connections so vitest can exit cleanly.
export async function _closeTrainingQueueForTests() {
  if (_queue) { await _queue.close(); _queue = null }
  if (_connection) { _connection.disconnect(); _connection = null }
}
