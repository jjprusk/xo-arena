// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * TrainGuidedModal — locks in the live-training UX:
 *
 *   1. Mount → POSTs /train-guided, expects `{ sessionId, skillId, channelPrefix }`.
 *   2. Subscribes to `${channelPrefix}{progress,complete,error,cancelled,early_stop}`.
 *   3. As `:progress` events arrive, win-rate sparkline + stat tiles update.
 *   4. On `:complete`, POSTs /finalize and shows the celebration.
 *
 * The previously-failing user report ("popup hangs there and nothing gets
 * reported") was that no progress events ever lit up the modal. The Redis
 * stream confirmed the backend was emitting events; this suite locks in
 * that the modal's SSE wiring at least does the right thing given the
 * documented event shape, so we'd catch a regression in the channelPrefix
 * / eventTypes contract immediately.
 */
import React, { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'

vi.mock('../../../lib/api.js', () => ({
  api: {
    bots: {
      trainGuided:         vi.fn(),
      trainGuidedFinalize: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue('tok'),
}))

// Capture the useEventStream registration so the test can fire synthetic
// SSE events into the modal.
const eventStreamRegistry = { latest: null }
vi.mock('../../../lib/useEventStream.js', () => ({
  useEventStream: (opts) => { eventStreamRegistry.latest = opts },
  KNOWN_SSE_EVENT_TYPES: [],
}))

import TrainGuidedModal from '../TrainGuidedModal.jsx'
import { api } from '../../../lib/api.js'

function dispatch(channel, payload) {
  const onEvent = eventStreamRegistry.latest?.onEvent
  if (!onEvent) throw new Error('useEventStream.onEvent not registered yet')
  act(() => { onEvent(channel, payload) })
}

beforeEach(() => {
  vi.clearAllMocks()
  eventStreamRegistry.latest = null
})

describe('TrainGuidedModal', () => {
  it('subscribes to the correct ml:session:<id>:* event types after the POST', async () => {
    api.bots.trainGuided.mockResolvedValue({
      sessionId:     'sess_abc',
      skillId:       'skl_1',
      channelPrefix: 'ml:session:sess_abc:',
    })

    render(<TrainGuidedModal botId="bot_1" botName="Sparky" onClose={() => {}} onComplete={() => {}} />)

    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    const sub = eventStreamRegistry.latest
    expect(sub.channels).toEqual(['ml:session:sess_abc:'])
    // The eventTypes list is what the channel-prefix subscription is paired
    // with — the static EventSource listener registration. A regression here
    // (e.g. forgetting to suffix one of the kinds) would silently break the
    // modal because the browser drops named events without listeners.
    expect(sub.eventTypes).toEqual([
      'ml:session:sess_abc:progress',
      'ml:session:sess_abc:complete',
      'ml:session:sess_abc:error',
      'ml:session:sess_abc:cancelled',
      'ml:session:sess_abc:early_stop',
    ])
  })

  it('updates progress UI on :progress events (win-rate sparkline + stat tiles)', async () => {
    api.bots.trainGuided.mockResolvedValue({
      sessionId: 'sess_abc', skillId: 'skl_1', channelPrefix: 'ml:session:sess_abc:',
    })
    render(<TrainGuidedModal botId="bot_1" botName="Sparky" onClose={() => {}} onComplete={() => {}} />)
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    // First progress tick — episode 1500 of 30000.
    dispatch('ml:session:sess_abc:progress', {
      sessionId: 'sess_abc',
      episode: 1500, totalEpisodes: 30000,
      winRate: 0.42, lossRate: 0.30, drawRate: 0.28,
      epsilon: 0.65,
    })

    // Header progress percent: 1500 / 30000 = 5%
    expect(screen.getByText('5%')).toBeInTheDocument()
    // Win/Loss/Draw tiles reflect the latest payload.
    expect(screen.getByText('42%')).toBeInTheDocument()  // Win
    expect(screen.getByText('30%')).toBeInTheDocument()  // Loss
    expect(screen.getByText('28%')).toBeInTheDocument()  // Draw
    expect(screen.getByText('0.650')).toBeInTheDocument() // ε

    // Second tick — climb visible.
    dispatch('ml:session:sess_abc:progress', {
      sessionId: 'sess_abc',
      episode: 15000, totalEpisodes: 30000,
      winRate: 0.71, lossRate: 0.12, drawRate: 0.17,
      epsilon: 0.10,
    })
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('71%')).toBeInTheDocument()
  })

  it('on :complete, POSTs /finalize and transitions to done', async () => {
    api.bots.trainGuided.mockResolvedValue({
      sessionId: 'sess_abc', skillId: 'skl_1', channelPrefix: 'ml:session:sess_abc:',
    })
    api.bots.trainGuidedFinalize.mockResolvedValue({ bot: { id: 'bot_1', botModelType: 'qlearning' } })
    const onComplete = vi.fn()
    render(<TrainGuidedModal botId="bot_1" botName="Sparky" onClose={() => {}} onComplete={onComplete} />)
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    dispatch('ml:session:sess_abc:complete', { sessionId: 'sess_abc', summary: { wins: 21000, losses: 5000, draws: 4000 } })

    // The finalize POST should fire (even before the 2.5s celebration timer
    // expires) and the modal should reach the 'done' status.
    await waitFor(() => {
      expect(api.bots.trainGuidedFinalize).toHaveBeenCalledWith('bot_1', { sessionId: 'sess_abc', skillId: 'skl_1' }, 'tok')
    })
    await waitFor(() => expect(screen.getByText(/Bot trained!/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it('shows the error state if the initial POST rejects', async () => {
    api.bots.trainGuided.mockRejectedValue(new Error('Training is busy'))
    render(<TrainGuidedModal botId="bot_1" botName="Sparky" onClose={() => {}} onComplete={() => {}} />)

    // Error text appears twice — header subtitle + footer role=alert. The
    // role=alert anchor is the user-facing one, so assert on it.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Training is busy/))
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('shows the error state if a :error event arrives mid-training', async () => {
    api.bots.trainGuided.mockResolvedValue({
      sessionId: 'sess_abc', skillId: 'skl_1', channelPrefix: 'ml:session:sess_abc:',
    })
    render(<TrainGuidedModal botId="bot_1" botName="Sparky" onClose={() => {}} onComplete={() => {}} />)
    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true))

    dispatch('ml:session:sess_abc:error', { sessionId: 'sess_abc', error: 'Engine crashed' })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Engine crashed/))
  })

  // ── StrictMode regression guard (the actual bug from the user report) ────
  // Before the fix, the startup effect's closure-scoped `cancelled` flag
  // combined with the `startedRef` early-return wedged the modal forever
  // at status='starting' because:
  //   1. Mount #1: startedRef→true, cancelled=false, async POST starts.
  //   2. Cleanup: cancelled=true (mutates mount #1's closure).
  //   3. Mount #2: startedRef.current already true → early return.
  //   4. Mount #1's POST resolves → if (cancelled) return → no setState.
  // Locking it down by simulating the StrictMode mount → cleanup → mount.
  it('survives StrictMode\'s double-mount (fixes the "Preparing self-play episodes…" hang)', async () => {
    // Production mounts the app under <StrictMode>. In dev React mounts every
    // effect twice (run → cleanup → run) to surface stale closures and
    // missing-cleanup bugs. This test wraps the modal in StrictMode here so
    // a regression of the original cancelled-flag-in-closure pattern would
    // cause this assertion to fail (because the first run's cancelled=true
    // would skip the setState and eventStream would never enable).
    api.bots.trainGuided.mockResolvedValue({
      sessionId: 'sess_abc', skillId: 'skl_1', channelPrefix: 'ml:session:sess_abc:',
    })
    render(
      <StrictMode>
        <TrainGuidedModal botId="bot_1" botName="Sparky" onClose={() => {}} onComplete={() => {}} />
      </StrictMode>,
    )

    await waitFor(() => expect(eventStreamRegistry.latest?.enabled).toBe(true), { timeout: 2_000 })
    expect(eventStreamRegistry.latest?.channels).toEqual(['ml:session:sess_abc:'])
  })
})
