// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * `training:start` job handler — A3b.2a shadow mode.
 *
 * Receives a job carrying { sessionId } and runs the existing training
 * loop against that session in the worker process. The backend continues
 * to run `setImmediate(_runTraining)` for real traffic — this handler is
 * only exercised by the QA harness today. A3b.2b flips startTraining()
 * to enqueue instead of setImmediate, behind a SystemConfig kill switch.
 *
 * Like ping.js, the actual training-runner is injected so the handler
 * stays unit-testable without Prisma.
 */
import logger from '../../logger.js'
import { _runTrainingForQueueJob } from '../../services/mlService.js'
import {
  registerActiveSession   as _defaultRegister,
  unregisterActiveSession as _defaultUnregister,
} from '../activeSessions.js'

export async function handleTrainingStart(
  job,
  {
    runFn        = _runTrainingForQueueJob,
    onStart      = _defaultRegister,
    onFinish     = _defaultUnregister,
  } = {},
) {
  const { sessionId, enqueuedAt = null } = job.data ?? {}
  if (!sessionId) throw new Error('training:start job missing sessionId')

  const startedAt = Date.now()
  const lagMs = enqueuedAt != null ? startedAt - enqueuedAt : null

  logger.info(
    { queueJobId: job.id, queueJobName: job.name, sessionId, lagMs },
    'training:start picked up by worker'
  )

  // A3b.4 — record the session so SIGTERM can ask it to pause+checkpoint
  // before the worker closes. unregister via try/finally so a thrown
  // runner doesn't leave a phantom entry the shutdown path would wait on.
  onStart(sessionId)
  try {
    const result = await runFn(sessionId)
    const durationMs = Date.now() - startedAt
    logger.info(
      { queueJobId: job.id, sessionId, durationMs, lagMs },
      'training:start completed'
    )
    return { ok: true, sessionId, lagMs, durationMs, ...result }
  } finally {
    onFinish(sessionId)
  }
}
