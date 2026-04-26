// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — A/B experiment surface for the Intelligent Guide v1.
 *
 * This module exists so that v1.1 can plug experiment definitions in without
 * re-touching the trigger sites in `journeyService` / `recommendationService`.
 * In v1 the function returns the `defaultBucket` for every caller because
 * `guide.experiments.<key>.buckets` defaults to 1 (no split active).
 *
 * Design (per Sprint6_Kickoff §3.4 / Resume §2 #22):
 *   - Stable per-user assignment via SHA-256 hash of `userId:experimentKey`.
 *     First 4 hex chars (16 bits) → integer mod bucket count → bucket label
 *     `bucket-<N>` (zero-indexed, deterministic).
 *   - Bucket count comes from the SystemConfig key
 *     `guide.experiments.<experimentKey>.buckets`. Missing row or value <=1
 *     means "no split" — everyone gets `defaultBucket`. v1.1 swaps in real
 *     experiment definitions via that key.
 *   - Same `(userId, experimentKey)` always returns the same bucket; the
 *     bucket only changes if the SystemConfig `buckets` value changes (or the
 *     user reseeds, but we don't do that in v1).
 */

import crypto from 'node:crypto'
import db from '../lib/db.js'

/**
 * @param {string} userId        the user being assigned
 * @param {string} experimentKey short identifier (e.g. 'reward.amount')
 * @param {string} defaultBucket bucket name to return when the experiment is
 *                               disabled (i.e. `buckets <= 1` in SystemConfig)
 * @returns {Promise<string>} a stable bucket label
 */
export async function experimentVariant(userId, experimentKey, defaultBucket) {
  if (!userId || !experimentKey) return defaultBucket
  const buckets = await _getBucketCount(experimentKey)
  if (buckets <= 1) return defaultBucket
  const hash = crypto.createHash('sha256').update(`${userId}:${experimentKey}`).digest('hex')
  const idx  = parseInt(hash.slice(0, 4), 16) % buckets
  return `bucket-${idx}`
}

async function _getBucketCount(experimentKey) {
  const row = await db.systemConfig.findUnique({
    where: { key: `guide.experiments.${experimentKey}.buckets` },
  }).catch(() => null)
  if (!row) return 1
  const raw = typeof row.value === 'string' ? _safeParse(row.value) : row.value
  const n   = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

function _safeParse(s) { try { return JSON.parse(s) } catch { return s } }
