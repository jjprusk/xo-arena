// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help doc chunker. Splits a markdown body into retrieval-friendly chunks.
 *
 * The strategy is simple on purpose: paragraph-based grouping with a soft
 * char-count cap. We deliberately keep markdown headers in the chunk text
 * because the headers carry topic signal that helps both FTS and embeddings.
 *
 * Tradeoff: very long single paragraphs aren't split — that would harm
 * coherence. v1 corpus is hand-authored so the constraint is implicit. If
 * the corpus ever ingests external sources we'll revisit.
 */

const TARGET_CHUNK_CHARS = 800
const MIN_CHUNK_CHARS = 120

/**
 * Splits a markdown body into ordered chunks. Each chunk has a `position`
 * (zero-based) and a `content` string.
 *
 * @param {string} body — full markdown body (post-frontmatter)
 * @returns {{ position: number, content: string }[]}
 */
export function chunk(body) {
  if (!body || typeof body !== 'string') return []

  // Split on blank lines (paragraphs / sections). Keep the original line
  // breaks within each block.
  const blocks = body
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean)

  const out = []
  let buf = []
  let bufLen = 0

  const flush = () => {
    if (buf.length === 0) return
    out.push({ position: out.length, content: buf.join('\n\n') })
    buf = []
    bufLen = 0
  }

  for (const block of blocks) {
    const blockLen = block.length
    // If adding this block would exceed the target and the buffer already
    // has enough content, flush first.
    if (bufLen + blockLen > TARGET_CHUNK_CHARS && bufLen >= MIN_CHUNK_CHARS) {
      flush()
    }
    buf.push(block)
    bufLen += blockLen
  }
  flush()

  return out
}
