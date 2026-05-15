// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'test-token'),
}))

const mockListQueries  = vi.fn()
const mockGetQuery     = vi.fn()
const mockMarkReviewed = vi.fn()
vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      help: {
        listQueries:  (...a) => mockListQueries(...a),
        getQuery:     (...a) => mockGetQuery(...a),
        markReviewed: (...a) => mockMarkReviewed(...a),
      },
    },
  },
}))

import AdminHelpQueriesPage from '../AdminHelpQueriesPage.jsx'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/help/queries']}>
      <Routes>
        <Route path="/admin/help/queries" element={<AdminHelpQueriesPage />} />
        <Route path="/admin/help/new"     element={<div>New doc page</div>} />
        <Route path="/help/:slug"         element={<div>Help doc</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockListQueries.mockReset()
  mockGetQuery.mockReset()
  mockMarkReviewed.mockReset()
})

describe('AdminHelpQueriesPage', () => {
  it('lands with default filters: unreviewed + filter-triggered + last 24h', async () => {
    mockListQueries.mockResolvedValue({ rows: [], total: 0, limit: 100, offset: 0 })
    renderPage()
    await waitFor(() => {
      expect(mockListQueries).toHaveBeenCalled()
    })
    const opts = mockListQueries.mock.calls[0][1]
    expect(opts.unreviewed).toBe(true)
    expect(opts.contentFilterTriggered).toBe(true)
    expect(typeof opts.since).toBe('string')   // ISO from isoDaysAgo(1)
  })

  it('renders rows with badges and clicks expand the detail panel', async () => {
    mockListQueries.mockResolvedValue({
      rows: [
        {
          id: 'q1', text: 'How do I train a bot?', createdAt: new Date().toISOString(),
          contentFilterTriggered: true, signal: null, category: null,
          reviewedAt: null, reviewedById: null, degraded: false, context: {},
        },
      ],
      total: 1, limit: 100, offset: 0,
    })
    mockGetQuery.mockResolvedValue({
      query: {
        id: 'q1', text: 'How do I train a bot?', context: { route: '/play' },
        answers: [{
          id: 'a1', rendered: 'Use the Gym tab.', chunkIds: [], contentFilterTriggered: true,
          contentFilterTerms: ['banned'], reviewedAt: null, reviewedById: null,
          feedback: [],
        }],
      },
      chunks: [],
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('row-q1')).toBeDefined()
    })
    expect(screen.getByText('filter')).toBeDefined()    // badge

    fireEvent.click(screen.getByTestId('row-q1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-q1')).toBeDefined()
    })
    expect(screen.getByText('Use the Gym tab.')).toBeDefined()
    expect(screen.getByText(/Filter terms: banned/)).toBeDefined()
  })

  it('shows an empty state when no rows match', async () => {
    mockListQueries.mockResolvedValue({ rows: [], total: 0, limit: 100, offset: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('queries-empty')).toBeDefined()
    })
  })

  it('shows an error banner on fetch failure', async () => {
    mockListQueries.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('queries-error')).toBeDefined()
    })
  })

  it('toggling unreviewed off re-fetches without the flag', async () => {
    mockListQueries.mockResolvedValue({ rows: [], total: 0, limit: 100, offset: 0 })
    renderPage()
    await waitFor(() => expect(mockListQueries).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('toggle-unreviewed'))
    await waitFor(() => expect(mockListQueries).toHaveBeenCalledTimes(2))
    const lastOpts = mockListQueries.mock.calls[1][1]
    expect(lastOpts.unreviewed).toBeUndefined()
  })

  it('signal filter chip swap re-fetches with new param', async () => {
    mockListQueries.mockResolvedValue({ rows: [], total: 0, limit: 100, offset: 0 })
    renderPage()
    await waitFor(() => expect(mockListQueries).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('signal-NOT_HELPFUL'))
    await waitFor(() => {
      const last = mockListQueries.mock.calls.at(-1)[1]
      expect(last.signal).toBe('NOT_HELPFUL')
    })
    // Category chips become visible when NOT_HELPFUL is selected.
    expect(screen.getByTestId('category-OUTDATED')).toBeDefined()
  })

  it('marking an answer reviewed POSTs and refreshes the list', async () => {
    mockListQueries.mockResolvedValue({
      rows: [{
        id: 'q1', text: 'why?', createdAt: new Date().toISOString(),
        contentFilterTriggered: false, signal: null, category: null,
        reviewedAt: null, reviewedById: null, degraded: false, context: {},
      }],
      total: 1, limit: 100, offset: 0,
    })
    mockGetQuery.mockResolvedValue({
      query: {
        id: 'q1', text: 'why?', context: {},
        answers: [{
          id: 'a1', rendered: 'because', chunkIds: [], contentFilterTriggered: false,
          contentFilterTerms: [], reviewedAt: null, reviewedById: null, feedback: [],
        }],
      },
      chunks: [],
    })
    mockMarkReviewed.mockResolvedValue({
      answer: { id: 'a1', reviewedAt: new Date(), reviewedById: 'usr1' },
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('row-q1')).toBeDefined())
    fireEvent.click(screen.getByTestId('row-q1'))
    await waitFor(() => expect(screen.getByTestId('mark-reviewed-q1')).toBeDefined())

    fireEvent.click(screen.getByTestId('mark-reviewed-q1'))
    await waitFor(() => {
      expect(mockMarkReviewed).toHaveBeenCalledWith('a1', 'test-token')
    })
    // Reload triggered after mark-reviewed.
    await waitFor(() => {
      expect(mockListQueries).toHaveBeenCalledTimes(2)
    })
  })

  it('Create-doc link includes the seedQuestion query string', async () => {
    mockListQueries.mockResolvedValue({
      rows: [{
        id: 'q1', text: 'unique question text', createdAt: new Date().toISOString(),
        contentFilterTriggered: false, signal: null, category: null,
        reviewedAt: null, reviewedById: null, degraded: false, context: {},
      }],
      total: 1, limit: 100, offset: 0,
    })
    mockGetQuery.mockResolvedValue({
      query: {
        id: 'q1', text: 'unique question text', context: {},
        answers: [{
          id: 'a1', rendered: '…', chunkIds: [], contentFilterTriggered: false,
          contentFilterTerms: [], reviewedAt: null, reviewedById: null, feedback: [],
        }],
      },
      chunks: [],
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('row-q1')).toBeDefined())
    fireEvent.click(screen.getByTestId('row-q1'))
    await waitFor(() => {
      const link = screen.getByTestId('create-doc-q1')
      expect(link.getAttribute('href')).toContain('seedQuestion=unique%20question%20text')
    })
  })

  it('renders the reviewed badge when row.reviewedAt is set', async () => {
    mockListQueries.mockResolvedValue({
      rows: [{
        id: 'q1', text: 'old one', createdAt: new Date().toISOString(),
        contentFilterTriggered: false, signal: null, category: null,
        reviewedAt: new Date().toISOString(), reviewedById: 'usr1',
        degraded: false, context: {},
      }],
      total: 1, limit: 100, offset: 0,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('reviewed')).toBeDefined())
  })
})
