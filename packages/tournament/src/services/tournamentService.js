/**
 * Tournament service — orchestration layer.
 *
 * Handles all DB operations for tournament lifecycle:
 * create, publish, cancel, register, withdraw, start, completeMatch.
 */

import db from '@xo-arena/db'
import logger from '../logger.js'
import { generateBracket, generateRoundRobinSchedule } from '../lib/bracket.js'
import { publishEvent } from '../lib/redis.js'
import { enqueueJob } from '../lib/botJobQueue.js'
import { awardTournamentMerits, getOrCreateClassification } from './classificationService.js'

// ─── Internal config helper ───────────────────────────────────────────────────

async function _getSystemConfig(key, defaultValue) {
  try {
    const row = await db.systemConfig.findUnique({ where: { key } })
    return row?.value ?? defaultValue
  } catch {
    return defaultValue
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a tournament in DRAFT status.
 *
 * @param {object} data - Tournament fields
 * @param {string} createdByBetterAuthId - betterAuthId of the creator
 * @returns {Promise<object>} Created tournament record
 */
export async function createTournament(data, createdByBetterAuthId) {
  // Resolve domain user ID
  const creator = await db.user.findUnique({
    where: { betterAuthId: createdByBetterAuthId },
    select: { id: true },
  })
  if (!creator) throw new Error('Creator user not found')

  const tournament = await db.tournament.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      game: data.game,
      mode: data.mode,
      format: data.format,
      bracketType: data.bracketType ?? 'SINGLE_ELIM',
      status: 'DRAFT',
      minParticipants: data.minParticipants ?? 2,
      maxParticipants: data.maxParticipants ?? null,
      bestOfN: data.bestOfN ?? 3,
      botMinGamesPlayed: data.botMinGamesPlayed ?? null,
      allowNonCompetitiveBots: data.allowNonCompetitiveBots ?? false,
      allowSpectators: data.allowSpectators ?? true,
      replayRetentionDays: data.replayRetentionDays ?? 30,
      startTime: data.startTime ? new Date(data.startTime) : null,
      endTime: data.endTime ? new Date(data.endTime) : null,
      registrationOpenAt: data.registrationOpenAt ? new Date(data.registrationOpenAt) : null,
      registrationCloseAt: data.registrationCloseAt ? new Date(data.registrationCloseAt) : null,
      noticePeriodMinutes: data.noticePeriodMinutes ?? null,
      durationMinutes: data.durationMinutes ?? null,
      isRecurring: data.isRecurring ?? false,
      autoOptOutAfterMissed: data.autoOptOutAfterMissed ?? null,
      createdById: creator.id,
    },
  })

  logger.info({ tournamentId: tournament.id }, 'Tournament created')
  return tournament
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Update a tournament (only allowed in DRAFT status).
 *
 * @param {string} id - Tournament ID
 * @param {object} data - Fields to update
 * @param {string} actorBetterAuthId - betterAuthId of actor
 * @returns {Promise<object>} Updated tournament record
 */
export async function updateTournament(id, data, actorBetterAuthId) {
  const tournament = await db.tournament.findUnique({ where: { id } })
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 })
  if (tournament.status !== 'DRAFT') {
    throw Object.assign(new Error('Tournament can only be updated in DRAFT status'), { status: 409 })
  }

  const allowedFields = [
    'name', 'description', 'game', 'mode', 'format', 'bracketType',
    'minParticipants', 'maxParticipants', 'bestOfN', 'botMinGamesPlayed',
    'allowNonCompetitiveBots', 'allowSpectators', 'replayRetentionDays',
    'startTime', 'endTime', 'registrationOpenAt', 'registrationCloseAt',
    'noticePeriodMinutes', 'durationMinutes', 'isRecurring', 'autoOptOutAfterMissed',
  ]

  const updateData = {}
  for (const field of allowedFields) {
    if (field in data) {
      if (['startTime', 'endTime', 'registrationOpenAt', 'registrationCloseAt'].includes(field)) {
        updateData[field] = data[field] ? new Date(data[field]) : null
      } else {
        updateData[field] = data[field]
      }
    }
  }

  const updated = await db.tournament.update({ where: { id }, data: updateData })
  logger.info({ tournamentId: id, actorBetterAuthId }, 'Tournament updated')
  return updated
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish a tournament: DRAFT → REGISTRATION_OPEN.
 *
 * @param {string} id - Tournament ID
 * @param {string} actorBetterAuthId - betterAuthId of actor
 * @returns {Promise<object>} Updated tournament record
 */
