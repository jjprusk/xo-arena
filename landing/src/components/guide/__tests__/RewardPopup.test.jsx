// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * RewardPopup — phase-boundary celebrations driven by socket events
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

// Fake socket — captures the most recent listener for each event so tests
// can fire payloads at will.
const _listeners = new Map()
const fakeSocket = {
  on: vi.fn((event, cb) => { _listeners.set(event, cb) }),
  off: vi.fn((event) => { _listeners.delete(event) }),
}

vi.mock('../../../lib/socket.js', () => ({
  getSocket: () => fakeSocket,
}))

import RewardPopup from '../RewardPopup.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  _listeners.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RewardPopup', () => {
  it('renders nothing before any event fires', () => {
    const { container } = render(<RewardPopup />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Hook reward popup with +20 TC on guide:hook_complete', () => {
    render(<RewardPopup />)
    const fire = _listeners.get('guide:hook_complete')
    expect(fire).toBeTypeOf('function')
    act(() => {
      fire({ reward: 20, message: 'Welcome to the Arena.' })
    })
    expect(screen.getByText(/Hook complete!/i)).toBeInTheDocument()
    expect(screen.getByText(/\+20 Tournament Credits/i)).toBeInTheDocument()
    expect(screen.getByText(/build your first bot/i)).toBeInTheDocument()
  })

  it('shows the Curriculum reward popup with +50 TC on guide:curriculum_complete', () => {
    render(<RewardPopup />)
    act(() => {
      _listeners.get('guide:curriculum_complete')({ reward: 50, message: 'You earned the graduation reward.' })
    })
    expect(screen.getByText(/Journey complete!/i)).toBeInTheDocument()
    expect(screen.getByText(/\+50 Tournament Credits/i)).toBeInTheDocument()
    expect(screen.getByText(/Specialize/i)).toBeInTheDocument()
  })

  it('falls back to default reward amounts when the payload omits them', () => {
    render(<RewardPopup />)
    act(() => { _listeners.get('guide:hook_complete')({}) })
    expect(screen.getByText(/\+20 Tournament Credits/i)).toBeInTheDocument()
  })

  it('the close button dismisses the popup', () => {
    render(<RewardPopup />)
    act(() => { _listeners.get('guide:hook_complete')({ reward: 20 }) })
    expect(screen.getByTestId('reward-popup')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Dismiss reward popup/i))
    expect(screen.queryByTestId('reward-popup')).not.toBeInTheDocument()
  })

  it('auto-dismisses after 8 seconds', () => {
    vi.useFakeTimers()
    render(<RewardPopup />)
    act(() => { _listeners.get('guide:hook_complete')({ reward: 20 }) })
    expect(screen.getByTestId('reward-popup')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(8_000) })
    expect(screen.queryByTestId('reward-popup')).not.toBeInTheDocument()
  })

  it('a second event resets the auto-dismiss window (newest reward wins)', () => {
    vi.useFakeTimers()
    render(<RewardPopup />)
    act(() => { _listeners.get('guide:hook_complete')({ reward: 20 }) })
    act(() => { vi.advanceTimersByTime(5_000) })  // halfway through dismiss
    act(() => { _listeners.get('guide:curriculum_complete')({ reward: 50 }) })
    expect(screen.getByText(/\+50 Tournament Credits/i)).toBeInTheDocument()
    // Old timer should not have dismissed at 8s from first fire — the new
    // event reset it.
    act(() => { vi.advanceTimersByTime(3_000) })  // total 8s from first fire
    expect(screen.getByTestId('reward-popup')).toBeInTheDocument()
    // 8s from the second fire — now it dismisses
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(screen.queryByTestId('reward-popup')).not.toBeInTheDocument()
  })

  it('cleans up socket listeners on unmount', () => {
    const { unmount } = render(<RewardPopup />)
    unmount()
    expect(fakeSocket.off).toHaveBeenCalledWith('guide:hook_complete', expect.any(Function))
    expect(fakeSocket.off).toHaveBeenCalledWith('guide:curriculum_complete', expect.any(Function))
  })
})
