// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Curriculum Cup clone service (Intelligent Guide §5.4).
 *
 * Spawns a fresh, single-elimination 4-bot tournament for one user:
 *   1 of the user's bots
 *   2 fresh ownerless bot User rows cloned from the Rusty persona
 *   1 fresh ownerless bot User row cloned from the Copper persona
 *
 * Opponent display names are drawn without replacement from the per-tier
 * curated pools (curriculumNamePools.js) so each cup feels distinct. The
 * cloned bot User rows are private to this cup — the 30-day GC sweep
 * (tournamentSweep.js) deletes them with the cup itself.
 *
 * Returned shape: `{ status, body }` so the route handler is a thin map.
 */

import db from './db.js'
import { publish } from './redis.js'
import { CURRICULUM_CUP_CONFIG } from '../config/curriculumCupConfig.js'
import { pickNames } from '../config/curriculumNamePools.js'

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Create a fresh ownerless bot User row cloned from the named built-in
 * persona, with the chosen displayName drawn from the cup's name pool.
 * Returns the new User row.
 */
async function cloneCupOpponent({ builtinUsername, displayName }) {
  const persona = await db.user.findUnique({
    where:  { username: builtinUsername },
    select: { id: true, isBot: true, botModelType: true, botModelId: true, botCompetitive: true, avatarUrl: true },
  })
  if (!persona?.isBot) {
    throw new Error(`Cup persona '${builtinUsername}' is missing — re-run seed?`)
  }

  const slug     = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cup-bot'
  const suffix   = randomSuffix()
  const username = `bot-cup-${slug}-${suffix}`
  const email    = `${username}@xo-arena.internal`
  const botModelId = persona.botModelId
    ? `${persona.botModelId}:cup:${suffix}`
    : `builtin:${persona.botModelType ?? 'minimax'}:novice:cup:${suffix}`

  return db.user.create({
    data: {
      username, email,
      displayName,
      avatarUrl:      persona.avatarUrl ?? null,
      isBot:          true,
      botOwnerId:     null,
      botModelType:   persona.botModelType,
      botModelId,
      botActive:      true,
      botCompetitive: false,
      botAvailable:   false,   // cup-only — not eligible for general bracket fills
    },
    select: { id: true, displayName: true, botModelId: true, isBot: true },
  })
}

/**
 * Pick which of the caller's bots enters the cup. If `myBotId` is provided,
 * validate ownership; otherwise auto-pick the user's most-recent bot.
 * Returns the bot User row, or `{ error }` if no eligible bot is found.
 */
export async function selectCallerBot({ callerId, myBotId }) {
  if (myBotId) {
    const bot = await db.user.findUnique({
      where:  { id: myBotId },
      select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true, botOwnerId: true },
    })
    if (!bot?.isBot)              return { error: { status: 404, message: 'Bot not found' } }
    if (bot.botOwnerId !== callerId) return { error: { status: 403, message: 'You do not own this bot' } }
    if (!bot.botActive)            return { error: { status: 409, message: 'Bot is inactive' } }
    return { bot }
  }

  const bot = await db.user.findFirst({
    where:   { botOwnerId: callerId, isBot: true, botActive: true },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, displayName: true, botModelId: true, isBot: true, botActive: true, botOwnerId: true },
  })
  if (!bot) return { error: { status: 400, message: 'No bot found — create one in Quick Bot first.' } }
  return { bot }
}

/**
 * Build the bracket for a 4-participant SINGLE_ELIM cup. Creates round 1
 * (2 matches) and round 2 (1 match, participants TBD), and publishes
 * `tournament:bot:match:ready` for the round-1 matches so the bot game
 * runner picks them up. Round 2 is filled when round 1 completes by the
 * existing bracket-progression machinery.
 *
 * Pairings honor `seedPosition`: (0 vs 1), (2 vs 3) — caller's bot at slot 0
 * faces a Rusty opponent in round 1, mirroring §5.4's "your bot draws an
 * easier first round" rationale.
 */
async function startCupBracket({ tournament, participants }) {
  const sorted = [...participants].sort((a, b) => (a.seedPosition ?? 0) - (b.seedPosition ?? 0))

  const round = await db.tournamentRound.create({
    data: { tournamentId: tournament.id, roundNumber: 1, status: 'IN_PROGRESS' },
  })

  for (let i = 0; i < sorted.length; i += 2) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]

    const match = await db.tournamentMatch.create({
      data: {
        tournamentId:   tournament.id,
        roundId:        round.id,
        participant1Id: p1.id,
        participant2Id: p2.id,
        status:         'PENDING',
      },
    })

    // Cup is BVB end-to-end (user spectates), so always bot:match:ready.
    await publish('tournament:bot:match:ready', {
      tournamentId: tournament.id,
      matchId:      match.id,
      gameId:       tournament.game,
      bestOfN:      tournament.bestOfN,
      bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
      bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
    })
  }
}