export async function publishTournament(id, actorBetterAuthId) {
  const tournament = await db.tournament.findUnique({ where: { id } })
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 })
  if (tournament.status !== 'DRAFT') {
    throw Object.assign(new Error('Only DRAFT tournaments can be published'), { status: 409 })
  }

  const updated = await db.tournament.update({
    where: { id },
    data: { status: 'REGISTRATION_OPEN' },
  })

  logger.info({ tournamentId: id, actorBetterAuthId }, 'Tournament published')
  return updated
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

/**
 * Cancel a tournament.
 * Publishes tournament:cancelled Redis event with all participant user IDs.
 *
 * @param {string} id - Tournament ID
 * @param {string} actorBetterAuthId - betterAuthId of actor (or 'system' for auto-cancel)
 * @returns {Promise<object>} Updated tournament record
 */
export async function cancelTournament(id, actorBetterAuthId) {
  const tournament = await db.tournament.findUnique({
    where: { id },
    include: {
      participants: {
        where: { status: { notIn: ['WITHDRAWN', 'ELIMINATED'] } },
        include: { user: { select: { betterAuthId: true } } },
      },
    },
  })
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 })

  const terminalStatuses = ['COMPLETED', 'CANCELLED']
  if (terminalStatuses.includes(tournament.status)) {
    throw Object.assign(new Error('Tournament is already in a terminal state'), { status: 409 })
  }

  const updated = await db.tournament.update({
    where: { id },
    data: { status: 'CANCELLED' },
  })

  const participantUserIds = tournament.participants
    .map(p => p.user?.betterAuthId)
    .filter(Boolean)

  await publishEvent('tournament:cancelled', {
    tournamentId: id,
    participantUserIds,
  })

  logger.info({ tournamentId: id, actorBetterAuthId }, 'Tournament cancelled')
  return updated
}

// ─── Register ────────────────────────────────────────────────────────────────

/**
 * Register a participant in a tournament.
 *
 * @param {string} tournamentId - Tournament ID
 * @param {string} betterAuthId - betterAuthId of the user registering
 * @returns {Promise<object>} Created TournamentParticipant record
 */
export async function registerParticipant(tournamentId, betterAuthId) {
  // Look up the domain user
  const user = await db.user.findUnique({
    where: { betterAuthId },
    select: {
      id: true,
      eloRating: true,
      isBot: true,
      botActive: true,
      botAvailable: true,
      botProvisional: true,
      botCompetitive: true,
      botGamesPlayed: true,
      preferences: true,
    },
  })
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })

  // Fetch tournament with participant count
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      _count: { select: { participants: { where: { status: { notIn: ['WITHDRAWN'] } } } } },
    },
  })
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 })

  if (tournament.status !== 'REGISTRATION_OPEN') {
    throw Object.assign(new Error('Tournament is not open for registration'), { status: 409 })
  }

  // Bot eligibility checks for BOT_VS_BOT tournaments
  if (tournament.mode === 'BOT_VS_BOT') {
    if (!user.isBot) {
      throw Object.assign(new Error('Only bots may register for BOT_VS_BOT tournaments'), { status: 409 })
    }
    if (!user.botActive) {
      throw Object.assign(new Error('Bot is not active'), { status: 409 })
    }
    if (!user.botAvailable) {
      throw Object.assign(new Error('Bot is not available'), { status: 409 })
    }
    if (user.botProvisional) {
      throw Object.assign(new Error('Provisional bots may not enter tournaments'), { status: 409 })
    }

    const minGames = tournament.botMinGamesPlayed
      ?? await _getSystemConfig('tournament.botMatch.minGamesPlayed', 0)
    if (user.botGamesPlayed < minGames) {
      throw Object.assign(
        new Error(`Bot has insufficient games played (${user.botGamesPlayed} < ${minGames})`),
        { status: 409 }
      )
    }
    if (!tournament.allowNonCompetitiveBots && !user.botCompetitive) {
      throw Object.assign(new Error('Non-competitive bots are not allowed in this tournament'), { status: 409 })
    }
  }

  // MIXED mode: both humans and bots may register — no additional restriction beyond the above

  // Check maxParticipants
  if (
    tournament.maxParticipants !== null &&
    tournament._count.participants >= tournament.maxParticipants
  ) {
    throw Object.assign(new Error('Tournament is full'), { status: 409 })
  }

  // Check for existing active registration
  const existing = await db.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId, userId: user.id } },
  })
  if (existing) {
    if (existing.status !== 'WITHDRAWN') {
      throw Object.assign(new Error('Already registered for this tournament'), { status: 409 })
    }
    // Re-activate a withdrawn registration
    const userNotifPref = user.preferences?.tournamentResultNotifPref
    const reactivated = await db.tournamentParticipant.update({
      where: { id: existing.id },
      data: {
        status: 'REGISTERED',
        eloAtRegistration: user.eloRating,
        registeredAt: new Date(),
        ...(userNotifPref === 'AS_PLAYED' || userNotifPref === 'END_OF_TOURNAMENT'
          ? { resultNotifPref: userNotifPref }
          : {}),
      },
    })
    logger.info({ tournamentId, userId: user.id }, 'Participant re-registered')
    return reactivated
  }

  // Ensure classification record exists (creates RECRUIT/0 if first time)
  await getOrCreateClassification(user.id).catch(err =>
    logger.warn({ err, userId: user.id }, 'Failed to bootstrap classification')
  )

  const userNotifPref = user.preferences?.tournamentResultNotifPref
  const participant = await db.tournamentParticipant.create({
    data: {
      tournamentId,
      userId: user.id,
      eloAtRegistration: user.eloRating,
      status: 'REGISTERED',
      ...(userNotifPref === 'AS_PLAYED' || userNotifPref === 'END_OF_TOURNAMENT'
        ? { resultNotifPref: userNotifPref }
        : {}),
    },
  })

  logger.info({ tournamentId, userId: user.id }, 'Participant registered')
  return participant
}

