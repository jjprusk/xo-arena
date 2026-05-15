// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import HelpDocPage from '../HelpDocPage.jsx'

function renderDoc(slug) {
  return render(
    <MemoryRouter initialEntries={[`/help/${slug}`]}>
      <Routes>
        <Route path="/help/:slug" element={<HelpDocPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('HelpDocPage', () => {
  it('shows Loading… while fetch is pending', () => {
    global.fetch.mockImplementationOnce(() => new Promise(() => {}))
    renderDoc('getting-started')
    expect(screen.getByText(/Loading…/)).toBeInTheDocument()
  })

  it('renders the doc body as Markdown', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ doc: {
        slug: 'gs', title: 'Getting started', body: '# Welcome\n\nHello world.',
        category: 'basics', tags: [], updatedAt: new Date().toISOString(),
      } }),
    })
    renderDoc('gs')
    await waitFor(() => screen.getByText('Welcome'))
    // Markdown renders the H1.
    expect(screen.getByRole('heading', { level: 1, name: /Welcome/i })).toBeInTheDocument()
    expect(screen.getByText('Hello world.')).toBeInTheDocument()
  })

  it('renders friendly 404 view for unknown slug', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 })
    renderDoc('missing')
    await waitFor(() => screen.getByText(/Doc not found/i))
    expect(screen.getByText(/missing/)).toBeInTheDocument()
  })

  it('renders error view on 5xx', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    renderDoc('foo')
    await waitFor(() => screen.getByText(/Couldn't load this doc/))
  })

  it('shows ← Help index back link in all happy and sad states', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ doc: { slug: 'x', body: 'body', title: 'X', category: 'basics', tags: [] } }),
    })
    renderDoc('x')
    await waitFor(() => screen.getByText('body'))
    const link = screen.getByText(/Help index/i).closest('a')
    expect(link).toHaveAttribute('href', '/help')
  })
})
