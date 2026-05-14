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
import { embedText, toPgVectorLiteral, RateLimitError } from './embedClient.js'
import {
  streamChatCompletion,
  currentChatModelVersion,
  RateLimitError as ChatRateLimitError,
} from './chatClient.js'
import { buildPromptMessages, PROMPT_TEMPLATE_VERSION, REFUSAL } from './promptBuilder.js'
import { scan as scanContent } from './contentFilter.js'

const DEGRADED_REASON_MAX = 200

const DEFAULT_FTS_WEIGHT = 0.4
const DEFAULT_TOP_K = 5
const DEFAULT_ASK_TOP_K = 5
const MAX_ANSWER_TOKENS = 400

// First-chunk-of-doc boost. Most docs in /doc/Help_Corpus open with a
// definitional sentence ("A bot on AI Arena is..."). Without a boost, the
// definitional chunk loses to long-tail chunks that have higher
// term-frequency for keywords like "bot" or "tournament". A small additive
// nudge to position=0 chunks brings definitional content into top-K for
// "what is X" style queries without crowding out specifically-relevant
// chunks for narrower questions. Tuned by inspection on the seeded corpus;
// keep small so it doesn't dominate genuine ranking signal.
const FIRST_CHUNK_BOOST = 0.08

// Query-side aliases — maps spelling variants users commonly type to the
// canonical phrasing the corpus uses. We APPEND the canonical form to the
// raw query (rather than replacing) so FTS still matches the user's term
// if it appears literally somewhere in the corpus, while the embedding
// model also sees the canonical phrasing it recognizes.
//
// Why this is needed: OpenAI's tokenizer treats "tictactoe" as a single
// token; the 384-dim embedding doesn't preserve the equivalence to "tic
// tac toe" the way the native 1536-dim embedding would. So a user typing
// "how do I play tictactoe" gets a cosine score of ~0.45 against the
// canonical playing-tic-tac-toe chunks, vs ~0.63 for "how do I play tic
// tac toe". Expansion closes that gap without a column-type migration.
//
// Keep this map small and additive. As the corpus grows, the right
// long-term solution is either query rewriting via the LLM (Sprint 5+
// optimization) or per-doc alias fields surfaced into the chunk text.
const QUERY_ALIASES = [
  // Tic-Tac-Toe spelling variants.
  { match: /\btictactoe\b/gi,    add: 'tic tac toe' },
  { match: /\btic-tac-toe\b/gi,  add: 'tic tac toe' },
  // Connect 4 spelling variants — surfaces the future-games doc which
  // documents "not yet playable" status for this and other planned games.
  { match: /\bconnect ?4\b/gi,   add: 'connect four future games planned not available yet' },
  { match: /\bconnect-?four\b/gi, add: 'connect four future games planned not available yet' },
  // Add new aliases here as retrieval misses surface.
]

/**
 * Returns a query string suitable for embedding + FTS. Original user text
 * is preserved (we APPEND canonical forms when an alias matches) so FTS
 * still recognizes the literal user term if it appears anywhere in the
 * corpus. Used internally by `search`; HelpQuery.text persists the ORIGINAL
 * user-typed query, not the expanded form — analytics should see what the
 * user actually typed.
 */
