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
    // Default tx mock: invoke the callback with `db` as `tx`. Tests that
    // need real serialisation (concurrent step credit) override this with
    // a queued implementation.
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(0),
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
  // Default $transaction mock — invoke callback with `db` as `tx` and return
  // its result. Concurrent-credit tests below override with a serial queue.
  db.$transaction.mockImplementation(async (fn) => fn(db))
  db.$executeRaw.mockResolvedValue(0)
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

// ── Error compounding (task #33) ──────────────────────────────────────────────
//
// The DB row is the source of truth; SSE is a notification layer. When SSE
// fails, the credit must still land — and conversely, when the reward DB
// write fails, the corresponding SSE celebration must NOT leak (otherwise
// a user could see a "+20 TC" popup with no actual TC). These tests pin
// the contract: durable state wins, SSE is best-effort, reward and reward-
// SSE are paired (both fire or neither does).

describe('completeStep — error compounding', () => {
  it('SSE failure on guide:journeyStep does NOT roll back the step credit', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))
    mockAppendToStream.mockRejectedValueOnce(new Error('redis down'))

    const result = await completeStep(mockUserId, 1)

    expect(result).toBe(true)   // step is credited despite SSE failure
    // Persistent state was written.
    const updateCall = db.user.update.mock.calls[0][0]
    expect(updateCall.data.preferences.journeyProgress.completedSteps).toEqual([1])
  })

  it('SSE failure on guide:hook_complete does NOT prevent the +20 TC reward grant', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))
    // Make ALL appendToStream calls fail — both the journeyStep and hook_complete events.
    mockAppendToStream.mockRejectedValue(new Error('redis offline'))

    const result = await completeStep(mockUserId, 2)

    expect(result).toBe(true)
    // Reward write happened — durable +20 TC even when SSE is down.
    const rewardCalls = db.user.update.mock.calls.filter(c =>
      c[0].data?.creditsTc?.increment !== undefined,
    )
    expect(rewardCalls).toHaveLength(1)
    expect(rewardCalls[0][0].data.creditsTc.increment).toBe(20)
  })

  it('reward DB write failure suppresses the guide:hook_complete SSE (no torn celebration)', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))

    // First update = step write (succeeds), second update = reward (fails).
    db.user.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('TC grant failed'))

    const result = await completeStep(mockUserId, 2)
    expect(result).toBe(true)   // step itself is recorded

    // guide:journeyStep fires (the step credit succeeded), but
    // guide:hook_complete does NOT fire — we don't want the popup
    // celebrating a reward that never landed.
    const channels = mockAppendToStream.mock.calls.map(c => c[0])
    expect(channels).toContain('guide:journeyStep')
    expect(channels).not.toContain('guide:hook_complete')
  })

  it('reward DB write failure suppresses guide:curriculum_complete + guide:specialize_start', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1, 2, 3, 4, 5, 6]))
    db.user.update
      .mockResolvedValueOnce({})                                // step 7 write
      .mockRejectedValueOnce(new Error('TC grant failed'))      // reward write

    const result = await completeStep(mockUserId, 7)
    expect(result).toBe(true)

    const channels = mockAppendToStream.mock.calls.map(c => c[0])
    expect(channels).toContain('guide:journeyStep')
    expect(channels).not.toContain('guide:curriculum_complete')
    expect(channels).not.toContain('guide:specialize_start')
  })

  it('SystemConfig lookup failure falls through to defaults (no crash)', async () => {
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))
    db.systemConfig.findUnique.mockRejectedValue(new Error('config table offline'))

    const result = await completeStep(mockUserId, 2)

    // SystemConfig is read TWICE: once for the v1.enabled gate (top of
    // completeStep), once for the reward amount (inside _handleHookComplete).
    // Both should fail-soft — first failure causes completeStep to return
    // false (caught by the outer try/catch), so no step is credited at all.
    // This test pins that error containment: the function returns gracefully,
    // doesn't throw, and the user is left in a clean state.
    expect(result).toBe(false)
    // No step write happened (the gate failed before the credit code path).
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('persisted state is the source of truth: getJourneyProgress returns the credited step even if SSE is down', async () => {
    let currentSteps = []
    db.user.findUnique.mockImplementation(async () =>
      mockUserWithProgress(currentSteps),
    )
    db.user.update.mockImplementation(async ({ data }) => {
      const next = data?.preferences?.journeyProgress?.completedSteps
      if (Array.isArray(next)) currentSteps = next
      return {}
    })
    mockAppendToStream.mockRejectedValue(new Error('SSE down'))

    await completeStep(mockUserId, 1)

    // Even with SSE permanently broken, the next hydration sees the credit.
    const prog = await getJourneyProgress(mockUserId)
    expect(prog.completedSteps).toEqual([1])
  })
})