// ─── Withdraw ────────────────────────────────────────────────────────────────

/**
 * Withdraw a participant from a tournament.
 *
 * @param {string} tournamentId - Tournament ID
 * @param {string} betterAuthId - betterAuthId of the user withdrawing
 * @returns {Promise<object>} Updated TournamentParticipant record
 */
export async function withdrawParticipant(tournamentId, betterAuthId) {
  const user = await db.user.findUnique({
    where: { betterAuthId },
    select: { id: true },
  })
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })

  const tournament = await db.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 })

  const allowedStatuses = ['REGISTRATION_OPEN', 'DRAFT']
  if (!allowedStatuses.includes(tournament.status)) {
    throw Object.assign(
      new Error('Cannot withdraw after registration has closed'),
      { status: 409 }
    )
  }

  const participant = await db.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId, userId: user.id } },
  })
  if (!participant || participant.status === 'WITHDRAWN') {
    throw Object.assign(new Error('Not registered for this tournament'), { status: 404 })
  }

  const updated = await db.tournamentParticipant.update({
    where: { id: participant.id },
    data: { status: 'WITHDRAWN' },
  })

  logger.info({ tournamentId, userId: user.id }, 'Participant withdrawn')
  return updated
}

// ─── Start ───────────────────────────────────────────────────────────────────

/**
 * Start a tournament: close registration, seed participants, generate bracket,
 * set IN_PROGRESS. Auto-cancels if minParticipants not met.
 *
 * @param {string} id - Tournament ID
 * @param {string} actorBetterAuthId - betterAuthId of actor
 * @returns {Promise<{ tournament, rounds, matches }>}
 */
