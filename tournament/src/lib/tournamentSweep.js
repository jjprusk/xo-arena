// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tournament sweep job — runs every 60 seconds.
 *
 * Phase 1 — close registration:
 *   For every REGISTRATION_OPEN tournament whose effective close time is in
 *   the past. The effective close is `registrationCloseAt` when set,
 *   otherwise `startTime` — "null close means close when the tournament
 *   starts" (admin UX expectation).
 *   - participants < minParticipants → auto-cancel immediately
 *   - participants >= minParticipants → transition to REGISTRATION_CLOSED
 *
 * Phase 2 — start or cancel:
 *   For every REGISTRATION_OPEN or REGISTRATION_CLOSED tournament whose
 *   startTime is in the past:
 *   - participants >= minParticipants → auto-start (generate bracket + publish events)
 *   - participants <  minParticipants → auto-cancel  (publish cancelled event)
 */

import db from './db.js'
import { publish } from './redis.js'
import { buildBotMatchReadyPayload } from './publishPayloads.js'
import { expectedGameCount, RUNAWAY_CANCEL_RATIO } from './bracketMath.js'
import { sweepStaleTestRows } from './testJanitor.js'
import logger from '../logger.js'

const SWEEP_INTERVAL_MS = 60_000

// Phase 3.7a.6 — retention for the sweep-drop audit log. 90 days keeps the
// "last month" admin rolling window working comfortably without the audit
// table growing unboundedly. Checked once per sweep tick, but gated on
// last-prune so we only hit the DB once a day.
const AUTO_DROP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const AUTO_DROP_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
let _lastAutoDropPruneAt = 0

// Sprint 4 — Curriculum Cup retention (§5.4). Cups are private to the user
// who created them and have no tournament-history value beyond the owner's
// reflection window. 30 days matches the Sprint 4 spec; the per-hour gate
// keeps the sweep cheap. Sprint 6 made this admin-tunable via SystemConfig
// `guide.cup.retentionDays` (read inside sweepOldCups so changes take effect
// on the next sweep, not requiring a restart).
const DEFAULT_CUP_RETENTION_DAYS = 30
const CUP_SWEEP_INTERVAL_MS      = 60 * 60 * 1000
let _lastCupSweepAt = 0

// Stale-test-row janitor (Guard B). Runs hourly out-of-band — TTL is 24h on
// the row's updatedAt, so a coarser cadence is fine.
const TEST_JANITOR_INTERVAL_MS = 60 * 60 * 1000
let _lastTestJanitorAt = 0

export function startTournamentSweep() {
  logger.info('Tournament sweep job started (60s interval)')
  recoverPendingBotMatches().catch(err => logger.warn({ err }, 'Tournament sweep — startup recovery failed'))
  sweep()
  return setInterval(sweep, SWEEP_INTERVAL_MS)
}

// How long a bot match must be PENDING before the sweep re-publishes it
const BOT_MATCH_STALE_MS = 2 * 60_000

/**
 * On startup, re-publish tournament:bot:match:ready for any PENDING bot matches
 * in IN_PROGRESS tournaments. This recovers from events lost during a backend restart.
 * Exported for unit tests (QA_Phase_3.4 §11g item 3).
 */
export async function recoverPendingBotMatches(onlyStale = false) {
  const matchFilter = onlyStale
    ? { status: 'PENDING', createdAt: { lte: new Date(Date.now() - BOT_MATCH_STALE_MS) } }
    : { status: 'PENDING' }
  const inProgress = await db.tournament.findMany({
    where: { status: 'IN_PROGRESS' },
    include: {
      rounds: {
        include: {
          matches: { where: matchFilter },
        },
      },
    },
  })

  let recovered = 0
  for (const t of inProgress) {
    for (const round of t.rounds) {
      for (const match of round.matches) {
        if (!match.participant1Id || !match.participant2Id) continue

        const [p1, p2] = await Promise.all([
          db.tournamentParticipant.findUnique({
            where: { id: match.participant1Id },
            include: { user: { select: { id: true, displayName: true, botModelId: true, isBot: true } } },
          }),
          db.tournamentParticipant.findUnique({
            where: { id: match.participant2Id },
            include: { user: { select: { id: true, displayName: true, botModelId: true, isBot: true } } },
          }),
        ])

        if (!p1?.user || !p2?.user) continue
        if (!p1.user.isBot || !p2.user.isBot) continue  // only recover bot vs bot matches

        await publish(
          'tournament:bot:match:ready',
          buildBotMatchReadyPayload(t, match, p1.user, p2.user),
        ).catch(() => {})
        recovered++
      }
    }
  }

  if (recovered > 0) {
    logger.info({ recovered }, 'Tournament sweep — re-published pending bot matches on startup')
  }
}

