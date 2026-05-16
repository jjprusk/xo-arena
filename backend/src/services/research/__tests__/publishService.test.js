// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the Research Log publish/unpublish service.
 * Sprint 2 of doc/Research_Log_Plan.md §2.2.
 *
 * Covers:
 *   - flag-off → 503-equivalent PublishError
 *   - 404 / 403 ownership branches
 *   - first publish creates HelpDoc + chunks + sets fields on source row
 *   - re-publish updates existing HelpDoc, bumps version, preserves publishedAt
 *   - unpublish tears down HelpDoc + chunks + clears fields
 *   - unpublish on already-unpublished record is a no-op success
 *   - PII scrubber output is woven into the HelpDoc body
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const dbMock = {
  trainingSessionNote: {
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
  researchLogEntry: {
    findUnique: vi.fn(),
    update:     vi.fn(),
  },
  helpDoc: {
    findUnique: vi.fn(),
    create:     vi.fn(),
    update:     vi.fn(),
    deleteMany: vi.fn(),
  },
  helpChunk: {
    deleteMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
}
vi.mock('../../../lib/db.js', () => ({ default: dbMock }))

const flagMock = vi.fn()
vi.mock('../config.js', () => ({
  isPublishEnabled: () => flagMock(),
  PUBLISH_FLAG_KEY: 'researchLog.publishEnabled',
}))

// Stub the embedding pipeline so tests are hermetic — we never want to hit
// the real chunker/embedder in unit tests for the publish service.
vi.mock('../../help/chunker.js', () => ({
  chunk: (body) => body
    ? [{ position: 0, content: body }]
    : [],
}))
vi.mock('../../help/embedClient.js', () => ({
  embedTexts:              async (texts) => texts.map(() => new Array(384).fill(0)),
  toPgVectorLiteral:       (v) => `[${v.join(',')}]`,
  currentEmbedModelVersion: () => 'stub',
}))

const { publishNote, unpublishNote, publishEntry, unpublishEntry, PublishError } =
  await import('../publishService.js')

const USER_ID  = 'user_owner'
const OTHER_ID = 'user_intruder'

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockResolvedValue(true)
})

// ── Notes ──────────────────────────────────────────────────────────────────