export async function startTournament(id, actorBetterAuthId) {
  const tournament = await db.tournament.findUnique({
    where: { id },
    include: {
      participants: {
        where: { status: { notIn: ['WITHDRAWN'] } },
        include: { user: { select: { betterAuthId: true, eloRating: true } } },
      },
    },
  })
  if (!tournament) throw Object.assign(new Error('Tournament not found'), { status: 404 })

  const allowedStatuses = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED']
  if (!allowedStatuses.includes(tournament.status)) {
    throw Object.assign(new Error('Tournament cannot be started in its current state'), { status: 409 })
  }

  // Check minParticipants
  if (tournament.participants.length < tournament.minParticipants) {
    logger.warn(
      { tournamentId: id, count: tournament.participants.length, min: tournament.minParticipants },
      'Tournament auto-cancelled — insufficient participants'
    )
    await cancelTournament(id, 'system')
    throw Object.assign(
      new Error(`Insufficient participants (${tournament.participants.length}/${tournament.minParticipants}) — tournament cancelled`),
      { status: 422 }
    )
  }

  // Close registration (skip for OPEN format — goes directly to IN_PROGRESS)
  if (tournament.format !== 'OPEN') {
    await db.tournament.update({
      where: { id },
      data: { status: 'REGISTRATION_CLOSED' },
    })
  }

  // Seed participants (sorted by eloAtRegistration descending)
  const participantsForBracket = tournament.participants.map(p => ({
    id: p.id,
    userId: p.userId,
    eloAtRegistration: p.eloAtRegistration ?? 1200,
  }))

  // Generate bracket (SINGLE_ELIM or ROUND_ROBIN)
  let bracketRounds
  if (tournament.bracketType === 'ROUND_ROBIN') {
    bracketRounds = generateRoundRobinSchedule(participantsForBracket)
  } else {
    bracketRounds = generateBracket(participantsForBracket)
  }

  // Persist rounds and matches
  const createdRounds = []
  const createdMatches = []

  for (const roundDef of bracketRounds) {
    const round = await db.tournamentRound.create({
      data: {
        tournamentId: id,
        roundNumber: roundDef.roundNumber,
        status: 'PENDING',
      },
    })
    createdRounds.push(round)

    for (const matchDef of roundDef.matches) {
      const match = await db.tournamentMatch.create({
        data: {
          tournamentId: id,
          roundId: round.id,
          participant1Id: matchDef.participant1Id,
          participant2Id: matchDef.participant2Id,
          status: 'PENDING',
          p1Wins: 0,
          p2Wins: 0,
          drawGames: 0,
        },
      })
      createdMatches.push(match)
    }
  }

  // Set tournament IN_PROGRESS
  const updatedTournament = await db.tournament.update({
    where: { id },
    data: { status: 'IN_PROGRESS' },
  })

  // For FLASH format, ensure endTime is set
  if (tournament.format === 'FLASH' && tournament.durationMinutes && !tournament.endTime) {
    const startedAt = new Date()
    const endTime = new Date(startedAt.getTime() + tournament.durationMinutes * 60 * 1000)
    await db.tournament.update({
      where: { id },
      data: { endTime },
    })
  }

  if (tournament.bracketType === 'ROUND_ROBIN') {
    // Round robin: all rounds and all matches start IN_PROGRESS simultaneously
    for (const round of createdRounds) {
      await db.tournamentRound.update({ where: { id: round.id }, data: { status: 'IN_PROGRESS' } })
    }
    for (const match of createdMatches) {
      await db.tournamentMatch.update({ where: { id: match.id }, data: { status: 'IN_PROGRESS' } })
      await _dispatchMatch(tournament, match)
    }
    // All participants start as ACTIVE in round robin
    for (const p of tournament.participants) {
      await db.tournamentParticipant.update({
        where: { id: p.id },
        data: { status: 'ACTIVE' },
      })
    }
  } else {
    // SINGLE_ELIM: round 1 only, BYE handling
    const round1 = createdRounds[0]
    if (round1) {
      await db.tournamentRound.update({
        where: { id: round1.id },
        data: { status: 'IN_PROGRESS' },
      })

      const round1Matches = createdMatches.filter(m => m.roundId === round1.id)
      for (const match of round1Matches) {
        if (match.participant1Id && !match.participant2Id) {
          // BYE — participant1 auto-advances
          await db.tournamentMatch.update({
            where: { id: match.id },
            data: {
              status: 'COMPLETED',
              winnerId: match.participant1Id,
              completedAt: new Date(),
            },
          })

          // Mark participant1 as ACTIVE (they're in the tournament)
          await db.tournamentParticipant.update({
            where: { id: match.participant1Id },
            data: { status: 'ACTIVE' },
          })

          // Advance to next round immediately
          await _advanceWinner(
            match.participant1Id,
            round1.id,
            match.id,
            id,
            createdRounds,
            createdMatches
          )
        } else if (match.participant1Id && match.participant2Id) {
          // Real match — set to IN_PROGRESS and publish event (PVP) or enqueue (BOT_VS_BOT)
          await db.tournamentMatch.update({
            where: { id: match.id },
            data: { status: 'IN_PROGRESS' },
          })

          await _dispatchMatch(tournament, match)
        }
      }
    }
  }

  logger.info({ tournamentId: id, actorBetterAuthId }, 'Tournament started')
  return { tournament: updatedTournament, rounds: createdRounds, matches: createdMatches }
}

