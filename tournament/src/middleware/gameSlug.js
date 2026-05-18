// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Tournament service mirror of backend/src/middleware/gameSlug.js. See the
// backend copy for full behavior documentation; this duplicate exists because
// the two services run in isolated containers without a shared workspace
// import path.

import { resolveGameSlug, getAcceptedSlugs } from '../constants/games.js'

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
  if (!req.query) req.query = {}
  req.query.gameId = canonical

  next()
}
