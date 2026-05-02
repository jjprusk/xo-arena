// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * RewardPopup — phase-boundary celebrations driven by SSE events
 * (Sprint 3 §9.1).
 *
 * Covers:
 *   - Renders nothing by default
 *   - guide:hook_complete shows a +20 TC popup with the next-phase hint
 *   - guide:curriculum_complete shows a +50 TC popup with Specialize hint
 *   - Manual dismiss via the close button
 *   - Auto-dismiss after 8s via fake timers
 *   - Falls back to default reward amounts when payload omits them
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// Capture the most recent useEventStream onEvent handler so tests can
// dispatch SSE payloads at will.
let _sseHandler = null
vi.mock('../../../lib/useEventStream.js', () => ({
  useEventStream: ({ onEvent }) => { _sseHandler = onEvent },
}))

import RewardPopup from '../RewardPopup.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  _sseHandler = null
})

afterEach(() => {
  vi.useRealTimers()
})

function fire(channel, payload) {
  expect(_sseHandler).toBeTypeOf('function')
  act(() => _sseHandler(channel, payload))
}

describe('RewardPopup', () => {
  it('renders nothing before any event fires', () => {
    const { container } = render(<RewardPopup />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Hook reward popup with +20 TC on guide:hook_complete', () => {
    render(<RewardPopup />)
    fire('guide:hook_complete', { reward: 20, message: 'Welcome to the Arena.' })
    expect(screen.getByText(/Off to a great start!/i)).toBeInTheDocument()
    expect(screen.getByText(/\+20 Tournament Credits/i)).toBeInTheDocument()
    expect(screen.getByText(/build your first bot/i)).toBeInTheDocument()
  })

  it('shows the Curriculum reward popup with +50 TC on guide:curriculum_complete', () => {
    render(<RewardPopup />)
    fire('guide:curriculum_complete', { reward: 50, message: 'You earned the graduation reward.' })
    expect(screen.getByText(/Journey complete!/i)).toBeInTheDocument()
    expect(screen.getByText(/\+50 Tournament Credits/i)).toBeInTheDocument()
    expect(screen.getByText(/Specialize/i)).toBeInTheDocument()
  })

  it('falls back to default reward amounts when the payload omits them', () => {
    render(<RewardPopup />)
    fire('guide:hook_complete', {})
    expect(screen.getByText(/\+20 Tournament Credits/i)).toBeInTheDocument()
  })

  it('the close button dismisses the popup', () => {
    render(<RewardPopup />)
    fire('guide:hook_complete', { reward: 20 })
    expect(screen.getByTestId('reward-popup')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Dismiss reward popup/i))
    expect(screen.queryByTestId('reward-popup')).not.toBeInTheDocument()
  })

  it('auto-dismisses after 8 seconds', () => {
    vi.useFakeTimers()
    render(<RewardPopup />)
    fire('guide:hook_complete', { reward: 20 })
    expect(screen.getByTestId('reward-popup')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(8_000) })
    expect(screen.queryByTestId('reward-popup')).not.toBeInTheDocument()
  })

  it('does NOT render on resumed-journey hydration — popup is event-driven, not state-driven (task #30)', () => {
    // Scenario: user completed steps 1-3 weeks ago; now they sign in fresh.
    // The guideStore hydrates with `completedSteps: [1, 2, 3]` from
    // GET /api/v1/guide/preferences. RewardPopup MUST NOT render — that
    // would re-celebrate the Hook reward they already received. The popup
    // only fires on a fresh `guide:hook_complete` SSE event, never from
    // hydrated state. Catches a regression where someone wires the popup
    // to journeyProgress instead of the SSE channel.
    const { container } = render(<RewardPopup />)
    expect(container).toBeEmptyDOMElement()

    // Even if the SSE stream stays silent (no replay), nothing renders.
    expect(container).toBeEmptyDOMElement()
  })

  it('a second event resets the auto-dismiss window (newest reward wins)', () => {
    vi.useFakeTimers()
    render(<RewardPopup />)
    fire('guide:hook_complete', { reward: 20 })
    act(() => { vi.advanceTimersByTime(5_000) })
    fire('guide:curriculum_complete', { reward: 50 })
    expect(screen.getByText(/\+50 Tournament Credits/i)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3_000) })  // 8s from first fire
    expect(screen.getByTestId('reward-popup')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(5_000) })  // 8s from second fire
    expect(screen.queryByTestId('reward-popup')).not.toBeInTheDocument()
  })
})
