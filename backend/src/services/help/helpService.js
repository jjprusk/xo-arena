// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help System — top-level service.
 *
 * v1 surface area:
 *   - search(query): hybrid FTS + vector retrieval, with graceful
 *     degradation to FTS-only when the embedding provider is unreachable.
 *
 * Sprint 2 will add:
 *   - ask(question, context): full RAG with streamed LLM response
 *
 * The hybrid retrieval merges per-source normalized scores:
 *
 *     score = α · norm(ts_rank_cd) + (1 - α) · cosine_sim
 *
 * The α weight lives in `SystemConfig['help.retrieval.fts_weight']` and
 * defaults to 0.4 (60% semantic, 40% lexical) — chosen because the corpus
 * is short-form and the most damaging miss is a query that uses synonyms
 * the docs don't. Read-on-every-call so admins can tune without redeploy.
 *
 * Degraded mode (§2.2 of Help_System_Sprint_Tracker.md): when `embedText`
 * throws (OpenAI 5xx / 429 / network error), we fall back to running just
 * the FTS query and return `{ degraded: true, degradedReason }`. The
 * `/help/ask` endpoint (Sprint 2 §2.3) is responsible for persisting these
 * flags onto the HelpQuery row. The schema retains a GIN tsvector index
 * from Sprint 1 so this path is fast.
 */

import db from '../../lib/db.js'
import logger from '../../logger.js'
import { embedText, toPgVectorLiteral } from './embedClient.js'

const DEGRADED_REASON_MAX = 200

const DEFAULT_FTS_WEIGHT = 0.4
const DEFAULT_TOP_K = 5

/**
 * Returns the current FTS weight α from SystemConfig, clamped to [0, 1].
 * α=0 → vector-only; α=1 → FTS-only.
 */
export async function getFtsWeight() {
  try {
    const row = await db.systemConfig.findUnique({ where: { key: 'help.retrieval.fts_weight' } })
    if (row && typeof row.value === 'number') {
      return Math.min(1, Math.max(0, row.value))
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'help.search: SystemConfig lookup failed, using default')
  }
  return DEFAULT_FTS_WEIGHT
}

/**
 * Hybrid retrieval. Returns top-K chunks ranked by the merged score.
 *
 * Implementation note: we run two separate queries (one FTS, one vector)
 * and merge in JS rather than fighting Postgres CTE syntax to do a
 * weighted union. The per-source result sets are bounded (50 each) so this
 * is cheap. We then normalize each source's scores to [0, 1] and combine.
 *
 * Degraded fallback: if the vector branch throws (`embedClient` error),
 * we serve the FTS result alone and tag the response with
 * `degraded: true`. Callers should persist this on the `HelpQuery` row so
 * the admin Health dashboard can chart vendor-incident rate. We don't
 * re-throw — broken embeddings degrade quality but should not block the
 * user's question.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.topK=5]
 * @param {number} [opts.alpha] — override the FTS weight; falls back to SystemConfig
 * @returns {Promise<{
 *   chunks: Array<{ id, docId, position, content, ftsScore, cosScore, score }>,
 *   alpha: number,
 *   counts: { fts: number, vec: number, merged: number },
 *   degraded: boolean,
 *   degradedReason: string | null,
 * }>}
 */
export async function search(query, opts = {}) {
  const topK = opts.topK ?? DEFAULT_TOP_K
  const alpha = opts.alpha ?? (await getFtsWeight())
  const trimmed = String(query ?? '').trim()
  if (!trimmed) {
    return {
      chunks: [],
      alpha,
      counts: { fts: 0, vec: 0, merged: 0 },
      degraded: false,
      degradedReason: null,
    }
  }

  // Run both branches concurrently; capture rejections independently so a
  // failing vector branch doesn't abort the FTS branch. The FTS branch is
  // expected never to throw against a healthy DB — if it does, surface
  // the error normally (the caller's catch logs it; the route returns 5xx).
  const [ftsRes, vecRes] = await Promise.allSettled([
    runFtsQuery(trimmed),
    runVectorQuery(trimmed),
  ])

  if (ftsRes.status === 'rejected') throw ftsRes.reason

  const ftsRows = ftsRes.value
  let vecRows = []
  let degraded = false
  let degradedReason = null
  let effectiveAlpha = alpha

  if (vecRes.status === 'rejected') {
    degraded = true
    degradedReason = String(vecRes.reason?.message ?? vecRes.reason ?? 'unknown')
      .slice(0, DEGRADED_REASON_MAX)
    // Force the merge to ignore the (missing) vector half. Without this,
    // a non-zero alpha would discount FTS scores by (1-alpha) for any
    // chunk only in the FTS set.
    effectiveAlpha = 1
    logger.warn(
      { err: degradedReason, query: trimmed.slice(0, 80) },
      'help.search: vector branch failed — falling back to FTS only',
    )
  } else {
    vecRows = vecRes.value
  }

  const merged = mergeRanked(ftsRows, vecRows, effectiveAlpha)
  return {
    chunks:         merged.slice(0, topK),
    alpha:          effectiveAlpha,
    counts:         { fts: ftsRows.length, vec: vecRows.length, merged: merged.length },
    degraded,
    degradedReason,
  }
}

