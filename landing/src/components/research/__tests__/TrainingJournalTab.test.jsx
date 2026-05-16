// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the Training Journal tab — Sprint 2 of
 * doc/Research_Log_Plan.md §3 step 9.
 *
 * Locked behaviors: tab switching, notes list with publish CTA, entry
 * composer happy-path, community feed display, export anchor target.
 */

import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'tok'),
}))

const listNotesMock     = vi.fn()
const publishNoteMock   = vi.fn()
const unpublishNoteMock = vi.fn()
const listEntriesMock   = vi.fn()
const createEntryMock   = vi.fn()
const deleteEntryMock   = vi.fn()
const publishEntryMock  = vi.fn()
const unpublishEntryMock = vi.fn()
const listCommunityMock = vi.fn()
const getPrefsMock      = vi.fn()
const patchPrefsMock    = vi.fn()

vi.mock('../../../lib/api.js', () => ({
  api: {
    research: {
      listNotes:      (...a) => listNotesMock(...a),
      publishNote:    (...a) => publishNoteMock(...a),
      unpublishNote:  (...a) => unpublishNoteMock(...a),
      listEntries:    (...a) => listEntriesMock(...a),
      createEntry:    (...a) => createEntryMock(...a),
      deleteEntry:    (...a) => deleteEntryMock(...a),
      publishEntry:   (...a) => publishEntryMock(...a),
      unpublishEntry: (...a) => unpublishEntryMock(...a),
      listCommunity:  (...a) => listCommunityMock(...a),
      exportUrl:      () => '/api/v1/research/export.md',
      getPreferences:   (...a) => getPrefsMock(...a),
      patchPreferences: (...a) => patchPrefsMock(...a),
    },
  },
}))

import TrainingJournalTab from '../TrainingJournalTab.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  listNotesMock.mockResolvedValue({ notes: [] })
  listEntriesMock.mockResolvedValue({ entries: [] })
  listCommunityMock.mockResolvedValue({ items: [], nextCursor: null })
  getPrefsMock.mockResolvedValue({ shareNotesWithGuide: false })
  patchPrefsMock.mockResolvedValue({ shareNotesWithGuide: true })
})

