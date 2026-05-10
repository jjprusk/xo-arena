// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { nextOccurrences, advanceOne } from '../recurrence.js'

const NOW = new Date('2026-05-10T12:00:00Z')

describe('advanceOne', () => {
  it('adds 24h for DAILY', () => {
    const d = new Date('2026-05-10T00:00:00Z')
    expect(advanceOne(d, 'DAILY').toISOString()).toBe('2026-05-11T00:00:00.000Z')
  })
  it('adds 7d for WEEKLY', () => {
    const d = new Date('2026-05-10T00:00:00Z')
    expect(advanceOne(d, 'WEEKLY').toISOString()).toBe('2026-05-17T00:00:00.000Z')
  })
  it('adds one month for MONTHLY', () => {
    const d = new Date('2026-05-10T00:00:00Z')
    expect(advanceOne(d, 'MONTHLY').toISOString()).toBe('2026-06-10T00:00:00.000Z')
  })
  it('returns null for unknown interval', () => {
    expect(advanceOne(new Date(), 'YEARLY')).toBeNull()
  })
})

describe('nextOccurrences', () => {
  it('returns 5 weekly occurrences when start is in the past', () => {
    const out = nextOccurrences({
      recurrenceStart: '2026-04-15T18:00:00Z',
      recurrenceInterval: 'WEEKLY',
      now: NOW,
      count: 5,
    })
    expect(out).toHaveLength(5)
    expect(out[0].getTime()).toBeGreaterThan(NOW.getTime())
    // Each step should be exactly 7 days apart.
    for (let i = 1; i < out.length; i++) {
      expect(out[i] - out[i - 1]).toBe(7 * 24 * 60 * 60 * 1000)
    }
  })

  it('starts at recurrenceStart when it is in the future', () => {
    const start = '2026-05-15T18:00:00Z'
    const [first] = nextOccurrences({
      recurrenceStart: start,
      recurrenceInterval: 'DAILY',
      now: NOW,
      count: 1,
    })
    expect(first.toISOString()).toBe('2026-05-15T18:00:00.000Z')
  })

  it('returns [] when paused', () => {
    expect(nextOccurrences({
      recurrenceStart: '2026-04-15T18:00:00Z',
      recurrenceInterval: 'WEEKLY',
      paused: true,
      now: NOW,
    })).toEqual([])
  })

  it('returns [] when end date already passed', () => {
    expect(nextOccurrences({
      recurrenceStart: '2026-01-01T00:00:00Z',
      recurrenceInterval: 'WEEKLY',
      recurrenceEndDate: '2026-04-01T00:00:00Z',
      now: NOW,
    })).toEqual([])
  })

  it('truncates at end date mid-series', () => {
    // Two more weekly slots within end window from NOW.
    const out = nextOccurrences({
      recurrenceStart: '2026-04-15T18:00:00Z',
      recurrenceInterval: 'WEEKLY',
      recurrenceEndDate: '2026-05-29T00:00:00Z',
      now: NOW,
      count: 10,
    })
    expect(out).toHaveLength(3) // 5/13, 5/20, 5/27 — 6/3 falls after end date
    out.forEach(d => expect(d.getTime()).toBeLessThanOrEqual(new Date('2026-05-29T00:00:00Z').getTime()))
  })

  it('returns [] for missing inputs', () => {
    expect(nextOccurrences({ recurrenceStart: null, recurrenceInterval: 'DAILY', now: NOW })).toEqual([])
    expect(nextOccurrences({ recurrenceStart: '2026-04-15T00:00:00Z', recurrenceInterval: null, now: NOW })).toEqual([])
  })
})
