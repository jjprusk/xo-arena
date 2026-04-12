import { Router } from 'express'
import db from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { optionalAuth, requireAuth, requireTournamentAdmin, isTournamentAdmin } from '../middleware/auth.js'

const router = Router()

// GET /api/tournaments
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { status, game } = req.query

    const isAdmin = req.auth?.userId ? await isTournamentAdmin(req.auth.userId) : false

    const where = {}
    if (status) where.status = status
    if (game) where.game = game
    if (!isAdmin) {
      where.status = where.status
        ? { equals: where.status, not: 'DRAFT' }
        : { not: 'DRAFT' }
    }

    const tournaments = await db.tournament.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        game: true,
        mode: true,
        format: true,
        bracketType: true,
        status: true,
        minParticipants: true,
        maxParticipants: true,
        bestOfN: true,
        allowSpectators: true,
        startTime: true,
        endTime: true,
        registrationOpenAt: true,
        registrationCloseAt: true,
        isRecurring: true,
        createdAt: true,
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ tournaments })
  } catch (e) {
    next(e)
  }
})

// GET /api/tournaments/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const isAdmin = req.auth?.userId ? await isTournamentAdmin(req.auth.userId) : false

    const tournament = await db.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        participants: {
          include: {
            user: { select: { id: true, displayName: true, avatarUrl: true, eloRating: true } },
          },
        },
        rounds: {
          include: { matches: true },
          orderBy: { roundNumber: 'asc' },
        },
      },
    })

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    if (tournament.status === 'DRAFT' && !isAdmin) return res.status(404).json({ error: 'Tournament not found' })

    res.json({ tournament })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments
router.post('/', requireTournamentAdmin, async (req, res, next) => {
  try {
    const {
      name, description, game, mode, format, bracketType,
      minParticipants, maxParticipants, bestOfN, botMinGamesPlayed,
      allowNonCompetitiveBots, paceMs, allowSpectators, replayRetentionDays,
      startTime, endTime, registrationOpenAt, registrationCloseAt,
      noticePeriodMinutes, durationMinutes, isRecurring, recurrenceInterval,
      recurrenceEndDate, autoOptOutAfterMissed,
    } = req.body

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }

    const tournament = await db.tournament.create({
      data: {
        name,
        description,
        game,
        mode,
        format,
        bracketType,
        status: 'DRAFT',
        createdById: req.auth.userId,
        ...(minParticipants !== undefined && { minParticipants }),
        ...(maxParticipants !== undefined && { maxParticipants }),
        ...(bestOfN !== undefined && { bestOfN }),
        ...(botMinGamesPlayed !== undefined && { botMinGamesPlayed }),
        ...(allowNonCompetitiveBots !== undefined && { allowNonCompetitiveBots }),
        ...(paceMs !== undefined && { paceMs }),
        ...(allowSpectators !== undefined && { allowSpectators }),
        ...(replayRetentionDays !== undefined && { replayRetentionDays }),
        ...(startTime !== undefined && { startTime: new Date(startTime) }),
        ...(endTime !== undefined && { endTime: new Date(endTime) }),
        ...(registrationOpenAt !== undefined && { registrationOpenAt: new Date(registrationOpenAt) }),
        ...(registrationCloseAt !== undefined && { registrationCloseAt: new Date(registrationCloseAt) }),
        ...(noticePeriodMinutes !== undefined && { noticePeriodMinutes }),
        ...(durationMinutes !== undefined && { durationMinutes }),
        ...(isRecurring !== undefined && { isRecurring }),
        ...(recurrenceInterval !== undefined && { recurrenceInterval }),
        ...(recurrenceEndDate !== undefined && { recurrenceEndDate: new Date(recurrenceEndDate) }),
        ...(autoOptOutAfterMissed !== undefined && { autoOptOutAfterMissed }),
      },
    })

    res.status(201).json({ tournament })
  } catch (e) {
    next(e)
  }
})