export function expandQuery(raw) {
  let out = String(raw ?? '')
  const additions = new Set()
  for (const { match, add } of QUERY_ALIASES) {
    if (match.test(out)) additions.add(add)
    match.lastIndex = 0  // reset stateful /g regex between calls
  }
  if (additions.size === 0) return out
  return `${out} ${[...additions].join(' ')}`
}

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

  // Query expansion — append canonical phrasings for known spelling
  // variants (see QUERY_ALIASES). Both retrieval branches use the
  // expanded query; HelpQuery.text (logged in /help/ask) persists the
  // ORIGINAL user-typed string so analytics see what the user typed.
  const effective = expandQuery(trimmed)

  // Run both branches concurrently; capture rejections independently so a
  // failing vector branch doesn't abort the FTS branch. The FTS branch is
  // expected never to throw against a healthy DB — if it does, surface
  // the error normally (the caller's catch logs it; the route returns 5xx).
  const [ftsRes, vecRes] = await Promise.allSettled([
    runFtsQuery(effective),
    runVectorQuery(effective),
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
  //
  // ivfflat tuning: the help_chunks index was created with lists=100 (per
  // the v1 migration), which suits a multi-thousand-row corpus. With our
  // current ~550 chunks each list holds ~5 vectors; the default probes=1
  // scans only one list, dropping recall to ~1% of the corpus and causing
  // canonical chunks to be entirely absent from top-K results. Bumping
  // probes=10 visits ~10% per query — still fast (<5 ms for our size) and
  // brings recall close to exhaustive. Tune up if recall complaints
  // resurface; lists can be lowered (or HNSW adopted) once the corpus
  // grows past ~10K chunks. SET LOCAL scopes to the transaction only.
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ivfflat.probes = 10')
    return await tx.$queryRaw`
      SELECT
        c.id, c."docId", c.position, c.content,
        (1 - (c.embedding <=> ${lit}::vector)) AS sim
      FROM help_chunks c
      JOIN help_docs d ON d.id = c."docId"
      WHERE d.status = 'PUBLISHED' AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${lit}::vector ASC
      LIMIT 50
    `
  })
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
    const base = alpha * ftsN + (1 - alpha) * cosN
    // First-chunk-of-doc boost: see FIRST_CHUNK_BOOST comment for why.
    const boost = (r.position === 0) ? FIRST_CHUNK_BOOST : 0
    r.score = base + boost
    out.push(r)
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// ── ask() — Sprint 2 §2.3 ──────────────────────────────────────────────────
//
// Orchestration:
//   1. retrieve via search() — picks up degraded fallback if embed fails
//   2. persist HelpQuery row with retrieval state
//   3. build help.v1 prompt
//   4. stream chat completion (OpenAI gpt-4o-mini by default)
//   5. accumulate streamed tokens server-side
//   6. on stream complete, scan content filter — replace with refusal if hit
//   7. persist HelpAnswer row
//   8. emit accumulated answer to caller via the returned async generator
//
// Streaming model: `ask()` returns an async generator yielding
//   { kind: 'token', text: string }
// for each model fragment, followed by exactly one terminal frame:
//   { kind: 'done', answerId, contentFilterTriggered, ...stats }
// or
//   { kind: 'error', error: 'llm_unavailable' | 'rate_limited' | 'provider_unavailable', ... }
//
// The HTTP route maps these to SSE frames (`event: token` / `event: done` /
// `event: error`). We deliberately do NOT yield the refusal text mid-stream
// when content filter triggers — per §7.7 we accept that v1 streams real
// tokens then sends a `replace` event at end. The frame shape supports that:
// the caller renders incrementally and swaps to `rendered` on `done`.

/**
 * Run the full RAG pipeline. Returns an async generator (see top comment).
 *
 * @param {object} args
 * @param {string} args.question       — raw user question (verbatim into prompt)
 * @param {string|null} args.userId    — auth-required (route enforces); null only allowed in tests
 * @param {object} [args.context]      — cleaned allow-list context (caller strips unknowns)
 * @param {number} [args.topK=5]
 * @param {AbortSignal} [args.signal]  — propagated to the streaming chat call
 */
