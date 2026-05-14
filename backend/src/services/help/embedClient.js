// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Embedding client for the Help System.
 *
 * v1 architecture (per ADR-001 in doc/Help_System_Plan.md): OpenAI
 * `text-embedding-3-small` at 384 dim, called directly from the backend.
 * The `dimensions=384` parameter matches our existing `vector(384)` schema
 * without a column-type migration.
 *
 * Two modes:
 *   - Stub: deterministic hash-projection. Active under NODE_ENV=test or
 *     HELP_EMBED_STUB=1. Keeps the unit-test suite hermetic (no API calls)
 *     and lets offline / no-credit local dev exercise the seeder + retrieval
 *     paths without burning real tokens.
 *   - OpenAI: real embedding via api.openai.com. Default in any environment
 *     where NODE_ENV != 'test' and HELP_EMBED_STUB is unset.
 */

export const EMBED_DIM = 384

const OPENAI_EMBED_URL   = 'https://api.openai.com/v1/embeddings'
const OPENAI_EMBED_MODEL = 'text-embedding-3-small'

/**
 * Stable identifier for the embedding model that produced a given vector.
 * Stored on every help_chunks row in `embeddingModel`; checked at boot by
 * `reindexAllIfStale` so a model swap (or the Sprint 2 stub → OpenAI cutover)
 * triggers a one-time corpus reindex.
 *
 * Format: '<provider>:<model>@<dim>' for live; 'stub' for the hermetic stub.
 * Bump this constant whenever the live model identity changes (e.g. moving
 * to text-embedding-3-large, or to 512-dim).
 */
export const EMBED_MODEL_VERSION_LIVE = `${OPENAI_EMBED_MODEL}@${EMBED_DIM}`
export const EMBED_MODEL_VERSION_STUB = 'stub'

/**
 * Returns the model version tag that THIS process will write into the
 * `help_chunks.embeddingModel` column when it embeds new content.
 * Switches based on stub vs. live (see `shouldUseStub`).
 */
export function currentEmbedModelVersion() {
  return shouldUseStub() ? EMBED_MODEL_VERSION_STUB : EMBED_MODEL_VERSION_LIVE
}

// OpenAI's documented per-request input cap is 2048, but we batch at 100 to
// stay well under the request-size ceiling (~8MB) and keep retry granularity
// reasonable if a batch fails.
const MAX_BATCH = 100

/**
 * Thrown when OpenAI responds with 429. Caller distinguishes this from
 * generic 5xx because the recovery path differs (back off and retry vs.
 * surface to the user / fall back to tsv-only retrieval).
 */
export class RateLimitError extends Error {
  constructor(message, retryAfter = null) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

/**
 * Returns a deterministic 384-dim L2-normalized vector for a single text.
 * Used in tests and when HELP_EMBED_STUB=1. Token-hash projection means
 * inputs sharing tokens trend toward higher cosine similarity without
 * making any claim of semantic quality.
 */
function stubEmbed(text) {
  const v = new Array(EMBED_DIM).fill(0)
  const tokens = String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (const tok of tokens) {
    for (let salt = 0; salt < 4; salt++) {
      let h = salt * 2654435761
      for (let i = 0; i < tok.length; i++) {
        h = Math.imul(h ^ tok.charCodeAt(i), 16777619) >>> 0
      }
      v[h % EMBED_DIM] += 1
    }
  }
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm === 0) {
    v[0] = 1
    return v
  }
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm
  return v
}

function shouldUseStub() {
  // VITEST is set by vitest itself regardless of NODE_ENV, which matters
  // because our local docker-compose sets NODE_ENV=development and we still
  // want vitest runs there to be hermetic (no real OpenAI calls). CI sets
  // NODE_ENV=test explicitly, so either signal triggers stub mode.
  return (
    process.env.NODE_ENV === 'test'
    || process.env.VITEST === 'true'
    || process.env.HELP_EMBED_STUB === '1'
  )
}

