// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Seed-bot add helpers for Phase 3.7a template-based flow.
 *
 * Extracted from the route handler so the validation branches are
 * exercisable without spinning up Express. Each helper returns an
 * object shaped like `{ status, body }` — the route maps that straight
 * to a response.
 */

import db from './db.js'

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Enroll a seeded bot into every current pre-game occurrence of the template.
 * Without this, seed bots added *after* an occurrence spawned would only
 * start appearing in future occurrences — surprising behavior. Covers DRAFT
 * and REGISTRATION_OPEN (and CLOSED, which is still pre-game) so this works
 * whether the sibling tournament was published before or after the seed add.
 * Each step is best-effort; conflicts and misses are swallowed so the
 * primary seed add still succeeds.
 */
async function backfillOpenOccurrences(templateId, userId) {
  const openOccurrences = await db.tournament.findMany({
    where:  { templateId, status: { in: ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] } },
    select: { id: true },
  })
  for (const occ of openOccurrences) {
    await db.tournamentParticipant.upsert({
      where:  { tournamentId_userId: { tournamentId: occ.id, userId } },
      create: { tournamentId: occ.id, userId, status: 'REGISTERED', registrationMode: 'SINGLE' },
      update: { status: 'REGISTERED' },
    }).catch(() => {})
    await db.tournamentSeedBot.upsert({
      where:  { tournamentId_userId: { tournamentId: occ.id, userId } },
      create: { tournamentId: occ.id, userId },
      update: {},
    }).catch(() => {})
  }
}

/**
 * Enroll every template seed bot into a single tournament (typically the
 * sibling row at publish time, or a freshly-spawned occurrence). Inverse
 * direction of backfillOpenOccurrences — one tournament, all seeds.
 */
export async function syncTemplateSeedsToTournament(tournamentId, templateId) {
  if (!templateId) return
  const seeds = await db.tournamentTemplateSeedBot.findMany({
    where:  { templateId },
    select: { userId: true },
  })
  for (const { userId } of seeds) {
    await db.tournamentParticipant.upsert({
      where:  { tournamentId_userId: { tournamentId, userId } },
      create: { tournamentId, userId, status: 'REGISTERED', registrationMode: 'SINGLE' },
      update: { status: 'REGISTERED' },
    }).catch(() => {})
    await db.tournamentSeedBot.upsert({
      where:  { tournamentId_userId: { tournamentId, userId } },
      create: { tournamentId, userId },
      update: {},
    }).catch(() => {})
  }
}

/**
 * Mode B: create a new system-bot user cloned from a built-in persona
 * and seed it on the template.
 */
export async function cloneAndSeedPersona({ templateId, personaBotId, displayName }) {
  const name = String(displayName ?? '').trim()
  if (!name) {
    return { status: 400, body: { error: 'displayName required when cloning a persona' } }
  }

  const persona = await db.user.findUnique({
    where:  { id: personaBotId },
    select: { id: true, username: true, isBot: true, botOwnerId: true, botModelType: true, botModelId: true, botCompetitive: true, avatarUrl: true },
  })
  if (!persona)           return { status: 404, body: { error: 'Persona not found' } }
  if (!persona.isBot)     return { status: 400, body: { error: 'Persona must be a bot' } }
  if (persona.botOwnerId) return { status: 400, body: { error: 'Persona must be a system bot (no user owner)' } }
  if (!persona.username?.startsWith('bot-')) {
    return { status: 400, body: { error: 'Only built-in personas can be cloned' } }
  }

  const slug     = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clone'
  const suffix   = randomSuffix()
  const username = `bot-clone-${slug}-${suffix}`
  const email    = `${username}@xo-arena.internal`
  const botModelId = persona.botModelId
    ? `${persona.botModelId}:clone:${suffix}`
    : `builtin:${persona.botModelType ?? 'minimax'}:intermediate:clone:${suffix}`

  try {
    const clone = await db.user.create({
      data: {
        username, email,
        displayName:    name,
        avatarUrl:      persona.avatarUrl ?? null,
        isBot:          true,
        botOwnerId:     null,
        botModelType:   persona.botModelType,
        botModelId,
        botActive:      true,
        botCompetitive: persona.botCompetitive ?? false,
        botAvailable:   true,
      },
      select: { id: true, displayName: true, username: true },
    })
    const seed = await db.tournamentTemplateSeedBot.create({
      data: { templateId, userId: clone.id },
    })
    await backfillOpenOccurrences(templateId, clone.id)
    return { status: 201, body: { seed, user: clone } }
  } catch (e) {
    if (e?.code === 'P2002') {
      // username/email/botModelId all get random suffixes, so the only
      // realistic P2002 here is the unowned-bot displayName uniqueness
      // index (LOWER("displayName")). Prisma's meta.target for
      // expression indexes isn't reliably tagged with the column name,
      // so we don't branch on it.
      return { status: 409, body: { error: `A system bot named "${name}" already exists — pick a different name.` } }
    }
    throw e
  }
}

/**
 * Mode A: seed an existing system bot. Idempotent — a second call for
 * the same (templateId, userId) returns the existing row.
 */
export async function seedExistingSystemBot({ templateId, userId }) {
  if (!userId) {
    return { status: 400, body: { error: 'userId or (personaBotId + displayName) required' } }
  }

  const user = await db.user.findUnique({
    where:  { id: userId },
    select: { id: true, isBot: true, botOwnerId: true },
  })
  if (!user)            return { status: 404, body: { error: 'User not found' } }
  if (!user.isBot)      return { status: 400, body: { error: 'Only bots can be seeded (isBot: true)' } }
  if (user.botOwnerId)  return { status: 400, body: { error: 'Only system bots (no user owner) can be seeded on a recurring template' } }

  const seed = await db.tournamentTemplateSeedBot.upsert({
    where:  { templateId_userId: { templateId, userId } },
    create: { templateId, userId },
    update: {},
  })
  await backfillOpenOccurrences(templateId, userId)
  return { status: 201, body: { seed } }
}
