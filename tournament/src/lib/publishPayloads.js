// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Shared Redis publish-payload builders for the tournament service.
 *
 * Keeping these in one place so the `gameId` field can't accidentally be
 * dropped from one call site but not the others — the backend's
 * botGameRunner reads `gameId` off every tournament:bot:match:ready event
 * to know which game to instantiate. Regression-tested in the sibling
 * __tests__/publishPayloads.test.js file (QA_Phase_3.4 §11g).
 */

/**
 * Build the payload published on `tournament:bot:match:ready` for any
 * BOT_VS_BOT match the backend needs to run. All four publish sites
 * (autoStart SINGLE_ELIM, autoStart ROUND_ROBIN, bracket advancement,
 * recoverPendingBotMatches) go through this helper.
 *
 * @param {object} tournament - needs { id, bestOfN, game }
 * @param {object} match      - needs { id }
 * @param {object} p1User     - needs { id, displayName, botModelId }
 * @param {object} p2User     - same
 */
export function buildBotMatchReadyPayload(tournament, match, p1User, p2User) {
  return {
    tournamentId: tournament.id,
    matchId:      match.id,
    bestOfN:      tournament.bestOfN,
    gameId:       tournament.game,
    bot1: { id: p1User.id, displayName: p1User.displayName, botModelId: p1User.botModelId },
    bot2: { id: p2User.id, displayName: p2User.displayName, botModelId: p2User.botModelId },
  }
}
