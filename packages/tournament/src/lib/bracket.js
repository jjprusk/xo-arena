/**
 * Bracket generation for single elimination tournaments.
 */

/**
 * Calculate the next power of 2 >= n.
 * @param {number} n
 * @returns {number}
 */
function nextPowerOfTwo(n) {
  if (n <= 1) return 1
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * Calculate number of rounds for N participants (padded to next power of 2).
 * @param {number} n
 * @returns {number}
 */
export function roundCount(n) {
  if (n <= 1) return 0
  return Math.ceil(Math.log2(nextPowerOfTwo(n)))
}

/**
 * Generate a single elimination bracket.
 *
 * @param {Array<{id: string, userId: string, eloAtRegistration: number}>} participants
 * @returns {Array<{roundNumber: number, matches: Array<{participant1Id: string|null, participant2Id: string|null}>}>}
 *
 * Rules:
 * - Seed participants by eloAtRegistration descending (highest seed = 1st)
 * - Pad to next power of 2 with BYE slots (null participant)
 * - Round 1: seed 1 vs seed N, seed 2 vs seed N-1, etc. (standard single elim seeding)
 * - BYE matches: participant1Id set, participant2Id = null (participant auto-advances)
 * - Returns array of rounds, each with array of matches
 */
export function generateBracket(participants) {
  if (!participants || participants.length === 0) {
    return []
  }

  // Sort by eloAtRegistration descending to assign seeds
  const seeded = [...participants].sort(
    (a, b) => (b.eloAtRegistration ?? 0) - (a.eloAtRegistration ?? 0)
  )

  const bracketSize = nextPowerOfTwo(seeded.length)
  const numRounds = roundCount(seeded.length)

  if (numRounds === 0) return []

  // Pad with BYE slots (null) to fill bracket
  const slots = [...seeded.map(p => p.id)]
  while (slots.length < bracketSize) {
    slots.push(null)
  }

  // Build round 1 using standard single-elimination seeding:
  // seed 1 vs seed N, seed 2 vs seed N-1, etc.
  // This is achieved by the "fold" pattern on the seeded array.
  const round1Matches = buildRound1Matches(slots)

  const rounds = [{ roundNumber: 1, matches: round1Matches }]

  // Generate subsequent rounds as TBD placeholders
  // (actual participants are filled in as matches complete)
  let matchesInRound = round1Matches.length
  for (let r = 2; r <= numRounds; r++) {
    matchesInRound = matchesInRound / 2
    const matches = []
    for (let i = 0; i < matchesInRound; i++) {
      matches.push({ participant1Id: null, participant2Id: null })
    }
    rounds.push({ roundNumber: r, matches })
  }

  return rounds
}

/**
 * Build round 1 matchups using standard single-elimination seeding.
 * The "fold" algorithm: repeatedly split the array and interleave.
 *
 * For 8 seeds: [1,2,3,4,5,6,7,8]
 * Result pairs: (1,8),(2,7),(3,6),(4,5) — top half vs bottom half reversed
 *
 * @param {Array<string|null>} slots - participant IDs (or null for BYE), seeded order
 * @returns {Array<{participant1Id: string|null, participant2Id: string|null}>}
 */
function buildRound1Matches(slots) {
  // Use the standard bracket seeding fold:
  // Recursively pair position 0 with last, 1 with second-to-last, etc.
  // This ensures seed 1 faces the lowest seed in round 1.
  const matches = []
  const n = slots.length // always a power of 2

  // Standard seeding: build pairs by "folding" the bracket
  // positions array = [0..n-1], fold to get pairs
  const positions = buildBracketPositions(n)

  for (let i = 0; i < positions.length; i += 2) {
    matches.push({
      participant1Id: slots[positions[i]] ?? null,
      participant2Id: slots[positions[i + 1]] ?? null,
    })
  }

  return matches
}

/**
 * Build the bracket position ordering for standard single-elimination.
 * Returns an array of indices such that reading pairs gives correct seeding.
 *
 * For n=8: [0,7,3,4,1,6,2,5] → pairs: (0,7),(3,4),(1,6),(2,5)
 * → seed 1 vs 8, seed 4 vs 5, seed 2 vs 7, seed 3 vs 6
 *
 * @param {number} n - bracket size (power of 2)
 * @returns {number[]}
 */
function buildBracketPositions(n) {
  if (n === 1) return [0]
  if (n === 2) return [0, 1]

  // Iterative fold: start with [0,1], expand to full size
  let positions = [0, 1]
  while (positions.length < n) {
    const size = positions.length
    const next = new Array(size * 2)
    for (let i = 0; i < size; i++) {
      next[i * 2] = positions[i]
      next[i * 2 + 1] = size * 2 - 1 - positions[i]
    }
    positions = next
  }

  return positions
}

/**
 * Generate a round-robin schedule using the circle method.
 *
 * For n players: n-1 rounds (if n even) or n rounds (if n odd).
 * Each round has ⌊n/2⌋ matches. Players with a "bye" round get no match that round.
 *
 * @param {Array<{id: string, eloAtRegistration: number}>} participants
 * @returns {Array<{roundNumber: number, matches: Array<{participant1Id: string, participant2Id: string}>}>}
 */
export function generateRoundRobinSchedule(participants) {
  if (!participants || participants.length < 2) return []

  // Sort by ELO descending for consistent ordering
  const sorted = [...participants].sort(
    (a, b) => (b.eloAtRegistration ?? 0) - (a.eloAtRegistration ?? 0)
  )

  const ids = sorted.map(p => p.id)

  // If odd number of players, add null as bye placeholder
  const hasOdd = ids.length % 2 !== 0
  if (hasOdd) ids.push(null)

  const n = ids.length          // always even after padding
  const numRounds = n - 1
  const fixed = ids[0]
  const rotating = ids.slice(1) // n-1 elements, rotated each round

  const rounds = []

  for (let round = 0; round < numRounds; round++) {
    const matches = []

    // Fixed player pairs with last element of rotating
    const opp = rotating[rotating.length - 1]
    if (fixed !== null && opp !== null) {
      matches.push({ participant1Id: fixed, participant2Id: opp })
    }

    // Middle pairs
    for (let i = 0; i < Math.floor((n - 2) / 2); i++) {
      const p1 = rotating[i]
      const p2 = rotating[n - 3 - i] // n-2 is rotating.length-1, so n-3-i mirrors from end
      if (p1 !== null && p2 !== null) {
        matches.push({ participant1Id: p1, participant2Id: p2 })
      }
    }

    rounds.push({ roundNumber: round + 1, matches })

    // Rotate: move last rotating element to front
    rotating.unshift(rotating.pop())
  }

  return rounds
}
