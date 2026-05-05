// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * GET /api/v1/config/sw — Service Worker control plane.
 *
 * Phase 20 insurance endpoint, built BEFORE the SW caching logic ships.
 * The landing app's Service Worker fetches this on `install` / `activate`
 * and again on tab visibility-change. The SW reads two fields:
 *
 *   { enabled, version }
 *
 *   - enabled (bool, default true)
 *       SystemConfig key `sw.enabled`. Flip to `false` and every SW in
 *       the wild self-unregisters + clears all caches on its next
 *       check-in. The kill switch — toggle via:
 *           um-style: setSystemConfig('sw.enabled', false)
 *           or PATCH /api/v1/admin/guide-config (when the key is added
 *           to the admin schema).
 *
 *   - version (int, default 1)
 *       SystemConfig key `sw.version`. Bump to invalidate the SW's
 *       precache without unregistering the worker. Use this when a
 *       cached asset URL is wrong/poisoned but the SW logic itself is
 *       fine.
 *
 * Authless — a stale-auth SW must be able to reach the kill switch.
 * `Cache-Control: public, max-age=30` keeps load light while still
 * letting an emergency flip propagate within ~30s.
 *
 * See doc/Guide_Operations.md → "Service Worker kill switch" for the
 * operator runbook, and doc/Performance_Plan_v2.md §Phase 20 for the
 * design context.
 */
import { Router } from 'express'
import { getSystemConfig } from '../services/skillService.js'

const router = Router()

router.get('/', async (_req, res) => {
  let enabled = true
  let version = 1
  try {
    const [enabledRaw, versionRaw] = await Promise.all([
      getSystemConfig('sw.enabled', true),
      getSystemConfig('sw.version', 1),
    ])
    if (typeof enabledRaw === 'boolean') enabled = enabledRaw
    if (Number.isInteger(versionRaw))    version = versionRaw
  } catch {
    // SystemConfig unreachable — fail open: serve defaults so a healthy
    // SW keeps working. The kill switch only matters when DB is reachable
    // anyway (otherwise the SW had bigger problems).
  }
  res.setHeader('Cache-Control', 'public, max-age=30')
  res.json({ enabled, version })
})

export default router