export async function* ask({
  question,
  userId,
  context = {},
  topK = DEFAULT_ASK_TOP_K,
  signal,
  // Injectable test seams. ESM exports are read-only so tests can't
  // monkey-patch the module's `search` / chat / db / filter at runtime;
  // accepting them as params keeps the production call sites clean
  // (defaults are the real implementations) while letting unit tests
  // pass deterministic stubs.
  _search = search,
  _streamChatCompletion = streamChatCompletion,
  _scanContent = scanContent,
} = {}) {
  const askStart = Date.now()
  const trimmedQ = String(question ?? '').trim()
  if (!trimmedQ) {
    yield { kind: 'error', error: 'empty_question' }
    return
  }

  // 1. Retrieve. search() catches embed failures and returns degraded=true
  //    + an empty vec branch. The HelpQuery row captures the flag so
  //    incidents are visible in the admin Health tile.
  const retrieval = await _search(trimmedQ, { topK })

  // 2. Persist HelpQuery early so we have a row even if generation fails.
  //    Embedding column stays NULL when degraded — that's deliberate; we
  //    don't want stale stub-era vectors polluting the analytics index.
  const retrievedChunkIds = retrieval.chunks.map(c => c.id)
  const retrievalScore = Object.fromEntries(
    retrieval.chunks.map(c => [c.id, {
      fts:    c.ftsScore ?? null,
      vector: c.cosScore ?? null,
      hybrid: c.score ?? null,
    }]),
  )
  let helpQuery
  try {
    helpQuery = await db.helpQuery.create({
      data: {
        userId:            userId ?? null,
        text:              trimmedQ,
        retrievedChunkIds,
        retrievalScore,
        context,
        promptTemplate:    PROMPT_TEMPLATE_VERSION,
        modelVersion:      currentChatModelVersion(),
        degraded:          retrieval.degraded,
        degradedReason:    retrieval.degradedReason,
      },
    })
  } catch (err) {
    logger.error({ err: err.message }, 'help.ask: failed to persist HelpQuery')
    yield { kind: 'error', error: 'internal' }
    return
  }

  // 3. Build the prompt.
  const messages = buildPromptMessages({
    question: trimmedQ,
    chunks:   retrieval.chunks,
    context,
  })

  // 4–5. Stream + accumulate. We DO yield tokens to the caller as they
  //      arrive so the SSE client sees real-time streaming. The full
  //      string accumulates server-side for filter + persistence.
  const collected = []
  try {
    for await (const piece of _streamChatCompletion(messages, {
      maxTokens: MAX_ANSWER_TOKENS,
      signal,
    })) {
      collected.push(piece)
      yield { kind: 'token', text: piece }
    }
  } catch (err) {
    const code = err instanceof ChatRateLimitError ? 'rate_limited' : 'llm_unavailable'
    const reason = String(err?.message ?? err).slice(0, DEGRADED_REASON_MAX)
    logger.warn({ err: reason, queryId: helpQuery.id, code }, 'help.ask: chat failed')
    // Mark the query as degraded so the Health tile reflects the incident.
    try {
      await db.helpQuery.update({
        where: { id: helpQuery.id },
        data:  { degraded: true, degradedReason: reason },
      })
    } catch {}
    yield {
      kind:      'error',
      error:     code,
      retryAfter: err instanceof ChatRateLimitError ? err.retryAfter : null,
    }
    return
  }

  const rawAnswer = collected.join('')

  // 6. Content filter (§2.7 / §7.7 of plan). On trigger, swap the rendered
  //    text for the refusal phrase and record the terms.
  const filter = _scanContent(rawAnswer)
  const finalRendered = filter.triggered ? REFUSAL.HOSTILE : rawAnswer

  // 7. Persist HelpAnswer.
  let answer
  try {
    answer = await db.helpAnswer.create({
      data: {
        queryId:                 helpQuery.id,
        chunkIds:                retrievedChunkIds,
        rendered:                finalRendered,
        rank:                    0,
        contentFilterTriggered:  filter.triggered,
        contentFilterTerms:      filter.triggered ? filter.terms : [],
      },
    })
    // Point the HelpQuery at its top answer + record latency.
    await db.helpQuery.update({
      where: { id: helpQuery.id },
      data:  { topAnswerId: answer.id, latencyMs: Date.now() - askStart },
    })
  } catch (err) {
    logger.error({ err: err.message, queryId: helpQuery.id },
      'help.ask: failed to persist HelpAnswer (answer already streamed)')
  }

  // 8. Terminal frame.
  yield {
    kind: 'done',
    answerId:                answer?.id ?? null,
    queryId:                 helpQuery.id,
    contentFilterTriggered:  filter.triggered,
    rendered:                finalRendered,  // for clients that prefer non-streaming view
    degraded:                retrieval.degraded,
    latencyMs:               Date.now() - askStart,
  }
}