// ─── Complete Match ───────────────────────────────────────────────────────────

/**
 * Complete a match: record result, advance winner, check round/tournament completion.
 *
 * @param {string} matchId - TournamentMatch ID
 * @param {string} winnerId - participant ID of the winner
 * @param {{ p1Wins: number, p2Wins: number, drawGames: number, drawResolution?: string }} result
 * @returns {Promise<{ match, tournament }>}
 */
export async function completeMatch(matchId, winnerId, { p1Wins, p2Wins, drawGames, drawResolution }) {
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      round: {
        include: {
          tournament: true,
          matches: true,
        },
      },
    },
  })
  if (!match) throw Object.assign(new Error('Match not found'), { status: 404 })
  if (match.status === 'COMPLETED') {
    throw Object.assign(new Error('Match is already completed'), { status: 409 })
  }

  const tournament = match.round.tournament

  // Update match to COMPLETED
  await db.tournamentMatch.update({
    where: { id: matchId },
    data: {
      status: 'COMPLETED',
      winnerId,
      p1Wins: p1Wins ?? 0,
      p2Wins: p2Wins ?? 0,
      drawGames: drawGames ?? 0,
      drawResolution: drawResolution ?? null,
      completedAt: new Date(),
    },
  })

  // For MIXED human-vs-bot matches, write a Game record.
  // (BOT_VS_BOT records it in the worker; PVP records it in socketHandler; MIXED h-vs-b records it here)
  if (tournament.mode === 'MIXED' && match.participant1Id && match.participant2Id) {
    const p1Participant = await db.tournamentParticipant.findUnique({
      where: { id: match.participant1Id },
      include: { user: { select: { id: true, isBot: true } } },
    })
    const p2Participant = await db.tournamentParticipant.findUnique({
      where: { id: match.participant2Id },
      include: { user: { select: { id: true, isBot: true } } },
    })
    const p1User = p1Participant?.user
    const p2User = p2Participant?.user

    if (p1User && p2User && (p1User.isBot !== p2User.isBot)) {
      // human vs bot pairing — write Game row
      const winnerUser = winnerId === match.participant1Id ? p1User : p2User
      const outcome = winnerId === match.participant1Id ? 'PLAYER1_WIN'
        : winnerId === match.participant2Id ? 'PLAYER2_WIN'
        : 'DRAW'
      await db.game.create({
        data: {
          appId: tournament.game,
          player1Id: p1User.id,
          player2Id: p2User.id,
          winnerId: winnerId ? winnerUser?.id ?? null : null,
          mode: 'PVBOT',
          outcome,
          totalMoves: 0,
          durationMs: 0,
          startedAt: match.createdAt ?? new Date(),
          tournamentId: tournament.id,
          tournamentMatchId: match.id,
        },
      })
    }
  }

  let updatedTournament = tournament

  if (tournament.bracketType === 'ROUND_ROBIN') {
    // Award points (2 for win, 1 each for draw, 0 for loss)
    const isDraw = !winnerId
    if (isDraw) {
      // Both get 1 point
      if (match.participant1Id) {
        await db.tournamentParticipant.update({
          where: { id: match.participant1Id },
          data: { points: { increment: 1 } },
        })
      }
      if (match.participant2Id) {
        await db.tournamentParticipant.update({
          where: { id: match.participant2Id },
          data: { points: { increment: 1 } },
        })
      }
    } else {
      // Winner gets 2, loser gets 0 (no update needed for loser)
      await db.tournamentParticipant.update({
        where: { id: winnerId },
        data: { points: { increment: 2 } },
      })
    }

    // Check if all tournament matches are complete
    const allTournamentMatches = await db.tournamentMatch.findMany({
      where: { tournamentId: tournament.id },
    })
    const allDone = allTournamentMatches.every(
      m => m.id === matchId ? true : m.status === 'COMPLETED'
    )

    if (allDone) {
      updatedTournament = await _completeRoundRobinTournament(tournament.id)
    }

    const updatedMatch = await db.tournamentMatch.findUnique({ where: { id: matchId } })
    return { match: updatedMatch, tournament: updatedTournament }
  }

  // SINGLE_ELIM path: eliminate loser, advance winner, check round/tournament completion

  // Mark loser as ELIMINATED
  const loserId = winnerId === match.participant1Id ? match.participant2Id : match.participant1Id
  if (loserId) {
    await db.tournamentParticipant.update({
      where: { id: loserId },
      data: { status: 'ELIMINATED' },
    })
  }

  // Mark winner as ACTIVE (if not already)
  if (winnerId) {
    await db.tournamentParticipant.update({
      where: { id: winnerId },
      data: { status: 'ACTIVE' },
    })
  }

  // Fetch all rounds for this tournament (needed for advancement)
  const allRounds = await db.tournamentRound.findMany({
    where: { tournamentId: tournament.id },
    orderBy: { roundNumber: 'asc' },
  })
  const allMatches = await db.tournamentMatch.findMany({
    where: { tournamentId: tournament.id },
  })

  // Advance winner to the next round
  if (winnerId) {
    await _advanceWinner(winnerId, match.roundId, matchId, tournament.id, allRounds, allMatches)
  }

  // Check if the current round is complete
  const currentRoundMatches = allMatches.filter(m => m.roundId === match.roundId)
  const allCurrentRoundDone = currentRoundMatches.every(
    m => m.id === matchId ? true : m.status === 'COMPLETED'
  )

  if (allCurrentRoundDone) {
    // Mark current round completed
    await db.tournamentRound.update({
      where: { id: match.roundId },
      data: { status: 'COMPLETED' },
    })

    const currentRound = allRounds.find(r => r.id === match.roundId)
    const nextRound = allRounds.find(r => r.roundNumber === (currentRound?.roundNumber ?? 0) + 1)

    if (nextRound) {
      // Set next round IN_PROGRESS
      await db.tournamentRound.update({
        where: { id: nextRound.id },
        data: { status: 'IN_PROGRESS' },
      })

      // Set next round matches to IN_PROGRESS and publish match:ready events (PVP) or enqueue (BOT_VS_BOT)
      const nextRoundMatches = allMatches.filter(m => m.roundId === nextRound.id)
      for (const nextMatch of nextRoundMatches) {
        // Re-fetch to get updated participant IDs
        const freshMatch = await db.tournamentMatch.findUnique({ where: { id: nextMatch.id } })
        if (freshMatch?.participant1Id && freshMatch?.participant2Id) {
          await db.tournamentMatch.update({
            where: { id: freshMatch.id },
            data: { status: 'IN_PROGRESS' },
          })

          await _dispatchMatch(tournament, freshMatch)
        }
      }
    } else {
      // No next round — this was the final round → tournament COMPLETED
      updatedTournament = await _completeTournament(tournament.id)
    }
  }

  const updatedMatch = await db.tournamentMatch.findUnique({ where: { id: matchId } })
  return { match: updatedMatch, tournament: updatedTournament }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Dispatch a match: bot-vs-bot → enqueue server-side job;
 * human-vs-human or human-vs-bot → publish tournament:match:ready for client-side play.
 *
 * Works for all tournament modes (PVP, BOT_VS_BOT, MIXED).
 */
