// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Research Log publish / unpublish service.
 *
 * Sprint 2 of doc/Research_Log_Plan.md §2.2. Shared between
 * TrainingSessionNote and ResearchLogEntry — both sit behind the
 * `researchLog.publishEnabled` SystemConfig flag, both produce a HelpDoc
 * row carrying `source='community'` so the Sprint 3 retrieval mixer can
 * isolate the community lane.
 *
 * Idempotency rules:
 *   - publish() on an already-published record refreshes the linked
 *     HelpDoc body + chunks (so editing the note then re-publishing
 *     propagates), bumps HelpDoc.version, but leaves publishedAt alone.
 *   - unpublish() on an unpublished record is a no-op success.
 */

import db from '../../lib/db.js'
import { scrubForPublish } from './pii.js'
import { isPublishEnabled } from './config.js'
import { chunk } from '../help/chunker.js'
import {
  embedTexts,
  toPgVectorLiteral,
  currentEmbedModelVersion,
} from '../help/embedClient.js'

// Lane discriminator on HelpDoc.source — must match plan §2.1 S3 exactly
// so the Sprint 3 retrieval mixer can isolate the community lane.
export const COMMUNITY_SOURCE = 'community-note'
const COMMUNITY_CATEGORY_FOR_NOTES = 'community'

export class PublishError extends Error {
  constructor(code, status, message) {
    super(message ?? code)
    this.name = 'PublishError'
    this.code = code
    this.status = status
  }
}

/**
 * Notes have no title column; derive one from the first non-empty line,
 * capped at 80 chars. The user can rename later by editing the note body
 * and re-publishing (titles aren't a separate field).
 */
