// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HelpIndexPage, {
  groupByCategory, orderedCategories, CATEGORY_LABEL,
} from '../HelpIndexPage.jsx'

function renderIndex() {
  return render(
    <MemoryRouter>
      <HelpIndexPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('HelpIndexPage — pure helpers', () => {
  it('groupByCategory groups docs by category', () => {
    const out = groupByCategory([
      { slug: 'a', category: 'bots' },
      { slug: 'b', category: 'basics' },
      { slug: 'c', category: 'bots' },
    ])
    expect(out.bots).toHaveLength(2)
    expect(out.basics).toHaveLength(1)
  })

  it('orderedCategories puts known categories in preferred order, extras alphabetical', () => {
    const out = orderedCategories({
      basics: [1], bots: [1], xyz: [1], abc: [1], training: [1],
    })
    expect(out.slice(0, 3)).toEqual(['basics', 'bots', 'training'])
    expect(out.slice(-2)).toEqual(['abc', 'xyz'])
  })

  it('CATEGORY_LABEL covers all canonical buckets', () => {
    for (const key of ['basics','games','bots','training','tournaments','gameplay','economy','account','admin']) {
      expect(CATEGORY_LABEL[key]).toBeTruthy()
    }
  })
})

describe('HelpIndexPage — rendering', () => {
  it('shows Loading… while fetch is pending', () => {
    global.fetch.mockImplementationOnce(() => new Promise(() => {}))
    renderIndex()
    expect(screen.getByText(/Loading…/)).toBeInTheDocument()
  })

  it('renders docs grouped by category with category labels', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ docs: [
        // Avoid using the literal category-label string as a title
        // (CATEGORY_LABEL.basics === "Getting started") since that would
        // ambiguate the screen.getByText match.
        { slug: 'gs', title: 'Quickstart walkthrough', category: 'basics' },
        { slug: 'bo', title: 'Bots overview',         category: 'bots' },
        { slug: 'qb', title: 'Quick bots',            category: 'bots' },
      ] }),
    })
    renderIndex()
    await waitFor(() => screen.getByText('Quickstart walkthrough'))
    expect(screen.getByText('Quickstart walkthrough')).toBeInTheDocument()
    expect(screen.getByText('Bots overview')).toBeInTheDocument()
    expect(screen.getByText('Quick bots')).toBeInTheDocument()
    // Category labels.
    expect(screen.getByText(CATEGORY_LABEL.basics)).toBeInTheDocument()
    expect(screen.getByText(CATEGORY_LABEL.bots)).toBeInTheDocument()
  })

  it('links each doc to /help/:slug', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ docs: [{ slug: 'getting-started', title: 'GS', category: 'basics' }] }),
    })
    renderIndex()
    await waitFor(() => screen.getByText('GS'))
    const link = screen.getByText('GS').closest('a')
    expect(link).toHaveAttribute('href', '/help/getting-started')
  })

  it('renders the empty-state when no docs', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ docs: [] }),
    })
    renderIndex()
    await waitFor(() => screen.getByText(/No published docs/))
  })

  it('renders error state on HTTP failure', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    renderIndex()
    await waitFor(() => screen.getByText(/Couldn't load/))
  })
})
