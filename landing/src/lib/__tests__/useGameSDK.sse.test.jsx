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
const claimSseSessionMock = vi.fn()
vi.mock('../useEventStream.js', () => ({
  useEventStream: (opts) => {
    eventStreamRegistry.latest = opts
  },
  claimSseSession: (...args) => claimSseSessionMock(...args),
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
  claimSseSessionMock.mockReset()
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
    // POST /rt/tables now surfaces `tableId` directly — the previous
    // follow-up `/rt/tables/:slug/join` was solely there to discover it
    // and has been removed. The test pins both halves of that change.
    rtFetchMock.mockResolvedValueOnce({
      slug: 'hvb1', tableId: 'tbl_h', label: 'A vs Bot', mark: 'X',
      action: 'created', board: Array(9).fill(null), currentTurn: 'X',
    })

    // Phase 3.8.5.2 — picker payload is identity-scoped; the hook never
    // forwards a botSkillId, even if a caller (legacy) tries to pass one.
    const { result } = renderHook(() =>
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

    // Session is populated from the create response alone (session.tableId
    // exposes the slug — the canonical Table.id is plumbed internally for
    // the SSE channel filter from `res.tableId`).
    await waitFor(() => expect(result.current.session?.tableId).toBe('hvb1'))

    // The previous follow-up `/rt/tables/:slug/join` POST is GONE — the
    // create response now carries `tableId` directly so the client doesn't
    // need a second RTT to discover it. This saves ~170 ms on warm-anon
    // vs-community-bot landings (Future_Ideas PlayVsBot start-flow fix).
    const joinCalls = rtFetchMock.mock.calls.filter(c => /^\/rt\/tables\/.+\/join$/.test(c[0]))
    expect(joinCalls).toHaveLength(0)
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

  // ── playBundle path — single-shot HvB start (Future_Ideas item 3) ──────────
  describe('single-shot playBundle branch', () => {
    const bundle = {
      sseSessionId: 'pre_alloc_1',
      tableId:      'tbl_h',
      slug:         'hvb-pre',
      label:        'You vs Rusty',
      mark:         'X',
      board:        Array(9).fill(null),
      currentTurn:  'X',
      bot:          { id: 'bot_rusty', displayName: 'Rusty', botModelId: 'builtin:minimax:0' },
    }

    it('skips the rtFetch chain entirely when a playBundle is provided', async () => {
      const { result } = renderHook(() =>
        useGameSDK({
          gameId: 'xo',
          botUserId: bundle.bot.id,
          currentUser: { id: 'u1', displayName: 'Alice' },
          playBundle: bundle,
        }),
      )

      // applyCreateResultHvb fires synchronously from the bundle — phase
      // flips to 'playing' before any rtFetch could possibly resolve.
      await waitFor(() => expect(result.current.phase).toBe('playing'))

      // No POST /rt/tables — the entire create-flow chain was bypassed.
      expect(rtFetchMock).not.toHaveBeenCalled()
      // The pre-allocated SSE session id was staged for the next openStream.
      expect(claimSseSessionMock).toHaveBeenCalledWith('pre_alloc_1')
      // Session exposes the bundle's slug, just like the multi-step path.
      expect(result.current.session?.tableId).toBe('hvb-pre')
    })

    it('multi-step PvP path still runs when no playBundle is provided (regression guard)', async () => {
      rtFetchMock
        .mockResolvedValueOnce({ slug: 'abc', label: 'Alice', mark: 'X', action: 'created' })
        .mockResolvedValueOnce({ tableId: 'tbl_1', mark: 'X', action: 'host_reattach' })

      renderHook(() =>
        useGameSDK({ gameId: 'xo', currentUser: { id: 'u1', displayName: 'Alice' } }),
      )

      await waitFor(() => {
        expect(rtFetchMock).toHaveBeenCalledWith('/rt/tables', expect.objectContaining({
          body: expect.objectContaining({ kind: 'pvp' }),
        }))
      })
      // No SSE-session pre-claim on the multi-step path.
      expect(claimSseSessionMock).not.toHaveBeenCalled()
    })

    it('joinSlug overrides playBundle (rejoin of an existing table should not skip the SSE bootstrap)', async () => {
      rtFetchMock.mockResolvedValueOnce({
        ok: true, action: 'host_reattach', tableId: 'tbl_x', mark: 'X', slug: 'abc',
        room: { hostUserId: 'u1', label: 'PvP' },
      })

      renderHook(() =>
        useGameSDK({
          gameId: 'xo', joinSlug: 'abc',
          currentUser: { id: 'u1' },
          playBundle: bundle,  // present but should be ignored
        }),
      )

      await waitFor(() => {
        expect(rtFetchMock).toHaveBeenCalledWith('/rt/tables/abc/join', expect.objectContaining({
          body: { role: 'player' },
        }))
      })
      expect(claimSseSessionMock).not.toHaveBeenCalled()
    })
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
