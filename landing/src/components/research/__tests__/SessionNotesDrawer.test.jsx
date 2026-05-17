// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for SessionNotesDrawer — Sprint 1 of doc/Research_Log_Plan.md.
 * Covers the five behaviors locked by the sprint checklist:
 * render, add, edit, delete, optimistic-update + rollback on failure.
 */

import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'tok'),
}))

const listMock   = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('../../../lib/api.js', () => ({
  api: {
    research: {
      listNotes:  (...a) => listMock(...a),
      createNote: (...a) => createMock(...a),
      updateNote: (...a) => updateMock(...a),
      deleteNote: (...a) => deleteMock(...a),
    },
  },
}))

import SessionNotesDrawer from '../SessionNotesDrawer.jsx'

function makeNote(over = {}) {
  return {
    id: 'note_1',
    userId: 'u',
    sessionId: 'sess_1',
    body: 'first note',
    outcome: 'SUCCESS',
    tags: ['lr'],
    createdAt: '2026-05-15T10:00:00Z',
    ...over,
  }
}

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: /Research notes/i }))
  // The list fetch is kicked off by the open transition.
  await waitFor(() => expect(listMock).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue({ notes: [] })
})

describe('SessionNotesDrawer', () => {
  it('renders closed by default and fetches on open', async () => {
    render(<SessionNotesDrawer sessionId="sess_1" />)
    expect(listMock).not.toHaveBeenCalled()
    await openDrawer()
    expect(screen.getByText(/No notes yet/i)).toBeInTheDocument()
  })

  it('adds a note via the form and renders it after the API resolves', async () => {
    listMock.mockResolvedValueOnce({ notes: [] })
    createMock.mockResolvedValueOnce({ note: makeNote({ body: 'lr=3e-4', tags: ['lr'] }) })

    render(<SessionNotesDrawer sessionId="sess_1" />)
    await openDrawer()

    const textarea = screen.getByPlaceholderText(/What happened this session/i)
    fireEvent.change(textarea, { target: { value: 'lr=3e-4' } })
    fireEvent.change(screen.getByPlaceholderText(/tags, comma separated/i), { target: { value: 'lr' } })
    fireEvent.click(screen.getByRole('button', { name: /\+ Add note/i }))

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      'sess_1',
      { body: 'lr=3e-4', outcome: 'SUCCESS', tags: ['lr'] },
      'tok',
    ))
    await waitFor(() => expect(screen.getByText('lr=3e-4')).toBeInTheDocument())
  })

  it('edits a note inline and updates via PATCH', async () => {
    listMock.mockResolvedValueOnce({ notes: [makeNote()] })
    updateMock.mockResolvedValueOnce({ note: makeNote({ body: 'revised', outcome: 'PLATEAU' }) })

    render(<SessionNotesDrawer sessionId="sess_1" />)
    await openDrawer()
    await waitFor(() => expect(screen.getByText('first note')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Edit/i }))
    const ta = screen.getByDisplayValue('first note')
    fireEvent.change(ta, { target: { value: 'revised' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(
      'note_1',
      expect.objectContaining({ body: 'revised' }),
      'tok',
    ))
    await waitFor(() => expect(screen.getByText('revised')).toBeInTheDocument())
  })

  it('deletes a note and removes it from the list', async () => {
    listMock.mockResolvedValueOnce({ notes: [makeNote()] })
    deleteMock.mockResolvedValueOnce({ ok: true })

    render(<SessionNotesDrawer sessionId="sess_1" />)
    await openDrawer()
    await waitFor(() => expect(screen.getByText('first note')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('note_1', 'tok'))
    await waitFor(() => expect(screen.queryByText('first note')).not.toBeInTheDocument())
  })

  it('rolls back an optimistic add when the API rejects', async () => {
    listMock.mockResolvedValueOnce({ notes: [] })
    createMock.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))

    render(<SessionNotesDrawer sessionId="sess_1" />)
    await openDrawer()

    fireEvent.change(screen.getByPlaceholderText(/What happened this session/i), {
      target: { value: 'optimistic-row' },
    })
    fireEvent.click(screen.getByRole('button', { name: /\+ Add note/i }))

    // The optimistic placeholder body is rendered as a <p> in the note list.
    // After the rejection, the row vanishes (rollback) and the error surfaces.
    await waitFor(() => expect(screen.getByText(/rate limited/i)).toBeInTheDocument())
    // No <p> in the document has the optimistic text — the row was rolled back.
    const paragraphs = Array.from(document.querySelectorAll('p'))
    expect(paragraphs.some(p => p.textContent === 'optimistic-row')).toBe(false)
  })
})
