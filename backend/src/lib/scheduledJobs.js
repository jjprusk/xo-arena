/**
 * Durable job scheduler — polls DB every 30s, claims and executes PENDING jobs.
 * Replaces ad-hoc setInterval sweeps for tournament timing.
 */
import db from './db.js'
import logger from '../logger.js'

const DISPATCH_INTERVAL_MS = 30_000

let _lastTickAt = null
let _io = null

export function getDispatcherHeartbeat() { return _lastTickAt }
export function setIO(io) { _io = io }

// ── Job handlers ──────────────────────────────────────────────────────────────
// Each handler receives job.payload and should return a Promise.
// Handlers are registered lazily to avoid circular imports.
const HANDLERS = {}

export function registerHandler(type, fn) {
  HANDLERS[type] = fn
}

// ── Public helpers ────────────────────────────────────────────────────────────

export async function scheduleJob({ type, payload, runAt }) {
  return db.scheduledJob.create({
    data: { type, payload, runAt: new Date(runAt), status: 'PENDING' },
  })
}

export async function cancelJobs({ type, where: payloadWhere }) {
  // payloadWhere is a Prisma JSON filter applied to the payload column
  // e.g. { path: ['tournamentId'], equals: 'some-id' }
  const jobs = await db.scheduledJob.findMany({
    where: {
      type,
      status: { in: ['PENDING', 'RUNNING'] },
      payload: payloadWhere,
    },
    select: { id: true },
  })
  if (jobs.length === 0) return
  await db.scheduledJob.updateMany({
    where: { id: { in: jobs.map(j => j.id) } },
    data: { status: 'DONE' },   // mark done so they are skipped, not retried
  })
  logger.info({ type, count: jobs.length }, 'scheduledJobs: cancelled jobs')
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function startDispatcher() {
  // ── Startup recovery: reset stuck RUNNING jobs ────────────────────────────
  const recovered = await db.scheduledJob.updateMany({
    where: { status: 'RUNNING' },
    data:  { status: 'PENDING' },
  })
  if (recovered.count > 0) {
    logger.warn({ count: recovered.count }, 'scheduledJobs: reset stuck RUNNING jobs on startup')
  }

  // ── Register built-in tournament handlers ─────────────────────────────────
  // Import dispatch lazily to avoid circular dependency with notificationBus.js
  registerHandler('tournament.warn.60', async ({ tournamentId, name, participantIds }) => {
    const { dispatch } = await import('./notificationBus.js')
    await dispatch({
      type: 'tournament.starting_soon',
      targets: { cohort: participantIds },
      payload: { tournamentId, name, minutesUntilStart: 60 },
    })
  })

  registerHandler('tournament.warn.15', async ({ tournamentId, name, participantIds }) => {
    // 15-min warning: socket-only (no persistence in DB)
    // dispatch() handles ephemeral vs persistent, but tournament.starting_soon is persistent
    // So we emit directly to cohort sockets — skip the bus for this one
    if (_io) {
      for (const userId of (participantIds ?? [])) {
        _io.to(`user:${userId}`).emit('tournament:warning', { tournamentId, minutesUntilStart: 15 })
      }
    }
  })

  registerHandler('tournament.warn.2', async ({ tournamentId, name, participantIds }) => {
    const { dispatch } = await import('./notificationBus.js')
    await dispatch({
      type: 'tournament.starting_soon',
      targets: { cohort: participantIds },
      payload: { tournamentId, name, minutesUntilStart: 2 },
    })
  })

  registerHandler('tournament.start', async ({ tournamentId }) => {
    // Import lazily — tournamentService may not exist yet, just log for now
    // TODO: wire to tournamentService.autoStart(tournamentId) when available
    logger.info({ tournamentId }, 'scheduledJobs: tournament.start job fired')
    // If tournamentService has autoStart, uncomment:
    // const { autoStart } = await import('../services/tournamentService.js')
    // await autoStart(tournamentId)
  })

  // ── Start the polling interval ────────────────────────────────────────────
  const id = setInterval(runDispatcherTick, DISPATCH_INTERVAL_MS)
  if (id.unref) id.unref()  // don't block process exit
  logger.info('scheduledJobs: dispatcher started')
  return id
}

async function runDispatcherTick() {
  _lastTickAt = new Date()
  try {
    // Claim PENDING jobs due now with capacity for retries
    const now = new Date()
    const jobs = await db.scheduledJob.findMany({
      where: {
        status: 'PENDING',
        runAt: { lte: now },
      },
    })

    // Re-check attempts individually (Prisma doesn't support field-field comparison)
    // Filter out jobs that have hit maxAttempts
    const eligible = jobs.filter(j => j.attempts < j.maxAttempts)

    if (eligible.length === 0) return

    // Atomically claim them (set RUNNING)
    await db.scheduledJob.updateMany({
      where: { id: { in: eligible.map(j => j.id) } },
      data:  { status: 'RUNNING', attempts: { increment: 1 } },
    })

    // Re-fetch to get updated attempts count
    const claimed = await db.scheduledJob.findMany({
      where: { id: { in: eligible.map(j => j.id) } },
    })

    await Promise.all(claimed.map(async (job) => {
      const handler = HANDLERS[job.type]
      if (!handler) {
        logger.warn({ type: job.type, id: job.id }, 'scheduledJobs: no handler registered — marking FAILED')
        await db.scheduledJob.update({
          where: { id: job.id },
          data:  { status: 'FAILED', lastError: 'No handler registered' },
        })
        return
      }

      try {
        await handler(job.payload)
        await db.scheduledJob.update({ where: { id: job.id }, data: { status: 'DONE' } })
        logger.info({ type: job.type, id: job.id }, 'scheduledJobs: job completed')
      } catch (err) {
        const errMsg = err?.message ?? String(err)
        if (job.attempts >= job.maxAttempts) {
          await db.scheduledJob.update({
            where: { id: job.id },
            data:  { status: 'FAILED', lastError: errMsg },
          })
          logger.error({ err, type: job.type, id: job.id }, 'scheduledJobs: job FAILED after max attempts')
          // Dispatch system alert to admins
          try {
            const { dispatch } = await import('./notificationBus.js')
            const admins = await db.baUser.findMany({ where: { role: 'admin' }, select: { id: true } })
            const adminIds = (await db.user.findMany({
              where: { betterAuthId: { in: admins.map(a => a.id) } },
              select: { id: true },
            })).map(u => u.id)
            if (adminIds.length > 0) {
              await dispatch({
                type: 'system.alert',
                targets: { cohort: adminIds },
                payload: { key: `scheduledJob.${job.type}`, message: `Scheduled job "${job.type}" failed after ${job.maxAttempts} attempts: ${errMsg}` },
              })
            }
          } catch (alertErr) {
            logger.warn({ alertErr }, 'scheduledJobs: failed to dispatch system.alert (non-fatal)')
          }
        } else {
          // Reset to PENDING for retry
          await db.scheduledJob.update({
            where: { id: job.id },
            data:  { status: 'PENDING', lastError: errMsg },
          })
          logger.warn({ err, type: job.type, id: job.id, attempts: job.attempts }, 'scheduledJobs: job failed — will retry')
        }
      }
    }))
  } catch (err) {
    logger.error({ err }, 'scheduledJobs: dispatcher tick error')
  }
}
