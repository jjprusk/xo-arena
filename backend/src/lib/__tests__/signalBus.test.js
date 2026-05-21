// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initSignalBus,
  requestPause, requestCancel,
  clearPause, clearCancel,
  isPaused, isCancelled,
  _closeSignalBusForTests,
  _signalBusModeForTests,
} from '../signalBus.js'

// In-memory mode is the only mode unit-testable without a live Redis;
// the redis-mode wiring is exercised by the local smoke and the
// 3-session parallel crash-recovery harness (which we don't want to
// duplicate as a vitest spec — it spins up the full backend + worker).

describe('signalBus — in-memory mode', () => {
  beforeEach(async () => {
    await _closeSignalBusForTests()
    await initSignalBus({ mode: 'memory' })
  })
  afterEach(async () => {
    await _closeSignalBusForTests()
  })

  it('reports the configured mode', () => {
    expect(_signalBusModeForTests()).toBe('memory')
  })

  it('pause: raise → read → clear', () => {
    expect(isPaused('s1')).toBe(false)
    requestPause('s1')
    expect(isPaused('s1')).toBe(true)
    clearPause('s1')
    expect(isPaused('s1')).toBe(false)
  })

  it('cancel: raise → read → clear', () => {
    expect(isCancelled('s2')).toBe(false)
    requestCancel('s2')
    expect(isCancelled('s2')).toBe(true)
    clearCancel('s2')
    expect(isCancelled('s2')).toBe(false)
  })

  it('isolates sessions — one session\'s flag does not affect another', () => {
    requestPause('a')
    requestCancel('b')
    expect(isPaused('a')).toBe(true)
    expect(isPaused('b')).toBe(false)
    expect(isCancelled('a')).toBe(false)
    expect(isCancelled('b')).toBe(true)
  })

  it('initSignalBus is idempotent for the same mode', async () => {
    await initSignalBus({ mode: 'memory' })  // second call with same mode = no-op
    expect(_signalBusModeForTests()).toBe('memory')
  })

  it('initSignalBus throws if called with a different mode after init', async () => {
    await expect(initSignalBus({ mode: 'redis', redisUrl: 'redis://unused' }))
      .rejects.toThrow(/cannot switch to/)
  })
})