/**
 * Clone a Curriculum Cup for the calling user.
 *
 * @param {object} args
 * @param {string} args.callerId — domain User.id of the human cloning the cup
 * @param {string} [args.myBotId] — optional bot to enter; auto-picked if absent
 * @param {() => number} [args.rng] — name-pool RNG, injectable for tests
 * @returns {Promise<{status:number, body:object}>}
 */
export async function cloneCurriculumCup({ callerId, myBotId, rng = Math.random }) {
  if (!callerId) return { status: 400, body: { error: 'callerId required' } }

  const sel = await selectCallerBot({ callerId, myBotId })
  if (sel.error) return { status: sel.error.status, body: { error: sel.error.message } }
  const callerBot = sel.bot

  // Draw opponent display names per the cup config.
  const slotsByTier = CURRICULUM_CUP_CONFIG.opponentSlots.reduce((acc, s) => {
    acc[s.tier] = (acc[s.tier] ?? 0) + 1
    return acc
  }, {})
  const drawnByTier = {}
  for (const tier of Object.keys(slotsByTier)) {
    drawnByTier[tier] = pickNames(tier, slotsByTier[tier], rng)
  }
  const opponentSpecs = CURRICULUM_CUP_CONFIG.opponentSlots.map((s) => ({
    tier:            s.tier,
    builtinUsername: s.builtinUsername,
    displayName:     drawnByTier[s.tier].shift(),
  }))

  // Spawn opponent bot User rows.
  const opponents = []
  for (const spec of opponentSpecs) {
    const bot = await cloneCupOpponent({ builtinUsername: spec.builtinUsername, displayName: spec.displayName })
    opponents.push(bot)
  }

  // Create the Tournament row directly in IN_PROGRESS — no registration window.
  const now = new Date()
  const tournament = await db.tournament.create({
    data: {
      name:                CURRICULUM_CUP_CONFIG.name,
      game:                CURRICULUM_CUP_CONFIG.game,
      mode:                CURRICULUM_CUP_CONFIG.mode,
      format:              CURRICULUM_CUP_CONFIG.format,
      bracketType:         CURRICULUM_CUP_CONFIG.bracketType,
      minParticipants:     CURRICULUM_CUP_CONFIG.minParticipants,
      maxParticipants:     CURRICULUM_CUP_CONFIG.maxParticipants,
      bestOfN:             CURRICULUM_CUP_CONFIG.bestOfN,
      paceMs:              CURRICULUM_CUP_CONFIG.paceMs,
      status:              'IN_PROGRESS',
      isCup:               true,
      seedingMode:         'deterministic',
      createdById:         callerId,
      startTime:           now,
      registrationOpenAt:  now,
      registrationCloseAt: now,
    },
    select: { id: true, name: true, game: true, bestOfN: true },
  })

  // Slot 0 = user's bot. Slots 1-3 = opponents in declared order. The
  // (0 vs 1), (2 vs 3) pairing means the user's bot faces an opponent
  // (Rusty by default per CURRICULUM_CUP_CONFIG.opponentSlots ordering).
  const participantInputs = [
    { user: callerBot, seedPosition: 0 },
    ...opponents.map((opp, i) => ({ user: opp, seedPosition: i + 1 })),
  ]
  const participants = []
  for (const input of participantInputs) {
    const p = await db.tournamentParticipant.create({
      data: {
        tournamentId:     tournament.id,
        userId:           input.user.id,
        status:           'REGISTERED',
        registrationMode: 'SINGLE',
        seedPosition:        input.seedPosition,
      },
      select: { id: true, seedPosition: true },
    })
    participants.push({ ...p, user: input.user })
  }

  // Fire the journey step 6 trigger for the user (mirrors a regular
  // /register publish so the backend bridge credits step 6).
  await publish('tournament:participant:joined', {
    tournamentId: tournament.id,
    userId:       callerId,
  }).catch(() => {})

  // Build round 1 + publish bot match-ready events.
  await startCupBracket({ tournament, participants })

  await publish('tournament:started', {
    tournamentId: tournament.id,
    name:         tournament.name,
  }).catch(() => {})

  return {
    status: 201,
    body: {
      tournament,
      participants: participants.map(p => ({
        id:          p.id,
        seedPosition:   p.seedPosition,
        userId:      p.user.id,
        displayName: p.user.displayName,
        isCallerBot: p.user.id === callerBot.id,
      })),
    },
  }
}
