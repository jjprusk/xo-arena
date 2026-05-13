// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help corpus seeder.
 *
 * Reads /doc/Help_Corpus/*.md and inserts new HelpDoc rows (additive only:
 * never updates existing slugs). For each new doc, regenerates chunks and
 * writes 384-dim embeddings via the embed client.
 *
 * Behaviour rules (locked in by the §13 decisions of Help_System_Plan.md):
 *   1. DB is canonical after seeding. Subsequent edits happen in the admin
 *      editor; the seeder never overwrites an existing slug.
 *   2. Seed runs idempotently on every backend startup — safe to re-run.
 *   3. New file in the corpus dir is picked up on next boot.
 *   4. `seededFromFile` is set so an admin can correlate a doc back to its
 *      original git-tracked file if needed.
 *
 * The frontmatter format is YAML-ish; we parse a minimal subset rather than
 * pull in js-yaml as a dep. Supported keys are listed at the top of each
 * /doc/Help_Corpus/*.md file.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import db from '../../lib/db.js'
import logger from '../../logger.js'
import { chunk } from './chunker.js'
import { embedTexts, toPgVectorLiteral } from './embedClient.js'

const DEFAULT_CORPUS_DIR = '/app/doc/Help_Corpus'

/**
 * Parses a markdown file with YAML-style frontmatter.
 * Returns { meta: Record<string,any>, body: string }.
 * Throws if the frontmatter block is missing or malformed.
 */
export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    throw new Error('frontmatter missing — file must start with "---"')
  }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) throw new Error('frontmatter unterminated — no closing "---"')

  const fmText = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\s*\n/, '')

  const meta = {}
  for (const line of fmText.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
    if (!m) continue
    const [, k, vRaw] = m
    const v = vRaw.trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      // Array literal: split on commas, trim, drop empties.
      meta[k] = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
    } else if (v === 'true' || v === 'false') {
      meta[k] = v === 'true'
    } else {
      meta[k] = v
    }
  }
  return { meta, body }
}

/**
 * Inserts chunks for a doc, regenerating embeddings. Uses raw SQL because
 * Prisma cannot bind the pgvector column type directly.
 *
 * Caller is responsible for clearing prior chunks (e.g., during reindex).
 * `seedDoc` only inserts for newly-created docs so it never deletes.
 */
async function insertChunks(docId, docVersion, body) {
  const chunks = chunk(body)
  if (chunks.length === 0) return 0

  const embeddings = await embedTexts(chunks.map(c => c.content))

  for (let i = 0; i < chunks.length; i++) {
    const { position, content } = chunks[i]
    const vec = toPgVectorLiteral(embeddings[i])
    // Use createMany would be nice but pgvector binding via Prisma is not
    // supported — so we do one $executeRaw per row. Tiny corpus, no perf
    // concern in v1.
    await db.$executeRaw`
      INSERT INTO "help_chunks" ("id", "docId", "position", "content", "embedding", "docVersion", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        ${docId},
        ${position},
        ${content},
        ${vec}::vector,
        ${docVersion},
        CURRENT_TIMESTAMP
      )
    `
  }
  return chunks.length
}

/**
 * Reindex a single doc: deletes existing chunks, regenerates from current
 * body, bumps no version (caller's responsibility — used by /reindex which
 * doesn't change content, and by PUT which bumps version then calls this).
 */
export async function reindexDoc(docId) {
  const doc = await db.helpDoc.findUnique({ where: { id: docId } })
  if (!doc) throw new Error(`reindexDoc: doc not found: ${docId}`)
  await db.helpChunk.deleteMany({ where: { docId } })
  const n = await insertChunks(docId, doc.version, doc.body)
  return { docId, chunkCount: n }
}

/**
 * Reindex every doc. Used by `um help-reindex` with no args and by the
 * admin /reindex endpoint.
 */
export async function reindexAll() {
  const docs = await db.helpDoc.findMany({ select: { id: true } })
  const results = []
  for (const { id } of docs) {
    results.push(await reindexDoc(id))
  }
  return results
}

/**
 * Reads all corpus markdown files from `corpusDir` and inserts any whose
 * slug is not already in the DB. Returns a summary of {inserted, skipped}
 * counts. Safe to call on every boot.
 */
export async function seedCorpus(corpusDir = process.env.HELP_CORPUS_DIR || DEFAULT_CORPUS_DIR) {
  let files
  try {
    files = (await readdir(corpusDir)).filter(f => f.endsWith('.md'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn({ corpusDir }, 'Help corpus dir not found — skipping seed')
      return { inserted: 0, skipped: 0, errors: [] }
    }
    throw err
  }

  let inserted = 0
  let skipped = 0
  const errors = []

  for (const file of files) {
    try {
      const raw = await readFile(join(corpusDir, file), 'utf8')
      const { meta, body } = parseFrontmatter(raw)
      if (!meta.slug || !meta.title || !meta.category) {
        errors.push({ file, error: 'missing required frontmatter (slug/title/category)' })
        continue
      }

      const existing = await db.helpDoc.findUnique({ where: { slug: meta.slug } })
      if (existing) {
        skipped++
        continue
      }

      const created = await db.helpDoc.create({
        data: {
          slug:           meta.slug,
          title:          meta.title,
          body,
          category:       meta.category,
          tags:           Array.isArray(meta.tags) ? meta.tags : [],
          status:         (meta.status === 'DRAFT' || meta.status === 'ARCHIVED') ? meta.status : 'PUBLISHED',
          seededFromFile: file,
          version:        1,
        },
      })
      await insertChunks(created.id, 1, body)
      inserted++
    } catch (err) {
      errors.push({ file, error: err.message })
    }
  }

  if (inserted > 0 || errors.length > 0) {
    logger.info({ inserted, skipped, errorCount: errors.length }, 'Help corpus seed complete')
    for (const e of errors) logger.warn({ file: e.file, err: e.error }, 'Help corpus seed: file error')
  }
  return { inserted, skipped, errors }
}
