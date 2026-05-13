import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'test-token'),
}))

const mockGetDoc    = vi.fn()
const mockCreateDoc = vi.fn()
vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: { help: {
      getDoc:    (...a) => mockGetDoc(...a),
      createDoc: (...a) => mockCreateDoc(...a),
      archiveDoc: vi.fn(),
    } },
  },
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

import AdminHelpDocEditPage from '../AdminHelpDocEditPage.jsx'

function renderEdit(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/help"        element={<div data-testid="list">List</div>} />
        <Route path="/admin/help/new"    element={<AdminHelpDocEditPage />} />
        <Route path="/admin/help/:id"    element={<AdminHelpDocEditPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockGetDoc.mockReset()
  mockCreateDoc.mockReset()
  mockFetch.mockReset()
})

describe('AdminHelpDocEditPage — new', () => {
  it('renders empty form for /admin/help/new', () => {
    renderEdit('/admin/help/new')
    expect(screen.getByText('New help doc')).toBeDefined()
    expect(screen.getByTestId('field-slug').value).toBe('')
    // Slug is editable in new mode
    expect(screen.getByTestId('field-slug').disabled).toBe(false)
  })

  it('calls createDoc on submit', async () => {
    mockCreateDoc.mockResolvedValue({ doc: { id: 'new-id', slug: 'x', version: 1 } })

    renderEdit('/admin/help/new')
    fireEvent.change(screen.getByTestId('field-slug'),     { target: { value: 'x' } })
    fireEvent.change(screen.getByTestId('field-title'),    { target: { value: 'Title' } })
    fireEvent.change(screen.getByTestId('field-category'), { target: { value: 'basics' } })
    fireEvent.change(screen.getByTestId('field-body'),     { target: { value: 'Body content' } })
    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => expect(mockCreateDoc).toHaveBeenCalled())
    const [body] = mockCreateDoc.mock.calls[0]
    expect(body.slug).toBe('x')
    expect(body.title).toBe('Title')
    expect(body.category).toBe('basics')
  })
})

describe('AdminHelpDocEditPage — edit', () => {
  it('loads existing doc and populates fields', async () => {
    mockGetDoc.mockResolvedValue({
      doc: { id: 'd1', slug: 'tournaments', title: 'Tournaments', body: 'Body', category: 'tournaments', tags: ['a', 'b'], status: 'PUBLISHED', version: 4 },
    })

    renderEdit('/admin/help/d1')
    await waitFor(() => {
      expect(screen.getByTestId('field-title').value).toBe('Tournaments')
      expect(screen.getByTestId('field-slug').value).toBe('tournaments')
      // Slug read-only in edit mode
      expect(screen.getByTestId('field-slug').disabled).toBe(true)
    })
    expect(screen.getByText(/v4 · tournaments/)).toBeDefined()
  })

  it('shows conflict banner on 409 and reload restores server state', async () => {
    mockGetDoc.mockResolvedValue({
      doc: { id: 'd1', slug: 'x', title: 'old', body: 'b', category: 'c', tags: [], status: 'PUBLISHED', version: 1 },
    })
    // Server says: version is now 5 (someone else edited).
    mockFetch.mockResolvedValueOnce({
      status: 409,
      json: async () => ({
        error: 'version_conflict',
        current: { id: 'd1', slug: 'x', title: 'theirs', body: 'their body', category: 'c', tags: [], status: 'PUBLISHED', version: 5 },
      }),
    })

    renderEdit('/admin/help/d1')
    await waitFor(() => expect(screen.getByTestId('field-title').value).toBe('old'))

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'mine' } })
    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => expect(screen.getByTestId('conflict-banner')).toBeDefined())
    fireEvent.click(screen.getByTestId('conflict-reload'))

    await waitFor(() => {
      expect(screen.getByTestId('field-title').value).toBe('theirs')
    })
  })

  it('saves successfully when version matches', async () => {
    mockGetDoc.mockResolvedValue({
      doc: { id: 'd1', slug: 'x', title: 'old', body: 'b', category: 'c', tags: [], status: 'PUBLISHED', version: 1 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ doc: { id: 'd1', version: 2, title: 'new' }, chunkCount: 3 }),
    })

    renderEdit('/admin/help/d1')
    await waitFor(() => expect(screen.getByTestId('field-title').value).toBe('old'))

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'new' } })
    fireEvent.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByText(/✓ Saved/)).toBeDefined()
    })
    // version sent should be 1; PUT happens via fetch
    const [, init] = mockFetch.mock.calls[0]
    expect(JSON.parse(init.body).version).toBe(1)
  })
})