describe('publishNote', () => {
  it('throws publish_disabled (503) when the feature flag is OFF', async () => {
    flagMock.mockResolvedValueOnce(false)
    await expect(publishNote('n1', USER_ID)).rejects.toMatchObject({
      code: 'publish_disabled',
      status: 503,
    })
    expect(dbMock.trainingSessionNote.findUnique).not.toHaveBeenCalled()
  })

  it('throws note_not_found (404) when the note does not exist', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce(null)
    await expect(publishNote('missing', USER_ID)).rejects.toMatchObject({
      code: 'note_not_found',
      status: 404,
    })
  })

  it('throws forbidden (403) when another user attempts to publish', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce({
      id: 'n1', userId: OTHER_ID, body: 'hi', tags: [], helpDocId: null, publishedAt: null,
    })
    await expect(publishNote('n1', USER_ID)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    })
  })

  it('first publish creates a new HelpDoc + sets helpDocId + scrubs PII', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce({
      id: 'n1', userId: USER_ID,
      body: 'mail me at joe@example.com to discuss',
      tags: ['lr'], helpDocId: null, publishedAt: null,
    })
    dbMock.helpDoc.create.mockResolvedValueOnce({
      id: 'doc_new', version: 1,
    })
    dbMock.trainingSessionNote.update.mockResolvedValueOnce({
      id: 'n1', userId: USER_ID, sharedWithCommunity: true,
      helpDocId: 'doc_new', publishedAt: new Date(),
    })

    const result = await publishNote('n1', USER_ID)

    expect(dbMock.helpDoc.findUnique).not.toHaveBeenCalled()
    expect(dbMock.helpDoc.create).toHaveBeenCalledTimes(1)
    const createArg = dbMock.helpDoc.create.mock.calls[0][0].data
    expect(createArg.slug).toBe('research-note-n1')
    expect(createArg.source).toBe('community-note')
    expect(createArg.ownerId).toBe(USER_ID)
    expect(createArg.tags).toEqual(['lr'])
    expect(createArg.body).toContain('[email redacted]')
    expect(createArg.body).not.toContain('joe@example.com')

    // chunks regenerated under the new docId
    expect(dbMock.helpChunk.deleteMany).toHaveBeenCalledWith({ where: { docId: 'doc_new' } })
    expect(dbMock.$executeRaw).toHaveBeenCalled()

    // source row stamped
    const updateArg = dbMock.trainingSessionNote.update.mock.calls[0][0]
    expect(updateArg.where).toEqual({ id: 'n1' })
    expect(updateArg.data.sharedWithCommunity).toBe(true)
    expect(updateArg.data.helpDocId).toBe('doc_new')
    expect(updateArg.data.publishedAt).toBeInstanceOf(Date)

    // scrub matches surfaced to caller
    expect(result.helpDocId).toBe('doc_new')
    expect(result.scrubMatches.map(m => m.kind)).toContain('email')
  })

  it('re-publish updates the existing HelpDoc, bumps version, preserves publishedAt', async () => {
    const originalPublishedAt = new Date('2026-05-01T00:00:00Z')
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce({
      id: 'n1', userId: USER_ID, body: 'updated notes',
      tags: ['lr'], helpDocId: 'doc_existing', publishedAt: originalPublishedAt,
    })
    dbMock.helpDoc.findUnique.mockResolvedValueOnce({ id: 'doc_existing', version: 3 })
    dbMock.helpDoc.update.mockResolvedValueOnce({ id: 'doc_existing', version: 4 })
    dbMock.trainingSessionNote.update.mockResolvedValueOnce({
      id: 'n1', userId: USER_ID, sharedWithCommunity: true,
      helpDocId: 'doc_existing', publishedAt: originalPublishedAt,
    })

    await publishNote('n1', USER_ID)

    expect(dbMock.helpDoc.create).not.toHaveBeenCalled()
    expect(dbMock.helpDoc.update).toHaveBeenCalledTimes(1)
    expect(dbMock.helpDoc.update.mock.calls[0][0].data.version).toEqual({ increment: 1 })

    // publishedAt preserved (not overwritten with new Date())
    expect(dbMock.trainingSessionNote.update.mock.calls[0][0].data.publishedAt)
      .toBe(originalPublishedAt)
  })
})

describe('unpublishNote', () => {
  it('throws publish_disabled (503) when the feature flag is OFF', async () => {
    flagMock.mockResolvedValueOnce(false)
    await expect(unpublishNote('n1', USER_ID)).rejects.toMatchObject({
      code: 'publish_disabled', status: 503,
    })
  })

  it('throws note_not_found (404) when the note does not exist', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce(null)
    await expect(unpublishNote('n1', USER_ID)).rejects.toMatchObject({
      code: 'note_not_found', status: 404,
    })
  })

  it('throws forbidden (403) when another user attempts to unpublish', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce({
      id: 'n1', userId: OTHER_ID, helpDocId: 'doc_x',
    })
    await expect(unpublishNote('n1', USER_ID)).rejects.toMatchObject({
      code: 'forbidden', status: 403,
    })
  })

  it('tears down the linked HelpDoc + chunks and clears fields', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce({
      id: 'n1', userId: USER_ID, helpDocId: 'doc_x',
    })
    dbMock.trainingSessionNote.update.mockResolvedValueOnce({
      id: 'n1', sharedWithCommunity: false, helpDocId: null, publishedAt: null,
    })

    await unpublishNote('n1', USER_ID)

    expect(dbMock.helpChunk.deleteMany).toHaveBeenCalledWith({ where: { docId: 'doc_x' } })
    expect(dbMock.helpDoc.deleteMany).toHaveBeenCalledWith({ where: { id: 'doc_x' } })
    const data = dbMock.trainingSessionNote.update.mock.calls[0][0].data
    expect(data).toEqual({ sharedWithCommunity: false, publishedAt: null, helpDocId: null })
  })

  it('is a no-op success when the note was never published', async () => {
    dbMock.trainingSessionNote.findUnique.mockResolvedValueOnce({
      id: 'n1', userId: USER_ID, helpDocId: null,
    })
    dbMock.trainingSessionNote.update.mockResolvedValueOnce({
      id: 'n1', sharedWithCommunity: false, helpDocId: null, publishedAt: null,
    })

    await unpublishNote('n1', USER_ID)

    expect(dbMock.helpChunk.deleteMany).not.toHaveBeenCalled()
    expect(dbMock.helpDoc.deleteMany).not.toHaveBeenCalled()
    expect(dbMock.trainingSessionNote.update).toHaveBeenCalledTimes(1)
  })
})

