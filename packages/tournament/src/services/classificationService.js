/**
 * Player Classification Service — Phase 2
 *
 * Tier ladder: RECRUIT → CONTENDER → VETERAN → ELITE → CHAMPION → LEGEND
 *
 * Merit awards fire at tournament completion, based on finish position
 * relative to tier-peer count (players of the SAME tier in the same tournament).
 *
 * Promotion: when merits >= threshold for current tier, advance one tier,
 * reset merits to 0.
 *
 * Demotion: periodic review (configurable cadence). A player demotes if
 * their Finish Ratio (% of qualifying matches where they did NOT finish last)
 * falls below the threshold AND they didn't promote in this period AND they
 * have minimum qualifying matches AND they haven't used their opt-out.
 */

import db from '@xo-arena/db'
import logger from '../logger.js'

const TIERS = ['RECRUIT', 'CONTENDER', 'VETERAN', 'ELITE', 'CHAMPION', 'LEGEND']

// ─── SystemConfig helpers ─────────────────────────────────────────────────────

async function getConfig(key, defaultValue) {
  try {
    const row = await db.systemConfig.findUnique({ where: { key } })
    return row ? row.value : defaultValue
  } catch {
    return defaultValue
  }
}

// Default merit thresholds per tier (merits needed to promote)
const DEFAULT_PROMOTION_THRESHOLDS = {
  RECRUIT: 4,
  CONTENDER: 6,
  VETERAN: 10,
  ELITE: 18,
  CHAMPION: 25,
  LEGEND: Infinity, // Can't promote past LEGEND
}

async function getPromotionThresholds() {
  const overrides = {}
  for (const tier of TIERS.slice(0, -1)) {
    const v = await getConfig(`classification.tiers.${tier}.meritsRequired`, null)
    overrides[tier] = v ?? DEFAULT_PROMOTION_THRESHOLDS[tier]
  }
  overrides.LEGEND = Infinity
  return overrides
}

// ─── Bootstrap classification ─────────────────────────────────────────────────

/**
 * Get or create a PlayerClassification for a user.
 * If created, writes an "initial" ClassificationHistory entry.
 */
export async function getOrCreateClassification(userId) {
  let classification = await db.playerClassification.findUnique({
    where: { userId },
  })

  if (!classification) {
    classification = await db.playerClassification.create({
      data: {
        userId,
        tier: 'RECRUIT',
        merits: 0,
        history: {
          create: {
            fromTier: null,
            toTier: 'RECRUIT',
            reason: 'initial',
          },
        },
      },
    })
    logger.info({ userId }, 'PlayerClassification created (initial)')
  }

  return classification
}

// ─── Merit awards at tournament completion ─────────────────────────────────────

/**
 * Award merits to all non-withdrawn participants at tournament end.
 *
 * Called from _completeTournament in tournamentService.js.
 *
 * Logic:
 * 1. Group participants by their current tier
 * 2. For each tier group, look up the correct MeritThreshold band
 * 3. Award merits by finish position (pos1–pos4) — positions beyond 4 receive 0
 * 4. Handle ties: all tied participants receive the same merit award
 * 5. Best Overall bonus: +1 merit to finalPosition=1 if total participants >= 10
 * 6. Write MeritTransaction rows
 * 7. Run promotion check for each updated classification
 */