async function runFtsQuery(query) {
  // websearch_to_tsquery handles natural language queries gracefully
  // (quotes, OR, negation). Falls back sensibly on garbage input.
  const rows = await db.$queryRaw`
    SELECT
      c.id, c."docId", c.position, c.content,
      ts_rank_cd(c.tsv, websearch_to_tsquery('english', ${query})) AS rank
    FROM help_chunks c
    JOIN help_docs d ON d.id = c."docId"
    WHERE d.status = 'PUBLISHED'
      AND c.tsv @@ websearch_to_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT 50
  `
  return rows.map(r => ({
    id: r.id,
    docId: r.docId,
    position: r.position,
    content: r.content,
    ftsScore: Number(r.rank) || 0,
    cosScore: null,
  }))
}

async function runVectorQuery(query) {
  const vec = await embedText(query)
  const lit = toPgVectorLiteral(vec)
  // pgvector's `<=>` operator returns cosine *distance* (0 = identical,
  // 2 = opposite). Convert to similarity via 1 - distance.
  const rows = await db.$queryRaw`
    SELECT
      c.id, c."docId", c.position, c.content,
      (1 - (c.embedding <=> ${lit}::vector)) AS sim
    FROM help_chunks c
    JOIN help_docs d ON d.id = c."docId"
    WHERE d.status = 'PUBLISHED' AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${lit}::vector ASC
    LIMIT 50
  `
  return rows.map(r => ({
    id: r.id,
    docId: r.docId,
    position: r.position,
    content: r.content,
    ftsScore: null,
    cosScore: Number(r.sim) || 0,
  }))
}

/**
 * Computes the degraded-rate over a recent window for the admin Health
 * dashboard tile (§2.2 of the Sprint Tracker). Returns
 *
 *   { totalQueries, degradedQueries, ratio }
 *
 * where `ratio` ∈ [0, 1]. Safe to call frequently — the SQL hits the
 * (degraded, createdAt) covering index added by migration
 * 20260513210000_help_query_degraded.
 *
 * @param {number} windowMinutes — how far back to look. 60 for the
 *   "last 1 h" tile, 1440 for the "last 24 h" tile.
 */
export async function getDegradedRate(windowMinutes = 60) {
  const rows = await db.$queryRaw`
    SELECT
      COUNT(*)::int                                        AS total,
      COUNT(*) FILTER (WHERE degraded)::int               AS degraded
    FROM help_queries
    WHERE "createdAt" > NOW() - (${windowMinutes}::int * INTERVAL '1 minute')
  `
  const total    = Number(rows[0]?.total ?? 0)
  const degraded = Number(rows[0]?.degraded ?? 0)
  return {
    windowMinutes,
    totalQueries:    total,
    degradedQueries: degraded,
    ratio:           total > 0 ? degraded / total : 0,
  }
}

/**
 * Merges FTS and vector result sets:
 *   - Normalize each source's scores to [0, 1] (max-norm; min stays 0).
 *   - Sum chunks present in both with α and (1-α).
 *   - Chunks present in only one source still count, weighted by the
 *     corresponding coefficient — this prevents the merge from
 *     accidentally penalizing a strong single-source hit.
 *
 * Returns array sorted descending by `score`.
 */
export function mergeRanked(ftsRows, vecRows, alpha) {
  const ftsMax = Math.max(0, ...ftsRows.map(r => r.ftsScore || 0))
  const vecMax = Math.max(0, ...vecRows.map(r => r.cosScore || 0))

  const byId = new Map()
  const put = (row) => {
    const existing = byId.get(row.id)
    if (existing) {
      // Merge in scores from the other source.
      if (row.ftsScore != null) existing.ftsScore = row.ftsScore
      if (row.cosScore != null) existing.cosScore = row.cosScore
    } else {
      byId.set(row.id, { ...row })
    }
  }
  ftsRows.forEach(put)
  vecRows.forEach(put)

  const out = []
  for (const r of byId.values()) {
    const ftsN = ftsMax > 0 && r.ftsScore != null ? r.ftsScore / ftsMax : 0
    const cosN = vecMax > 0 && r.cosScore != null ? r.cosScore / vecMax : 0
    r.score = alpha * ftsN + (1 - alpha) * cosN
    out.push(r)
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
