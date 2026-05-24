// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Slug-validator middleware for the /api/v1/games/<slug>/... route prefix.
//
// Validates that req.params.slug is a registered game (or an accepted legacy
// alias), normalizes it to canonical form, and exposes it to downstream
// handlers via:
//   - req.gameId       — preferred forward-looking field
//   - req.query.gameId — backward-compat injection so existing handlers that
//                        read req.query.gameId Just Work without modification
//
// Rejects unknown slugs with a clean 404 + helpful error body listing the
// accepted slugs. Fail-fast so unknown slugs never reach the inner handlers.

import { resolveGameSlug, getAcceptedSlugs } from '../constants/games.js'

/**
 * Express middleware that validates :slug in /api/v1/games/:slug/... routes.
 *
 * On success:
 *   - sets req.gameId to the canonical (resolved) form
 *   - injects req.query.gameId for back-compat with handlers that pre-date this prefix
 *   - calls next()
 *
 * On failure (unknown slug):
 *   - returns 404 with { error, slug, acceptedSlugs }
 *
 * Mount with mergeParams:true on the parent router so :slug is visible.
 */
export function validateGameSlug(req, res, next) {
  const rawSlug = req.params?.slug
  const canonical = rawSlug ? resolveGameSlug(rawSlug) : null

  if (!canonical) {
    return res.status(404).json({
      error: `Unknown game slug: ${rawSlug || '(missing)'}`,
      slug: rawSlug || null,
      acceptedSlugs: getAcceptedSlugs(),
    })
  }

  req.gameId = canonical

  // Back-compat: existing handlers read req.query.gameId. Inject the resolved
  // canonical value so the same handler works whether mounted under the flat
  // path (where gameId comes from ?gameId=) or under the prefix path (where
  // it comes from :slug). The injection does NOT override an explicit query
  // param when the handler was reached via the flat path.
  if (!req.query) req.query = {}
  req.query.gameId = canonical

  next()
}
