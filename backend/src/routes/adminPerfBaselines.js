// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Admin "Perf Baselines" panel — surfaces the JSON artifacts produced by
 * the scripts under `perf/` (perf-bundle, perf-sse-rtt, perf-waterfall,
 * perf-longtasks, perf-backend-p95, perf-v2, perf-inp). The user runs
 * those scripts manually from a terminal; this router only reads the
 * resulting files.
 *
 * Gating: the directory is supplied via `PERF_BASELINES_DIR`. In dev it
 * points at the bind-mounted `perf/baselines/` from the repo. In Fly.io
 * production it is unset, so the listing endpoint reports
 * `enabled: false` and the dashboard hides the panel.
 *
 *   GET /api/v1/admin/perf/baselines
 *     → { enabled, dir, files: [{ filename, kind, env, timestamp,
 *                                  sizeBytes, mtime }] }
 *
 *   GET /api/v1/admin/perf/baselines/:filename
 *     → { filename, content }
 *
 * Mounted by `index.js` AFTER admin.js so it inherits requireAuth +
 * requireAdmin from the shared `/admin` prefix.
 */
import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requireAdmin)

// Filenames we'll accept. Strict — alphanum, dot, dash, underscore only.
// This is the first line of defence against path traversal; the second is a
// resolved-path check below.
const FILENAME_RE = /^[a-zA-Z0-9._-]+\.json$/

// Filename pattern produced by the perf-* scripts:
//   <kind>-<env>-<iso-timestamp>.json
// e.g. `bundle-composition-local-2026-05-04T13-42-54-981Z.json`
//      `sse-rtt-staging-2026-05-04T...json`
const NAME_PARTS_RE = /^(.+)-(local|staging|prod)-([0-9TZ.\-]+)$/

function parseFilename(name) {
  const stem = name.replace(/\.json$/, '')
  const m = stem.match(NAME_PARTS_RE)
  if (!m) return { kind: stem, env: null, timestamp: null }
  return { kind: m[1], env: m[2], timestamp: m[3] }
}

function baselinesDir() {
  // Read each request so tests can flip the env between cases.
  return process.env.PERF_BASELINES_DIR || null
}

router.get('/baselines', async (_req, res, next) => {
  try {
    const dir = baselinesDir()
    if (!dir) {
      return res.json({ enabled: false, dir: null, files: [] })
    }
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.json({ enabled: false, dir, files: [], error: 'directory not found' })
      }
      throw err
    }
    const files = []
    for (const ent of entries) {
      if (!ent.isFile()) continue
      if (!FILENAME_RE.test(ent.name)) continue
      const stat = await fs.stat(path.join(dir, ent.name))
      files.push({
        filename:  ent.name,
        sizeBytes: stat.size,
        mtime:     stat.mtime.toISOString(),
        ...parseFilename(ent.name),
      })
    }
    files.sort((a, b) => b.mtime.localeCompare(a.mtime))
    res.json({ enabled: true, dir, files })
  } catch (err) {
    next(err)
  }
})

router.get('/baselines/:filename', async (req, res, next) => {
  try {
    const dir = baselinesDir()
    if (!dir) return res.status(404).json({ error: 'baseline storage not configured' })
    const { filename } = req.params
    if (!FILENAME_RE.test(filename)) {
      return res.status(400).json({ error: 'invalid filename' })
    }
    const full = path.resolve(dir, filename)
    const dirResolved = path.resolve(dir)
    if (full !== path.join(dirResolved, filename)) {
      return res.status(400).json({ error: 'invalid filename' })
    }
    let raw
    try {
      raw = await fs.readFile(full, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' })
      throw err
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return res.status(422).json({ error: 'baseline is not valid JSON' })
    }
    res.json({ filename, content: parsed })
  } catch (err) {
    next(err)
  }
})

export default router