// PATCH /api/tournaments/:id
router.patch('/:id', requireTournamentAdmin, async (req, res, next) => {
  try {
    const {
      name, description, game, mode, format, bracketType,
      minParticipants, maxParticipants, bestOfN, botMinGamesPlayed,
      allowNonCompetitiveBots, paceMs, allowSpectators, replayRetentionDays,
      startTime, endTime, registrationOpenAt, registrationCloseAt,
      noticePeriodMinutes, durationMinutes, isRecurring, recurrenceInterval,
      recurrenceEndDate, autoOptOutAfterMissed,
    } = req.body

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }

    // status is intentionally excluded — use dedicated endpoints
    const data = {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(game !== undefined && { game }),
      ...(mode !== undefined && { mode }),
      ...(format !== undefined && { format }),
      ...(bracketType !== undefined && { bracketType }),
      ...(minParticipants !== undefined && { minParticipants }),
      ...(maxParticipants !== undefined && { maxParticipants }),
      ...(bestOfN !== undefined && { bestOfN }),
      ...(botMinGamesPlayed !== undefined && { botMinGamesPlayed }),
      ...(allowNonCompetitiveBots !== undefined && { allowNonCompetitiveBots }),
      ...(paceMs !== undefined && { paceMs }),
      ...(allowSpectators !== undefined && { allowSpectators }),
      ...(replayRetentionDays !== undefined && { replayRetentionDays }),
      ...(startTime !== undefined && { startTime: new Date(startTime) }),
      ...(endTime !== undefined && { endTime: new Date(endTime) }),
      ...(registrationOpenAt !== undefined && { registrationOpenAt: new Date(registrationOpenAt) }),
      ...(registrationCloseAt !== undefined && { registrationCloseAt: new Date(registrationCloseAt) }),
      ...(noticePeriodMinutes !== undefined && { noticePeriodMinutes }),
      ...(durationMinutes !== undefined && { durationMinutes }),
      ...(isRecurring !== undefined && { isRecurring }),
      ...(recurrenceInterval !== undefined && { recurrenceInterval }),
      ...(recurrenceEndDate !== undefined && { recurrenceEndDate: new Date(recurrenceEndDate) }),
      ...(autoOptOutAfterMissed !== undefined && { autoOptOutAfterMissed }),
    }

    const tournament = await db.tournament.update({
      where: { id: req.params.id },
      data,
    })

    res.json({ tournament })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/publish
router.post('/:id/publish', requireTournamentAdmin, async (req, res, next) => {
  try {
    const tournament = await db.tournament.update({
      where: { id: req.params.id },
      data: {
        status: 'REGISTRATION_OPEN',
        registrationOpenAt: new Date(),
      },
    })

    if (tournament.format === 'FLASH') {
      await publish('tournament:flash:announced', {
        tournamentId: tournament.id,
        name: tournament.name,
        noticePeriodMinutes: tournament.noticePeriodMinutes,
      })
    }

    // Notify all connected users that a new tournament is open
    await publish('tournament:published', {
      tournamentId: tournament.id,
      name: tournament.name,
      format: tournament.format,
      mode: tournament.mode,
    })

    res.json({ tournament })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/cancel
router.post('/:id/cancel', requireTournamentAdmin, async (req, res, next) => {
  try {
    const existing = await db.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        participants: {
          where: { status: { in: ['REGISTERED', 'ACTIVE'] } },
          select: { userId: true },
        },
      },
    })

    if (!existing) return res.status(404).json({ error: 'Tournament not found' })

    const participantUserIds = existing.participants.map(p => p.userId)

    const tournament = await db.tournament.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
    })

    await publish('tournament:cancelled', {
      tournamentId: tournament.id,
      participantUserIds,
    })

    res.json({ tournament })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/start
router.post('/:id/start', requireTournamentAdmin, async (req, res, next) => {
  try {
    const existing = await db.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        participants: {
          where: { status: { in: ['REGISTERED', 'ACTIVE'] } },
          include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true, isBot: true } } },
        },
      },
    })

    if (!existing) return res.status(404).json({ error: 'Tournament not found' })

    if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'DRAFT'].includes(existing.status)) {
      return res.status(400).json({ error: `Cannot start a tournament with status ${existing.status}` })
    }

    const participants = existing.participants
    if (participants.length < existing.minParticipants) {
      return res.status(400).json({
        error: `Not enough participants — need ${existing.minParticipants}, have ${participants.length}`,
      })
    }

    const updateData = { status: 'IN_PROGRESS' }
    if (!existing.startTime) updateData.startTime = new Date()

    const tournament = await db.tournament.update({
      where: { id: req.params.id },
      data: updateData,
    })

    const isPvp = existing.mode === 'PVP'

    if (existing.bracketType === 'SINGLE_ELIM') {
      const shuffled = [...participants].sort(() => Math.random() - 0.5)

      const round = await db.tournamentRound.create({
        data: { tournamentId: tournament.id, roundNumber: 1, status: 'IN_PROGRESS' },
      })

      for (let i = 0; i < shuffled.length; i += 2) {
        const p1 = shuffled[i]
        const p2 = shuffled[i + 1]

        if (!p2) {
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

          if (isPvp) {
            await publish('tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              participant1UserId: p1.user.betterAuthId,
              participant2UserId: p2.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            })
          } else {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
          }
        }
      }
    } else if (existing.bracketType === 'ROUND_ROBIN') {
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

          if (isPvp) {
            await publish('tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              participant1UserId: p1.user.betterAuthId,
              participant2UserId: p2.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            })
          } else {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
          }
        }
      }
    }

    res.json({ tournament })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/register
