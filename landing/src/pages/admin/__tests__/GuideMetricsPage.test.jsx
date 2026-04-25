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
const pageMod = await import('../GuideMetricsPage.jsx')
const GuideMetricsPage = pageMod.default
const { rollupTrend } = pageMod

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

  it('renders the cohort granularity picker (default Week)', async () => {
    api.admin.guideMetrics.mockResolvedValue(FIXTURE)
    renderPage()
    const select = await screen.findByLabelText(/trend granularity/i)
    expect(select.value).toBe('week')
    // The three options match the spec (Day / Week / Month).
    expect([...select.querySelectorAll('option')].map(o => o.value))
      .toEqual(['day', 'week', 'month'])
  })
})

describe('rollupTrend (cohort slicer §2)', () => {
  // Daily samples spanning two ISO weeks + a month boundary so all three
  // granularities exercise distinct bucketing logic.
  const points = [
    { date: '2026-03-30', value: 10 },  // Mon — week of 03-30
    { date: '2026-03-31', value: 20 },
    { date: '2026-04-01', value: 30 },  // crosses month, same ISO week
    { date: '2026-04-02', value: 40 },
    { date: '2026-04-06', value: 50 },  // Mon — week of 04-06
    { date: '2026-04-07', value: 60 },
  ]

  it('day granularity = identity (one bucket per row)', () => {
    const r = rollupTrend(points, 'day')
    expect(r).toHaveLength(6)
    expect(r[0]).toEqual({ bucket: '2026-03-30', value: 10 })
    expect(r[5]).toEqual({ bucket: '2026-04-07', value: 60 })
  })

  it('week granularity buckets on ISO week start (Mon UTC), averages across days', () => {
    const r = rollupTrend(points, 'week')
    expect(r).toHaveLength(2)
    expect(r[0].bucket).toBe('2026-03-30')   // Mon-Thu
    expect(r[0].value).toBe(25)              // (10+20+30+40)/4
    expect(r[1].bucket).toBe('2026-04-06')   // Mon-Tue
    expect(r[1].value).toBe(55)              // (50+60)/2
  })

  it('month granularity buckets on YYYY-MM, averages across days', () => {
    const r = rollupTrend(points, 'month')
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ bucket: '2026-03', value: 15 })   // (10+20)/2
    expect(r[1]).toEqual({ bucket: '2026-04', value: 45 })   // (30+40+50+60)/4
  })

  it('returns [] on empty / non-array input (defensive)', () => {
    expect(rollupTrend([], 'week')).toEqual([])
    expect(rollupTrend(null, 'week')).toEqual([])
    expect(rollupTrend(undefined, 'week')).toEqual([])
  })
})
