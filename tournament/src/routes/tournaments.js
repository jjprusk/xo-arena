// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import db from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { optionalAuth, requireAuth, requireTournamentAdmin, isTournamentAdmin } from '../middleware/auth.js'
import { cleanupSeededBots } from '../lib/tournamentSweep.js'
import { checkRecurringOccurrences } from '../lib/recurringScheduler.js'
import { computeTemplateEndDate } from '../lib/templateDefaults.js'
import { cloneAndSeedPersona, seedExistingSystemBot, syncTemplateSeedsToTournament } from '../lib/seedBotService.js'
import { assertBotHasSkillForGame } from '../lib/registrationGuards.js'
import { cloneCurriculumCup } from '../lib/curriculumCupService.js'
import { expectedGameCount } from '../lib/bracketMath.js'

// Coerce a client-supplied date-ish value to a Prisma-safe value.
// Crucially, empty string / null must map to `null`, NOT `new Date(null)`
// which is the Unix epoch (a footgun when the client sends `null` to clear
// an optional date field).
function toDate(v) {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const router = Router()

// GET /api/tournaments
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { status, game, includeTest } = req.query

    const isAdmin = req.auth?.userId ? await isTournamentAdmin(req.auth.userId) : false
    // Test tournaments (e2e-created) are hidden from everyone by default.
    // Admins can opt in with ?includeTest=true to see them in the admin UI.
    const showTest = isAdmin && (includeTest === 'true' || includeTest === '1')

    const where = {}
    if (status) where.status = status
    if (game) where.game = game
    if (!isAdmin) {
      where.status = where.status
        ? { equals: where.status, not: 'DRAFT' }
        : { not: 'DRAFT' }
    }
    if (!showTest) where.isTest = false

    // Curriculum / Rookie Cups (§5.4 / §5.8) are private to the creator. Hide
    // them from everyone else — guests too. Admins still see all cups so they
    // can investigate abuse / runaway state.
    if (!isAdmin) {
      const callerDbId = req.auth?.dbUserId ?? null
      if (callerDbId) {
        where.OR = [{ isCup: false }, { isCup: true, createdById: callerDbId }]
      } else {
        where.isCup = false
      }
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
        isTest: true,
        startTime: true,
        endTime: true,
        registrationOpenAt: true,
        registrationCloseAt: true,
        templateId: true,
        createdAt: true,
        _count: { select: { participants: true, games: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // If authenticated, annotate each tournament with whether the viewer is already registered
    let myTournamentIds = new Set()
    if (req.auth?.userId && tournaments.length > 0) {
      const myParticipations = await db.tournamentParticipant.findMany({
        where: {
          tournamentId: { in: tournaments.map(t => t.id) },
          user: { betterAuthId: req.auth.userId },
        },
        select: { tournamentId: true },
      })
      myTournamentIds = new Set(myParticipations.map(p => p.tournamentId))
    }

    res.json({
      tournaments: tournaments.map(t => {
        const gamesPlayed   = t._count?.games        ?? 0
        const participants  = t._count?.participants ?? 0
        const expectedGames = expectedGameCount(t.bracketType, participants, t.bestOfN)
        // Surface as runawayRatio (actual/expected). Admin UI turns red
        // at >3, sweep auto-cancels at >5 (tournamentSweep.js).
        const runawayRatio  = expectedGames > 0 ? gamesPlayed / expectedGames : 0
        return {
          ...t,
          isRegisteredByViewer: myTournamentIds.has(t.id),
          gamesPlayed,
          expectedGames,
          runawayRatio,
        }
      }),
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/curriculum-cup/clone
//
// Spawns a fresh Curriculum Cup for the calling user (Intelligent Guide
// §5.4). Creates 3 ownerless opponent bots cloned from Rusty/Copper, builds
// a 4-bot single-elim bracket with the user's bot at slot 0, and starts
// the bracket immediately (no registration window). Step 6 fires through
// the standard `tournament:participant:joined` publish.
//
// Body: { myBotId? } — auto-picks the user's most-recent bot if omitted.
router.post('/curriculum-cup/clone', requireAuth, async (req, res, next) => {
  try {
    const callerId = req.auth?.dbUserId
    if (!callerId) return res.status(401).json({ error: 'Unauthorized' })

    const { myBotId } = req.body ?? {}
    const result = await cloneCurriculumCup({ callerId, myBotId })
    res.status(result.status).json(result.body)
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
            // botOwnerId is exposed so the UI can flag "this bot is yours" in
            // bracket / participants list / spectate header — a Curriculum Cup
            // shows 4 bots and the user has no other way to spot theirs.
            user: { select: { id: true, betterAuthId: true, displayName: true, avatarUrl: true, isBot: true, botOwnerId: true } },
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
      noticePeriodMinutes, durationMinutes, isRecurring,
      startMode, isTest,
    } = req.body

    // Phase 3.7a stage 3: recurrence is owned by TournamentTemplate. Callers
    // must use POST /api/tournaments/admin/templates for recurring creates.
    if (isRecurring) {
      return res.status(400).json({
        error: 'Recurring tournaments are created via POST /api/tournaments/admin/templates. Drop isRecurring from the POST /api/tournaments payload.',
      })
    }

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
    if (registrationCloseAt && startTime && toDate(registrationCloseAt) > toDate(startTime)) {
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
        ...(startTime !== undefined && { startTime: toDate(startTime) }),
        ...(endTime !== undefined && { endTime: toDate(endTime) }),
        ...(registrationOpenAt !== undefined && { registrationOpenAt: toDate(registrationOpenAt) }),
        ...(registrationCloseAt !== undefined && { registrationCloseAt: toDate(registrationCloseAt) }),
        ...(noticePeriodMinutes !== undefined && { noticePeriodMinutes }),
        ...(durationMinutes !== undefined && { durationMinutes }),
        ...(isTest !== undefined && { isTest: !!isTest }),
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
      noticePeriodMinutes, durationMinutes,
      startMode, isTest,
    } = req.body

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }
    const VALID_START_MODES = ['AUTO', 'SCHEDULED', 'MANUAL']
    if (startMode !== undefined && !VALID_START_MODES.includes(startMode)) {
      return res.status(400).json({ error: 'startMode must be AUTO, SCHEDULED, or MANUAL' })
    }
    if (registrationCloseAt && startTime && toDate(registrationCloseAt) > toDate(startTime)) {
      return res.status(400).json({ error: 'registrationCloseAt must be before startTime' })
    }

    // status is intentionally excluded — use dedicated endpoints.
    // Recurrence fields (interval / end / paused / auto-opt-out) live on
    // TournamentTemplate and are edited via PATCH /admin/templates/:id —
    // not mirrored here.
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
      ...(startTime !== undefined && { startTime: toDate(startTime) }),
      ...(endTime !== undefined && { endTime: toDate(endTime) }),
      ...(registrationOpenAt !== undefined && { registrationOpenAt: toDate(registrationOpenAt) }),
      ...(registrationCloseAt !== undefined && { registrationCloseAt: toDate(registrationCloseAt) }),
      ...(noticePeriodMinutes !== undefined && { noticePeriodMinutes }),
      ...(durationMinutes !== undefined && { durationMinutes }),
      ...(isTest !== undefined && { isTest: !!isTest }),
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

    // Enroll template seed bots onto this tournament. If seed bots were
    // added to the template while the sibling was still DRAFT, the per-seed
    // backfill may have missed them (or this is a scheduler-spawned
    // occurrence that needs its seeds hydrated at publish time).
    await syncTemplateSeedsToTournament(tournament.id, tournament.templateId)

    if (tournament.format === 'FLASH') {
      await publish('tournament:flash:announced', {
        tournamentId: tournament.id,
        name: tournament.name,
        noticePeriodMinutes: tournament.noticePeriodMinutes,
      })
    }

    // Notify all connected users that a new tournament is open. Include the
    // tournament's timing fields so the backend bridge can set a dynamic
    // expiresAt on each per-user notification row — the "registration open"
    // message is noise once registration closes (or the tournament starts).
    await publish('tournament:published', {
      tournamentId: tournament.id,
      name: tournament.name,
      format: tournament.format,
      mode: tournament.mode,
      startTime:           tournament.startTime?.toISOString()           ?? null,
      registrationCloseAt: tournament.registrationCloseAt?.toISOString() ?? null,
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

    cleanupSeededBots(tournament.id).catch(() => {})

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

          if (p1.user.isBot && p2.user.isBot) {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              gameId: tournament.game,
              bestOfN: tournament.bestOfN,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
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

          if (p1.user.isBot && p2.user.isBot) {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              gameId: tournament.game,
              bestOfN: tournament.bestOfN,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
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

// POST /api/tournaments/:id/fill-qa-bots
// Creates (if needed) and registers N QA bots into a tournament.
// Bots are named qabot-01..qabot-N with botModelId testbot:qabot-NN:<difficulty>.
// Not idempotent on the bot accounts themselves (upsert), but idempotent on registration.
const QA_DIFFICULTIES = ['novice', 'intermediate', 'advanced', 'master']
router.post('/:id/fill-qa-bots', requireTournamentAdmin, async (req, res, next) => {
  try {
    const rawCount = Number(req.body.count)
    const count = isNaN(rawCount) ? 20 : Math.max(2, Math.min(32, rawCount))
    const difficulty = QA_DIFFICULTIES.includes(req.body.difficulty) ? req.body.difficulty : 'novice'
    const tournamentId = req.params.id

    const tournament = await db.tournament.findUnique({ where: { id: tournamentId } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(tournament.status)) {
      return res.status(400).json({ error: `Cannot add bots to a ${tournament.status.toLowerCase()} tournament` })
    }

    const registered = []
    const skipped    = []

    for (let i = 1; i <= count; i++) {
      const username  = `qabot-${String(i).padStart(2, '0')}`
      const modelId   = `testbot:${username}:${difficulty}`

      const bot = await db.user.upsert({
        where:  { username },
        create: {
          username,
          email:         `${username}@arena.test`,
          displayName:   `QA Bot ${String(i).padStart(2, '0')}`,
          isBot:         true,
          botActive:     true,
          botModelId:    modelId,
          nameConfirmed: true,
          gameElo: { create: { gameId: 'xo', rating: 1200 } },
        },
        update: { botModelId: modelId, botActive: true },
      })

      const existing = await db.tournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId, userId: bot.id } },
      })
      if (existing && existing.status !== 'WITHDRAWN') {
        skipped.push(username)
        continue
      }

      await db.tournamentParticipant.upsert({
        where:  { tournamentId_userId: { tournamentId, userId: bot.id } },
        create: { tournamentId, userId: bot.id, status: 'REGISTERED' },
        update: { status: 'REGISTERED' },
      })
      registered.push(username)
    }

    res.json({ registered, skipped, total: count })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/add-seeded-bot
// Creates a one-off disposable bot at a chosen difficulty and registers it.
// Body: { difficulty: 'novice'|'intermediate'|'advanced'|'master', displayName?: string }
const SEEDED_BOT_DIFFICULTIES = { novice: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced', master: 'Master' }
router.post('/:id/add-seeded-bot', requireTournamentAdmin, async (req, res, next) => {
  try {
    const tournamentId = req.params.id
    const difficulty = SEEDED_BOT_DIFFICULTIES[req.body.difficulty] ? req.body.difficulty : 'intermediate'
    const rawName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : ''
    const displayName = rawName.length > 0 ? rawName.slice(0, 40) : `${SEEDED_BOT_DIFFICULTIES[difficulty]} Bot`

    const tournament = await db.tournament.findUnique({ where: { id: tournamentId } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    if (['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(tournament.status)) {
      return res.status(400).json({ error: `Cannot add bots to a ${tournament.status.toLowerCase()} tournament` })
    }
    if (tournament.maxParticipants) {
      const count = await db.tournamentParticipant.count({
        where: { tournamentId, status: { not: 'WITHDRAWN' } },
      })
      if (count >= tournament.maxParticipants) {
        return res.status(400).json({ error: 'Tournament is full' })
      }
    }

    // Generate a short unique suffix so the bot username is unique across tournaments
    const suffix = `${tournamentId.slice(-6)}-${Date.now().toString(36)}`
    const username  = `seeded-${difficulty}-${suffix}`
    const modelId   = `testbot:${username}:${difficulty}`

    const bot = await db.user.create({
      data: {
        username,
        email:         `${username}@arena.test`,
        displayName,
        isBot:         true,
        botActive:     true,
        botModelId:    modelId,
        nameConfirmed: true,
        gameElo: { create: { gameId: tournament.game ?? 'xo', rating: 1200 } },
      },
    })

    await db.tournamentParticipant.create({
      data: { tournamentId, userId: bot.id, status: 'REGISTERED' },
    })

    res.json({ added: 1, displayName: bot.displayName, difficulty, userId: bot.id })
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

    // Intelligent Guide v1 — email verification gate (§3.5.4).
    // Signup no longer blocks on verification; tournament entry is where the
    // gate moves to. A user with an unverified email cannot register
    // themselves OR their bot in any tournament, Cup-tier or otherwise.
    // Returns 403 with a code the client can key off to prompt a resend.
    const baId = req.auth.userId
    if (baId) {
      const baUser = await db.baUser.findUnique({
        where: { id: baId },
        select: { emailVerified: true },
      })
      if (baUser && baUser.emailVerified === false) {
        return res.status(403).json({
          error:  'Email verification required to enter tournaments',
          code:   'EMAIL_VERIFICATION_REQUIRED',
        })
      }
    }

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

    // Pre-open gate: status can flip to REGISTRATION_OPEN (e.g., after an
    // admin publish, or if the scheduler spawns with status=REGISTRATION_OPEN
    // before `registrationOpenAt`), but we still refuse registrations until
    // the open time arrives.
    if (tournament.registrationOpenAt && new Date(tournament.registrationOpenAt) > new Date()) {
      return res.status(400).json({ error: 'Tournament registration is not yet open' })
    }

    // Effective close = explicit `registrationCloseAt`, otherwise `startTime`.
    // Null close means registration closes when the tournament starts.
    const effectiveClose = tournament.registrationCloseAt ?? tournament.startTime
    if (effectiveClose && new Date(effectiveClose) <= new Date()) {
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

    // Phase 3.8.2.5 / 3.8.5.3 — a bot can only enter a tournament if it has
    // a BotSkill for the tournament's game.
    const skillCheck = await assertBotHasSkillForGame({
      db,
      userId,
      isBot:  user.isBot,
      gameId: tournament.game,
    })
    if (!skillCheck.ok) return res.status(skillCheck.status).json(skillCheck.body)

    const gameEloRow = await db.gameElo.findUnique({
      where: { userId_gameId: { userId, gameId: tournament.game } },
      select: { rating: true },
    })
    const currentElo = gameEloRow?.rating ?? null

    let registrationMode = 'SINGLE'
    if (tournament.templateId) {
      const recurringReg = await db.recurringTournamentRegistration.findUnique({
        where: { templateId_userId: { templateId: tournament.templateId, userId } },
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

    // Include userId so the backend bridge can fire Curriculum step 6
    // (Intelligent Guide §5.4) for the registering human user.
    await publish('tournament:participant:joined', { tournamentId, userId }).catch(() => {})
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

      // Phase 3.7a propagation: if this tournament is tied to a template,
      // mirror the seed onto TournamentTemplateSeedBot so scheduler-spawned
      // occurrences inherit the seed. Without this, legacy `addSeedBots`
      // callers only populated the current occurrence.
      if (tournament.templateId) {
        await db.tournamentTemplateSeedBot.upsert({
          where:  { templateId_userId: { templateId: tournament.templateId, userId: user.id } },
          create: { templateId: tournament.templateId, userId: user.id },
          update: {},
        }).catch(() => {})
      }

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

    // Phase 3.7a propagation (mirror of POST): if this tournament is tied
    // to a template, also drop the template-seed row so future spawned
    // occurrences don't re-include the bot.
    const tournament = await db.tournament.findUnique({
      where: { id: tournamentId },
      select: { templateId: true },
    })
    if (tournament?.templateId) {
      await db.tournamentTemplateSeedBot.deleteMany({
        where: { templateId: tournament.templateId, userId: botUserId },
      }).catch(() => {})
    }

    res.status(204).send()
  } catch (e) { next(e) }
})

// DELETE /api/tournaments/admin/purge-cancelled
// Hard-deletes all CANCELLED tournaments and their related data (admin only).
router.delete('/admin/purge-cancelled', requireTournamentAdmin, async (req, res, next) => {
  try {
    // Collect seeded-bot user IDs before cascade-deleting participants
    const cancelled = await db.tournament.findMany({
      where: { status: 'CANCELLED' },
      select: { id: true },
    })
    const tournamentIds = cancelled.map(t => t.id)

    if (tournamentIds.length > 0) {
      const seededParticipants = await db.tournamentParticipant.findMany({
        where: { tournamentId: { in: tournamentIds } },
        include: { user: { select: { id: true, username: true } } },
      })
      const seededIds = seededParticipants
        .filter(p => p.user?.username?.startsWith('seeded-'))
        .map(p => p.user.id)
      if (seededIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: seededIds } } })
      }
    }

    const result = await db.tournament.deleteMany({ where: { status: 'CANCELLED' } })
    res.json({ deleted: result.count })
  } catch (e) {
    next(e)
  }
})

// DELETE /api/tournaments/admin/purge-test
// Hard-deletes all tournaments flagged as test (admin only). Seeded bots
// created for those tournaments are cascaded the same way purge-cancelled
// handles them.
router.delete('/admin/purge-test', requireTournamentAdmin, async (req, res, next) => {
  try {
    const testTournaments = await db.tournament.findMany({
      where: { isTest: true },
      select: { id: true },
    })
    const tournamentIds = testTournaments.map(t => t.id)

    if (tournamentIds.length > 0) {
      const seededParticipants = await db.tournamentParticipant.findMany({
        where: { tournamentId: { in: tournamentIds } },
        include: { user: { select: { id: true, username: true } } },
      })
      const seededIds = seededParticipants
        .filter(p => p.user?.username?.startsWith('seeded-'))
        .map(p => p.user.id)
      if (seededIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: seededIds } } })
      }
    }

    const result = await db.tournament.deleteMany({ where: { isTest: true } })
    res.json({ deleted: result.count })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/:id/admin/force-complete
// Admin/QA shortcut: mark a tournament COMPLETED without playing out its
// bracket. Useful for testing the recurring sweep and for cleaning up
// stuck tournaments. Not exposed in normal UI.
router.post('/:id/admin/force-complete', requireTournamentAdmin, async (req, res, next) => {
  try {
    const tournament = await db.tournament.findUnique({ where: { id: req.params.id } })
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    const updated = await db.tournament.update({
      where: { id: req.params.id },
      data:  { status: 'COMPLETED', endTime: new Date() },
    })
    res.json({ tournament: updated })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/admin/scheduler/check-recurring
// Manually fires the recurring-occurrence check. Useful in QA (no 60s wait)
// and as an admin "kick" if the scheduler appears stuck.
router.post('/admin/scheduler/check-recurring', requireTournamentAdmin, async (req, res, next) => {
  try {
    // Manual admin trigger processes test-flagged templates too — QA specs
    // rely on this to spawn occurrences on demand without waiting 60s.
    const summary = await checkRecurringOccurrences({ includeTest: true })
    res.json(summary)
  } catch (e) {
    next(e)
  }
})

// GET /api/tournaments/admin/templates
// Phase 3.7a admin view: list all recurring-tournament templates with
// subscriber count + last-occurrence info so the admin Tournaments page
// can render its new "Templates" tab. Occurrences are still listed via
// the existing GET / (the public list — admins can toggle isTest via
// that path).
router.get('/admin/templates', requireTournamentAdmin, async (req, res, next) => {
  try {
    const templates = await db.tournamentTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { subscriptions: true, seedBots: true, tournaments: true } },
      },
    })
    // Attach the most-recent occurrence per template for a quick status peek.
    const results = await Promise.all(templates.map(async (t) => {
      const lastOccurrence = await db.tournament.findFirst({
        where:   { templateId: t.id },
        orderBy: { startTime: 'desc' },
        select:  { id: true, startTime: true, status: true },
      })
      return {
        id:                      t.id,
        name:                    t.name,
        game:                    t.game,
        mode:                    t.mode,
        format:                  t.format,
        bracketType:             t.bracketType,
        minParticipants:         t.minParticipants,
        maxParticipants:         t.maxParticipants,
        recurrenceInterval:      t.recurrenceInterval,
        recurrenceStart:         t.recurrenceStart,
        recurrenceEndDate:       t.recurrenceEndDate,
        paused:                  t.paused,
        isTest:                  t.isTest,
        createdById:             t.createdById,
        createdAt:               t.createdAt,
        subscriberCount:         t._count.subscriptions,
        seedBotCount:            t._count.seedBots,
        occurrenceCount:         t._count.tournaments,
        lastOccurrence,
      }
    }))
    res.json({ templates: results })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/admin/templates
// Phase 3.7a stage 2: template-first create. Writes TournamentTemplate
// directly (canonical home for recurrence config) and materialises a
// sibling Tournament row with the same id to preserve first-occurrence
// display semantics during the cutover — existing admin list UI still
// shows a "first tournament" alongside the template, and seed-bot /
// publish endpoints keyed on tournamentId still work.
// Callers: landing Create-Tournament form when `isRecurring` is checked.
// POST /api/tournaments rejects isRecurring:true — recurring creates must
// go through this endpoint (stage 3).
router.post('/admin/templates', requireTournamentAdmin, async (req, res, next) => {
  try {
    const {
      name, description, game, mode, format, bracketType,
      minParticipants, maxParticipants, bestOfN, botMinGamesPlayed,
      allowNonCompetitiveBots, allowSpectators, paceMs, startMode,
      noticePeriodMinutes, durationMinutes,
      recurrenceInterval, recurrenceStart, recurrenceEndDate,
      registrationOpenAt, registrationCloseAt,
      paused, autoOptOutAfterMissed, isTest,
    } = req.body

    if (!name?.trim())        return res.status(400).json({ error: 'name is required' })
    if (!game)                return res.status(400).json({ error: 'game is required' })
    if (!mode)                return res.status(400).json({ error: 'mode is required' })
    if (!format)              return res.status(400).json({ error: 'format is required' })
    if (!bracketType)         return res.status(400).json({ error: 'bracketType is required' })
    if (!recurrenceInterval)  return res.status(400).json({ error: 'recurrenceInterval is required for a template' })

    // Scheduler anchor: recurrenceStart is required on TournamentTemplate.
    // Fall back to registrationCloseAt / registrationOpenAt when the admin
    // created the template in AUTO mode without an explicit start (UX
    // mirrors the old POST /tournaments dual-write).
    const anchor = toDate(recurrenceStart) ?? toDate(registrationCloseAt) ?? toDate(registrationOpenAt)
    if (!anchor) {
      return res.status(400).json({ error: 'recurrenceStart (or registrationCloseAt / registrationOpenAt) is required' })
    }

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }

    // Test-flagged templates auto-expire 24h after their start anchor unless
    // the caller specified an explicit end date. Belt-and-suspenders TTL: a
    // crashed spec that never runs cleanup still can't leak a daily template
    // forever — the scheduler honours recurrenceEndDate already.
    const explicitEnd = recurrenceEndDate !== undefined ? toDate(recurrenceEndDate) : undefined
    const effectiveEnd = computeTemplateEndDate(anchor, !!isTest, explicitEnd)

    const templateData = {
      name: name.trim(),
      description, game, mode, format, bracketType,
      recurrenceInterval,
      recurrenceStart: anchor,
      createdById: req.auth.userId,
      ...(minParticipants !== undefined && { minParticipants }),
      ...(maxParticipants !== undefined && { maxParticipants }),
      ...(bestOfN !== undefined && { bestOfN }),
      ...(botMinGamesPlayed !== undefined && { botMinGamesPlayed }),
      ...(allowNonCompetitiveBots !== undefined && { allowNonCompetitiveBots }),
      ...(allowSpectators !== undefined && { allowSpectators }),
      ...(noticePeriodMinutes !== undefined && { noticePeriodMinutes }),
      ...(durationMinutes !== undefined && { durationMinutes }),
      ...(paceMs !== undefined && { paceMs }),
      ...(startMode !== undefined && { startMode }),
      ...(effectiveEnd !== undefined && { recurrenceEndDate: effectiveEnd }),
      ...(registrationOpenAt !== undefined  && { registrationOpenAt:  toDate(registrationOpenAt) }),
      ...(registrationCloseAt !== undefined && { registrationCloseAt: toDate(registrationCloseAt) }),
      ...(paused !== undefined && { paused: !!paused }),
      ...(autoOptOutAfterMissed !== undefined && { autoOptOutAfterMissed }),
      ...(isTest !== undefined && { isTest: !!isTest }),
    }

    const template = await db.tournamentTemplate.create({ data: templateData })

    // Sibling first-occurrence Tournament row — same id so existing admin
    // list / publish / seed-bot endpoints continue to work during the
    // cutover. Status DRAFT until admin publishes explicitly. The deprecated
    // Tournament.recurrence* columns are still written for backward compat
    // with readers that haven't been migrated; stage 3 removes them.
    const siblingTournamentStartTime = toDate(recurrenceStart) ?? anchor
    await db.tournament.create({
      data: {
        id: template.id,
        name: template.name,
        description: template.description,
        game: template.game,
        mode: template.mode,
        format: template.format,
        bracketType: template.bracketType,
        status: 'DRAFT',
        createdById: req.auth.userId,
        templateId: template.id,
        minParticipants: template.minParticipants,
        maxParticipants: template.maxParticipants,
        bestOfN: template.bestOfN,
        botMinGamesPlayed: template.botMinGamesPlayed,
        allowNonCompetitiveBots: template.allowNonCompetitiveBots,
        allowSpectators: template.allowSpectators,
        noticePeriodMinutes: template.noticePeriodMinutes,
        durationMinutes: template.durationMinutes,
        paceMs: template.paceMs,
        startMode: template.startMode,
        startTime: siblingTournamentStartTime,
        registrationOpenAt: template.registrationOpenAt,
        registrationCloseAt: template.registrationCloseAt,
        isTest: template.isTest,
      },
    }).catch(err => {
      req.log?.warn?.({ err, templateId: template.id }, 'sibling Tournament row create failed (template still ok)')
    })

    res.status(201).json({ template })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/admin/templates/:id/pause
router.post('/admin/templates/:id/pause', requireTournamentAdmin, async (req, res, next) => {
  try {
    const template = await db.tournamentTemplate.update({
      where: { id: req.params.id },
      data:  { paused: true },
    })
    res.json({ template })
  } catch (e) {
    next(e)
  }
})

// POST /api/tournaments/admin/templates/:id/unpause
router.post('/admin/templates/:id/unpause', requireTournamentAdmin, async (req, res, next) => {
  try {
    const template = await db.tournamentTemplate.update({
      where: { id: req.params.id },
      data:  { paused: false },
    })
    res.json({ template })
  } catch (e) {
    next(e)
  }
})

// GET /api/tournaments/admin/templates/:id
// Single template detail with counts + recent occurrences. Drives the
// admin drill-in page.
router.get('/admin/templates/:id', requireTournamentAdmin, async (req, res, next) => {
  try {
    const template = await db.tournamentTemplate.findUnique({
      where:  { id: req.params.id },
      include: {
        _count:  { select: { subscriptions: true, seedBots: true, tournaments: true } },
        seedBots: {
          include: { user: { select: { id: true, username: true, displayName: true, isBot: true, botOwnerId: true } } },
        },
      },
    })
    if (!template) return res.status(404).json({ error: 'Template not found' })

    const occurrences = await db.tournament.findMany({
      where:  { templateId: template.id },
      orderBy: { startTime: 'desc' },
      take: 50,
      select: {
        id: true, status: true, startTime: true, endTime: true,
        _count: { select: { participants: true } },
      },
    })

    res.json({ template, occurrences })
  } catch (e) {
    next(e)
  }
})

// PATCH /api/tournaments/admin/templates/:id
// Template-specific edit — only fields that live on the template row.
// Updates the Tournament row with the matching id too (first occurrence
// carries the config today), so the legacy admin view stays in sync.
router.patch('/admin/templates/:id', requireTournamentAdmin, async (req, res, next) => {
  try {
    const {
      name, description, game, mode, format, bracketType,
      minParticipants, maxParticipants, bestOfN, botMinGamesPlayed,
      allowNonCompetitiveBots, allowSpectators, paceMs, startMode,
      noticePeriodMinutes, durationMinutes,
      recurrenceInterval, recurrenceStart, recurrenceEndDate,
      registrationOpenAt, registrationCloseAt,
      paused, autoOptOutAfterMissed, isTest,
    } = req.body

    if (bestOfN !== undefined && (bestOfN < 1 || bestOfN % 2 === 0)) {
      return res.status(400).json({ error: 'bestOfN must be a positive odd number (1, 3, 5, ...)' })
    }

    const templateData = {
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
      ...(allowSpectators !== undefined && { allowSpectators }),
      ...(paceMs !== undefined && { paceMs }),
      ...(startMode !== undefined && { startMode }),
      ...(noticePeriodMinutes !== undefined && { noticePeriodMinutes }),
      ...(durationMinutes !== undefined && { durationMinutes }),
      ...(recurrenceInterval !== undefined && { recurrenceInterval }),
      ...(recurrenceStart !== undefined && { recurrenceStart: toDate(recurrenceStart) }),
      ...(recurrenceEndDate !== undefined && { recurrenceEndDate: toDate(recurrenceEndDate) }),
      ...(registrationOpenAt  !== undefined && { registrationOpenAt:  toDate(registrationOpenAt) }),
      ...(registrationCloseAt !== undefined && { registrationCloseAt: toDate(registrationCloseAt) }),
      ...(paused !== undefined && { paused: !!paused }),
      ...(autoOptOutAfterMissed !== undefined && { autoOptOutAfterMissed }),
      ...(isTest !== undefined && { isTest: !!isTest }),
    }
    const template = await db.tournamentTemplate.update({
      where: { id: req.params.id },
      data:  templateData,
    })

    // Mirror the relevant fields back onto the Tournament row with the same
    // id (the first-occurrence row). Stage 3: recurrence fields (interval /
    // end / paused / auto-opt-out) live only on the template now, so the
    // mirror is limited to display metadata + registration window + the
    // startTime → recurrenceStart mapping. Non-fatal.
    await db.tournament.updateMany({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(minParticipants !== undefined && { minParticipants }),
        ...(maxParticipants !== undefined && { maxParticipants }),
        ...(bestOfN !== undefined && { bestOfN }),
        ...(recurrenceStart !== undefined && { startTime: toDate(recurrenceStart) }),
        ...(registrationOpenAt  !== undefined && { registrationOpenAt:  toDate(registrationOpenAt) }),
        ...(registrationCloseAt !== undefined && { registrationCloseAt: toDate(registrationCloseAt) }),
        ...(isTest !== undefined && { isTest: !!isTest }),
      },
    }).catch(() => {})

    // Also push display metadata (name / description / isTest / participant
    // bounds / bestOfN) onto scheduler-spawned occurrences that are still
    // upcoming or open. Otherwise a template rename leaves already-spawned
    // occurrences displaying the old name in the public / admin list.
    // Completed/cancelled/in-progress occurrences are frozen — their
    // historical name is part of the record.
    const occurrenceMetadata = {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(minParticipants !== undefined && { minParticipants }),
      ...(maxParticipants !== undefined && { maxParticipants }),
      ...(bestOfN !== undefined && { bestOfN }),
      ...(isTest !== undefined && { isTest: !!isTest }),
    }
    if (Object.keys(occurrenceMetadata).length > 0) {
      await db.tournament.updateMany({
        where: {
          templateId: req.params.id,
          id:     { not: req.params.id },                        // skip the sibling row (already done above)
          status: { in: ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] },
        },
        data: occurrenceMetadata,
      }).catch(() => {})
    }

    res.json({ template })
  } catch (e) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Template not found' })
    next(e)
  }
})

// DELETE /api/tournaments/admin/templates/:id
// Removes the template. Cascade drops subscriptions + template seed bots.
// Occurrences keep their history (templateId FK has ON DELETE SET NULL).
router.delete('/admin/templates/:id', requireTournamentAdmin, async (req, res, next) => {
  try {
    await db.tournamentTemplate.delete({ where: { id: req.params.id } })
    // Phase 3.7a dual-write cleanup: unlink any tournaments pointing at the
    // deleted template (sibling row + scheduler-spawned occurrences). Keeps
    // the tournaments intact — games/participants may be attached — but
    // routes them through the regular admin-tournament UI instead of a
    // template-detail page that 404s.
    await db.tournament.updateMany({
      where: { OR: [{ id: req.params.id }, { templateId: req.params.id }] },
      data:  { templateId: null },
    }).catch(() => {})
    res.json({ ok: true })
  } catch (e) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Template not found' })
    next(e)
  }
})

// POST /api/tournaments/admin/templates/:id/seed-bots
// Two modes:
//   (A) { userId }                           — seed an existing system bot
//   (B) { personaBotId, displayName }        — clone persona → new system bot,
//                                              then seed it on this template
// Idempotent for mode (A): a second call for (template, userId) is a no-op.
router.post('/admin/templates/:id/seed-bots', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { userId, personaBotId, displayName } = req.body ?? {}
    const result = personaBotId
      ? await cloneAndSeedPersona({ templateId: req.params.id, personaBotId, displayName })
      : await seedExistingSystemBot({ templateId: req.params.id, userId })
    res.status(result.status).json(result.body)
  } catch (e) {
    next(e)
  }
})

// DELETE /api/tournaments/admin/templates/:id/seed-bots/:userId
router.delete('/admin/templates/:id/seed-bots/:userId', requireTournamentAdmin, async (req, res, next) => {
  try {
    const { id: templateId, userId } = req.params
    await db.tournamentTemplateSeedBot.delete({
      where: { templateId_userId: { templateId, userId } },
    })
    // Inverse of backfillOpenOccurrences: when seed-add enrolls the bot on
    // every pre-game occurrence, removal must withdraw it from the same set
    // so the underlying User row remains deletable (FK to participants is
    // RESTRICT). Frozen occurrences (IN_PROGRESS / COMPLETED / CANCELLED)
    // retain their participant row — that's historical record.
    const openOccurrences = await db.tournament.findMany({
      where:  { templateId, status: { in: ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] } },
      select: { id: true },
    })
    for (const occ of openOccurrences) {
      await db.tournamentSeedBot.deleteMany({
        where: { tournamentId: occ.id, userId },
      }).catch(() => {})
      await db.tournamentParticipant.deleteMany({
        where: { tournamentId: occ.id, userId },
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (e) {
    if (e?.code === 'P2025') return res.status(404).json({ error: 'Seed bot not found on this template' })
    next(e)
  }
})

export default router
