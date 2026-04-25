// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readGuestJourney,
  recordGuestHookStep1,
  recordGuestHookStep2,
  clearGuestJourney,
  hasGuestProgress,
} from '../guestMode.js'

const KEY = 'guideGuestJourney'

beforeEach(() => {
  window.localStorage.clear()
})

describe('guestMode — read/write/clear', () => {
  it('readGuestJourney returns {} when nothing stored', () => {
    expect(readGuestJourney()).toEqual({})
  })

  it('readGuestJourney returns {} on malformed JSON without throwing', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(readGuestJourney()).toEqual({})
  })

  it('readGuestJourney returns {} when stored value is not an object', () => {
    window.localStorage.setItem(KEY, JSON.stringify('a string'))
    expect(readGuestJourney()).toEqual({})
  })

  it('recordGuestHookStep1 writes an ISO timestamp', () => {
    recordGuestHookStep1()
    const stored = readGuestJourney()
    expect(typeof stored.hookStep1CompletedAt).toBe('string')
    expect(() => new Date(stored.hookStep1CompletedAt).toISOString()).not.toThrow()
  })

  it('recordGuestHookStep1 is idempotent — second call preserves the original timestamp', () => {
    recordGuestHookStep1()
    const first = readGuestJourney().hookStep1CompletedAt
    recordGuestHookStep1()
    expect(readGuestJourney().hookStep1CompletedAt).toBe(first)
  })

  it('recordGuestHookStep2 is idempotent and orthogonal to step 1', () => {
    recordGuestHookStep1()
    recordGuestHookStep2()
    const snapshot = readGuestJourney()
    expect(snapshot.hookStep1CompletedAt).toBeTruthy()
    expect(snapshot.hookStep2CompletedAt).toBeTruthy()
    const before = snapshot.hookStep2CompletedAt
    recordGuestHookStep2()
    expect(readGuestJourney().hookStep2CompletedAt).toBe(before)
  })

  it('clearGuestJourney wipes the entry', () => {
    recordGuestHookStep1()
    recordGuestHookStep2()
    clearGuestJourney()
    expect(readGuestJourney()).toEqual({})
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})

describe('guestMode — hasGuestProgress', () => {
  it('returns false when nothing recorded', () => {
    expect(hasGuestProgress()).toBe(false)
  })

  it('returns true after step 1', () => {
    recordGuestHookStep1()
    expect(hasGuestProgress()).toBe(true)
  })

  it('returns true after step 2 only', () => {
    recordGuestHookStep2()
    expect(hasGuestProgress()).toBe(true)
  })

  it('returns false after clear', () => {
    recordGuestHookStep1()
    clearGuestJourney()
    expect(hasGuestProgress()).toBe(false)
  })
})
