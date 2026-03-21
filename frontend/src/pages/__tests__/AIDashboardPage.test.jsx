import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(),
  },
}))

// Recharts uses ResizeObserver — provide a minimal mock in jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

import { api } from '../../lib/api.js'
import AIDashboardPage from '../AIDashboardPage.jsx'

const SUMMARY = {
  total: 42,
  rows: [
    { implementation: 'minimax', difficulty: 'hard', count: 30, avgMs: 80, maxMs: 200 },
    { implementation: 'minimax', difficulty: 'easy', count: 12, avgMs: 2, maxMs: 5 },
  ],
}

const HISTOGRAM = [
  { label: '0–10ms', count: 10 },
  { label: '10–50ms', count: 5 },
  { label: '50–100ms', count: 3 },
  { label: '100–200ms', count: 8 },
  { label: '200–500ms', count: 4 },
  { label: '500ms+', count: 0 },
]

const HEATMAP = Array.from({ length: 9 }, (_, i) => ({ index: i, count: i * 3 }))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((path) => {
    if (path.includes('summary')) return Promise.resolve(SUMMARY)
    if (path.includes('histogram')) return Promise.resolve({ histogram: HISTOGRAM })
    if (path.includes('heatmap')) return Promise.resolve({ heatmap: HEATMAP })
    return Promise.reject(new Error('unknown'))
  })
})

describe('AIDashboardPage', () => {
  it('renders heading', () => {
    render(<AIDashboardPage />)
    expect(screen.getByText('AI Dashboard')).toBeDefined()
  })

  it('shows total move count from summary', async () => {
    render(<AIDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('42')).toBeDefined()
    })
  })

  it('shows per-difficulty stat cards', async () => {
    render(<AIDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('minimax / hard')).toBeDefined()
      expect(screen.getByText('minimax / easy')).toBeDefined()
    })
  })

  it('shows empty state message when no data', async () => {
    api.get.mockImplementation((path) => {
      if (path.includes('summary')) return Promise.resolve({ total: 0, rows: [] })
      if (path.includes('histogram')) return Promise.resolve({ histogram: [] })
      if (path.includes('heatmap')) return Promise.resolve({ heatmap: [] })
      return Promise.reject(new Error('unknown'))
    })

    render(<AIDashboardPage />)
    await waitFor(() => {
      const empties = screen.getAllByText(/No (data|moves recorded) yet/)
      expect(empties.length).toBeGreaterThan(0)
    })
  })

  it('difficulty filter buttons are rendered', async () => {
    render(<AIDashboardPage />)
    expect(screen.getByText('All')).toBeDefined()
    expect(screen.getByText('easy')).toBeDefined()
    expect(screen.getByText('medium')).toBeDefined()
    expect(screen.getByText('hard')).toBeDefined()
  })

  it('clicking a difficulty filter re-fetches histogram and heatmap', async () => {
    render(<AIDashboardPage />)
    await waitFor(() => expect(screen.getByText('AI Dashboard')).toBeDefined())

    fireEvent.click(screen.getByText('hard'))

    await waitFor(() => {
      const calls = api.get.mock.calls.map((c) => c[0])
      expect(calls.some((c) => c.includes('difficulty=hard'))).toBe(true)
    })
  })
})