function deriveNoteTitle(body) {
  const firstLine = String(body ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return firstLine.slice(0, 80) || 'Untitled research note'
}

function noteSlug(noteId)   { return `research-note-${noteId}` }
function entrySlug(entryId) { return `research-entry-${entryId}` }

/**
 * Rewrites the HelpChunk rows for a doc to match `body`. Mirrors
 * services/help/corpusSeeder.js `insertChunks` — raw SQL is required
 * because Prisma cannot bind the pgvector type.
 */
async function regenerateChunks(docId, docVersion, body) {
  await db.helpChunk.deleteMany({ where: { docId } })
  const chunks = chunk(body)
  if (chunks.length === 0) return 0
  const embeddings = await embedTexts(chunks.map(c => c.content))
  const embeddingModel = currentEmbedModelVersion()
  for (let i = 0; i < chunks.length; i++) {
    const { position, content } = chunks[i]
    const vec = toPgVectorLiteral(embeddings[i])
    await db.$executeRaw`
      INSERT INTO "help_chunks" ("id", "docId", "position", "content", "embedding", "docVersion", "embeddingModel", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        ${docId},
        ${position},
        ${content},
        ${vec}::vector,
        ${docVersion},
        ${embeddingModel},
        CURRENT_TIMESTAMP
      )
    `
  }
  return chunks.length
}

/**
 * Upsert the HelpDoc backing a note/entry, then regenerate its chunks.
 * `existingDocId` is the current helpDocId from the source row (may be
 * null on first publish or stale if the linked HelpDoc was deleted).
 */
async function upsertCommunityDoc({
  existingDocId,
  slug,
  title,
  body,
  tags,
  category,
  ownerId,
}) {
  let doc = null
  if (existingDocId) {
    doc = await db.helpDoc.findUnique({ where: { id: existingDocId } })
  }

  if (doc) {
    doc = await db.helpDoc.update({
      where: { id: doc.id },
      data: {
        title,
        body,
        tags,
        category,
        source:   COMMUNITY_SOURCE,
        ownerId,
        status:   'PUBLISHED',
        version:  { increment: 1 },
      },
    })
  } else {
    doc = await db.helpDoc.create({
      data: {
        slug,
        title,
        body,
        category,
        tags,
        status:   'PUBLISHED',
        source:   COMMUNITY_SOURCE,
        ownerId,
        version:  1,
      },
    })
  }

  await regenerateChunks(doc.id, doc.version, body)
  return doc
}

/**
 * Tear down a HelpDoc + its chunks. Used by both unpublishNote and
 * unpublishEntry. Safe to call when `docId` no longer points to a row.
 */
async function teardownCommunityDoc(docId) {
  if (!docId) return
  await db.helpChunk.deleteMany({ where: { docId } })
  await db.helpDoc.deleteMany({ where: { id: docId } })
}

// ── Notes ──────────────────────────────────────────────────────────────────

export async function publishNote(noteId, userId) {
  if (!(await isPublishEnabled())) {
    throw new PublishError('publish_disabled', 503,
      'Research Log community publishing is currently disabled')
  }
  const note = await db.trainingSessionNote.findUnique({ where: { id: noteId } })
  if (!note) throw new PublishError('note_not_found', 404)
  if (note.userId !== userId) throw new PublishError('forbidden', 403)

  const { scrubbed, matches } = scrubForPublish(note.body)
  const title = deriveNoteTitle(scrubbed)
  const docBody = `# ${title}\n\n${scrubbed}`

  const doc = await upsertCommunityDoc({
    existingDocId: note.helpDocId,
    slug:          noteSlug(note.id),
    title,
    body:          docBody,
    tags:          Array.isArray(note.tags) ? note.tags : [],
    category:      COMMUNITY_CATEGORY_FOR_NOTES,
    ownerId:       userId,
  })

  const updated = await db.trainingSessionNote.update({
    where: { id: note.id },
    data: {
      sharedWithCommunity: true,
      publishedAt:         note.publishedAt ?? new Date(),
      helpDocId:           doc.id,
    },
  })
  return { note: updated, helpDocId: doc.id, scrubMatches: matches }
}

export async function unpublishNote(noteId, userId) {
  if (!(await isPublishEnabled())) {
    throw new PublishError('publish_disabled', 503,
      'Research Log community publishing is currently disabled')
  }
  const note = await db.trainingSessionNote.findUnique({ where: { id: noteId } })
  if (!note) throw new PublishError('note_not_found', 404)
  if (note.userId !== userId) throw new PublishError('forbidden', 403)

  await teardownCommunityDoc(note.helpDocId)
  const updated = await db.trainingSessionNote.update({
    where: { id: note.id },
    data: {
      sharedWithCommunity: false,
      publishedAt:         null,
      helpDocId:           null,
    },
  })
  return { note: updated }
}

// ── Entries ────────────────────────────────────────────────────────────────

export async function publishEntry(entryId, userId) {
  if (!(await isPublishEnabled())) {
    throw new PublishError('publish_disabled', 503,
      'Research Log community publishing is currently disabled')
  }
  const entry = await db.researchLogEntry.findUnique({ where: { id: entryId } })
  if (!entry) throw new PublishError('entry_not_found', 404)
  if (entry.userId !== userId) throw new PublishError('forbidden', 403)

  const { scrubbed: scrubbedBody,  matches: bodyMatches }  = scrubForPublish(entry.body)
  const { scrubbed: scrubbedTitle, matches: titleMatches } = scrubForPublish(entry.title)
  const title = scrubbedTitle.slice(0, 120) || 'Untitled research entry'
  const docBody = `# ${title}\n\n${scrubbedBody}`
  const matches = [...titleMatches, ...bodyMatches]

  const doc = await upsertCommunityDoc({
    existingDocId: entry.helpDocId,
    slug:          entrySlug(entry.id),
    title,
    body:          docBody,
    tags:          Array.isArray(entry.tags) ? entry.tags : [],
    category:      entry.category,
    ownerId:       userId,
  })

  const updated = await db.researchLogEntry.update({
    where: { id: entry.id },
    data: {
      sharedWithCommunity: true,
      publishedAt:         entry.publishedAt ?? new Date(),
      helpDocId:           doc.id,
    },
  })
  return { entry: updated, helpDocId: doc.id, scrubMatches: matches }
}

export async function unpublishEntry(entryId, userId) {
  if (!(await isPublishEnabled())) {
    throw new PublishError('publish_disabled', 503,
      'Research Log community publishing is currently disabled')
  }
  const entry = await db.researchLogEntry.findUnique({ where: { id: entryId } })
  if (!entry) throw new PublishError('entry_not_found', 404)
  if (entry.userId !== userId) throw new PublishError('forbidden', 403)

  await teardownCommunityDoc(entry.helpDocId)
  const updated = await db.researchLogEntry.update({
    where: { id: entry.id },
    data: {
      sharedWithCommunity: false,
      publishedAt:         null,
      helpDocId:           null,
    },
  })
  return { entry: updated }
}