async function _dispatchMatch(tournament, match) {
  const p1 = await db.tournamentParticipant.findUnique({
    where: { id: match.participant1Id },
    include: { user: { select: { betterAuthId: true, isBot: true } } },
  })
  const p2 = await db.tournamentParticipant.findUnique({
    where: { id: match.participant2Id },
    include: { user: { select: { betterAuthId: true, isBot: true } } },
  })

  const p1IsBot = p1?.user?.isBot ?? false
  const p2IsBot = p2?.user?.isBot ?? false

  if (p1IsBot && p2IsBot) {
    await enqueueJob(match.id, tournament.id)
  } else {
    await publishEvent('tournament:match:ready', {
      tournamentId: tournament.id,
      matchId: match.id,
      participant1UserId: p1?.user?.betterAuthId ?? p1?.userId,
      participant2UserId: p2?.user?.betterAuthId ?? p2?.userId,
    })
  }
}

/**
 * Advance a winner to the next round's match.
 * Finds the current match's position in the round and places the winner
 * in the corresponding slot of the next round match.
 *
 * @param {string} winnerId - participant ID
 * @param {string} currentRoundId - current round DB ID
 * @param {string} currentMatchId - current match DB ID
 * @param {string} tournamentId
 * @param {object[]} allRounds - sorted by roundNumber asc
 * @param {object[]} allMatches
 */
