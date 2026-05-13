// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Embedding client for the Help System.
 *
 * Sprint 1 ships a deterministic stub so the seeder + retrieval paths can be
 * wired and tested end-to-end without the xo-llm proxy. Sprint 2 swaps the
 * implementation to call the real `xo-llm /embed` endpoint (MiniLM-L6-v2,
 * 384 dim).
 *
 * The stub is intentionally not random: hashing → bag-of-tokens projection
 * means two inputs with the same content always produce the same vector and
 * inputs sharing tokens trend toward higher cosine similarity. That's enough
 * to validate the SQL plumbing (vector type, ivfflat index, retrieval merge)
 * without claiming any semantic quality.
 */

export const EMBED_DIM = 384

/**
 * Returns a deterministic 384-dim L2-normalized vector for a single text.
 * Uses a token-hash projection: each token contributes to a small set of
 * dimensions weighted by its frequency. Tokens are lowercased, alphanumeric.
 */
function stubEmbed(text) {
  const v = new Array(EMBED_DIM).fill(0)
  const tokens = String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (const tok of tokens) {
    // 4 hash slots per token → roughly stable contribution surface
    for (let salt = 0; salt < 4; salt++) {
      let h = salt * 2654435761
      for (let i = 0; i < tok.length; i++) {
        h = Math.imul(h ^ tok.charCodeAt(i), 16777619) >>> 0
      }
      v[h % EMBED_DIM] += 1
    }
  }
  // L2 normalize so cosine similarity reduces to dot product.
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm === 0) {
    // Empty input — emit a fixed sentinel vector so downstream code that
    // expects a 384-length array still gets one. Cosine to any real vector
    // will be 0; that's fine, FTS will dominate ranking in this edge case.
    v[0] = 1
    return v
  }
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm
  return v
}

/**
 * Embeds a batch of texts. Returns an array of 384-dim vectors in input
 * order. The real implementation in Sprint 2 will POST `{ texts }` to
 * `xo-llm /embed` and forward the response.
 */
export async function embedTexts(texts) {
  if (!Array.isArray(texts)) throw new Error('embedTexts: expected array')
  return texts.map(stubEmbed)
}

/** Convenience: embed a single text. */
export async function embedText(text) {
  const [v] = await embedTexts([text])
  return v
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
