// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Community-feed + export helpers for the Research Log.
 * Sprint 2 of doc/Research_Log_Plan.md §3 steps 5–6.
 *
 * The community feed surfaces HelpDoc rows carrying the `community-note`
 * source discriminator, paginated cursor-style by createdAt+id so a tag
 * filter doesn't fragment the page boundary.
 *
 * The export endpoint walks both `TrainingSessionNote` and
 * `ResearchLogEntry` for the caller and emits a single markdown stream
 * with YAML frontmatter per item — round-trip friendly.
 */

import db from '../../lib/db.js'
import { COMMUNITY_SOURCE } from './publishService.js'

const DEFAULT_PAGE = 20
const MAX_PAGE     = 100

/**
 * List published community HelpDocs (notes + entries unified under the
 * `community-note` source). Cursor pagination on createdAt — caller passes
 * the last-seen `createdAt` ISO string + `id` and we return the next page.
 *
 * Attribution is the owner's `displayName` (User.displayName) — null when
 * the user has been deleted (HelpDoc.ownerId FK is ON DELETE SET NULL so
 * the doc survives as an anonymous contribution).
 */
export async function listCommunityDocs({ tag, cursorCreatedAt, cursorId, limit } = {}) {
  const take = Math.min(Math.max(Number(limit) || DEFAULT_PAGE, 1), MAX_PAGE)
  const where = { source: COMMUNITY_SOURCE }
  if (tag) where.tags = { has: String(tag).toLowerCase().replace(/-/g, '_') }
  if (cursorCreatedAt && cursorId) {
    // Walk older than the last-seen item. Tie-break on id so we never
    // re-serve a row with the same createdAt as the cursor.
    where.OR = [
      { createdAt: { lt: new Date(cursorCreatedAt) } },
      { createdAt: new Date(cursorCreatedAt), id: { lt: cursorId } },
    ]
  }

  const rows = await db.helpDoc.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    include: {
      owner: { select: { id: true, displayName: true } },
    },
  })

  const items = rows.map(d => ({
    id:         d.id,
    slug:       d.slug,
    title:      d.title,
    body:       d.body,
    category:   d.category,
    tags:       d.tags,
    createdAt:  d.createdAt,
    updatedAt:  d.updatedAt,
    version:    d.version,
    author:     d.owner
      ? { id: d.owner.id, displayName: d.owner.displayName }
      : null,
  }))

  const last = rows[rows.length - 1]
  const nextCursor = rows.length === take && last
    ? { createdAt: last.createdAt.toISOString(), id: last.id }
    : null

  return { items, nextCursor }
}

// ── Export ────────────────────────────────────────────────────────────────

function yamlScalar(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  const s = String(v)
  // Quote if the value contains a colon, leading/trailing space, or starts
  // with a yaml-significant char. This is intentionally aggressive — we'd
  // rather over-quote and stay safe than under-quote and produce ambiguous
  // YAML in the export stream.
  if (/[:#\-&*?!|>%@`,\[\]{}]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`
  }
  return s
}

function yamlList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '[]'
  return '[' + arr.map(yamlScalar).join(', ') + ']'
}

function renderNoteMarkdown(note) {
  const fm = [
    '---',
    'type: note',
    `id: ${yamlScalar(note.id)}`,
    `sessionId: ${yamlScalar(note.sessionId)}`,
    `outcome: ${yamlScalar(note.outcome)}`,
    `tags: ${yamlList(note.tags)}`,
    `sharedWithCommunity: ${yamlScalar(note.sharedWithCommunity)}`,
    `createdAt: ${yamlScalar(note.createdAt.toISOString())}`,
    '---',
  ].join('\n')
  return `${fm}\n\n${note.body.trim()}\n`
}

function renderEntryMarkdown(entry) {
  const fm = [
    '---',
    'type: entry',
    `id: ${yamlScalar(entry.id)}`,
    `title: ${yamlScalar(entry.title)}`,
    `category: ${yamlScalar(entry.category)}`,
    `tags: ${yamlList(entry.tags)}`,
    `sharedWithCommunity: ${yamlScalar(entry.sharedWithCommunity)}`,
    `createdAt: ${yamlScalar(entry.createdAt.toISOString())}`,
    '---',
  ].join('\n')
  return `${fm}\n\n# ${entry.title}\n\n${entry.body.trim()}\n`
}

/**
 * Build a unified markdown export for a user's research log. Notes and
 * entries are interleaved by createdAt desc — the file reads like a
 * reverse-chronological journal.
 */
export async function buildExportMarkdown(userId) {
  const [notes, entries] = await Promise.all([
    db.trainingSessionNote.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    }),
    db.researchLogEntry.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const merged = [
    ...notes.map(n => ({ kind: 'note', createdAt: n.createdAt, render: () => renderNoteMarkdown(n) })),
    ...entries.map(e => ({ kind: 'entry', createdAt: e.createdAt, render: () => renderEntryMarkdown(e) })),
  ].sort((a, b) => b.createdAt - a.createdAt)

  const header =
    `# Research Journal Export\n\n` +
    `Generated: ${new Date().toISOString()}\n` +
    `Items: ${merged.length} (${notes.length} note${notes.length === 1 ? '' : 's'}, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})\n\n`

  if (merged.length === 0) {
    return header + '_No research entries yet._\n'
  }

  return header + merged.map(m => m.render()).join('\n')
}
