// Copyright © 2026 Joe Pruskowski. All rights reserved.
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
            user: { select: { id: true, displayName: true, avatarUrl: true } },
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
      allowNonCompetitiveBots, paceMs, allowSpectators,
      startTime, endTime, registrationOpenAt, registrationCloseAt,
      noticePeriodMinutes, durationMinutes, isRecurring, recurrenceInterval,
      recurrenceEndDate, autoOptOutAfterMissed, startMode,
    } = req.body

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }
    const VALID_START_MODES = ['AUTO', 'SCHEDULED', 'MANUAL']
    if (startMode !== undefined && !VALID_START_MODES.includes(startMode)) {
      return res.status(400).json({ error: 'startMode must be AUTO, SCHEDULED, or MANUAL' })
    }
    if (startMode === 'SCHEDULED' && !startTime) {
      return res.status(400).json({ error: 'SCHEDULED mode requires a startTime' })
    }
    if (registrationCloseAt && startTime && new Date(registrationCloseAt) > new Date(startTime)) {
      return res.status(400).json({ error: 'registrationCloseAt must be before startTime' })
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
        ...(startMode !== undefined && { startMode }),
        ...(minParticipants !== undefined && { minParticipants }),
        ...(maxParticipants !== undefined && { maxParticipants }),
        ...(bestOfN !== undefined && { bestOfN }),
        ...(botMinGamesPlayed !== undefined && { botMinGamesPlayed }),
        ...(allowNonCompetitiveBots !== undefined && { allowNonCompetitiveBots }),
        ...(paceMs !== undefined && { paceMs }),
        ...(allowSpectators !== undefined && { allowSpectators }),
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
      allowNonCompetitiveBots, paceMs, allowSpectators,
      startTime, endTime, registrationOpenAt, registrationCloseAt,
      noticePeriodMinutes, durationMinutes, isRecurring, recurrenceInterval,
      recurrenceEndDate, autoOptOutAfterMissed, startMode,
    } = req.body

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }
    const VALID_START_MODES = ['AUTO', 'SCHEDULED', 'MANUAL']
    if (startMode !== undefined && !VALID_START_MODES.includes(startMode)) {
      return res.status(400).json({ error: 'startMode must be AUTO, SCHEDULED, or MANUAL' })
    }
    if (registrationCloseAt && startTime && new Date(registrationCloseAt) > new Date(startTime)) {
      return res.status(400).json({ error: 'registrationCloseAt must be before startTime' })
    }

    // status is intentionally excluded — use dedicated endpoints
    const data = {
      ...(startMode !== undefined && { startMode }),
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
          where: { status: { in: ['REGISTERED'] } },
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
          where: { status: { in: ['REGISTERED'] } },
          include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true, isBot: true } } },
        },
      },
    })

    if (!existing) return res.status(404).json({ error: 'Tournament not found' })

    // Disallow starting from DRAFT — it was never published so participants were
    // never notified. Require REGISTRATION_OPEN or REGISTRATION_CLOSED first.
    if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(existing.status)) {
      return res.status(400).json({ error: `Cannot start a tournament with status ${existing.status}` })
    }

    const participants = existing.participants
    if (participants.length < existing.minParticipants) {
      return res.status(400).json({
        error: `Not enough participants — need ${existing.minParticipants}, have ${participants.length}`,
      })
    }

    // Guard: ROUND_ROBIN with too many participants creates N*(N-1)/2 matches —
    // cap at 128 to prevent a single start from flooding Redis with thousands of events.
    if (existing.bracketType === 'ROUND_ROBIN' && participants.length > 128) {
      return res.status(400).json({
        error: `Round-robin tournaments are limited to 128 participants (have ${participants.length})`,
      })
    }

    const updateData = { status: 'IN_PROGRESS' }
    if (!existing.startTime) updateData.startTime = new Date()

    const tournament = await db.tournament.update({
      where: { id: req.params.id },
      data: updateData,
    })

    const isPvp = existing.mode === 'HVH'

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
              gameId: tournament.game,
              bestOfN: tournament.bestOfN,
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
              gameId: tournament.game,
              bestOfN: tournament.bestOfN,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
          }
        }
      }
    }

    await publish('tournament:started', { tournamentId: tournament.id, name: tournament.name }).catch(() => {})
    res.json({ tournament })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/fill-test-players
// Registers the 4 standard test bots into the tournament (idempotent, admin only).
const TEST_BOT_USERNAMES = ['testbot-alpha', 'testbot-beta', 'testbot-gamma', 'testbot-delta']

