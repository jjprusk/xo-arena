// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Worker option resolution — A3b.3.
 *
 * The xo-training worker's BullMQ Worker options (`concurrency` +
 * `limiter`) used to be hardcoded in worker.js. They're now read from
 * SystemConfig so an admin can dial throughput on prod without a deploy:
 *
 *   ml.workerConcurrency      — max simultaneously-running jobs on this
 *                               worker process (default 2)
 *   ml.workerJobsPerSecond    — max jobs the worker accepts from the
 *                               queue per second, regardless of how many
 *                               slots are free. Acts as a rate limiter
 *                               (default 4 jobs/s)
 *
 * Why both? Concurrency caps *active* work — useful when each job is
 * CPU-heavy (we don't want N AlphaZero loops fighting for cores).
 * The rate limiter caps *acceptance* — useful when each job spikes the
 * DB on startup (initial state-load) and bursty acceptance would
 * stampede Postgres. They're complementary, not redundant.
 *
 * Defaults are conservative; A3b.6 (stage soak) is where we'll tune.
 *
 * Both knobs are exposed via `readWorkerOptions(opts)` with the
 * SystemConfig getter injectable so the boot path is unit-testable
 * without touching a real DB.
 */
import { getSystemConfig as _defaultGetSystemConfig } from '../services/mlService.js'

const DEFAULT_CONCURRENCY      = 2
const DEFAULT_JOBS_PER_SECOND  = 4

function _toPositiveInt(raw, fallback) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return n
}

export async function readWorkerOptions({ getConfig = _defaultGetSystemConfig } = {}) {
  const [rawConcurrency, rawJobsPerSecond] = await Promise.all([
    getConfig('ml.workerConcurrency',     DEFAULT_CONCURRENCY),
    getConfig('ml.workerJobsPerSecond',   DEFAULT_JOBS_PER_SECOND),
  ])

  const concurrency   = _toPositiveInt(rawConcurrency,     DEFAULT_CONCURRENCY)
  const jobsPerSecond = _toPositiveInt(rawJobsPerSecond,   DEFAULT_JOBS_PER_SECOND)

  return {
    concurrency,
    limiter: { max: jobsPerSecond, duration: 1000 },
  }
}

export const _DEFAULTS_FOR_TESTS = {
  concurrency:   DEFAULT_CONCURRENCY,
  jobsPerSecond: DEFAULT_JOBS_PER_SECOND,
}
