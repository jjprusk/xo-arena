// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — placeholder for the v1.1 Specialize-phase recommendation surface
 * (Intelligent_Guide_Requirements.md §7).
 *
 * v1 ships the surface so v1.1 can plug in the real catalog walker without
 * touching any trigger sites. Today it always returns `[]` — no UI subscribes
 * to it yet.
 *
 * Wire hint for v1.1:
 *   const variant = await experimentVariant(userId, 'rec.algorithm', 'baseline')
 *   return _walkCatalog(userId, variant)
 */

/**
 * @param {string} _userId
 * @returns {Promise<Array>} empty in v1
 */
export async function getRecommendations(_userId) {
  return []
}