/**
 * Embed `texts` via OpenAI. Batches at MAX_BATCH per request and preserves
 * input order even when OpenAI returns data out of order (it usually doesn't,
 * but the API contract says results carry an `index` field — we honor it).
 *
 * Throws:
 *   - RateLimitError on 429 (with retryAfter when present)
 *   - Error("openai embed <status>: ...") on any other non-2xx
 *   - Error("embedClient: OPENAI_API_KEY missing ...") if the key is unset
 *   - Network errors propagate from fetch()
 */
async function openaiEmbed(texts) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'embedClient: OPENAI_API_KEY missing — set it in env, ' +
      'or use HELP_EMBED_STUB=1 to bypass for offline/dev work',
    )
  }
  const out = new Array(texts.length)
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH)
    const res = await fetch(OPENAI_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:      OPENAI_EMBED_MODEL,
        input:      batch,
        dimensions: EMBED_DIM,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 429) {
        const ra = parseInt(res.headers.get('retry-after') ?? '0', 10)
        throw new RateLimitError(
          `openai embed 429: ${body.slice(0, 200)}`,
          Number.isFinite(ra) && ra > 0 ? ra : null,
        )
      }
      throw new Error(`openai embed ${res.status}: ${body.slice(0, 200)}`)
    }
    const j = await res.json()
    if (!j?.data || !Array.isArray(j.data) || j.data.length !== batch.length) {
      throw new Error('openai embed: malformed response (data array missing or wrong length)')
    }
    // Defensive: sort by index in case OpenAI ever returns out-of-order
    // results. The `index` field is part of the documented response shape.
    const ordered = [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (let k = 0; k < batch.length; k++) {
      const emb = ordered[k]?.embedding
      if (!Array.isArray(emb) || emb.length !== EMBED_DIM) {
        throw new Error(`openai embed: bad embedding shape at batch index ${k}`)
      }
      out[i + k] = emb
    }
  }
  return out
}

/**
 * Embeds a batch of texts. Returns an array of 384-dim vectors in input
 * order. Routes to stub or OpenAI per `shouldUseStub()`.
 */
export async function embedTexts(texts) {
  if (!Array.isArray(texts)) throw new Error('embedTexts: expected array')
  if (texts.length === 0) return []
  if (shouldUseStub()) return texts.map(stubEmbed)
  return await openaiEmbed(texts)
}

/** Convenience: embed a single text. */
export async function embedText(text) {
  const [v] = await embedTexts([text])
  return v
}

/**
 * Health probe — fires one minimal embed call to verify the provider + key
 * are reachable. Returns a stable shape suitable for the admin health
 * dashboard tile.
 *
 *   { ok, latencyMs, model, provider, error? }
 *
 * Never throws — wraps the real call so a health probe failure doesn't
 * propagate as an exception. Errors are surfaced via `ok: false` + `error`.
 */
export async function health() {
  if (shouldUseStub()) {
    return { ok: true, latencyMs: 0, model: 'stub', provider: 'stub' }
  }
  const t0 = Date.now()
  try {
    const [v] = await openaiEmbed(['health'])
    return {
      ok:       Array.isArray(v) && v.length === EMBED_DIM,
      latencyMs: Date.now() - t0,
      model:    OPENAI_EMBED_MODEL,
      provider: 'openai',
    }
  } catch (err) {
    return {
      ok:       false,
      latencyMs: Date.now() - t0,
      model:    OPENAI_EMBED_MODEL,
      provider: 'openai',
      error:    String(err?.message ?? err).slice(0, 200),
    }
  }
}

/**
 * Formats a JS vector as a pgvector literal: '[0.1,0.2,...]'. Required for
 * `$queryRaw` parameter binding since Prisma doesn't model pgvector types
 * directly.
 */
export function toPgVectorLiteral(vec) {
  if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
    throw new Error(`toPgVectorLiteral: expected ${EMBED_DIM}-length array`)
  }
  return '[' + vec.join(',') + ']'
}