// Exported for unit tests. Production code goes through `startTournamentSweep`.
export async function sweep() {
  const now = new Date()

  // Daily prune of the auto-drop audit log (3.7a.6). Runs out-of-band from the
  // phase logic; failures are non-fatal.
  if (now.getTime() - _lastAutoDropPruneAt > AUTO_DROP_PRUNE_INTERVAL_MS) {
    _lastAutoDropPruneAt = now.getTime()
    db.tournamentAutoDrop.deleteMany({
      where: { droppedAt: { lt: new Date(now.getTime() - AUTO_DROP_RETENTION_MS) } },
    }).then(r => {
      if (r.count > 0) logger.info({ pruned: r.count }, 'Tournament sweep — pruned tournament_auto_drops older than 90d')
    }).catch(err => {
      logger.warn({ err: err.message }, 'Tournament sweep — auto-drop prune failed')
    })
  }

  // Hourly sweep of expired Curriculum Cups (§5.4). Out-of-band from the
  // phase logic; failures are non-fatal.
  if (now.getTime() - _lastCupSweepAt > CUP_SWEEP_INTERVAL_MS) {
    _lastCupSweepAt = now.getTime()
    sweepOldCups(now).then(({ tournaments, bots }) => {
      if (tournaments > 0 || bots > 0) {
        logger.info({ tournaments, bots }, 'Tournament sweep — pruned old Curriculum Cups')
      }
    }).catch(err => {
      logger.warn({ err: err.message }, 'Tournament sweep — cup retention failed')
    })
  }

  // Hourly sweep of stale isTest rows (Guard B). Backstop for crashed specs
  // that never reached afterAll cleanup.
  if (now.getTime() - _lastTestJanitorAt > TEST_JANITOR_INTERVAL_MS) {
    _lastTestJanitorAt = now.getTime()
    sweepStaleTestRows(now).catch(err => {
      logger.warn({ err: err.message }, 'Tournament sweep — test janitor failed')
    })
  }

  // Phase 1: close registration for tournaments past their registrationCloseAt
  // If participant count < minParticipants at close time, cancel immediately.
  try {
    const toClose = await db.tournament.findMany({
      where: {
        status: 'REGISTRATION_OPEN',
        OR: [
          { registrationCloseAt: { not: null, lte: now } },
          // Null close == "close at startTime"
          { registrationCloseAt: null, startTime: { not: null, lte: now } },
        ],
      },
      include: {
        participants: {
          where: { status: { in: ['REGISTERED'] } },
          include: { user: { select: { id: true } } },
        },
      },
    })
    const insufficient = toClose.filter(t => t.participants.length < t.minParticipants)
    const sufficient   = toClose.filter(t => t.participants.length >= t.minParticipants)

    // Cancel tournaments that closed with too few participants
    for (const t of insufficient) {
      await autoCancel(t, t.participants.length)
    }

    // Partition by startMode: AUTO starts immediately, others just close registration
    const autoStart   = sufficient.filter(t => t.startMode === 'AUTO')
    const nonAuto     = sufficient.filter(t => t.startMode !== 'AUTO')

    if (nonAuto.length > 0) {
      await db.tournament.updateMany({
        where: { id: { in: nonAuto.map(t => t.id) } },
        data: { status: 'REGISTRATION_CLOSED' },
      })
      for (const t of nonAuto) {
        logger.info({ tournamentId: t.id, name: t.name, startMode: t.startMode }, 'Tournament sweep — registration closed')
        await publish('tournament:registration_closed', { tournamentId: t.id, name: t.name }).catch(() => {})
      }
    }

    // AUTO mode: start immediately on registration close (re-fetch for full user data)
    for (const t of autoStart) {
      await publish('tournament:registration_closed', { tournamentId: t.id, name: t.name }).catch(() => {})
      const full = await db.tournament.findUnique({
        where: { id: t.id },
        include: {
          participants: {
            where: { status: { in: ['REGISTERED'] } },
            include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true, isBot: true } } },
          },
        },
      })
      if (full) {
        logger.info({ tournamentId: t.id, name: t.name }, 'Tournament sweep — AUTO mode, starting on registration close')
        await autoStartTournament(full)
      }
    }
  } catch (err) {
    logger.error({ err }, 'Tournament sweep — registration close phase failed')
  }

  // Phase 2: start or cancel tournaments past their startTime
  let overdue
  try {
    overdue = await db.tournament.findMany({
      where: {
        status: { in: ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] },
        startTime: { not: null, lte: now },
      },
      include: {
        participants: {
          where: { status: { in: ['REGISTERED'] } },
          include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true, isBot: true } } },
        },
      },
    })
  } catch (err) {
    logger.error({ err }, 'Tournament sweep — DB query failed')
    return
  }

  if (overdue.length === 0) {
    // Phase 3 even when no overdue tournaments
    await recoverPendingBotMatches(true)
    return
  }
  logger.info({ count: overdue.length }, 'Tournament sweep — processing overdue tournaments')

  for (const t of overdue) {
    // MANUAL mode: sweep never starts these — admin uses the Start button
    if (t.startMode === 'MANUAL') continue

    const count = t.participants.length
    if (count < t.minParticipants) {
      await autoCancel(t, count)
    } else {
      await autoStartTournament(t)
    }
  }

  // Phase 3: re-publish events for bot matches stuck in PENDING (event may have been lost)
  await recoverPendingBotMatches(true)

  // Phase 4: runaway-loop guard. If any IN_PROGRESS tournament has played
  // > RUNAWAY_CANCEL_RATIO × its expected game ceiling, the bot runner is
  // almost certainly stuck re-playing the same series (e.g. match-complete
  // fetch silently failing so the series never advances). Cancel the
  // tournament immediately to stop the loop.
  try {
    const inFlight = await db.tournament.findMany({
      where:  { status: 'IN_PROGRESS' },
      select: {
        id: true, name: true, bracketType: true, bestOfN: true,
        _count: { select: { participants: true, games: true } },
      },
    })
    for (const t of inFlight) {
      const expected  = expectedGameCount(t.bracketType, t._count.participants, t.bestOfN)
      const played    = t._count.games
      if (expected > 0 && played > expected * RUNAWAY_CANCEL_RATIO) {
        logger.error(
          { tournamentId: t.id, name: t.name, gamesPlayed: played, expectedGames: expected, ratio: played / expected },
          'Tournament sweep — RUNAWAY LOOP detected, auto-cancelling'
        )
        try {
          await db.tournament.update({
            where: { id: t.id },
            data:  { status: 'CANCELLED' },
          })
          await db.tournamentMatch.updateMany({
            where: { tournamentId: t.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
            data:  { status: 'CANCELLED' },
          })
          await publish('tournament:cancelled', {
            tournamentId: t.id,
            name: t.name,
            reason: 'runaway_loop',
            gamesPlayed: played,
            expectedGames: expected,
          }).catch(() => {})
        } catch (err) {
          logger.warn({ err, tournamentId: t.id }, 'Tournament sweep — runaway auto-cancel failed')
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Tournament sweep — runaway guard phase failed')
  }
}

// ─── Auto-cancel ──────────────────────────────────────────────────────────────

/**
 * Returns true when every registered participant is a bot (or the list is
 * empty). Used to decide between silent deletion and a user-facing cancel.
 */
export function allParticipantsAreBots(participants) {
  return (participants ?? []).every(p => p?.user?.isBot === true)
}

/**
 * Past start time, under min participants — two branches:
 *
 *   Bot-only (including empty) → delete the row silently. `Tournament` has
 *   onDelete:Cascade on both `TournamentParticipant.tournamentId` and
 *   `TournamentSeedBot.tournamentId`, so the delete propagates cleanly.
 *   No `tournament:cancelled` event is published — nobody human to notify,
 *   and we'd otherwise force every connected client to refetch the list
 *   for an invisible occurrence. Prevents recurring-occurrence corpses
 *   from accumulating in the DB.
 *
 *   Has a human participant → current behavior: flip status to CANCELLED,
 *   publish `tournament:cancelled` so the humans who registered see the
 *   notification, keep the row for history.
 */
export async function autoCancel(tournament, count) {
  if (allParticipantsAreBots(tournament.participants)) {
    // Phase 3.7a.6: write an append-only audit row BEFORE the delete so the
    // admin "tournaments auto-dropped per period" widget has something to
    // count. Non-fatal — if the insert fails the delete still proceeds and
    // we lose one entry (log + carry on rather than leaking a cancelled row).
    try {
      await db.tournamentAutoDrop.create({
        data: {
          originalTournamentId: tournament.id,
          templateId:           tournament.templateId ?? null,
          name:                 tournament.name,
          game:                 tournament.game,
          minParticipants:      tournament.minParticipants,
          participantCount:     count,
        },
      })
    } catch (err) {
      logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-drop audit insert failed (continuing with delete)')
    }

    try {
      await db.tournament.delete({ where: { id: tournament.id } })
      logger.info(
        { tournamentId: tournament.id, name: tournament.name, participants: count, min: tournament.minParticipants },
        'Tournament sweep — auto-deleted (unfilled, bot-only)'
      )
    } catch (err) {
      logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-delete failed')
    }
    return
  }

  try {
    await db.tournament.update({
      where: { id: tournament.id },
      data: { status: 'CANCELLED' },
    })

    const participantUserIds = tournament.participants.map(p => p.userId)
    await publish('tournament:cancelled', {
      tournamentId: tournament.id,
      name: tournament.name,
      participantUserIds,
    })

    logger.info(
      { tournamentId: tournament.id, name: tournament.name, participants: count, min: tournament.minParticipants },
      'Tournament sweep — auto-cancelled (insufficient participants)'
    )
  } catch (err) {
    logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-cancel failed')
  }
}

// ─── Auto-start ───────────────────────────────────────────────────────────────

async function autoStartTournament(tournament) {
  try {
    await db.tournament.update({
      where: { id: tournament.id },
      data: { status: 'IN_PROGRESS' },
    })

    const participants = tournament.participants

    if (tournament.bracketType === 'SINGLE_ELIM') {
      const shuffled = [...participants].sort(() => Math.random() - 0.5)

      const round = await db.tournamentRound.create({
        data: { tournamentId: tournament.id, roundNumber: 1, status: 'IN_PROGRESS' },
      })

      for (let i = 0; i < shuffled.length; i += 2) {
        const p1 = shuffled[i]
        const p2 = shuffled[i + 1]

        if (!p2) {
          // Bye
          await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: round.id,
              participant1Id: p1.id,
              participant2Id: null,
              winnerId: p1.id,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          })
        } else {
          const match = await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: round.id,
              participant1Id: p1.id,
              participant2Id: p2.id,
              status: 'PENDING',
            },
          })

          if (p1.user.isBot && p2.user.isBot) {
            await publish(
              'tournament:bot:match:ready',
              buildBotMatchReadyPayload(tournament, match, p1.user, p2.user),
            )
          } else {
            await publish('tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              participant1UserId: p1.user.betterAuthId,
              participant2UserId: p2.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            })
          }
        }
      }
    } else if (tournament.bracketType === 'ROUND_ROBIN') {
      const round = await db.tournamentRound.create({
        data: { tournamentId: tournament.id, roundNumber: 1, status: 'IN_PROGRESS' },
      })

      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const p1 = participants[i]
          const p2 = participants[j]

          const match = await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: round.id,
              participant1Id: p1.id,
              participant2Id: p2.id,
              status: 'PENDING',
            },
          })

          if (p1.user.isBot && p2.user.isBot) {
            await publish(
              'tournament:bot:match:ready',
              buildBotMatchReadyPayload(tournament, match, p1.user, p2.user),
            )
          } else {
            await publish('tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              participant1UserId: p1.user.betterAuthId,
              participant2UserId: p2.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            })
          }
        }
      }
    }

    await publish('tournament:started', { tournamentId: tournament.id, name: tournament.name }).catch(() => {})
    logger.info(
      { tournamentId: tournament.id, name: tournament.name, participants: participants.length },
      'Tournament sweep — auto-started'
    )
  } catch (err) {
    logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-start failed')
  }
}