router.post('/:id/register', requireAuth, async (req, res, next) => {
  try {
    const { resultNotifPref, participantUserId } = req.body
    const tournamentId = req.params.id
    const requestingUserId = req.auth.dbUserId

    // participantUserId lets the owner register a bot they own.
    // If not provided, register the requesting user themselves.
    let userId = requestingUserId
    if (participantUserId && participantUserId !== requestingUserId) {
      // Verify the requesting user owns this bot
      const bot = await db.user.findUnique({
        where: { id: participantUserId },
        select: { id: true, isBot: true, botOwnerId: true },
      })
      if (!bot || !bot.isBot || bot.botOwnerId !== requestingUserId) {
        return res.status(403).json({ error: 'You do not own this bot' })
      }
      userId = participantUserId
    }

    const tournament = await db.tournament.findUnique({ where: { id: tournamentId } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })

    if (tournament.status !== 'REGISTRATION_OPEN') {
      return res.status(400).json({ error: 'Tournament registration is not open' })
    }

    if (tournament.registrationCloseAt && new Date(tournament.registrationCloseAt) <= new Date()) {
      return res.status(400).json({ error: 'Tournament registration has closed' })
    }

    if (tournament.maxParticipants) {
      const count = await db.tournamentParticipant.count({
        where: { tournamentId, status: { not: 'WITHDRAWN' } },
      })
      if (count >= tournament.maxParticipants) {
        return res.status(400).json({ error: 'Tournament is full' })
      }
    }

    const existing = await db.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    })
    if (existing && existing.status !== 'WITHDRAWN') {
      return res.status(400).json({ error: 'Already registered' })
    }

    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) return res.status(404).json({ error: 'User not found' })

    let registrationMode = 'SINGLE'
    if (tournament.isRecurring) {
      const recurringReg = await db.recurringTournamentRegistration.findUnique({
        where: { templateId_userId: { templateId: tournamentId, userId } },
      })
      if (recurringReg && !recurringReg.optedOutAt) {
        registrationMode = 'RECURRING'
      }
    }

    const participant = await db.tournamentParticipant.upsert({
      where: { tournamentId_userId: { tournamentId, userId } },
      create: {
        tournamentId,
        userId,
        eloAtRegistration: user.eloRating,
        status: 'REGISTERED',
        registrationMode,
        ...(resultNotifPref && { resultNotifPref }),
      },
      update: {
        status: 'REGISTERED',
        eloAtRegistration: user.eloRating,
        registrationMode,
        ...(resultNotifPref && { resultNotifPref }),
      },
    })

    res.status(201).json({ participant })
  } catch (e) {
    next(e)
  }
})

// DELETE /api/tournaments/:id/register
router.delete('/:id/register', requireAuth, async (req, res, next) => {
  try {
    const tournamentId = req.params.id
    const userId = req.auth.dbUserId

    const tournament = await db.tournament.findUnique({ where: { id: tournamentId } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })

    if (tournament.status === 'IN_PROGRESS' || tournament.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot withdraw from a tournament that is in progress or completed' })
    }

    const participant = await db.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    })
    if (!participant) return res.status(404).json({ error: 'Not registered' })

    await db.tournamentParticipant.update({
      where: { id: participant.id },
      data: { status: 'WITHDRAWN' },
    })

    res.status(204).send()
  } catch (e) {
    next(e)
  }
})

export default router
