// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * `ping` job handler — A3b.1 spike smoke test.
 *
 * Pure function, no Redis, no Prisma — so it's unit-testable without
 * spinning up the queue. The worker bootstrap just wires this into a
 * BullMQ Worker.
 *
 * Contract: receives a BullMQ Job, returns a JSON-serialisable result
 * stored on the completed job. Real jobs (training:start in A3b.2a) will
 * also live as small pure handlers here for the same reason.
 */
import logger from '../../logger.js'

export async function handlePing(job) {
  const { message = null, enqueuedAt = null } = job.data ?? {}
  const now = Date.now()
  const lagMs = enqueuedAt != null ? now - enqueuedAt : null

  logger.info({
    queueJobId: job.id,
    queueJobName: job.name,
    message,
    lagMs,
  }, 'training queue: ping received')

  return {
    ok: true,
    message,
    receivedAt: now,
    lagMs,
  }
}
