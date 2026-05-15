// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { create } from 'zustand'
import { createHelpStoreImpl, TURN_STATUS, reviveThread } from '../helpStore.js'

/**
 * Build a fresh, unpersisted store with injectable streamer + feedback
 * poster. The persist middleware lives on the production `useHelpStore`
 * export; tests use this lower-level constructor to avoid stomping
 * sessionStorage between tests.
 */
function makeStore({ streamer, feedbackPoster } = {}) {
  return create(createHelpStoreImpl({
    streamer:       streamer       ?? (async function* () {}),
    feedbackPoster: feedbackPoster ?? vi.fn(),
  }))
}

async function flush() {
  // Let micro-tasks settle so async-generator state updates land before
  // we assert.
  await new Promise(r => setTimeout(r, 0))
}

describe('helpStore — sendQuestion happy path', () => {
  it('emits a pending turn, transitions to streaming on tokens, lands in done', async () => {
    const streamer = vi.fn(async function* () {
      yield { kind: 'token', text: 'Hello ' }
      yield { kind: 'token', text: 'world.' }
      yield {
        kind:                   'done',
        answerId:               'a-1',
        queryId:                'q-1',
        rendered:               'Hello world.',
        contentFilterTriggered: false,
        degraded:               false,
        latencyMs:              123,
      }
    })
    const store = makeStore({ streamer })

    const p = store.getState().sendQuestion({ question: 'hi', token: 't' })

    // The turn is created synchronously before the first await — it
    // starts in pending until the first token lands.
    expect(store.getState().thread).toHaveLength(1)
    expect(store.getState().thread[0].status).toBe(TURN_STATUS.PENDING)
    expect(store.getState().inFlightTurnId).toBe(store.getState().thread[0].id)

    await p

    const [turn] = store.getState().thread
    expect(turn.status).toBe(TURN_STATUS.DONE)
    expect(turn.rendered).toBe('Hello world.')
    expect(turn.partial).toBe('Hello world.')
    expect(turn.answerId).toBe('a-1')
    expect(turn.queryId).toBe('q-1')
    expect(turn.latencyMs).toBe(123)
    expect(store.getState().inFlightTurnId).toBeNull()
  })

  it('trims whitespace and rejects blank questions (returns null)', async () => {
    const streamer = vi.fn()
    const store = makeStore({ streamer })
    const result = await store.getState().sendQuestion({ question: '   ' })
    expect(result).toBeNull()
    expect(streamer).not.toHaveBeenCalled()
    expect(store.getState().thread).toHaveLength(0)
  })

  it('passes context through to the streamer', async () => {
    const streamer = vi.fn(async function* () {
      yield { kind: 'done', rendered: 'ok' }
    })
    const store = makeStore({ streamer })
    await store.getState().sendQuestion({
      question: 'hi', context: { route: '/play', gameType: 'xo' }, token: 'tt',
    })
    expect(streamer).toHaveBeenCalledOnce()
    expect(streamer.mock.calls[0][0]).toMatchObject({
      question: 'hi',
      context:  { route: '/play', gameType: 'xo' },
      token:    'tt',
    })
    expect(streamer.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back to partial text if the done frame omits rendered', async () => {
    const streamer = vi.fn(async function* () {
      yield { kind: 'token', text: 'partial' }
      yield { kind: 'done' }  // no rendered
    })
    const store = makeStore({ streamer })
    await store.getState().sendQuestion({ question: 'q' })
    expect(store.getState().thread[0].rendered).toBe('partial')
  })
})

describe('helpStore — sendQuestion error frames', () => {
  it('lands the turn in error on rate_limited and surfaces retryAfter', async () => {
    const streamer = vi.fn(async function* () {
      yield { kind: 'error', error: 'rate_limited', retryAfter: 7 }
    })
    const store = makeStore({ streamer })
    await store.getState().sendQuestion({ question: 'q' })
    const [turn] = store.getState().thread
    expect(turn.status).toBe(TURN_STATUS.ERROR)
    expect(turn.error).toBe('rate_limited')
    expect(turn.retryAfter).toBe(7)
    expect(store.getState().inFlightTurnId).toBeNull()
  })

  it('lands the turn in error on llm_unavailable', async () => {
    const streamer = vi.fn(async function* () {
      yield { kind: 'error', error: 'llm_unavailable' }
    })
    const store = makeStore({ streamer })
    await store.getState().sendQuestion({ question: 'q' })
    expect(store.getState().thread[0].error).toBe('llm_unavailable')
  })

  it('handles a streamer that throws — turn lands in error=internal', async () => {
    const streamer = vi.fn(() => {
      // Returns an async iterable that throws on first next().
      return {
        [Symbol.asyncIterator]() { return this },
        async next() { throw new Error('boom') },
      }
    })
    const store = makeStore({ streamer })
    await store.getState().sendQuestion({ question: 'q' })
    expect(store.getState().thread[0].error).toBe('internal')
    expect(store.getState().inFlightTurnId).toBeNull()
  })
})

describe('helpStore — concurrency', () => {
  it('rejects a second sendQuestion while one is in flight', async () => {
    let resolveFirst
    const firstDone = new Promise(r => { resolveFirst = r })
    const streamer = vi.fn(async function* () {
      await firstDone
      yield { kind: 'done', rendered: 'ok' }
    })
    const store = makeStore({ streamer })

    const p1 = store.getState().sendQuestion({ question: 'first' })
    // While the first is mid-flight, a second call must return null and
    // not enqueue a second turn.
    const r2 = await store.getState().sendQuestion({ question: 'second' })
    expect(r2).toBeNull()
    expect(store.getState().thread).toHaveLength(1)

    resolveFirst()
    await p1

    // After completion, a follow-up sendQuestion is allowed.
    const streamer2 = vi.fn(async function* () { yield { kind: 'done', rendered: 'b' } })
    const store2 = makeStore({ streamer: streamer2 })
    await store2.getState().sendQuestion({ question: 'a' })
    const id = await store2.getState().sendQuestion({ question: 'b' })
    expect(id).not.toBeNull()
    expect(store2.getState().thread).toHaveLength(2)
  })
})

describe('helpStore — cancelInFlight', () => {
  it('aborts the active stream and lands turn in error=aborted (via streamer)', async () => {
    let signalRef
    const streamer = vi.fn(async function* ({ signal }) {
      signalRef = signal
      // Simulate a streamer that respects AbortSignal — emits an aborted
      // error frame after abort.
      await new Promise(resolve => {
        if (signal.aborted) return resolve()
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { kind: 'error', error: 'aborted' }
    })
    const store = makeStore({ streamer })
    const p = store.getState().sendQuestion({ question: 'q' })
    // mid-flight cancel
    store.getState().cancelInFlight()
    expect(signalRef.aborted).toBe(true)
    await p
    expect(store.getState().thread[0].status).toBe(TURN_STATUS.ERROR)
    expect(store.getState().thread[0].error).toBe('aborted')
    expect(store.getState().inFlightTurnId).toBeNull()
  })

  it('cancelInFlight is a no-op when nothing is in flight', () => {
    const store = makeStore()
    expect(() => store.getState().cancelInFlight()).not.toThrow()
  })
})

describe('helpStore — §3.5 implicit followUpWithin60s', () => {
  it('fires followUpWithin60s for the prior turn when next question arrives within 60s', async () => {
    const streamer = vi.fn(async function* () { yield { kind: 'done', rendered: 'a' } })
    const feedbackPoster = vi.fn(async () => ({}))
    const store = makeStore({ streamer, feedbackPoster })

    // First turn done.
    await store.getState().sendQuestion({ question: 'q1' })
    const prior = store.getState().thread[0]
    expect(prior.status).toBe(TURN_STATUS.DONE)
    expect(prior.finishedAt).toBeTruthy()

    // Inject queryId/answerId since the canned done frame didn't include
    // them — needed for the followUpWithin60s POST to fire.
    useHelpStoreLike(store, t => ({ ...t, queryId: 'q-1', answerId: 'a-1' }))

    // Now ask a follow-up immediately (well within 60s).
    feedbackPoster.mockClear()
    await store.getState().sendQuestion({ question: 'q2' })

    // Implicit POST fired for the prior turn — fire-and-forget so we
    // don't await it; just verify the call shape.
    expect(feedbackPoster).toHaveBeenCalled()
    const [body] = feedbackPoster.mock.calls[0]
    expect(body).toMatchObject({
      queryId:  'q-1',
      answerId: 'a-1',
      implicit: { followUpWithin60s: true },
    })
  })

  it('does NOT fire followUpWithin60s when prior turn finished more than 60s ago', async () => {
    const streamer = vi.fn(async function* () { yield { kind: 'done', rendered: 'a' } })
    const feedbackPoster = vi.fn(async () => ({}))
    const store = makeStore({ streamer, feedbackPoster })

    await store.getState().sendQuestion({ question: 'q1' })
    // Reach into the turn and back-date its finishedAt to 61s ago.
    useHelpStoreLike(store, t => ({
      ...t,
      queryId:    'q-1',
      answerId:   'a-1',
      finishedAt: Date.now() - 61_000,
    }))

    feedbackPoster.mockClear()
    await store.getState().sendQuestion({ question: 'q2' })

    // The followUpWithin60s POST should not have fired.
    const followUpCall = feedbackPoster.mock.calls.find(
      c => c[0]?.implicit?.followUpWithin60s === true,
    )
    expect(followUpCall).toBeUndefined()
  })

  it('does NOT fire followUpWithin60s when prior turn was an error', async () => {
    const streamer = vi.fn(async function* () { yield { kind: 'error', error: 'llm_unavailable' } })
    const feedbackPoster = vi.fn(async () => ({}))
    const store = makeStore({ streamer, feedbackPoster })

    await store.getState().sendQuestion({ question: 'q1' })
    expect(store.getState().thread[0].status).toBe(TURN_STATUS.ERROR)

    // Now ask a follow-up — but prior was an error, not done.
    const streamer2 = vi.fn(async function* () { yield { kind: 'done', rendered: 'b' } })
    store.setState({ /* swap streamer impossible — we just verify no fire */ })

    feedbackPoster.mockClear()
    await store.getState().sendQuestion({ question: 'q2' })
    expect(feedbackPoster).not.toHaveBeenCalled()
  })

  it('does NOT fire followUpWithin60s on the first question (no prior)', async () => {
    const streamer = vi.fn(async function* () { yield { kind: 'done', rendered: 'a' } })
    const feedbackPoster = vi.fn(async () => ({}))
    const store = makeStore({ streamer, feedbackPoster })
    await store.getState().sendQuestion({ question: 'first' })
    expect(feedbackPoster).not.toHaveBeenCalled()
  })

  it('swallows feedbackPoster errors so the new question still proceeds', async () => {
    const streamer = vi.fn(async function* () { yield { kind: 'done', rendered: 'a' } })
    const feedbackPoster = vi.fn(async () => { throw new Error('endpoint down') })
    const store = makeStore({ streamer, feedbackPoster })

    await store.getState().sendQuestion({ question: 'q1' })
    useHelpStoreLike(store, t => ({ ...t, queryId: 'q-1', answerId: 'a-1' }))

    // Should not throw; should still create the new turn.
    const newId = await store.getState().sendQuestion({ question: 'q2' })
    expect(newId).not.toBeNull()
    expect(store.getState().thread).toHaveLength(2)
  })
})

// Tiny helper for the §3.5 tests — patches the LAST turn in the thread
// with the result of `fn(turn)`. Keeps the test bodies tidy.
function useHelpStoreLike(store, fn) {
  store.setState(s => ({
    thread: s.thread.map((t, i, arr) => (i === arr.length - 1 ? fn(t) : t)),
  }))
}

describe('helpStore — clearThread', () => {
  it('empties the thread and aborts any in-flight stream', async () => {
    let aborted = false
    const streamer = vi.fn(async function* ({ signal }) {
      await new Promise(resolve => {
        signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true })
      })
      yield { kind: 'error', error: 'aborted' }
    })
    const store = makeStore({ streamer })
    const p = store.getState().sendQuestion({ question: 'q' })
    store.getState().clearThread()
    expect(store.getState().thread).toEqual([])
    expect(store.getState().inFlightTurnId).toBeNull()
    expect(aborted).toBe(true)
    await p
  })
})

describe('helpStore — submitFeedback', () => {
  it('delegates to the injected feedbackPoster with the expected shape', async () => {
    const feedbackPoster = vi.fn(async () => ({ id: 'fb-1' }))
    const store = makeStore({ feedbackPoster })
    const result = await store.getState().submitFeedback({
      queryId:  'q-1',
      answerId: 'a-1',
      signal:   'HELPFUL',
      implicit: { docLinkClicked: true },
      token:    'tt',
    })
    expect(result).toEqual({ id: 'fb-1' })
    expect(feedbackPoster).toHaveBeenCalledOnce()
    expect(feedbackPoster.mock.calls[0][0]).toEqual({
      queryId: 'q-1', answerId: 'a-1', signal: 'HELPFUL',
      category: undefined, comment: undefined,
      implicit: { docLinkClicked: true },
    })
    expect(feedbackPoster.mock.calls[0][1]).toEqual({ token: 'tt' })
  })

  it('propagates errors from the poster', async () => {
    const feedbackPoster = vi.fn(async () => { throw new Error('http 500') })
    const store = makeStore({ feedbackPoster })
    await expect(store.getState().submitFeedback({
      queryId: 'q', answerId: 'a', signal: 'HELPFUL',
    })).rejects.toThrow(/http 500/)
  })
})

describe('helpStore — reviveThread (sessionStorage rehydrate path)', () => {
  it('returns [] for missing input', () => {
    expect(reviveThread(undefined)).toEqual([])
    expect(reviveThread(null)).toEqual([])
  })

  it('demotes pending/streaming turns to error=interrupted', () => {
    const out = reviveThread([
      { id: '1', question: 'a', status: 'pending',   finishedAt: null },
      { id: '2', question: 'b', status: 'streaming', finishedAt: null, partial: 'p' },
      { id: '3', question: 'c', status: 'done',      finishedAt: 123 },
      { id: '4', question: 'd', status: 'error',     finishedAt: 456, error: 'rate_limited' },
    ])
    expect(out[0].status).toBe('error')
    expect(out[0].error).toBe('interrupted')
    expect(out[1].status).toBe('error')
    expect(out[1].error).toBe('interrupted')
    // Terminal turns are passed through unchanged.
    expect(out[2]).toEqual({ id: '3', question: 'c', status: 'done', finishedAt: 123 })
    expect(out[3]).toEqual({ id: '4', question: 'd', status: 'error', finishedAt: 456, error: 'rate_limited' })
  })
})

describe('helpStore — sessionStorage round-trip via useHelpStore', () => {
  beforeEach(() => {
    // Ensure a clean slate between cases — the production module-level
    // singleton uses sessionStorage by name 'xo-help-thread'.
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.clear() } catch {}
    }
  })

  it('persists thread to sessionStorage and recovers it on store-module reload', async () => {
    // Dynamic import so we can vi.resetModules() between the two phases
    // and observe rehydrate-from-sessionStorage behaviour.
    vi.resetModules()
    const mod1 = await import('../helpStore.js')

    // We can't easily inject deps into the singleton (it's already built
    // with real streamer/poster). Instead, hand-craft a thread directly
    // via setState — exercises the persist pipeline.
    mod1.useHelpStore.setState({
      thread: [
        { id: 't1', question: 'why', status: 'done', rendered: 'because.', finishedAt: 10 },
        { id: 't2', question: 'mid', status: 'streaming', partial: 'half...', finishedAt: null },
      ],
      inFlightTurnId: 't2',
    })

    // Persist is async — flush a tick.
    await flush()
    const stored = window.sessionStorage.getItem('xo-help-thread')
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored)
    // Only the thread is persisted (partialize).
    expect(parsed.state).toHaveProperty('thread')
    expect(parsed.state.thread).toHaveLength(2)
    expect(parsed.state).not.toHaveProperty('inFlightTurnId')

    vi.resetModules()
    const mod2 = await import('../helpStore.js')
    await flush()
    // The streaming turn must be demoted to error=interrupted on rehydrate.
    const thread = mod2.useHelpStore.getState().thread
    expect(thread).toHaveLength(2)
    expect(thread[0].status).toBe('done')
    expect(thread[1].status).toBe('error')
    expect(thread[1].error).toBe('interrupted')
    // inFlightTurnId never persists — always null on rehydrate.
    expect(mod2.useHelpStore.getState().inFlightTurnId).toBeNull()
  })
})
