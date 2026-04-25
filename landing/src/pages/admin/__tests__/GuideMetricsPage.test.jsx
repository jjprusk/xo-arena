// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(() => Promise.resolve('test-token')),
}))

vi.mock('../../../lib/api.js', () => ({
  api: { admin: { guideMetrics: vi.fn() } },
}))

// Recharts hits getBoundingClientRect under JSDOM and renders nothing without
// a measured container. We don't care about the chart's pixel output here —
// the panel's text is what we assert on. Stub the parts we use.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  LineChart:           ({ children }) => <div data-testid="line-chart">{children}</div>,
  Line:                () => null,
  XAxis:               () => null,
  YAxis:               () => null,
  Tooltip:             () => null,
}))

const { api } = await import('../../../lib/api.js')
const GuideMetricsPage = (await import('../GuideMetricsPage.jsx')).default

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <GuideMetricsPage />
    </MemoryRouter>
  )
}

const FIXTURE = {
  now: {
    date:          new Date('2026-04-25T00:00:00.000Z'),
    northStar:     { value: 0.42, denom: 100, numer: 42 },
    funnel:        { step1: 100, step2: 80, step3: 60, step4: 40, step5: 30, step6: 20, step7: 10 },
    signup:        { credential: 30, oauth: 70 },
    testUserCount: 3,
  },
  history: [
    { date: '2026-04-23', metric: 'northStar', value: 0.40, dimensions: {} },
    { date: '2026-04-24', metric: 'northStar', value: 0.41, dimensions: {} },
    { date: '2026-04-25', metric: 'northStar', value: 0.42, dimensions: {} },
  ],
}

describe('GuideMetricsPage', () => {
  it('renders North Star, funnel, signup split, and test-user footer from fixture', async () => {
    api.admin.guideMetrics.mockResolvedValue(FIXTURE)
    renderPage()

    expect(await screen.findByText('42.0%')).toBeDefined()         // North Star %
    expect(screen.getByText(/42 \/ 100 eligible users/)).toBeDefined()
    expect(screen.getByText('1. Play a quick game')).toBeDefined()  // funnel labels
    expect(screen.getByText('7. See result')).toBeDefined()
    expect(screen.getByText(/Credential: 30/)).toBeDefined()
    expect(screen.getByText(/OAuth: 70/)).toBeDefined()
    expect(screen.getByText(/Excluding 3 test users\./)).toBeDefined()
  })

  it('renders the empty-state copy when history is empty', async () => {
    api.admin.guideMetrics.mockResolvedValue({ ...FIXTURE, history: [] })
    renderPage()
    expect(await screen.findByText(/trend line populates/i)).toBeDefined()
  })

  it('shows an error message when the API call fails', async () => {
    api.admin.guideMetrics.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/failed to load metrics/i)).toBeDefined()
    })
  })

  it('shows "No signups in the last 30 days" when both signup buckets are 0', async () => {
    api.admin.guideMetrics.mockResolvedValue({
      ...FIXTURE,
      now: { ...FIXTURE.now, signup: { credential: 0, oauth: 0 } },
    })
    renderPage()
    expect(await screen.findByText(/No signups in the last 30 days/i)).toBeDefined()
  })
})