export async function awardTournamentMerits(tournamentId) {
  try {
    const participants = await db.tournamentParticipant.findMany({
      where: { tournamentId, status: { notIn: ['WITHDRAWN'] } },
      include: { user: true },
    })

    if (participants.length === 0) return

    // Load merit thresholds (ordered by bandMin asc)
    const bands = await db.meritThreshold.findMany({ orderBy: { bandMin: 'asc' } })

    // If no bands configured, skip merit awards (not yet seeded)
    if (bands.length === 0) {
      logger.warn({ tournamentId }, 'No MeritThreshold bands configured — skipping merit awards')
      return
    }

    // Ensure all participants have a classification and build lookup map
    const classificationMap = new Map()
    for (const p of participants) {
      const c = await getOrCreateClassification(p.userId)
      if (c) classificationMap.set(p.id, c)
    }

    // Group participants by tier
    const byTier = new Map()
    for (const p of participants) {
      const c = classificationMap.get(p.id)
      const tier = c?.tier ?? 'RECRUIT'
      if (!byTier.has(tier)) byTier.set(tier, [])
      byTier.get(tier).push(p)
    }

    const totalParticipants = participants.length
    const bestOverallMinParticipants = await getConfig('classification.bestOverallBonus.minParticipants', 10)

    // Process each tier group
    for (const [tier, tierParticipants] of byTier) {
      const tierPeerCount = tierParticipants.length

      // Find applicable band (largest bandMin <= tierPeerCount, and tierPeerCount >= 3)
      if (tierPeerCount < 3) continue // Need at least 3 tier-peers for merit awards

      const band = [...bands]
        .filter(b => b.bandMin <= tierPeerCount && (b.bandMax == null || tierPeerCount <= b.bandMax))
        .sort((a, b) => b.bandMin - a.bandMin)[0]

      if (!band) continue

      // Sort tier participants by finalPosition
      const sorted = [...tierParticipants]
        .filter(p => p.finalPosition != null)
        .sort((a, b) => a.finalPosition - b.finalPosition)

      // Award merits by position (handle ties)
      let i = 0
      while (i < sorted.length) {
        const pos = sorted[i].finalPosition
        // Find all tied at this position
        let j = i
        while (j < sorted.length && sorted[j].finalPosition === pos) j++
        const tiedGroup = sorted.slice(i, j)

        // Determine merit amount for this position
        const posLabel = i + 1 // 1-indexed position within tier group
        const meritAmount = posLabel === 1 ? band.pos1
          : posLabel === 2 ? band.pos2
          : posLabel === 3 ? band.pos3
          : posLabel === 4 ? band.pos4
          : 0

        if (meritAmount > 0) {
          for (const p of tiedGroup) {
            const c = classificationMap.get(p.id)
            if (!c) continue
            const reason = `finish_${posLabel}${tiedGroup.length > 1 ? '_tie' : ''}`
            await _addMerits(c.id, meritAmount, reason, tournamentId)
          }
        }

        i = j
      }
    }

    // Best Overall bonus: +1 merit to tournament winner (finalPosition=1) if totalParticipants >= 10
    if (totalParticipants >= bestOverallMinParticipants) {
      const winners = participants.filter(p => p.finalPosition === 1)
      for (const winner of winners) {
        const c = classificationMap.get(winner.id)
        if (c) {
          await _addMerits(c.id, 1, 'best_overall_bonus', tournamentId)
        }
      }
    }

    // Run promotion check for all classifications that received merits
    const classificationIds = new Set(
      participants
        .map(p => classificationMap.get(p.id)?.id)
        .filter(Boolean)
    )
    for (const classificationId of classificationIds) {
      await checkPromotion(classificationId, tournamentId)
    }

    logger.info({ tournamentId, participantCount: participants.length }, 'Merit awards completed')
  } catch (err) {
    logger.error({ err, tournamentId }, 'awardTournamentMerits failed')
  }
}

// ─── Promotion ────────────────────────────────────────────────────────────────

/**
 * Check if a classification qualifies for promotion. If so, promote.
 * Repeats until no longer eligible (handles multi-tier skips on large merit counts).
 */
export async function checkPromotion(classificationId, tournamentId = null) {
  const thresholds = await getPromotionThresholds()

  let classification = await db.playerClassification.findUnique({
    where: { id: classificationId },
  })

  while (classification) {
    const required = thresholds[classification.tier] ?? Infinity
    if (classification.merits < required) break
    if (classification.tier === 'LEGEND') break

    const fromTier = classification.tier
    const tierIndex = TIERS.indexOf(fromTier)
    const toTier = TIERS[tierIndex + 1]

    // Promote: advance tier, reset merits to 0
    classification = await db.playerClassification.update({
      where: { id: classificationId },
      data: { tier: toTier, merits: 0 },
    })

    // Write MeritTransaction for the reset
    await db.meritTransaction.create({
      data: {
        classificationId,
        tournamentId,
        delta: -classification.merits, // will be 0 after update, so track original
        reason: 'promotion_reset',
      },
    })

    // Write ClassificationHistory
    await db.classificationHistory.create({
      data: {
        classificationId,
        fromTier,
        toTier,
        reason: 'promotion',
        tournamentId,
      },
    })

    logger.info({ classificationId, fromTier, toTier }, 'Player promoted')
  }
}

// ─── Demotion ─────────────────────────────────────────────────────────────────

/**
 * Run periodic demotion review for all active classifications.
 *
 * Called from scheduler on configurable cadence.
 *
 * A player demotes if ALL of:
 * - Current tier is not RECRUIT (can't demote below RECRUIT)
 * - Did not promote during this review period
 * - Has >= minQualifyingMatches in the review period
 * - Finish Ratio < finishRatioThreshold
 * - Has not used their demotion opt-out for this period
 *
 * Finish Ratio = (matches where finalPositionPct > 0) / totalQualifyingMatches
 * (finalPositionPct = 0 means they finished last)
 */
export async function runDemotionReview() {
  try {
    const cadenceDays = await getConfig('classification.demotion.reviewCadenceDays', 30)
    const minMatches = await getConfig('classification.demotion.minQualifyingMatches', 5)
    const frThreshold = await getConfig('classification.demotion.finishRatioThreshold', 0.70)

    const reviewStart = new Date(Date.now() - cadenceDays * 24 * 60 * 60 * 1000)

    const classifications = await db.playerClassification.findMany({
      where: { tier: { not: 'RECRUIT' } },
    })

    for (const c of classifications) {
      try {
        await _reviewDemotion(c, reviewStart, minMatches, frThreshold)
      } catch (err) {
        logger.error({ err, classificationId: c.id }, 'Demotion review failed for player')
      }
    }

    logger.info({ count: classifications.length }, 'Demotion review completed')
  } catch (err) {
    logger.error({ err }, 'runDemotionReview failed')
  }
}