router.post('/:id/fill-test-players', requireTournamentAdmin, async (req, res, next) => {
  try {
    const tournamentId = req.params.id

    const tournament = await db.tournament.findUnique({ where: { id: tournamentId } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    // Disallow adding test players once the tournament is running — they'd appear
    // in the participant list but have no bracket slot.
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(tournament.status)) {
      return res.status(400).json({ error: `Cannot add players to a ${tournament.status.toLowerCase()} tournament` })
    }

    // Look up test bots — they must be seeded first via `um test-bots`
    const bots = await db.user.findMany({
      where: { username: { in: TEST_BOT_USERNAMES }, isBot: true },
      select: { id: true, username: true, displayName: true },
    })

    if (bots.length === 0) {
      return res.status(404).json({
        error: 'Test bots not found — run `docker compose exec backend node backend/src/cli/um.js test-bots` first',
      })
    }

    const registered = []
    const skipped    = []

    for (const bot of bots) {
      const existing = await db.tournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId, userId: bot.id } },
      })

      if (existing && existing.status !== 'WITHDRAWN') {
        skipped.push(bot.username)
        continue
      }

      await db.tournamentParticipant.upsert({
        where: { tournamentId_userId: { tournamentId, userId: bot.id } },
        create: { tournamentId, userId: bot.id, eloAtRegistration: null, status: 'REGISTERED' },
        update: { status: 'REGISTERED', eloAtRegistration: null },
      })

      registered.push(bot.username)
    }

    res.json({ registered, skipped })
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

    const gameEloRow = await db.gameElo.findUnique({
      where: { userId_gameId: { userId, gameId: tournament.game } },
      select: { rating: true },
    })
    const currentElo = gameEloRow?.rating ?? null

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
        eloAtRegistration: currentElo,
        status: 'REGISTERED',
        registrationMode,
        ...(resultNotifPref && { resultNotifPref }),
      },
      update: {
        status: 'REGISTERED',
        eloAtRegistration: currentElo,
        registrationMode,
        ...(resultNotifPref && { resultNotifPref }),
      },
    })

    await publish('tournament:participant:joined', { tournamentId }).catch(() => {})
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

    await publish('tournament:participant:left', { tournamentId }).catch(() => {})
    res.status(204).send()
  } catch (e) {
    next(e)
  }
})

// ─── Seed bots ───────────────────────────────────────────────────────────────
// Admin-managed bots that are automatically registered in every occurrence of a
// recurring tournament.  For one-off tournaments they register immediately.

const SKILL_LEVEL_MAP = {
  rusty: 'novice', novice: 'novice',
  copper: 'intermediate', intermediate: 'intermediate',
  sterling: 'advanced', advanced: 'advanced',
  magnus: 'master', master: 'master',
}

function makeSeedBotUsername(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  const uid = Math.random().toString(36).slice(2, 8)
  return `seedbot-${slug}-${uid}`
}

// GET /api/tournaments/:id/seed-bots
router.get('/:id/seed-bots', requireTournamentAdmin, async (req, res, next) => {
  try {
    const seeds = await db.tournamentSeedBot.findMany({
      where: { tournamentId: req.params.id },
      include: { user: { select: { id: true, displayName: true, botModelId: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ seedBots: seeds.map(s => ({
      id: s.id,
      userId: s.userId,
      displayName: s.user.displayName,
      botModelId: s.user.botModelId,
      skillLevel: s.user.botModelId?.split(':')[2] ?? null,
      createdAt: s.createdAt,
    })) })
  } catch (e) { next(e) }
})

// POST /api/tournaments/:id/seed-bots
// Body: { bots: [{ name: "Scarlett", skillLevel: "sterling" }] }
// Creates new bot users and registers them as participants + seed-bot config.
router.post('/:id/seed-bots', requireTournamentAdmin, async (req, res, next) => {
  try {
    const tournament = await db.tournament.findUnique({ where: { id: req.params.id } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    if (['COMPLETED', 'CANCELLED'].includes(tournament.status)) {
      return res.status(400).json({ error: `Cannot add seed bots to a ${tournament.status.toLowerCase()} tournament` })
    }

    const bots = req.body.bots
    if (!Array.isArray(bots) || bots.length === 0) {
      return res.status(400).json({ error: 'bots must be a non-empty array' })
    }

    const added = []
    for (const { name, skillLevel } of bots) {
      if (!name?.trim()) return res.status(400).json({ error: 'Each bot must have a name' })

      const skill = SKILL_LEVEL_MAP[skillLevel?.toLowerCase()] ?? 'intermediate'
      const username = makeSeedBotUsername(name.trim())
      const botModelId = `seed:${username}:${skill}`

      const user = await db.user.create({
        data: {
          username,
          email: `${username}@arena.test`,
          displayName: name.trim(),
          isBot: true,
          botActive: true,
          botAvailable: true,
          botCompetitive: true,
          botModelId,
          botModelType: 'minimax',
          nameConfirmed: true,
        },
      })

      await db.tournamentParticipant.upsert({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: user.id } },
        create: { tournamentId: tournament.id, userId: user.id, status: 'REGISTERED', registrationMode: 'SINGLE' },
        update: { status: 'REGISTERED' },
      })

      await db.tournamentSeedBot.upsert({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: user.id } },
        create: { tournamentId: tournament.id, userId: user.id },
        update: {},
      })

      added.push({ userId: user.id, displayName: user.displayName, botModelId, skillLevel: skill })
    }

    res.status(201).json({ added })
  } catch (e) { next(e) }
})

// DELETE /api/tournaments/:id/seed-bots/:botUserId
// Removes the seed-bot config and withdraws the bot from the tournament.
router.delete('/:id/seed-bots/:botUserId', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { id: tournamentId, botUserId } = req.params

    const seed = await db.tournamentSeedBot.findUnique({
      where: { tournamentId_userId: { tournamentId, userId: botUserId } },
    })
    if (!seed) return res.status(404).json({ error: 'Seed bot not found in this tournament' })

    await db.tournamentSeedBot.delete({
      where: { tournamentId_userId: { tournamentId, userId: botUserId } },
    })

    // Withdraw participant if registered (best-effort — may already be eliminated/completed)
    await db.tournamentParticipant.updateMany({
      where: { tournamentId, userId: botUserId, status: 'REGISTERED' },
      data: { status: 'WITHDRAWN' },
    })

    res.status(204).send()
  } catch (e) { next(e) }
})

export default router
