// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'test-token'),
}))

const mockGetMetrics = vi.fn()
vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: { help: { getMetrics: (...a) => mockGetMetrics(...a) } },
  },
}))

import AdminHelpMetricsPage from '../AdminHelpMetricsPage.jsx'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/help/metrics']}>
      <Routes>
        <Route path="/admin/help/metrics" element={<AdminHelpMetricsPage />} />
        <Route path="/admin/help/new"     element={<div>New doc page</div>} />
        <Route path="/help/:slug"         element={<div>Help doc</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function fullPayload(overrides = {}) {
  return {
    windowDays: 30,
    since:      new Date().toISOString(),
    questionsPerDay: Array.from({ length: 30 }, (_, i) => ({
      day:   new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10),
      count: i === 29 ? 12 : i % 3,
    })),
    feedbackTotals:       { helpful: 18, notHelpful: 4, total: 22 },
    helpfulPct:           18 / 22,
    notHelpfulByCategory: [
      { category: 'OUTDATED',  count: 2 },
      { category: 'OFF_TOPIC', count: 1 },
      { category: 'WRONG',     count: 1 },
    ],
    filterTriggerRate: { triggered: 3, total: 100, rate: 0.03 },
    topRetrievedChunks: [
      { id: 'c1', position: 0, slug: 'one', title: 'One', category: 'basics', hits: 9 },
      { id: 'c2', position: 2, slug: 'two', title: 'Two', category: 'bots',   hits: 5 },
    ],
    topNoSourceQueries: [
      { queryId: 'q1', text: 'how do I retire a bot', createdAt: new Date().toISOString() },
      { queryId: 'q2', text: 'where is the colosseum', createdAt: new Date().toISOString() },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  mockGetMetrics.mockReset()
})

describe('AdminHelpMetricsPage', () => {
  it('fetches with default 30-day window on mount', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload())
    renderPage()
    await waitFor(() => expect(mockGetMetrics).toHaveBeenCalled())
    expect(mockGetMetrics.mock.calls[0][1]).toBe(30)
  })

  it('renders all six rollup sections on happy path', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload())
    renderPage()
    await waitFor(() => expect(screen.getByTestId('tile-questions')).toBeDefined())
    expect(screen.getByTestId('tile-helpful')).toBeDefined()
    expect(screen.getByTestId('tile-feedback')).toBeDefined()
    expect(screen.getByTestId('tile-filter')).toBeDefined()
    expect(screen.getByTestId('section-per-day')).toBeDefined()
    expect(screen.getByTestId('section-by-category')).toBeDefined()
    expect(screen.getByTestId('section-top-chunks')).toBeDefined()
    expect(screen.getByTestId('section-no-source')).toBeDefined()
  })

  it('renders helpfulPct as a percentage in the headline tile', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload({ helpfulPct: 0.82 }))
    renderPage()
    await waitFor(() => {
      const tile = screen.getByTestId('tile-helpful')
      expect(tile.textContent).toMatch(/82%/)
    })
  })

  it('renders "—" for null helpfulPct (no feedback yet)', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload({
      helpfulPct:     null,
      feedbackTotals: { helpful: 0, notHelpful: 0, total: 0 },
    }))
    renderPage()
    await waitFor(() => {
      const tile = screen.getByTestId('tile-helpful')
      expect(tile.textContent).toMatch(/—/)
    })
  })

  it('omits sections when their data array is empty', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload({
      notHelpfulByCategory: [],
      topRetrievedChunks:   [],
      topNoSourceQueries:   [],
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('section-per-day')).toBeDefined())
    expect(screen.queryByTestId('section-by-category')).toBeNull()
    expect(screen.queryByTestId('section-top-chunks')).toBeNull()
    expect(screen.queryByTestId('section-no-source')).toBeNull()
  })

  it('switching the window re-fetches with the new days value', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload())
    renderPage()
    await waitFor(() => expect(mockGetMetrics).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('window-7'))
    await waitFor(() => expect(mockGetMetrics).toHaveBeenCalledTimes(2))
    expect(mockGetMetrics.mock.calls[1][1]).toBe(7)
  })

  it('no-source create link encodes the question into seedQuestion', async () => {
    mockGetMetrics.mockResolvedValue(fullPayload())
    renderPage()
    await waitFor(() => {
      const link = screen.getByTestId('nosource-create-q1')
      expect(link.getAttribute('href')).toContain('seedQuestion=how%20do%20I%20retire%20a%20bot')
    })
  })

  it('renders an error banner on fetch failure', async () => {
    mockGetMetrics.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('metrics-error')).toBeDefined())
  })
})
