import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'test-token'),
}))

const mockListDocs = vi.fn()
vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: { help: { listDocs: (...args) => mockListDocs(...args) } },
  },
}))

import AdminHelpDocsPage from '../AdminHelpDocsPage.jsx'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/help']}>
      <Routes>
        <Route path="/admin/help" element={<AdminHelpDocsPage />} />
        <Route path="/admin/help/new" element={<div>New page</div>} />
        <Route path="/admin/help/:id" element={<div>Edit page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockListDocs.mockReset()
})

describe('AdminHelpDocsPage', () => {
  it('renders a loading spinner first, then docs grouped by category', async () => {
    mockListDocs.mockResolvedValue({
      docs: [
        { id: 'd1', slug: 'getting-started', title: 'Getting started', category: 'basics', status: 'PUBLISHED', version: 1, updatedAt: '2026-05-13T10:00:00Z' },
        { id: 'd2', slug: 'quick-bots',      title: 'Quick bots',     category: 'bots',   status: 'PUBLISHED', version: 2, updatedAt: '2026-05-13T11:00:00Z' },
      ],
      total: 2, limit: 200, offset: 0,
    })

    const { container } = renderPage()
    // Loading state first
    expect(container.querySelector('.animate-spin')).not.toBeNull()

    await waitFor(() => {
      expect(screen.getByText('Getting started')).toBeDefined()
      expect(screen.getByText('Quick bots')).toBeDefined()
    })

    // Category headers visible
    expect(screen.getByText('basics')).toBeDefined()
    expect(screen.getByText('bots')).toBeDefined()
  })

  it('shows an empty state when no docs match the filter', async () => {
    mockListDocs.mockResolvedValue({ docs: [], total: 0, limit: 200, offset: 0 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/no docs match this filter/i)).toBeDefined()
    })
  })

  it('shows an error message on fetch failure', async () => {
    mockListDocs.mockRejectedValue(new Error('boom'))

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/failed to load help docs/i)).toBeDefined()
    })
  })

  it('has a New doc link that navigates to /admin/help/new', async () => {
    mockListDocs.mockResolvedValue({ docs: [], total: 0, limit: 200, offset: 0 })

    renderPage()
    await waitFor(() => {
      const link = screen.getByTestId('new-doc-button')
      expect(link.getAttribute('href')).toBe('/admin/help/new')
    })
  })

  it('renders status filter buttons including PUBLISHED, DRAFT, ARCHIVED', async () => {
    mockListDocs.mockResolvedValue({ docs: [], total: 0, limit: 200, offset: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('filter-PUBLISHED')).toBeDefined()
      expect(screen.getByTestId('filter-DRAFT')).toBeDefined()
      expect(screen.getByTestId('filter-ARCHIVED')).toBeDefined()
      expect(screen.getByTestId('filter-all')).toBeDefined()
    })
  })
})
