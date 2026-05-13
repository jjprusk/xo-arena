// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help System — top-level service.
 *
 * v1 surface area:
 *   - search(query): hybrid FTS + vector retrieval
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
 */

import db from '../../lib/db.js'
import logger from '../../logger.js'
import { embedText, toPgVectorLiteral } from './embedClient.js'

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
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.topK=5]
 * @param {number} [opts.alpha] — override the FTS weight; falls back to SystemConfig
 * @returns {Promise<{
 *   chunks: Array<{ id, docId, position, content, ftsScore, cosScore, score }>,
 *   alpha: number,
 *   counts: { fts: number, vec: number, merged: number }
 * }>}
 */
export async function search(query, opts = {}) {
  const topK = opts.topK ?? DEFAULT_TOP_K
  const alpha = opts.alpha ?? (await getFtsWeight())
  const trimmed = String(query ?? '').trim()
  if (!trimmed) {
    return { chunks: [], alpha, counts: { fts: 0, vec: 0, merged: 0 } }
  }

  const [ftsRows, vecRows] = await Promise.all([
    runFtsQuery(trimmed),
    runVectorQuery(trimmed),
  ])

  const merged = mergeRanked(ftsRows, vecRows, alpha)
  return {
    chunks: merged.slice(0, topK),
    alpha,
    counts: { fts: ftsRows.length, vec: vecRows.length, merged: merged.length },
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