async function _advanceWinner(winnerId, currentRoundId, currentMatchId, tournamentId, allRounds, allMatches) {
  const currentRound = allRounds.find(r => r.id === currentRoundId)
  if (!currentRound) return

  const nextRound = allRounds.find(r => r.roundNumber === currentRound.roundNumber + 1)
  if (!nextRound) return // Final round — no advancement needed

  // Determine position of current match within its round
  const currentRoundMatches = allMatches
    .filter(m => m.roundId === currentRoundId)
    .sort((a, b) => a.createdAt > b.createdAt ? 1 : -1)

  const matchIndex = currentRoundMatches.findIndex(m => m.id === currentMatchId)
  if (matchIndex === -1) return

  // Next round match index = Math.floor(matchIndex / 2)
  const nextMatchIndex = Math.floor(matchIndex / 2)
  // Whether winner goes into participant1 or participant2 slot
  const isParticipant1Slot = matchIndex % 2 === 0

  const nextRoundMatches = allMatches
    .filter(m => m.roundId === nextRound.id)
    .sort((a, b) => a.createdAt > b.createdAt ? 1 : -1)

  const nextMatch = nextRoundMatches[nextMatchIndex]
  if (!nextMatch) return

  await db.tournamentMatch.update({
    where: { id: nextMatch.id },
    data: isParticipant1Slot
      ? { participant1Id: winnerId }
      : { participant2Id: winnerId },
  })
}

/**
 * Complete a tournament: set status COMPLETED, record final positions for all participants.
 *
 * @param {string} tournamentId
 * @returns {Promise<object>} Updated tournament
 */
async function _completeTournament(tournamentId) {
  // Determine final standings based on elimination round
  // Winner of the final match = 1st place
  // All other participants ranked by how far they got (later rounds = better placement)
  const allRounds = await db.tournamentRound.findMany({
    where: { tournamentId },
    orderBy: { roundNumber: 'asc' },
  })
  const allMatches = await db.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'asc' },
  })
  const participants = await db.tournamentParticipant.findMany({
    where: { tournamentId, status: { notIn: ['WITHDRAWN'] } },
    include: { user: { select: { betterAuthId: true } } },
  })

  const totalRounds = allRounds.length

  // Build a map: participantId → last round they participated in
  const participantLastRound = new Map()

  for (const match of allMatches) {
    if (match.status !== 'COMPLETED') continue
    const round = allRounds.find(r => r.id === match.roundId)
    if (!round) continue

    const updateIfLater = (pid) => {
      if (!pid) return
      const current = participantLastRound.get(pid) ?? 0
      if (round.roundNumber > current) {
        participantLastRound.set(pid, round.roundNumber)
      }
    }
    updateIfLater(match.participant1Id)
    updateIfLater(match.participant2Id)
    // Winner gets credit for advancing (last round = totalRounds for the champion)
    if (match.winnerId) {
      const winnerCurrent = participantLastRound.get(match.winnerId) ?? 0
      if (round.roundNumber >= winnerCurrent) {
        participantLastRound.set(match.winnerId, round.roundNumber + 0.5) // winner of round slightly higher
      }
    }
  }

  // Find the overall tournament winner (winner of the last round's match)
  const finalRound = allRounds[allRounds.length - 1]
  const finalMatch = allMatches.find(m => m.roundId === finalRound?.id && m.status === 'COMPLETED')
  const tournamentWinnerId = finalMatch?.winnerId ?? null

  // Sort participants: tournament winner first, then by last round descending
  const ranked = [...participants].sort((a, b) => {
    if (a.id === tournamentWinnerId) return -1
    if (b.id === tournamentWinnerId) return 1
    const aRound = participantLastRound.get(a.id) ?? 0
    const bRound = participantLastRound.get(b.id) ?? 0
    return bRound - aRound
  })

  const totalParticipants = ranked.length

  // Assign final positions and update DB
  const finalStandings = []
  for (let i = 0; i < ranked.length; i++) {
    const p = ranked[i]
    const position = i + 1
    const positionPct = totalParticipants > 1
      ? ((totalParticipants - position) / (totalParticipants - 1)) * 100
      : 100

    await db.tournamentParticipant.update({
      where: { id: p.id },
      data: {
        finalPosition: position,
        finalPositionPct: positionPct,
        status: p.id === tournamentWinnerId ? 'ACTIVE' : 'ELIMINATED',
      },
    })

    finalStandings.push({
      userId: p.user?.betterAuthId ?? p.userId,
      position,
    })
  }

  const updated = await db.tournament.update({
    where: { id: tournamentId },
    data: { status: 'COMPLETED' },
  })

  // Phase 2: Award merits based on finish positions
  await awardTournamentMerits(tournamentId)

  await publishEvent('tournament:completed', {
    tournamentId,
    finalStandings,
  })

  logger.info({ tournamentId }, 'Tournament completed')
  return updated
}

