// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Tournament service mirror of backend/src/constants/games.js. Kept in sync
// manually; both services have their own Prisma client and run in separate
// containers, so duplication here is small and isolated. If/when the shared
// `packages/` workspace grows a game-registry module, both services should
// migrate to consuming it.
//
// As of A1.5b: canonical slug is 'tic-tac-toe'; 'xo' is a legacy alias.

export const GAME_IDS = Object.freeze({
  TIC_TAC_TOE:  'tic-tac-toe',
  CONNECT_FOUR: 'connect-four',
})

export const REGISTERED_GAME_IDS = new Set([
  GAME_IDS.TIC_TAC_TOE,
])

export const DEFAULT_GAME_ID = GAME_IDS.TIC_TAC_TOE

export const LEGACY_SLUG_MAP = Object.freeze({
  'xo': GAME_IDS.TIC_TAC_TOE,
})

export function resolveGameSlug(slug) {
  if (REGISTERED_GAME_IDS.has(slug)) return slug
  if (Object.prototype.hasOwnProperty.call(LEGACY_SLUG_MAP, slug)) {
    return LEGACY_SLUG_MAP[slug]
  }
  return null
}

export function getAcceptedSlugs() {
  return [...REGISTERED_GAME_IDS, ...Object.keys(LEGACY_SLUG_MAP)]
}
