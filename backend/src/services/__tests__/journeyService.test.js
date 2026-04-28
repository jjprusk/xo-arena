import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: mockAppendToStream,
}))

import db from '../../lib/db.js'
import {
  TOTAL_STEPS,
  HOOK_STEPS,
  CURRICULUM_STEPS,
  STEP_TITLES,
  deriveCurrentPhase,
  getJourneyProgress,
  completeStep,
  restartJourney,
} from '../journeyService.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockUserId = 'user_1'
function mockUserWithProgress(completedSteps = [], extra = {}) {
  return {
    id: mockUserId,
    preferences: {
      journeyProgress: { completedSteps: [...completedSteps], dismissedAt: null },
      ...extra,
    },
  }
}

function mockIo() {
  const roomEmit = vi.fn()
  const to = vi.fn().mockReturnValue({ emit: roomEmit })
  return { to, roomEmit }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.systemConfig.findUnique.mockResolvedValue(null)   // Force defaults
  db.user.update.mockResolvedValue({})
})

// ── Module constants ──────────────────────────────────────────────────────────

describe('journeyService — constants', () => {
  it('exports TOTAL_STEPS = 7', () => {
    expect(TOTAL_STEPS).toBe(7)
  })

  it('HOOK_STEPS = [1, 2] + CURRICULUM_STEPS = [3, 4, 5, 6, 7]', () => {
    expect(HOOK_STEPS).toEqual([1, 2])
    expect(CURRICULUM_STEPS).toEqual([3, 4, 5, 6, 7])
  })

  it('STEP_TITLES has a title for each of the 7 steps', () => {
    for (let i = 1; i <= 7; i++) {
      expect(STEP_TITLES[i]).toBeTruthy()
      expect(typeof STEP_TITLES[i]).toBe('string')
    }
  })
})

// ── Phase derivation ──────────────────────────────────────────────────────────

describe('deriveCurrentPhase', () => {
  it('returns "hook" when no steps complete', () => {
    expect(deriveCurrentPhase([])).toBe('hook')
  })

  it('returns "hook" when only step 1 is complete (hook not yet done)', () => {
    expect(deriveCurrentPhase([1])).toBe('hook')
  })

  it('returns "curriculum" when step 2 is complete (hook done)', () => {
    expect(deriveCurrentPhase([1, 2])).toBe('curriculum')
  })

  it('returns "curriculum" mid-curriculum', () => {
    expect(deriveCurrentPhase([1, 2, 3, 4])).toBe('curriculum')
  })

  it('returns "specialize" when step 7 is complete', () => {
    expect(deriveCurrentPhase([1, 2, 3, 4, 5, 6, 7])).toBe('specialize')
  })

  it('returns "specialize" even if step 7 is the only non-contiguous completed step (defensive)', () => {
    // If some upstream code somehow marked step 7 without intermediate ones,
    // phase derivation still recognizes the terminal milestone.
    expect(deriveCurrentPhase([7])).toBe('specialize')
  })

  it('returns "hook" on null/undefined input', () => {
    expect(deriveCurrentPhase(undefined)).toBe('hook')
    expect(deriveCurrentPhase(null)).toBe('hook')
  })
})

// ── getJourneyProgress ────────────────────────────────────────────────────────

describe('getJourneyProgress', () => {
  it('returns empty state when user has no prefs', async () => {
    db.user.findUnique.mockResolvedValue({ id: mockUserId, preferences: null })
    const prog = await getJourneyProgress(mockUserId)
    expect(prog).toEqual({ completedSteps: [], dismissedAt: null })
  })

  it('returns empty state when user is not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const prog = await getJourneyProgress(mockUserId)
    expect(prog).toEqual({ completedSteps: [], dismissedAt: null })
  })

  it('returns stored progress when present', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2]))
    const prog = await getJourneyProgress(mockUserId)
    expect(prog.completedSteps).toEqual([1, 2])
  })
})

// ── completeStep — core behavior ──────────────────────────────────────────────

describe('completeStep — basic behavior', () => {
  it('returns true and persists when a fresh step is completed', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))

    const result = await completeStep(mockUserId, 1)

    expect(result).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockUserId },
        data: expect.objectContaining({
          preferences: expect.objectContaining({
            journeyProgress: expect.objectContaining({
              completedSteps: [1],
            }),
          }),
        }),
      })
    )
  })

  it('is idempotent — returns false if step already complete', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))

    const result = await completeStep(mockUserId, 1)

    expect(result).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('sorts completedSteps numerically after insertion', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([3, 1]))

    await completeStep(mockUserId, 2)

    const callArgs = db.user.update.mock.calls[0][0]
    expect(callArgs.data.preferences.journeyProgress.completedSteps).toEqual([1, 2, 3])
  })

  it('returns false for out-of-range step indices (< 1 or > 7)', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))

    expect(await completeStep(mockUserId, 0)).toBe(false)
    expect(await completeStep(mockUserId, 8)).toBe(false)
    expect(await completeStep(mockUserId, -1)).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('returns false for non-integer step indices', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))

    expect(await completeStep(mockUserId, 1.5)).toBe(false)
    expect(await completeStep(mockUserId, '2')).toBe(false)
    expect(await completeStep(mockUserId, null)).toBe(false)
  })

  it('returns false when user not found (no prefs)', async () => {
    db.user.findUnique.mockResolvedValue(null)
    expect(await completeStep(mockUserId, 1)).toBe(false)
  })

  it('appends guide:journeyStep with phase on successful completion', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))

    await completeStep(mockUserId, 1)

    const sseCall = mockAppendToStream.mock.calls.find(([ch]) => ch === 'guide:journeyStep')
    expect(sseCall).toBeDefined()
    expect(sseCall[1]).toMatchObject({
      step: 1,
      completedSteps: [1],
      totalSteps: 7,
      phase: 'hook',
    })
    expect(sseCall[2]).toEqual({ userId: mockUserId })
  })

  it('emits guide:journeyStep on SSE even when no io is provided (offline tab)', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))

    await completeStep(mockUserId, 1)

    const sseCall = mockAppendToStream.mock.calls.find(([ch]) => ch === 'guide:journeyStep')
    expect(sseCall).toBeDefined()
    expect(sseCall[2]).toEqual({ userId: mockUserId })
  })
})