// ── Concurrency — multi-tab / multi-pod race ──────────────────────────────────
//
// Two simultaneous completeStep(userId, N) calls (e.g., two browser tabs both
// finishing PvAI games at the same instant, or two backend pods both reacting
// to a tournament:completed event) must NOT double-credit the step or pay the
// phase-boundary reward twice. The fix uses `db.$transaction` with a
// per-user advisory lock so one call serialises behind the other; the second
// finds the step already done and returns false. See journeyService.completeStep.
//
// In unit tests we can't take a real Postgres lock, so we simulate it: the
// $transaction mock runs callbacks in series (FIFO queue), and the user-row
// state mutates between calls so the second observer sees the post-write
// completedSteps. This proves the contract holds when the implementation
// actually goes through $transaction.

describe('completeStep — concurrent calls (multi-tab / multi-pod race)', () => {
  // Build a serial-tx mock that mutates a shared user row between calls. This
  // models Postgres' "second SELECT FOR UPDATE waits for the first to commit,
  // then sees the new row" without needing a real DB.
  function setupSerialTxWithRow(initialSteps) {
    let currentSteps = [...initialSteps]
    let creditsTc    = 0

    db.user.findUnique.mockImplementation(async () =>
      mockUserWithProgress(currentSteps),
    )
    db.user.update.mockImplementation(async ({ data }) => {
      // Step-progress write
      const next = data?.preferences?.journeyProgress?.completedSteps
      if (Array.isArray(next)) currentSteps = next
      // Reward write (separate update call)
      if (data?.creditsTc?.increment) creditsTc += data.creditsTc.increment
      return {}
    })

    // FIFO queue: every $transaction call awaits the previous one before
    // invoking its callback. This serialises the read-modify-write.
    let prior = Promise.resolve()
    db.$transaction.mockImplementation(async (fn) => {
      const queueSlot = prior.then(() => fn(db))
      prior = queueSlot.catch(() => {})  // never break the chain on error
      return queueSlot
    })

    return {
      getSteps:   () => currentSteps,
      getCreditsTc: () => creditsTc,
    }
  }

  it('issues a per-user pg_advisory_xact_lock inside the credit transaction', async () => {
    // Pin the lock SQL so a refactor can't silently weaken it. The lock
    // key MUST hash on the userId so different users don't queue behind
    // each other (they have independent journey rows).
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([1]))

    await completeStep(mockUserId, 2)

    // Tagged-template invocation: the first arg to `$executeRaw` is the
    // template strings array, then interpolated values. We assert on the
    // joined SQL text and the userId interpolation.
    expect(db.$executeRaw).toHaveBeenCalled()
    const [strings, ...values] = db.$executeRaw.mock.calls[0]
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings)
    expect(sql).toMatch(/pg_advisory_xact_lock\s*\(\s*hashtext\(/)
    expect(values[0]).toBe(mockUserId)
  })

  it('two concurrent completeStep(userId, 2) calls credit step 2 exactly once', async () => {
    const probe = setupSerialTxWithRow([1])   // pre-state: only step 1 done

    const [r1, r2] = await Promise.all([
      completeStep(mockUserId, 2),
      completeStep(mockUserId, 2),
    ])

    // Exactly one call wins the race; the other is a no-op (idempotent).
    expect([r1, r2].sort()).toEqual([false, true])

    // Step 2 ends up in completedSteps once, not twice (and array is sorted).
    expect(probe.getSteps()).toEqual([1, 2])
  })

  it('Hook reward (+20 TC) is paid exactly once even with concurrent step-2 credits', async () => {
    const probe = setupSerialTxWithRow([1])

    await Promise.all([
      completeStep(mockUserId, 2),
      completeStep(mockUserId, 2),
    ])

    // The race regression: pre-fix both calls passed the dedup check and
    // both fired _handleHookComplete → +40 TC. Post-fix exactly one pays.
    expect(probe.getCreditsTc()).toBe(20)
  })

  it('Curriculum reward (+50 TC) is paid exactly once even with concurrent step-7 credits', async () => {
    const probe = setupSerialTxWithRow([1, 2, 3, 4, 5, 6])

    await Promise.all([
      completeStep(mockUserId, 7),
      completeStep(mockUserId, 7),
    ])

    expect(probe.getCreditsTc()).toBe(50)
  })

  it('SSE events fire once per concurrent credit, not per call', async () => {
    setupSerialTxWithRow([1])

    await Promise.all([
      completeStep(mockUserId, 2),
      completeStep(mockUserId, 2),
    ])

    const journeyStepEvents = mockAppendToStream.mock.calls.filter(c => c[0] === 'guide:journeyStep')
    const hookCompleteEvents = mockAppendToStream.mock.calls.filter(c => c[0] === 'guide:hook_complete')
    expect(journeyStepEvents).toHaveLength(1)
    expect(hookCompleteEvents).toHaveLength(1)
  })

  it('three concurrent calls still credit exactly once', async () => {
    const probe = setupSerialTxWithRow([1])

    const results = await Promise.all([
      completeStep(mockUserId, 2),
      completeStep(mockUserId, 2),
      completeStep(mockUserId, 2),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)   // exactly one wins
    expect(probe.getSteps()).toEqual([1, 2])
    expect(probe.getCreditsTc()).toBe(20)
  })
})

// ── Hydration race (task #29) ─────────────────────────────────────────────────
//
// While a step credit is in flight, a parallel GET /guide/preferences (which
// calls getJourneyProgress under the hood) MUST return a snapshot-consistent
// view: either the pre-credit state or the post-credit state, never a torn
// in-between (e.g., completedSteps containing undefined, or the step present
// without its accompanying sort). This is automatically true today thanks
// to row-level atomicity in Postgres + our advisory-lock-guarded transaction,
// but a future refactor that splits the journeyProgress write into multiple
// statements would silently break it. Pin the contract so that change shows
// up as a test failure.

describe('getJourneyProgress — hydration during in-flight credit (race)', () => {
  it('returns post-credit state when hydration runs after commit', async () => {
    let currentSteps = [1]
    db.user.findUnique.mockImplementation(async () =>
      mockUserWithProgress(currentSteps),
    )
    db.user.update.mockImplementation(async ({ data }) => {
      const next = data?.preferences?.journeyProgress?.completedSteps
      if (Array.isArray(next)) currentSteps = next
      return {}
    })
    db.$transaction.mockImplementation(async (fn) => fn(db))

    await completeStep(mockUserId, 2)
    const prog = await getJourneyProgress(mockUserId)

    expect(prog.completedSteps).toEqual([1, 2])
    expect(prog.dismissedAt).toBeNull()
  })

  it('returns pre-credit state when hydration runs before the tx commits', async () => {
    let currentSteps = [1]
    db.user.findUnique.mockImplementation(async () =>
      mockUserWithProgress(currentSteps),
    )
    db.user.update.mockImplementation(async ({ data }) => {
      const next = data?.preferences?.journeyProgress?.completedSteps
      if (Array.isArray(next)) currentSteps = next
      return {}
    })

    // Gate the credit's transaction callback so we can interleave hydration
    // BEFORE it runs (and therefore before the user-row mutation).
    let releaseCredit
    const creditGate = new Promise((r) => { releaseCredit = r })
    db.$transaction.mockImplementation(async (fn) => {
      await creditGate
      return fn(db)
    })

    const creditPromise = completeStep(mockUserId, 2)

    // Hydration while the credit transaction is parked — must see pre-state.
    const progBefore = await getJourneyProgress(mockUserId)
    expect(progBefore.completedSteps).toEqual([1])

    // Release the credit and confirm the post-state landed.
    releaseCredit()
    await creditPromise

    const progAfter = await getJourneyProgress(mockUserId)
    expect(progAfter.completedSteps).toEqual([1, 2])
  })

  it('non-monotonic credit: step 6 alone (no prior steps) credits successfully (task #32 policy)', async () => {
    // Decision recorded in doc/Intelligent_Guide_Implementation_Plan.md §8:
    // out-of-order step completion is allowed at the service layer; only
    // dedup is enforced. A user who registers for a tournament before
    // sparring legitimately credits step 6 first.
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([]))

    const result = await completeStep(mockUserId, 6)

    expect(result).toBe(true)
    const call = db.user.update.mock.calls[0][0]
    expect(call.data.preferences.journeyProgress.completedSteps).toEqual([6])
  })

  it('non-monotonic credit: step 7 with only step 6 done fires both reward + Specialize SSE', async () => {
    // Even though steps 1-5 are skipped, the curriculum-complete reward
    // and Specialize-start event MUST fire — the trigger semantics are
    // about *this* event, not about prior state.
    db.user.findUnique.mockResolvedValue(mockUserWithProgress([6]))

    const result = await completeStep(mockUserId, 7)

    expect(result).toBe(true)
    const sseChannels = mockAppendToStream.mock.calls.map(c => c[0])
    expect(sseChannels).toContain('guide:curriculum_complete')
    expect(sseChannels).toContain('guide:specialize_start')

    // Reward update was issued (creditsTc.increment).
    const rewardCalls = db.user.update.mock.calls.filter(c =>
      c[0].data?.creditsTc?.increment !== undefined,
    )
    expect(rewardCalls).toHaveLength(1)
    expect(rewardCalls[0][0].data.creditsTc.increment).toBe(50)
  })

  it('returns stored state for a long-abandoned user with NO side effects (resume after 30+ days)', async () => {
    // Simulate a user who completed steps 1-3 a month ago and is just now
    // returning. The row is stale (long updatedAt gap) but the data is intact.
    db.user.findUnique.mockResolvedValue({
      id: mockUserId,
      preferences: {
        journeyProgress: { completedSteps: [1, 2, 3], dismissedAt: null },
      },
    })

    const prog = await getJourneyProgress(mockUserId)

    // Hydration returns the persisted state verbatim — no time-based decay.
    expect(prog.completedSteps).toEqual([1, 2, 3])
    expect(prog.dismissedAt).toBeNull()

    // Crucially: hydration is read-only. No spurious writes (e.g., a stale
    // "auto-credit step 1 on first load" pattern), no SSE events fired.
    expect(db.user.update).not.toHaveBeenCalled()
    expect(mockAppendToStream).not.toHaveBeenCalled()
  })

  it('parallel hydrations during in-flight credit return only pre- or post-state, never torn', async () => {
    let currentSteps = [1]
    db.user.findUnique.mockImplementation(async () =>
      mockUserWithProgress(currentSteps),
    )
    db.user.update.mockImplementation(async ({ data }) => {
      const next = data?.preferences?.journeyProgress?.completedSteps
      if (Array.isArray(next)) currentSteps = next
      return {}
    })
    db.$transaction.mockImplementation(async (fn) => fn(db))

    // Fire credit + 5 hydrations in the same microtask. Each hydration must
    // see a coherent completedSteps array — never undefined, never a partial
    // mutation. Some will see [1] (pre), some [1, 2] (post), but every read
    // must be one of those two snapshots.
    const [, ...hydrations] = await Promise.all([
      completeStep(mockUserId, 2),
      getJourneyProgress(mockUserId),
      getJourneyProgress(mockUserId),
      getJourneyProgress(mockUserId),
      getJourneyProgress(mockUserId),
      getJourneyProgress(mockUserId),
    ])

    for (const prog of hydrations) {
      expect(Array.isArray(prog.completedSteps)).toBe(true)
      expect(prog.completedSteps.every(s => Number.isInteger(s) && s >= 1 && s <= 7)).toBe(true)
      // Coherent snapshot — either fully pre-credit or fully post-credit.
      const isPre  = prog.completedSteps.length === 1 && prog.completedSteps[0] === 1
      const isPost = prog.completedSteps.length === 2 && prog.completedSteps[0] === 1 && prog.completedSteps[1] === 2
      expect(isPre || isPost).toBe(true)
    }
  })
})
