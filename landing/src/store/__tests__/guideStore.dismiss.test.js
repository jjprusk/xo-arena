// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * guideStore — dismissedAt lifecycle (task #31).
 *
 * Covers the full dismiss → restart → re-dismiss cycle:
 *   - dismissJourney() sets a fresh ISO timestamp on dismissedAt
 *   - restartJourney() clears completedSteps AND dismissedAt back to null
 *     (server is the source of truth via POST /guide/journey/restart)
 *   - re-dismissing after a restart writes a NEW timestamp, not the old one
 *     (catches a regression where the local state was reused stale)
 *   - hydrate() respects a persisted dismissedAt — does not clobber
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/api.js', () => ({
  api: {
    guide: {
      patchPreferences: vi.fn().mockResolvedValue({ ok: true }),
      restartJourney:   vi.fn().mockResolvedValue({ ok: true }),
      getPreferences:   vi.fn(),
    },
  },
}))
vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue('tok'),
}))

import { api } from '../../lib/api.js'
import { useGuideStore } from '../guideStore.js'

beforeEach(() => {
  vi.clearAllMocks()
  api.guide.patchPreferences.mockResolvedValue({ ok: true })
  api.guide.restartJourney.mockResolvedValue({ ok: true })
  // Reset store between tests.
  useGuideStore.setState({
    journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: null },
    slots:           [],
    panelOpen:       false,
    notifications:   [],
    uiHints:         {},
    hydrated:        false,
  })
})

describe('guideStore — dismissedAt lifecycle', () => {
  it('dismissJourney sets a fresh ISO timestamp and PATCHes the server', async () => {
    const t0 = Date.now()
    useGuideStore.getState().dismissJourney(['slot-a'])

    const { journeyProgress, slots } = useGuideStore.getState()
    expect(journeyProgress.dismissedAt).toBeTypeOf('string')
    expect(new Date(journeyProgress.dismissedAt).getTime()).toBeGreaterThanOrEqual(t0)
    expect(journeyProgress.completedSteps).toEqual([1, 2, 3])  // progress preserved
    expect(slots).toEqual(['slot-a'])

    // Server PATCH fires (fire-and-forget — await microtask flush).
    await Promise.resolve()
    await Promise.resolve()
    expect(api.guide.patchPreferences).toHaveBeenCalled()
    const [body] = api.guide.patchPreferences.mock.calls[0]
    expect(body.journeyProgress.dismissedAt).toBe(journeyProgress.dismissedAt)
    expect(body.guideSlots).toEqual(['slot-a'])
  })

  it('restartJourney clears completedSteps AND dismissedAt back to null', async () => {
    // Pre-state: dismissed mid-curriculum.
    useGuideStore.setState({
      journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: '2026-04-01T00:00:00Z' },
    })

    await useGuideStore.getState().restartJourney()

    const { journeyProgress } = useGuideStore.getState()
    expect(journeyProgress.completedSteps).toEqual([])
    expect(journeyProgress.dismissedAt).toBeNull()
    expect(api.guide.restartJourney).toHaveBeenCalledWith('tok')
  })

  it('re-dismissing after a restart writes a NEW timestamp, not the prior one', async () => {
    // Pre-state: dismissed with a known old timestamp.
    const oldTs = '2026-04-01T00:00:00Z'
    useGuideStore.setState({
      journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: oldTs },
    })

    // Restart wipes both fields.
    await useGuideStore.getState().restartJourney()
    expect(useGuideStore.getState().journeyProgress.dismissedAt).toBeNull()

    // Walk back through Hook to trigger another dismissable state, then dismiss.
    useGuideStore.setState({
      journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: null },
    })
    useGuideStore.getState().dismissJourney([])

    const { journeyProgress } = useGuideStore.getState()
    expect(journeyProgress.dismissedAt).not.toBe(oldTs)
    expect(journeyProgress.dismissedAt).not.toBeNull()
    // ISO 8601 format check
    expect(journeyProgress.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('hydrate() preserves a persisted dismissedAt — does not clobber to null', async () => {
    api.guide.getPreferences.mockResolvedValue({
      journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: '2026-04-01T00:00:00Z' },
      guideSlots:      ['slot-x'],
      uiHints:         {},
    })

    await useGuideStore.getState().hydrate()

    const { journeyProgress, slots, hydrated } = useGuideStore.getState()
    expect(journeyProgress.dismissedAt).toBe('2026-04-01T00:00:00Z')
    expect(journeyProgress.completedSteps).toEqual([1, 2, 3])
    expect(slots).toEqual(['slot-x'])
    expect(hydrated).toBe(true)
  })

  it('two rapid dismiss calls produce monotonically non-decreasing timestamps', async () => {
    useGuideStore.setState({
      journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: null },
    })

    useGuideStore.getState().dismissJourney(null)
    const ts1 = useGuideStore.getState().journeyProgress.dismissedAt
    // Allow Date.now() to tick — even on fast machines, two ISO strings
    // should be lexically <= in the JS event loop.
    await new Promise(r => setTimeout(r, 5))
    useGuideStore.getState().dismissJourney(null)
    const ts2 = useGuideStore.getState().journeyProgress.dismissedAt

    expect(new Date(ts2).getTime()).toBeGreaterThanOrEqual(new Date(ts1).getTime())
  })
})
