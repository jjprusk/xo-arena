// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.7 — StackedCurvesChart contract.
 *
 * Two surfaces matter to test:
 *   1. The pure `isCurveSaturated` rule (fade trigger).
 *   2. The component's grouping + empty-state behavior, asserted via
 *      `data-testid="stacked-curve-<label>"` per rendered curve and the
 *      `data-saturated` attribute that wraps the faded card.
 *
 * Recharts internals (AreaChart geometry) aren't exercised — the chart
 * is a thin recharts shell and JSDOM doesn't measure SVG anyway.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import StackedCurvesChart, { isCurveSaturated } from '../StackedCurvesChart.jsx'

vi.mock('../../../lib/api.js', () => ({
  api: { ml: { getMetrics: vi.fn() } },
}))

import { api } from '../../../lib/api.js'

beforeEach(() => vi.clearAllMocks())

describe('isCurveSaturated', () => {
  it('returns false when fewer than 3 points exist (default window)', () => {
    expect(isCurveSaturated([])).toBe(false)
    expect(isCurveSaturated([{ wins: 10, draws: 0, losses: 0 }])).toBe(false)
    expect(isCurveSaturated([
      { wins: 10, draws: 0, losses: 0 },
      { wins: 10, draws: 0, losses: 0 },
    ])).toBe(false)
  })

  it('returns true when the last 3 points are all 100% wins', () => {
    expect(isCurveSaturated([
      { wins:  6, draws: 4, losses: 0 }, // 60% — older noise, ignored
      { wins: 10, draws: 0, losses: 0 },
      { wins: 10, draws: 0, losses: 0 },
      { wins: 10, draws: 0, losses: 0 },
    ])).toBe(true)
  })

  it('returns false if any of the last 3 has even one draw or loss', () => {
    expect(isCurveSaturated([
      { wins: 10, draws: 0, losses: 0 },
      { wins:  9, draws: 1, losses: 0 }, // breaks the streak
      { wins: 10, draws: 0, losses: 0 },
    ])).toBe(false)
  })

  it('returns false on a (0,0,0) point — total=0 cannot saturate', () => {
    expect(isCurveSaturated([
      { wins: 10, draws: 0, losses: 0 },
      { wins:  0, draws: 0, losses: 0 },
      { wins: 10, draws: 0, losses: 0 },
    ])).toBe(false)
  })

  it('honors a custom window override', () => {
    expect(isCurveSaturated(
      [{ wins: 1, draws: 0, losses: 0 }, { wins: 1, draws: 0, losses: 0 }],
      2,
    )).toBe(true)
  })
})

describe('StackedCurvesChart — render', () => {
  it('renders nothing when the session has no metrics', async () => {
    api.ml.getMetrics.mockResolvedValue({ metrics: [] })
    const { container } = render(<StackedCurvesChart sessionId="sess_legacy" />)
    await waitFor(() => expect(api.ml.getMetrics).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('renders one card per opponent label (only those with ≥2 points)', async () => {
    api.ml.getMetrics.mockResolvedValue({ metrics: [
      // primary: 3 points → renders
      { episodeNum: 1000, opponentLabel: 'primary', wins: 5, draws: 5, losses: 10 },
      { episodeNum: 2000, opponentLabel: 'primary', wins: 9, draws: 5, losses:  6 },
      { episodeNum: 3000, opponentLabel: 'primary', wins: 14, draws: 4, losses: 2 },
      // easy: 3 points all 100% → renders + saturated
      { episodeNum: 1000, opponentLabel: 'easy', wins: 20, draws: 0, losses: 0 },
      { episodeNum: 2000, opponentLabel: 'easy', wins: 20, draws: 0, losses: 0 },
      { episodeNum: 3000, opponentLabel: 'easy', wins: 20, draws: 0, losses: 0 },
      // medium: just 1 point → does NOT render (under threshold)
      { episodeNum: 1000, opponentLabel: 'medium', wins: 8, draws: 6, losses: 6 },
    ]})
    render(<StackedCurvesChart sessionId="sess_multi" />)
    await screen.findByTestId('stacked-curves-chart')

    expect(screen.getByTestId('stacked-curve-primary')).toBeInTheDocument()
    expect(screen.getByTestId('stacked-curve-easy')).toBeInTheDocument()
    expect(screen.queryByTestId('stacked-curve-medium')).toBeNull()
  })

  it('marks a curve saturated when last 3 points are all 100% wins', async () => {
    api.ml.getMetrics.mockResolvedValue({ metrics: [
      { episodeNum: 1000, opponentLabel: 'easy', wins: 20, draws: 0, losses: 0 },
      { episodeNum: 2000, opponentLabel: 'easy', wins: 20, draws: 0, losses: 0 },
      { episodeNum: 3000, opponentLabel: 'easy', wins: 20, draws: 0, losses: 0 },
    ]})
    render(<StackedCurvesChart sessionId="sess_sat" />)
    const card = await screen.findByTestId('stacked-curve-easy')
    expect(card.getAttribute('data-saturated')).toBe('true')
    // Style attribute should set the opacity multiplier.
    expect(card.style.opacity).toBe('0.4')
  })

  it('does NOT mark a curve saturated when wins drop below 100% recently', async () => {
    api.ml.getMetrics.mockResolvedValue({ metrics: [
      { episodeNum: 1000, opponentLabel: 'primary', wins: 30, draws: 10, losses: 10 },
      { episodeNum: 2000, opponentLabel: 'primary', wins: 35, draws:  8, losses:  7 },
      { episodeNum: 3000, opponentLabel: 'primary', wins: 40, draws:  5, losses:  5 },
    ]})
    render(<StackedCurvesChart sessionId="sess_unsat" />)
    const card = await screen.findByTestId('stacked-curve-primary')
    expect(card.getAttribute('data-saturated')).toBe('false')
    expect(card.style.opacity).toBe('1')
  })
})