/**
 * Delete disposable seeded-bot users created by the add-seeded-bot endpoint
 * for a given tournament. Safe to call on completion or cancellation.
 * Returns the count of deleted user rows.
 */
export async function cleanupSeededBots(tournamentId) {
  const participants = await db.tournamentParticipant.findMany({
    where: { tournamentId },
    include: { user: { select: { id: true, username: true } } },
  })

  const seededIds = participants
    .filter(p => p.user?.username?.startsWith('seeded-'))
    .map(p => p.user.id)

  if (seededIds.length === 0) return 0

  await db.tournamentParticipant.deleteMany({
    where: { tournamentId, userId: { in: seededIds } },
  })

  const { count } = await db.user.deleteMany({ where: { id: { in: seededIds } } })
  return count
}

/**
 * Delete Curriculum Cup tournaments older than 30 days, plus any orphaned
 * cup-clone bot users (`bot-cup-*`) they brought in. Tournament cascade-
 * deletes participants, but the User rows are not cascade-deleted from
 * elsewhere — we collect them first, drop the tournament, then delete the
 * users (whose participant FK is now gone).
 *
 * Exported for unit tests.
 *
 * @param {Date} now
 * @returns {Promise<{tournaments:number, bots:number}>}
 */
export async function sweepOldCups(now = new Date()) {
  // Read tunable retention each sweep — admin changes via SystemConfig take
  // effect immediately, no restart. Coerce to a positive number; bad values
  // fall back to the default so a typo can't disable the sweep.
  const row     = await db.systemConfig.findUnique({ where: { key: 'guide.cup.retentionDays' } }).catch(() => null)
  const parsed  = row ? Number(typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : null
  const days    = (Number.isFinite(parsed) && parsed > 0) ? parsed : DEFAULT_CUP_RETENTION_DAYS
  const cutoff  = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  // Use the cup's own age (createdAt) so cups that never finished still get
  // collected. Cups complete in ~2 minutes; anything 30 days old has either
  // run, been abandoned, or stuck.
  const oldCups = await db.tournament.findMany({
    where:  { isCup: true, createdAt: { lt: cutoff } },
    select: {
      id: true,
      participants: {
        select: { user: { select: { id: true, username: true } } },
      },
    },
  })
  if (oldCups.length === 0) return { tournaments: 0, bots: 0 }

  // Collect cup-clone bot user ids before the cascade delete drops the
  // participant rows that reference them.
  const cupBotIds = new Set()
  for (const cup of oldCups) {
    for (const p of cup.participants) {
      if (p.user?.username?.startsWith('bot-cup-')) cupBotIds.add(p.user.id)
    }
  }

  const { count: tournamentsDeleted } = await db.tournament.deleteMany({
    where: { id: { in: oldCups.map(c => c.id) } },
  })

  let botsDeleted = 0
  if (cupBotIds.size > 0) {
    const { count } = await db.user.deleteMany({
      where: { id: { in: [...cupBotIds] } },
    })
    botsDeleted = count
  }

  return { tournaments: tournamentsDeleted, bots: botsDeleted }
}