// ── Rewards — step 2 (end of Hook) ────────────────────────────────────────────

describe('completeStep — Hook reward on step 2', () => {
  it('awards +20 TC (default) when step 2 completes', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))

    await completeStep(mockUserId, 2)

    // First update = journey-progress write; second update = TC grant
    const updates = db.user.update.mock.calls
    const tcGrant = updates.find(([args]) => args.data?.creditsTc)
    expect(tcGrant).toBeDefined()
    expect(tcGrant[0].data.creditsTc).toEqual({ increment: 20 })
  })

  it('uses admin-configured reward amount if SystemConfig key is set', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))
    db.systemConfig.findUnique.mockImplementation(async ({ where: { key } }) => {
      if (key === 'guide.rewards.hookComplete') return { value: '15' }
      return null
    })

    await completeStep(mockUserId, 2)

    const tcGrant = db.user.update.mock.calls.find(([args]) => args.data?.creditsTc)
    expect(tcGrant[0].data.creditsTc).toEqual({ increment: 15 })
  })

  it('appends guide:hook_complete to the SSE stream on step 2', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))

    await completeStep(mockUserId, 2)

    const sseCall = mockAppendToStream.mock.calls.find(([ch]) => ch === 'guide:hook_complete')
    expect(sseCall).toBeDefined()
    expect(sseCall[2]).toEqual({ userId: mockUserId })
  })

  it('does NOT award Hook reward on any other step (not step 1, 3, 4, 5, 6, 7)', async () => {
    for (const step of [1, 3, 4, 5, 6]) {
      db.user.findUnique.mockResolvedValue(mockUserWithProgress(
        Array.from({ length: step - 1 }, (_, i) => i + 1)
      ))
      vi.clearAllMocks()
      db.systemConfig.findUnique.mockResolvedValue(null)
      db.user.update.mockResolvedValue({})

      await completeStep(mockUserId, step)

      const tcGrant = db.user.update.mock.calls.find(([args]) => args.data?.creditsTc)
      // Only step 2 (Hook) and step 7 (Curriculum) grant TC
      expect(tcGrant, `step ${step} should not grant Hook TC`).toBeUndefined()
    }
  })
})

// ── Rewards — step 7 (end of Curriculum) + Specialize start ───────────────────

describe('completeStep — Curriculum reward + Specialize start on step 7', () => {
  it('awards +50 TC (default) when step 7 completes', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2, 3, 4, 5, 6]))

    await completeStep(mockUserId, 7)

    const tcGrant = db.user.update.mock.calls.find(([args]) => args.data?.creditsTc)
    expect(tcGrant[0].data.creditsTc).toEqual({ increment: 50 })
  })

  it('uses admin-configured reward amount if SystemConfig key is set', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2, 3, 4, 5, 6]))
    db.systemConfig.findUnique.mockImplementation(async ({ where: { key } }) => {
      if (key === 'guide.rewards.curriculumComplete') return { value: '100' }
      return null
    })

    await completeStep(mockUserId, 7)

    const tcGrant = db.user.update.mock.calls.find(([args]) => args.data?.creditsTc)
    expect(tcGrant[0].data.creditsTc).toEqual({ increment: 100 })
  })

  it('appends guide:curriculum_complete AND guide:specialize_start on step 7', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2, 3, 4, 5, 6]))

    await completeStep(mockUserId, 7)

    const sseChannels = mockAppendToStream.mock.calls.map(c => c[0])
    expect(sseChannels).toContain('guide:curriculum_complete')
    expect(sseChannels).toContain('guide:specialize_start')
  })
})

// ── restartJourney ────────────────────────────────────────────────────────────

describe('restartJourney', () => {
  it('clears completedSteps and dismissedAt', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2, 3], {
      otherKey: 'stays',
    }))

    await restartJourney(mockUserId)

    const call = db.user.update.mock.calls[0][0]
    expect(call.data.preferences.journeyProgress).toEqual({ completedSteps: [], dismissedAt: null })
    // Other prefs preserved
    expect(call.data.preferences.otherKey).toBe('stays')
  })

  it('is a no-op if user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    await restartJourney(mockUserId)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

// ── Defensive — errors are non-fatal ──────────────────────────────────────────

describe('completeStep — error handling', () => {
  it('returns false and does not throw when DB update fails', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))
    db.user.update.mockRejectedValue(new Error('DB offline'))

    const result = await completeStep(mockUserId, 1)
    expect(result).toBe(false)
  })

  it('step 7 reward failure does not propagate error', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2, 3, 4, 5, 6]))

    // First update (progress write) succeeds; second (TC grant) fails
    db.user.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('TC grant DB error'))

    const result = await completeStep(mockUserId, 7)
    expect(result).toBe(true)   // Still reports success — the step itself was recorded
  })
})