describe('TrainingJournalTab', () => {
  it('renders the three sub-tabs and the export anchor', async () => {
    render(<TrainingJournalTab />)
    expect(screen.getByRole('tab', { name: 'My notes' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'My entries' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Community' })).toBeInTheDocument()
    const link = screen.getByText('Export .md').closest('a')
    expect(link).toHaveAttribute('href', '/api/v1/research/export.md')
    expect(link).toHaveAttribute('download', 'training-journal.md')
  })

  it('shows the publish CTA on private notes', async () => {
    listNotesMock.mockResolvedValueOnce({
      notes: [{ id: 'n1', body: 'first note', outcome: 'SUCCESS', tags: ['lr'], createdAt: new Date().toISOString(), sharedWithCommunity: false }],
    })
    render(<TrainingJournalTab />)
    await waitFor(() => expect(screen.getByText('first note')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Publish note/ })).toBeInTheDocument()
  })

  it('shows the Unpublish CTA on shared notes', async () => {
    listNotesMock.mockResolvedValueOnce({
      notes: [{ id: 'n1', body: 'shared note', outcome: 'SUCCESS', tags: [], createdAt: new Date().toISOString(), sharedWithCommunity: true }],
    })
    render(<TrainingJournalTab />)
    await waitFor(() => expect(screen.getByText('shared note')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Unpublish note' })).toBeInTheDocument()
  })

  it('switches to the entries tab and creates an entry via the composer', async () => {
    createEntryMock.mockResolvedValueOnce({ entry: { id: 'e1' } })
    render(<TrainingJournalTab />)

    fireEvent.click(screen.getByRole('tab', { name: 'My entries' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Entry title')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Entry title'),
      { target: { value: 'Sprint retro' } })
    fireEvent.change(screen.getByPlaceholderText(/What did you learn/),
      { target: { value: 'plateau at 20k' } })
    fireEvent.change(screen.getByPlaceholderText(/tags/),
      { target: { value: 'lr, q-learning' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))

    await waitFor(() => expect(createEntryMock).toHaveBeenCalledTimes(1))
    const body = createEntryMock.mock.calls[0][0]
    expect(body.title).toBe('Sprint retro')
    expect(body.body).toBe('plateau at 20k')
    expect(body.tags).toEqual(['lr', 'q-learning'])
  })

  it('refuses to create an entry with empty fields', async () => {
    render(<TrainingJournalTab />)
    fireEvent.click(screen.getByRole('tab', { name: 'My entries' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Entry title')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    await waitFor(() =>
      expect(screen.getByText('Title and body are required.')).toBeInTheDocument())
    expect(createEntryMock).not.toHaveBeenCalled()
  })

  it('renders community items with author attribution', async () => {
    listCommunityMock.mockResolvedValueOnce({
      items: [{
        id: 'd1', title: 'Plateau notes', body: 'community body',
        category: 'community', tags: ['retro'],
        author: { id: 'u2', displayName: 'Alice' },
        createdAt: new Date().toISOString(),
      }],
      nextCursor: null,
    })
    render(<TrainingJournalTab />)
    fireEvent.click(screen.getByRole('tab', { name: 'Community' }))
    await waitFor(() => expect(screen.getByText('Plateau notes')).toBeInTheDocument())
    expect(screen.getByText(/by Alice/)).toBeInTheDocument()
    expect(screen.getByText('community body')).toBeInTheDocument()
  })

  it('falls back to "anonymous" when a community item has no author', async () => {
    listCommunityMock.mockResolvedValueOnce({
      items: [{
        id: 'd1', title: 'Anon note', body: 'b', category: 'community', tags: [],
        author: null, createdAt: new Date().toISOString(),
      }],
      nextCursor: null,
    })
    render(<TrainingJournalTab />)
    fireEvent.click(screen.getByRole('tab', { name: 'Community' }))
    await waitFor(() => expect(screen.getByText('Anon note')).toBeInTheDocument())
    expect(screen.getByText(/anonymous/)).toBeInTheDocument()
  })

  it('toggles the shareNotesWithGuide preference optimistically', async () => {
    getPrefsMock.mockResolvedValueOnce({ shareNotesWithGuide: false })
    render(<TrainingJournalTab />)
    const cb = await screen.findByLabelText('Share notes with Guide')
    await waitFor(() => expect(cb).not.toBeChecked())
    fireEvent.click(cb)
    await waitFor(() => expect(cb).toBeChecked())
    expect(patchPrefsMock).toHaveBeenCalledWith({ shareNotesWithGuide: true }, 'tok')
  })

  it('rolls back the toggle when the patch fails', async () => {
    getPrefsMock.mockResolvedValueOnce({ shareNotesWithGuide: false })
    patchPrefsMock.mockRejectedValueOnce(new Error('nope'))
    render(<TrainingJournalTab />)
    const cb = await screen.findByLabelText('Share notes with Guide')
    fireEvent.click(cb)
    await waitFor(() => expect(cb).not.toBeChecked())
  })

  it('surfaces a friendly 503 message when publish is disabled', async () => {
    listNotesMock.mockResolvedValueOnce({
      notes: [{ id: 'n1', body: 'pending publish', outcome: 'SUCCESS', tags: [], createdAt: new Date().toISOString(), sharedWithCommunity: false }],
    })
    const err = new Error('off')
    err.status = 503
    publishNoteMock.mockRejectedValueOnce(err)

    render(<TrainingJournalTab />)
    await waitFor(() => expect(screen.getByText('pending publish')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Publish note/ }))
    // Modal opens — tick the checkbox and click Publish.
    const modal = await screen.findByRole('dialog')
    fireEvent.click(within(modal).getByRole('checkbox'))
    fireEvent.click(within(modal).getByRole('button', { name: 'Publish' }))

    await waitFor(() =>
      expect(within(modal).getByText('Community publishing is currently disabled.'))
        .toBeInTheDocument())
  })
})
