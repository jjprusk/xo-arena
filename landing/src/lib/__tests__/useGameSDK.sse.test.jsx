// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

const rtFetchMock = vi.fn()
const sessionListeners = new Set()
let _sessionId = 's1'
vi.mock('../rtSession.js', () => ({
  rtFetch:             (...args) => rtFetchMock(...args),
  getSseSession:       () => _sessionId,
  setSseSession:       (id) => { _sessionId = id },
  clearSseSession:     () => { _sessionId = null },
  onSseSessionChange:  (fn) => { sessionListeners.add(fn); return () => sessionListeners.delete(fn) },
}))

// useEventStream is a hook — capture the latest registration so tests can
// dispatch synthetic SSE events and assert on the SDK's reaction.
const eventStreamRegistry = { latest: null }
vi.mock('../useEventStream.js', () => ({
  useEventStream: (opts) => {
    eventStreamRegistry.latest = opts
  },
  KNOWN_SSE_EVENT_TYPES: [],
}))

vi.mock('../getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

vi.mock('../perfLog.js', () => ({ perfMark: vi.fn() }))

vi.mock('../../store/soundStore.js', () => ({
  useSoundStore: { getState: () => ({ play: vi.fn() }) },
}))

import { useGameSDK } from '../useGameSDK.js'

beforeEach(() => {
  rtFetchMock.mockReset()
  sessionListeners.clear()
  _sessionId = 's1'
  eventStreamRegistry.latest = null
})

function dispatch(channel, payload) {
  const onEvent = eventStreamRegistry.latest?.onEvent
  if (!onEvent) throw new Error('useEventStream.onEvent not registered')
  act(() => { onEvent(channel, payload) })
}

describe('useGameSDK SSE+POST gameflow branch', () => {
  it('POSTs /rt/tables to create a PvP table and exposes the slug on the session', async () => {
    rtFetchMock
      .mockResolvedValueOnce({ slug: 'abc', label: 'Alice', mark: 'X', action: 'created' })  // create
      .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'X', action: 'host_reattach' })       // join

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', currentUser: { id: 'u1', displayName: 'Alice' } }),
    )

    await waitFor(() => {
      expect(rtFetchMock).toHaveBeenCalledWith('/rt/tables', expect.objectContaining({
        body: expect.objectContaining({ kind: 'pvp' }),
      }))
    })
    await waitFor(() => expect(result.current.session?.tableId).toBe('abc'))
    expect(result.current.phase).toBe('waiting')
  })

  it('POSTs /rt/tables/:slug/join when joinSlug is provided and applies the room shape', async () => {
    rtFetchMock.mockResolvedValueOnce({
      ok:       true,
      action:   'guest_seated',
      tableId:  'tbl_1',
      mark:     'O',
      slug:     'abc',
      room:     { hostUserId: 'h1', guestUserId: 'g1', hostUserDisplayName: 'A', guestUserDisplayName: 'B', label: 'PvP' },
    })

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', joinSlug: 'abc', currentUser: { id: 'g1', displayName: 'B' } }),
    )

    await waitFor(() => {
      expect(rtFetchMock).toHaveBeenCalledWith('/rt/tables/abc/join', expect.objectContaining({
        body: { role: 'player' },
      }))
    })
    await waitFor(() => expect(result.current.session).toBeTruthy())
    expect(result.current.session.tableId).toBe('abc')
  })

  it('POSTs /rt/tables {kind:"hvb"} when botUserId is provided', async () => {
    rtFetchMock
      .mockResolvedValueOnce({
        slug: 'hvb1', label: 'A vs Bot', mark: 'X',
        action: 'created', board: Array(9).fill(null), currentTurn: 'X',
      })
      .mockResolvedValueOnce({ tableId: 'tbl_h', mark: 'X', action: 'host_reattach' })

    // Phase 3.8.5.2 — picker payload is identity-scoped; the hook never
    // forwards a botSkillId, even if a caller (legacy) tries to pass one.
    renderHook(() =>
      useGameSDK({ gameId: 'xo', botUserId: 'bot_1', currentUser: { id: 'u1' } }),
    )

    await waitFor(() => {
      expect(rtFetchMock).toHaveBeenCalledWith('/rt/tables', expect.objectContaining({
        body: expect.objectContaining({ kind: 'hvb', botUserId: 'bot_1' }),
      }))
    })
    // Confirm the legacy field is gone from the request payload.
    const hvbCall = rtFetchMock.mock.calls.find(c => c[0] === '/rt/tables' && c[1]?.body?.kind === 'hvb')
    expect(hvbCall[1].body).not.toHaveProperty('botSkillId')
  })

  it('SDK.submitMove POSTs to /rt/tables/:slug/move when on the SSE transport', async () => {
    rtFetchMock
      .mockResolvedValueOnce({ slug: 'abc', label: 'A', mark: 'X', action: 'created' })
      .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'X', action: 'host_reattach' })

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', currentUser: { id: 'u1' } }),
    )
    await waitFor(() => expect(result.current.session?.tableId).toBe('abc'))

    rtFetchMock.mockClear()
    rtFetchMock.mockResolvedValueOnce({ ok: true, completed: false, mark: 'X' })
    act(() => result.current.sdk.submitMove(4))

    await waitFor(() => {
      expect(rtFetchMock).toHaveBeenCalledWith('/rt/tables/abc/move', { body: { cellIndex: 4 } })
    })
  })

  it('translates table:<id>:state kind=moved into a move event for handlers', async () => {
    rtFetchMock
      .mockResolvedValueOnce({ slug: 'abc', label: 'A', mark: 'X', action: 'created' })
      .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'X', action: 'host_reattach' })

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', currentUser: { id: 'u1' } }),
    )
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    const handler = vi.fn()
    act(() => { result.current.sdk.onMove(handler) })

    dispatch('table:tbl_1:state', {
      kind: 'moved', cellIndex: 4,
      board: Array(9).fill(null).map((_, i) => i === 4 ? 'X' : null),
      currentTurn: 'O', status: 'playing', winner: null, winLine: null,
      scores: { X: 0, O: 0 }, round: 1,
    })

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ move: 4 }))
  })

  it('translates table:<id>:lifecycle kind=cancelled into setAbandoned', async () => {
    rtFetchMock
      .mockResolvedValueOnce({ slug: 'abc', label: 'A', mark: 'X', action: 'created' })
      .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'X', action: 'host_reattach' })

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', currentUser: { id: 'u1' } }),
    )
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    dispatch('table:tbl_1:lifecycle', { kind: 'cancelled' })
    await waitFor(() => expect(result.current.abandoned).toEqual({ reason: 'cancelled' }))
  })

  it('translates table:<id>:state kind=forfeit into a finished event carrying forfeiterMark + reason', async () => {
    rtFetchMock
      .mockResolvedValueOnce({ slug: 'abc', label: 'A', mark: 'O', action: 'created' })
      .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'O', action: 'host_reattach' })

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', currentUser: { id: 'u1' } }),
    )
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    const handler = vi.fn()
    act(() => { result.current.sdk.onMove(handler) })

    dispatch('table:tbl_1:state', {
      kind: 'forfeit',
      forfeiterMark: 'X',
      winner:        'O',
      scores:        { X: 0, O: 1 },
      reason:        'disconnect',
    })

    // The synthetic finished event must carry the forfeit context the game
    // component needs to render an "Opponent forfeited (left the game)"
    // pill instead of a generic "Opponent wins!" — the user-visible bug
    // that surfaced after the disconnect-survival fix landed.
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      state: expect.objectContaining({
        status:        'finished',
        winner:        'O',
        endReason:     'forfeit',
        forfeiterMark: 'X',
        forfeitReason: 'disconnect',
      }),
    }))
  })

  it('translates table:<id>:reaction into reaction handlers (and filters self)', async () => {
    rtFetchMock
      .mockResolvedValueOnce({ slug: 'abc', label: 'A', mark: 'X', action: 'created' })
      .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'X', action: 'host_reattach' })

    const { result } = renderHook(() =>
      useGameSDK({ gameId: 'xo', currentUser: { id: 'u1' } }),
    )
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    const handler = vi.fn()
    act(() => { result.current.sdk.onReaction(handler) })

    dispatch('table:tbl_1:reaction', { emoji: '👍', fromMark: 'O' })
    expect(handler).toHaveBeenCalledWith({ emoji: '👍', fromMark: 'O' })

    handler.mockClear()
    dispatch('table:tbl_1:reaction', { emoji: '🎉', fromMark: 'X' })
    expect(handler).not.toHaveBeenCalled()
  })

})