// ── Entries ────────────────────────────────────────────────────────────────

describe('publishEntry', () => {
  it('throws publish_disabled (503) when the feature flag is OFF', async () => {
    flagMock.mockResolvedValueOnce(false)
    await expect(publishEntry('e1', USER_ID)).rejects.toMatchObject({
      code: 'publish_disabled', status: 503,
    })
  })

  it('throws entry_not_found (404) when missing', async () => {
    dbMock.researchLogEntry.findUnique.mockResolvedValueOnce(null)
    await expect(publishEntry('e1', USER_ID)).rejects.toMatchObject({
      code: 'entry_not_found', status: 404,
    })
  })

  it('throws forbidden (403) when another user owns the entry', async () => {
    dbMock.researchLogEntry.findUnique.mockResolvedValueOnce({
      id: 'e1', userId: OTHER_ID, title: 't', body: 'b', tags: [],
      category: 'PLANNING', helpDocId: null, publishedAt: null,
    })
    await expect(publishEntry('e1', USER_ID)).rejects.toMatchObject({
      code: 'forbidden', status: 403,
    })
  })

  it('first publish creates HelpDoc using entry title + category', async () => {
    dbMock.researchLogEntry.findUnique.mockResolvedValueOnce({
      id: 'e1', userId: USER_ID,
      title: 'Q-learning plateau notes',
      body:  'plateau after 20k episodes; lr=3e-4',
      tags:  ['q_learning'],
      category: 'RETROSPECTIVE',
      helpDocId: null, publishedAt: null,
    })
    dbMock.helpDoc.create.mockResolvedValueOnce({ id: 'doc_new', version: 1 })
    dbMock.researchLogEntry.update.mockResolvedValueOnce({ id: 'e1' })

    await publishEntry('e1', USER_ID)

    const createArg = dbMock.helpDoc.create.mock.calls[0][0].data
    expect(createArg.slug).toBe('research-entry-e1')
    expect(createArg.title).toBe('Q-learning plateau notes')
    expect(createArg.category).toBe('RETROSPECTIVE')
    expect(createArg.source).toBe('community-note')
    expect(createArg.ownerId).toBe(USER_ID)
    expect(createArg.body).toContain('# Q-learning plateau notes')
  })
})

describe('unpublishEntry', () => {
  it('throws publish_disabled (503) when the feature flag is OFF', async () => {
    flagMock.mockResolvedValueOnce(false)
    await expect(unpublishEntry('e1', USER_ID)).rejects.toMatchObject({
      code: 'publish_disabled', status: 503,
    })
  })

  it('tears down the linked HelpDoc + clears entry fields', async () => {
    dbMock.researchLogEntry.findUnique.mockResolvedValueOnce({
      id: 'e1', userId: USER_ID, helpDocId: 'doc_x',
    })
    dbMock.researchLogEntry.update.mockResolvedValueOnce({
      id: 'e1', sharedWithCommunity: false, helpDocId: null, publishedAt: null,
    })

    await unpublishEntry('e1', USER_ID)

    expect(dbMock.helpChunk.deleteMany).toHaveBeenCalledWith({ where: { docId: 'doc_x' } })
    expect(dbMock.helpDoc.deleteMany).toHaveBeenCalledWith({ where: { id: 'doc_x' } })
    expect(dbMock.researchLogEntry.update.mock.calls[0][0].data).toEqual({
      sharedWithCommunity: false, publishedAt: null, helpDocId: null,
    })
  })
})

// PublishError export sanity check — used by route layer.
describe('PublishError', () => {
  it('is exported with code, status, and message', () => {
    const e = new PublishError('something_bad', 418, 'teapot')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('something_bad')
    expect(e.status).toBe(418)
    expect(e.message).toBe('teapot')
  })
})
