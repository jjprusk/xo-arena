// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * RewardPopup — Phase 2 SSE delivery path (Realtime_Migration_Plan.md §Phase 2).
 *
 * The component subscribes to both transports so a `realtime.guide.via` flag
 * flip swaps the live source without remounting. These tests verify the SSE
 * path in isolation:
 *
 *   - With viaSse('guide')=true, an SSE-delivered guide:hook_complete shows
 *     the +20 TC popup (and the legacy socket emit is suppressed).
 *   - With viaSse('guide')=true, guide:curriculum_complete shows the +50 TC
 *     popup with the Specialize hint.
 *   - With viaSse('guide')=false (default), an SSE delivery is ignored — the
 *     socket transport is authoritative.
 *
 * The legacy socket-driven popups are covered in RewardPopup.test.jsx.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Fake socket — same shape as the legacy test. We don't fire socket events
// here; the contract is that with SSE on, the socket listener no-ops.
const _socketListeners = new Map()
const fakeSocket = {
  on:  vi.fn((event, cb) => { _socketListeners.set(event, cb) }),
  off: vi.fn((event) => { _socketListeners.delete(event) }),
}
vi.mock('../../../lib/socket.js', () => ({
  getSocket: () => fakeSocket,
}))

// Fake useEventStream — capture the onEvent prop so the test can dispatch
// SSE deliveries directly without spinning up an EventSource.
let _sseHandler = null
vi.mock('../../../lib/useEventStream.js', () => ({
  useEventStream: ({ onEvent }) => { _sseHandler = onEvent },
}))

// Toggle viaSse('guide') per-test.
let _guideOnSse = false
vi.mock('../../../lib/realtimeMode.js', () => ({
  viaSse: (feature) => feature === 'guide' && _guideOnSse,
}))

import RewardPopup from '../RewardPopup.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  _socketListeners.clear()
  _sseHandler   = null
  _guideOnSse   = false
})

describe('RewardPopup — SSE path (realtime.guide.via=sse)', () => {
  it('shows the +20 TC Hook popup on an SSE-delivered guide:hook_complete', () => {
    _guideOnSse = true
    render(<RewardPopup />)
    expect(_sseHandler).toBeTypeOf('function')

    act(() => { _sseHandler('guide:hook_complete', { reward: 20 }) })

    const popup = screen.getByTestId('reward-popup')
    expect(popup).toBeInTheDocument()
    expect(popup.textContent).toMatch(/Off to a great start/)
    expect(popup.textContent).toMatch(/\+20 Tournament Credits/)
    expect(popup.textContent).toMatch(/build your first bot/)
  })

  it('shows the +50 TC Curriculum popup on an SSE-delivered guide:curriculum_complete', () => {
    _guideOnSse = true
    render(<RewardPopup />)

    act(() => { _sseHandler('guide:curriculum_complete', { reward: 50 }) })

    const popup = screen.getByTestId('reward-popup')
    expect(popup.textContent).toMatch(/Journey complete/)
    expect(popup.textContent).toMatch(/\+50 Tournament Credits/)
    expect(popup.textContent).toMatch(/Specialize/)
  })

  it('falls back to default reward amounts when SSE payload omits them', () => {
    _guideOnSse = true
    render(<RewardPopup />)

    act(() => { _sseHandler('guide:hook_complete', {}) })

    expect(screen.getByTestId('reward-popup').textContent).toMatch(/\+20 Tournament Credits/)
  })

  it('ignores other SSE channels (e.g. guide:notification, presence:changed)', () => {
    _guideOnSse = true
    const { container } = render(<RewardPopup />)

    act(() => {
      _sseHandler('guide:notification', { type: 'reward', payload: {} })
      _sseHandler('presence:changed',   {})
    })

    expect(container).toBeEmptyDOMElement()
  })

  it('does NOT pop on SSE delivery when viaSse(guide)=false (socket is authoritative)', () => {
    _guideOnSse = false
    const { container } = render(<RewardPopup />)

    act(() => { _sseHandler('guide:hook_complete', { reward: 20 }) })

    expect(container).toBeEmptyDOMElement()
  })

  it('does NOT pop on socket delivery when viaSse(guide)=true (SSE is authoritative)', () => {
    _guideOnSse = true
    const { container } = render(<RewardPopup />)

    const socketHandler = _socketListeners.get('guide:hook_complete')
    expect(socketHandler).toBeTypeOf('function')
    act(() => { socketHandler({ reward: 20 }) })

    expect(container).toBeEmptyDOMElement()
  })
})
