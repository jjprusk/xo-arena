// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the chunk-3 F1 seat-release helpers.
 *
 * The helpers themselves are pure — these tests pin the contract so the
 * COMPLETED-transition sites in socketHandler/admin/GC can rely on the
 * shape (no mutation, occupied → empty + nulled identity, non-occupied
 * seats untouched).
 */

import { describe, it, expect } from 'vitest'
import { releaseSeats, releaseSeatForUser } from '../tableSeats.js'

describe('releaseSeats', () => {
  it('flips every occupied seat to empty and nulls userId/displayName', () => {
    const seats = [
      { userId: 'u1', status: 'occupied', displayName: 'Alice' },
      { userId: 'u2', status: 'occupied', displayName: 'Bob' },
    ]
    const result = releaseSeats(seats)
    expect(result).toEqual([
      { userId: null, status: 'empty', displayName: null },
      { userId: null, status: 'empty', displayName: null },
    ])
  })

  it('does not mutate the input array', () => {
    const seats = [{ userId: 'u1', status: 'occupied', displayName: 'Alice' }]
    const snapshot = JSON.stringify(seats)
    releaseSeats(seats)
    expect(JSON.stringify(seats)).toBe(snapshot)
  })

  it('leaves already-empty seats untouched', () => {
    const seats = [
      { userId: null, status: 'empty' },
      { userId: 'u2', status: 'occupied', displayName: 'Bob' },
    ]
    const result = releaseSeats(seats)
    expect(result[0]).toBe(seats[0])  // referentially identical
    expect(result[1]).toEqual({ userId: null, status: 'empty', displayName: null })
  })

  it('returns the input unchanged when given a non-array', () => {
    expect(releaseSeats(null)).toBe(null)
    expect(releaseSeats(undefined)).toBe(undefined)
  })
})

describe('releaseSeatForUser', () => {
  it('clears only the seat for the given userId', () => {
    const seats = [
      { userId: 'u1', status: 'occupied', displayName: 'Alice' },
      { userId: 'u2', status: 'occupied', displayName: 'Bob' },
    ]
    const result = releaseSeatForUser(seats, 'u1')
    expect(result[0]).toEqual({ userId: null, status: 'empty', displayName: null })
    expect(result[1]).toBe(seats[1])  // untouched
  })

  it('is a no-op when the userId is not seated', () => {
    const seats = [
      { userId: 'u1', status: 'occupied', displayName: 'Alice' },
      { userId: null, status: 'empty' },
    ]
    const result = releaseSeatForUser(seats, 'u-not-here')
    expect(result[0]).toBe(seats[0])
    expect(result[1]).toBe(seats[1])
  })

  it('returns input unchanged when userId is falsy', () => {
    const seats = [{ userId: 'u1', status: 'occupied' }]
    expect(releaseSeatForUser(seats, null)).toBe(seats)
    expect(releaseSeatForUser(seats, undefined)).toBe(seats)
  })

  it('returns input unchanged when seats is not an array', () => {
    expect(releaseSeatForUser(null, 'u1')).toBe(null)
  })
})