/**
 * Complete a round-robin tournament: calculate standings by points,
 * tiebreak by head-to-head wins (p1Wins when winner is the participant),
 * assign final positions, mark COMPLETED.
 */
async function _completeRoundRobinTournament(tournamentId) {
  const participants = await db.tournamentParticipant.findMany({
    where: { tournamentId, status: { notIn: ['WITHDRAWN'] } },
    include: { user: { select: { betterAuthId: true } } },
  })

  const matches = await db.tournamentMatch.findMany({
    where: { tournamentId },
  })

  // Tiebreak: count total wins (matches where winnerId === participant.id)
  const winCounts = new Map()
  for (const p of participants) {
    const wins = matches.filter(m => m.winnerId === p.id).length
    winCounts.set(p.id, wins)
  }

  // Sort: by points desc, then wins desc, then eloAtRegistration desc
  const ranked = [...participants].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    const bWins = winCounts.get(b.id) ?? 0
    const aWins = winCounts.get(a.id) ?? 0
    if (bWins !== aWins) return bWins - aWins
    return (b.eloAtRegistration ?? 0) - (a.eloAtRegistration ?? 0)
  })

  const totalParticipants = ranked.length

  const finalStandings = []
  for (let i = 0; i < ranked.length; i++) {
    const p = ranked[i]
    const position = i + 1
    const positionPct = totalParticipants > 1
      ? ((totalParticipants - position) / (totalParticipants - 1)) * 100
      : 100

    await db.tournamentParticipant.update({
      where: { id: p.id },
      data: {
        finalPosition: position,
        finalPositionPct: positionPct,
        status: position === 1 ? 'ACTIVE' : 'ELIMINATED',
      },
    })

    finalStandings.push({
      userId: p.user?.betterAuthId ?? p.userId,
      position,
    })
  }

  const updated = await db.tournament.update({
    where: { id: tournamentId },
    data: { status: 'COMPLETED' },
  })

  // Phase 2: award merits
  await awardTournamentMerits(tournamentId)

  await publishEvent('tournament:completed', { tournamentId, finalStandings })
  logger.info({ tournamentId }, 'Round robin tournament completed')
  return updated
}

// ─── Force Resolve Match ──────────────────────────────────────────────────────

/**
 * Force-resolve a match at flash tournament close time.
 * Uses current series score; if tied applies draw cascade (ELO then random).
 *
 * @param {string} matchId
 * @returns {Promise<void>}
 */
export async function forceResolveMatch(matchId) {
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      round: { include: { tournament: true } },
    },
  })
  if (!match || match.status === 'COMPLETED') return

  let winnerId = null
  let drawResolution = null

  if (match.p1Wins > match.p2Wins) {
    winnerId = match.participant1Id
  } else if (match.p2Wins > match.p1Wins) {
    winnerId = match.participant2Id
  } else {
    // Tied — ELO tiebreak: higher ELO at registration wins
    const p1 = match.participant1Id
      ? await db.tournamentParticipant.findUnique({ where: { id: match.participant1Id } })
      : null
    const p2 = match.participant2Id
      ? await db.tournamentParticipant.findUnique({ where: { id: match.participant2Id } })
      : null

    if (p1?.eloAtRegistration !== p2?.eloAtRegistration &&
        p1?.eloAtRegistration != null && p2?.eloAtRegistration != null) {
      winnerId = (p1.eloAtRegistration > p2.eloAtRegistration)
        ? match.participant1Id
        : match.participant2Id
      drawResolution = 'ELO'
    } else {
      // Random
      winnerId = Math.random() < 0.5 ? match.participant1Id : match.participant2Id
      drawResolution = 'RANDOM'
    }
  }

  await completeMatch(matchId, winnerId, {
    p1Wins: match.p1Wins,
    p2Wins: match.p2Wins,
    drawGames: match.drawGames,
    drawResolution,
  })
}