async function _reviewDemotion(classification, reviewStart, minMatches, frThreshold) {
  // Find qualifying matches (completed tournament participations) in review window
  const participations = await db.tournamentParticipant.findMany({
    where: {
      userId: classification.userId,
      status: { in: ['ELIMINATED', 'ACTIVE'] }, // completed tournaments only
      registeredAt: { gte: reviewStart },
      finalPosition: { not: null },
    },
  })

  if (participations.length < minMatches) return

  // Finish Ratio: % of matches where they did NOT finish last (finalPositionPct > 0)
  const nonLastCount = participations.filter(p => (p.finalPositionPct ?? 0) > 0).length
  const finishRatio = nonLastCount / participations.length

  if (finishRatio >= frThreshold) return

  // Check if they promoted in this review period
  const promotedInPeriod = await db.classificationHistory.findFirst({
    where: {
      classificationId: classification.id,
      reason: 'promotion',
      createdAt: { gte: reviewStart },
    },
  })
  if (promotedInPeriod) return

  // Check demotion opt-out — skip if the player used it within the current review period
  if (classification.demotionOptOutUsedAt && classification.demotionOptOutUsedAt >= reviewStart) {
    logger.info({ classificationId: classification.id }, 'Demotion skipped — opt-out used this period')
    return
  }

  const fromTier = classification.tier
  const tierIndex = TIERS.indexOf(fromTier)
  if (tierIndex <= 0) return // Already at RECRUIT

  const toTier = TIERS[tierIndex - 1]

  await db.playerClassification.update({
    where: { id: classification.id },
    data: { tier: toTier, merits: 0 },
  })

  await db.meritTransaction.create({
    data: {
      classificationId: classification.id,
      delta: -classification.merits,
      reason: 'demotion_reset',
    },
  })

  await db.classificationHistory.create({
    data: {
      classificationId: classification.id,
      fromTier,
      toTier,
      reason: 'demotion',
    },
  })

  logger.info({ classificationId: classification.id, fromTier, toTier }, 'Player demoted')
}

// ─── Admin override ───────────────────────────────────────────────────────────

/**
 * Manually promote or demote a player to a specific tier.
 */
export async function adminOverrideTier(userId, toTier, reason = 'admin_override') {
  if (!TIERS.includes(toTier)) {
    const err = new Error(`Invalid tier: ${toTier}`)
    err.status = 400
    throw err
  }

  let classification = await db.playerClassification.findUnique({ where: { userId } })
  if (!classification) {
    classification = await getOrCreateClassification(userId)
  }

  const fromTier = classification.tier
  await db.playerClassification.update({
    where: { id: classification.id },
    data: { tier: toTier, merits: 0 },
  })

  await db.classificationHistory.create({
    data: {
      classificationId: classification.id,
      fromTier,
      toTier,
      reason,
    },
  })

  logger.info({ userId, fromTier, toTier, reason }, 'Admin tier override applied')
  return await db.playerClassification.findUnique({
    where: { userId },
    include: { history: { orderBy: { createdAt: 'desc' }, take: 5 } },
  })
}

// ─── Demotion opt-out ─────────────────────────────────────────────────────────

/**
 * Allow a player to opt out of demotion for the current review period.
 * Can only be used once per period — calling again while the opt-out is still
 * active (within the current review window) returns a 409 error.
 *
 * Returns the updated classification.
 */
export async function useDemotionOptOut(userId) {
  const classification = await db.playerClassification.findUnique({ where: { userId } })
  if (!classification) {
    const err = new Error('No classification record found')
    err.status = 404
    throw err
  }

  if (classification.tier === 'RECRUIT') {
    const err = new Error('RECRUIT players cannot be demoted — opt-out not applicable')
    err.status = 400
    throw err
  }

  const cadenceDays = await getConfig('classification.demotion.reviewCadenceDays', 30)
  const reviewStart = new Date(Date.now() - cadenceDays * 24 * 60 * 60 * 1000)

  if (classification.demotionOptOutUsedAt && classification.demotionOptOutUsedAt >= reviewStart) {
    const err = new Error('Demotion opt-out already used for the current review period')
    err.status = 409
    throw err
  }

  const updated = await db.playerClassification.update({
    where: { id: classification.id },
    data: { demotionOptOutUsedAt: new Date() },
    include: { history: { orderBy: { createdAt: 'desc' }, take: 5 } },
  })

  logger.info({ userId, tier: classification.tier }, 'Demotion opt-out used')
  return updated
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _addMerits(classificationId, delta, reason, tournamentId = null) {
  await db.playerClassification.update({
    where: { id: classificationId },
    data: { merits: { increment: delta } },
  })
  await db.meritTransaction.create({
    data: { classificationId, tournamentId, delta, reason },
  })
}
