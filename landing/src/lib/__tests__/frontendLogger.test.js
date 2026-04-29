// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * frontendLogger — feeds the admin Log Viewer (POST /api/v1/logs).
 *
 * Why this matters: the viewer rendered the empty state for as long as it
 * existed because no producer wired up after the Phase-3.0 frontend cleanup
 * deleted the original logger. This suite locks in the contract that makes
 * the viewer functional going forward.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  flogger, setLogUserId, _resetForTests, _internal,
} from '../frontendLogger.js'

const okResponse = () => ({ ok: true, status: 204 })

beforeEach(() => {
  _resetForTests()
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => okResponse()))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('frontendLogger', () => {
  it('queues INFO/WARN entries and flushes on the 5s tick', async () => {
    flogger.info('warming up')
    flogger.warn('odd', { tag: 'x' })
    expect(fetch).not.toHaveBeenCalled()
    expect(_internal.getQueue()).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, opts] = fetch.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0]).toMatchObject({ level: 'INFO', source: 'frontend', message: 'warming up' })
    expect(body.entries[1]).toMatchObject({ level: 'WARN', message: 'odd', meta: { tag: 'x' } })
    expect(_internal.getQueue()).toHaveLength(0)
  })

  it('flushes ERROR/FATAL immediately and includes pending queued entries', async () => {
    flogger.info('queued first')
    flogger.error('boom', { stack: 's' })

    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    // ERROR rides alongside the queued INFO so a single fetch carries both.
    expect(body.entries.map(e => e.level)).toEqual(['INFO', 'ERROR'])
    expect(body.entries[1]).toMatchObject({ message: 'boom', meta: { stack: 's' } })
    expect(_internal.getQueue()).toHaveLength(0)
  })

  it('parks failed entries on the retry queue and drains them on the next tick', async () => {
    fetch
      .mockImplementationOnce(async () => { throw new Error('offline') })  // first flush fails
      .mockImplementationOnce(async () => okResponse())                    // second succeeds

    flogger.info('one')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(_internal.getRetry()).toHaveLength(1)
    expect(_internal.getQueue()).toHaveLength(0)

    flogger.info('two')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fetch).toHaveBeenCalledTimes(2)
    const body = JSON.parse(fetch.mock.calls[1][1].body)
    expect(body.entries.map(e => e.message)).toEqual(['one', 'two'])
    expect(_internal.getRetry()).toHaveLength(0)
  })

  it('setLogUserId tags subsequent entries (was a no-op in the legacy logger)', async () => {
    flogger.info('before sign-in')
    setLogUserId('usr_42')
    flogger.info('after sign-in')

    await vi.advanceTimersByTimeAsync(5_000)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.entries[0].userId).toBeNull()
    expect(body.entries[1].userId).toBe('usr_42')

    // Sign-out clears it back.
    setLogUserId(null)
    flogger.info('after sign-out')
    await vi.advanceTimersByTimeAsync(5_000)
    const body2 = JSON.parse(fetch.mock.calls[1][1].body)
    expect(body2.entries[0].userId).toBeNull()
  })

  it('coerces unknown levels to INFO so a typo never lands as a malformed row', async () => {
    flogger.debug('dbg')
    flogger.info('std')
    // Deliberately go around the public surface to exercise the level guard.
    flogger.info.call(null, 'still-info')
    await vi.advanceTimersByTimeAsync(5_000)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.entries.every(e => ['DEBUG','INFO','WARN','ERROR','FATAL'].includes(e.level))).toBe(true)
  })

  it('uses the correct endpoint and keepalive flag', async () => {
    flogger.error('boom')
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/logs')
    expect(opts.method).toBe('POST')
    expect(opts.keepalive).toBe(true)
    expect(opts.headers['Content-Type']).toBe('application/json')
  })
})
