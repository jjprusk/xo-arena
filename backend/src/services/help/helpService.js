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
import { rewriteLinks } from './linkRewriter.js'

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
  // Algorithm shorthand — "mc" is commonly used for Monte Carlo, "q" for
  // Q-learning, "rl" for reinforcement learning.
  { match: /\bmc\b/gi,           add: 'monte carlo algorithm' },
  { match: /\bdqn\b/gi,          add: 'deep q network algorithm' },
  { match: /\brl\b/gi,           add: 'reinforcement learning' },
  // Two-word spelling of AlphaZero — the corpus uses the one-word form
  // exclusively, so "alpha zero" misses without this. The added context
  // pulls retrieval toward the "Session recipe" section that answers
  // "what's the recipe for training an alpha zero bot."
  { match: /\balpha\s*zero\b/gi, add: 'alphazero session recipe simulations temperature episodes' },
  // Legacy brand name — XO Arena is the prior name of AI Arena. Users who
  // remember the old branding should land on the same overview docs.
  { match: /\bxo\s*arena\b/gi,   add: 'AI Arena platform overview' },
  // Onboarding queries — "how do I get started / begin / start" tends to
  // semantically match procedural tournament docs more strongly than the
  // dedicated getting-started doc. Aliasing toward the canonical
  // onboarding vocabulary pulls retrieval toward the right surface.
  { match: /\b(get|getting)\s*started\b/gi, add: 'first time new user welcome onboarding tutorial walkthrough quick play guide drawer' },
  { match: /\bwhere\s*do\s*i\s*(begin|start)\b/gi, add: 'first time new user welcome onboarding' },
  { match: /\bhow\s*do\s*i\s*begin\b/gi, add: 'first time new user welcome onboarding' },
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

  // Query expansion is asymmetric across the two branches:
  //
  // - FTS uses the ORIGINAL query. Postgres' websearch_to_tsquery joins
  //   tokens with AND, so appending alias text would force the chunk to
  //   match every appended token — usually shrinking the result set to
  //   zero. Let the user's literal terms drive lexical matching.
  //
  // - Vector retrieval uses the EXPANDED query. The 384-dim downsampled
  //   embedding doesn't know "tictactoe" == "tic tac toe", so appending
  //   the canonical phrasing gives the embedding model the form it
  //   actually recognises. Cosine similarity is permissive, not AND-y,
  //   so additional context only helps.
  //
  // HelpQuery.text (logged in /help/ask) persists the ORIGINAL user
  // string so analytics show what the user actually typed.
  const expanded = expandQuery(trimmed)

  // Run both branches concurrently; capture rejections independently so a
  // failing vector branch doesn't abort the FTS branch. The FTS branch is
  // expected never to throw against a healthy DB — if it does, surface
  // the error normally (the caller's catch logs it; the route returns 5xx).
  const [ftsRes, vecRes] = await Promise.allSettled([
    runFtsQuery(trimmed),       // original
    runVectorQuery(expanded),   // expanded
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

/**
 * Build the lane-specific WHERE clauses. Each lane filters HelpDoc rows by
 * `source` (and `ownerId` for the privateNotes lane). Returns a `Prisma.sql`
 * fragment to splice into both the FTS and vector queries.
 *
 * Lane definitions (Sprint 3 of doc/Research_Log_Plan.md §3):
 *   - corpus         → d.source = 'guide'         (curated /doc/Help_Corpus)
 *   - communityNotes → d.source = 'community-note' (any published note/entry)
 *   - privateNotes   → d.source = 'private-note' AND d.ownerId = $userId
 *                       (lane is empty in Sprint 3 — see Future_Ideas.md for
 *                        the deferred auto-indexing pipeline; lane plumbing
 *                        is wired so retrieval drops in zero-friction)
 */
function laneWhere(lane, userId) {
  // Use Prisma.sql via $queryRaw template tagging — we splice the filter into
  // the existing template literal below by switching to the explicit form.
  if (lane === 'corpus')         return { source: 'guide',          ownerFilter: false }
  if (lane === 'communityNotes') return { source: 'community-note', ownerFilter: false }
  if (lane === 'privateNotes')   return { source: 'private-note',   ownerFilter: true, userId }
  throw new Error(`unknown lane: ${lane}`)
}

async function runFtsQuery(query, { source = 'guide', ownerFilter = false, userId = null, limit = 50 } = {}) {
  // Splice the source filter (and optional ownerId filter) into the query.
  // We pass them as bound parameters so they're SQL-injection-safe.
  const rows = ownerFilter
    ? await db.$queryRaw`
        SELECT
          c.id, c."docId", c.position, c.content,
          ts_rank_cd(c.tsv, websearch_to_tsquery('english', ${query})) AS rank
        FROM help_chunks c
        JOIN help_docs d ON d.id = c."docId"
        WHERE d.status = 'PUBLISHED'
          AND d.source = ${source}
          AND d."ownerId" = ${userId}
          AND c.tsv @@ websearch_to_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
      `
    : await db.$queryRaw`
        SELECT
          c.id, c."docId", c.position, c.content,
          ts_rank_cd(c.tsv, websearch_to_tsquery('english', ${query})) AS rank
        FROM help_chunks c
        JOIN help_docs d ON d.id = c."docId"
        WHERE d.status = 'PUBLISHED'
          AND d.source = ${source}
          AND c.tsv @@ websearch_to_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}
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

async function runVectorQuery(query, { source = 'guide', ownerFilter = false, userId = null, limit = 50 } = {}) {
  const vec = await embedText(query)
  const lit = toPgVectorLiteral(vec)
  // pgvector's `<=>` operator returns cosine *distance* (0 = identical,
  // 2 = opposite). Convert to similarity via 1 - distance.
  //
  // ivfflat tuning: see the v1 comment that lived here — lists=100 + probes=10
  // is the production-tuned setting; the SET LOCAL is scoped to the
  // transaction so it doesn't bleed into other queries.
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL ivfflat.probes = 10')
    return ownerFilter
      ? await tx.$queryRaw`
          SELECT
            c.id, c."docId", c.position, c.content,
            (1 - (c.embedding <=> ${lit}::vector)) AS sim
          FROM help_chunks c
          JOIN help_docs d ON d.id = c."docId"
          WHERE d.status = 'PUBLISHED'
            AND d.source = ${source}
            AND d."ownerId" = ${userId}
            AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> ${lit}::vector ASC
          LIMIT ${limit}
        `
      : await tx.$queryRaw`
          SELECT
            c.id, c."docId", c.position, c.content,
            (1 - (c.embedding <=> ${lit}::vector)) AS sim
          FROM help_chunks c
          JOIN help_docs d ON d.id = c."docId"
          WHERE d.status = 'PUBLISHED'
            AND d.source = ${source}
            AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> ${lit}::vector ASC
          LIMIT ${limit}
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
 * Reads the user's `shareNotesWithGuide` preference from the existing
 * `User.preferences` Json column (Sprint 2 §2.4). Absent key === OFF.
 * Errors return false (fail-safe — never expose a private lane on error).
 */
export async function getUserSharePref(userId) {
  if (!userId) return false
  try {
    const row = await db.user.findUnique({
      where:  { id: userId },
      select: { preferences: true },
    })
    if (!row) return false
    const prefs = (row.preferences && typeof row.preferences === 'object') ? row.preferences : {}
    return prefs.shareNotesWithGuide === true
  } catch {
    return false
  }
}

// ── Lane-aware retrieval (Sprint 3 of doc/Research_Log_Plan.md §3) ────────

export const DEFAULT_LANE_BUDGETS = Object.freeze({
  corpus:         4,
  privateNotes:   2,
  communityNotes: 2,
})

const LANE_KEY_PREFIX = 'help.lanes.'

/**
 * Read per-lane budgets from SystemConfig. Each key
 * `help.lanes.<lane>` is an integer override; absence falls back to
 * DEFAULT_LANE_BUDGETS. Reads are best-effort — DB errors degrade to
 * defaults so a SystemConfig outage doesn't kill the help surface.
 */
export async function getLaneBudgets() {
  const out = { ...DEFAULT_LANE_BUDGETS }
  try {
    const rows = await db.systemConfig.findMany({
      where: { key: { in: ['corpus', 'privateNotes', 'communityNotes'].map(k => LANE_KEY_PREFIX + k) } },
    })
    for (const row of rows) {
      const lane = row.key.slice(LANE_KEY_PREFIX.length)
      const v = row.value
      const n = typeof v === 'number' ? v
              : typeof v === 'string' ? parseInt(v, 10)
              : (v && typeof v === 'object' && typeof v.limit === 'number') ? v.limit
              : NaN
      if (Number.isFinite(n) && n >= 0 && n <= 25) out[lane] = n
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'help.searchLanes: SystemConfig lookup failed, using defaults')
  }
  return out
}

/**
 * Lane-aware hybrid retrieval. Runs each enabled lane's FTS + vector
 * branches concurrently, merges per-lane, and returns lane-tagged chunks.
 *
 * Lane budgets default to DEFAULT_LANE_BUDGETS; per-lane overrides come
 * from `help.lanes.<lane>` SystemConfig keys (call `getLaneBudgets()`
 * to fetch). Caller may pass `lanes` directly to skip the lookup.
 *
 * Privacy contract:
 *   - The `privateNotes` lane filters by `HelpDoc.ownerId = userId` at
 *     the SQL level. Never in app code. Test asserts cross-user requests
 *     return zero rows.
 *   - The `shareNotesWithGuide` preference flips the lane OFF entirely
 *     (no SQL fired). Stored in `User.preferences` (Sprint 2 §2.4).
 *   - When `userId` is null (anonymous / CLI), the private lane is
 *     skipped — there's no owner to scope to.
 *
 * Degraded fallback applies per-lane: a failing vector branch on one
 * lane doesn't poison the other lanes. The returned `degraded` is true
 * if ANY lane lost its vector branch.
 */
export async function searchLanes(query, opts = {}) {
  const {
    userId = null,
    shareWithGuide = false,
    lanes: lanesOverride,
    alpha: alphaOverride,
  } = opts

  const trimmed = String(query ?? '').trim()
  if (!trimmed) {
    return {
      chunks: [],
      lanes: { corpus: [], privateNotes: [], communityNotes: [] },
      counts: { corpus: 0, privateNotes: 0, communityNotes: 0 },
      degraded: false,
      degradedReason: null,
      budgets: lanesOverride ?? DEFAULT_LANE_BUDGETS,
      alpha: alphaOverride ?? DEFAULT_FTS_WEIGHT,
    }
  }

  const budgets = lanesOverride ?? (await getLaneBudgets())
  const alpha = alphaOverride ?? (await getFtsWeight())
  const expanded = expandQuery(trimmed)

  // Decide which lanes are eligible to run.
  const willRun = {
    corpus:         budgets.corpus > 0,
    communityNotes: budgets.communityNotes > 0,
    privateNotes:   budgets.privateNotes > 0 && !!userId && shareWithGuide === true,
  }

  // Per-lane retrieval. Each lane gets a 50-row pool from FTS + vector then
  // merges + truncates to the lane budget.
  async function runLane(lane) {
    if (!willRun[lane]) return { lane, chunks: [], degraded: false, degradedReason: null }
    const where = laneWhere(lane, userId)
    const opts = { source: where.source, ownerFilter: where.ownerFilter, userId: where.userId, limit: 50 }
    const [ftsRes, vecRes] = await Promise.allSettled([
      runFtsQuery(trimmed, opts),
      runVectorQuery(expanded, opts),
    ])
    if (ftsRes.status === 'rejected') throw ftsRes.reason
    let vecRows = []
    let degraded = false, degradedReason = null
    let effectiveAlpha = alpha
    if (vecRes.status === 'rejected') {
      degraded = true
      degradedReason = String(vecRes.reason?.message ?? vecRes.reason ?? 'unknown').slice(0, DEGRADED_REASON_MAX)
      effectiveAlpha = 1
    } else {
      vecRows = vecRes.value
    }
    const merged = mergeRanked(ftsRes.value, vecRows, effectiveAlpha)
    const chunks = merged.slice(0, budgets[lane]).map(c => ({ ...c, lane }))
    return { lane, chunks, degraded, degradedReason }
  }

  const laneResults = await Promise.all(['corpus', 'communityNotes', 'privateNotes'].map(runLane))

  // Stitch — interleave chunks by their merged score so the final top-K is
  // sorted globally, not bucketed by lane.
  const all = laneResults.flatMap(r => r.chunks)
  all.sort((a, b) => b.score - a.score)
  const lanesOut = {
    corpus:         laneResults.find(r => r.lane === 'corpus').chunks,
    communityNotes: laneResults.find(r => r.lane === 'communityNotes').chunks,
    privateNotes:   laneResults.find(r => r.lane === 'privateNotes').chunks,
  }
  const counts = {
    corpus:         lanesOut.corpus.length,
    communityNotes: lanesOut.communityNotes.length,
    privateNotes:   lanesOut.privateNotes.length,
  }
  const anyDegraded = laneResults.some(r => r.degraded)
  const firstReason = laneResults.find(r => r.degradedReason)?.degradedReason ?? null

  return {
    chunks:         all,
    lanes:          lanesOut,
    counts,
    degraded:       anyDegraded,
    degradedReason: firstReason,
    budgets,
    alpha,
  }
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
  _searchLanes = searchLanes,
  _streamChatCompletion = streamChatCompletion,
  _scanContent = scanContent,
  _rewriteLinks = rewriteLinks,
  _getUserPrefs = getUserSharePref,
} = {}) {
  const askStart = Date.now()
  const trimmedQ = String(question ?? '').trim()
  if (!trimmedQ) {
    yield { kind: 'error', error: 'empty_question' }
    return
  }

  // 1. Retrieve via the lane-aware pipeline (Sprint 3). The corpus lane
  //    always runs; community-notes runs when there's content to find;
  //    private-notes runs only when the user has opted in via
  //    `shareNotesWithGuide` (Sprint 2 §2.4). searchLanes catches embed
  //    failures per-lane and aggregates degraded=true if ANY lane lost
  //    its vector branch.
  const shareWithGuide = userId ? await _getUserPrefs(userId).catch(() => false) : false
  const retrieval = await _searchLanes(trimmedQ, { userId, shareWithGuide })

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
  // Link rewriting: promote `**Gym**`/`**Profile**`/etc. to real Markdown
  // links so the Sprint 3 HelpAnswer renderer can wire them up as
  // clickable navigation (which already tracks doc-link clickthroughs as
  // implicit feedback per §3.2 of the plan). Skipped when the filter
  // triggered — refusal text has no platform terms to link, and we
  // want to preserve the canonical refusal phrase exactly.
  const finalRendered = filter.triggered
    ? REFUSAL.HOSTILE
    : _rewriteLinks(rawAnswer)

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

  // 8. Build citation metadata (Sprint 3 §3 step 4). One entry per
  //    referenced HelpDoc, with the lane that produced it. When the same
  //    doc appears in multiple lanes (rare but possible if a private mirror
  //    overlaps with the corpus), prefer the most-specific lane:
  //    privateNotes > communityNotes > corpus (private = your own; community
  //    = a peer's published note; corpus = curated).
  const citations = await buildCitations(retrieval.chunks)

  // 9. Terminal frame.
  yield {
    kind: 'done',
    answerId:                answer?.id ?? null,
    queryId:                 helpQuery.id,
    contentFilterTriggered:  filter.triggered,
    rendered:                finalRendered,  // for clients that prefer non-streaming view
    degraded:                retrieval.degraded,
    latencyMs:               Date.now() - askStart,
    citations,
  }
}

const LANE_PRIORITY = { privateNotes: 3, communityNotes: 2, corpus: 1 }

/**
 * Resolves chunk[] → citation[]. Dedupes by docId, keeps the most specific
 * lane, fetches title/slug/author in one query. Safe to call with [].
 */
export async function buildCitations(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return []
  const byDoc = new Map()
  for (const c of chunks) {
    if (!c?.docId) continue
    const prior = byDoc.get(c.docId)
    if (!prior || (LANE_PRIORITY[c.lane] ?? 0) > (LANE_PRIORITY[prior.lane] ?? 0)) {
      byDoc.set(c.docId, { docId: c.docId, lane: c.lane ?? 'corpus' })
    }
  }
  const docIds = [...byDoc.keys()]
  if (docIds.length === 0) return []
  const docs = await db.helpDoc.findMany({
    where: { id: { in: docIds } },
    select: {
      id: true, slug: true, title: true, source: true,
      owner: { select: { id: true, displayName: true } },
    },
  })
  const out = []
  for (const d of docs) {
    const c = byDoc.get(d.id)
    if (!c) continue
    out.push({
      docId:  d.id,
      lane:   c.lane,
      slug:   d.slug,
      title:  d.title,
      author: d.owner ? { id: d.owner.id, displayName: d.owner.displayName } : null,
    })
  }
  return out
}
