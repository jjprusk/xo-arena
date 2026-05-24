// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerActiveSession,
  unregisterActiveSession,
  getActiveSessions,
  _resetActiveSessionsForTests,
} from '../activeSessions.js'

describe('activeSessions registry (A3b.4)', () => {
  beforeEach(() => _resetActiveSessionsForTests())

  it('starts empty', () => {
    expect(getActiveSessions()).toEqual([])
  })

  it('registers and lists session ids', () => {
    registerActiveSession('s1')
    registerActiveSession('s2')
    expect(getActiveSessions().sort()).toEqual(['s1', 's2'])
  })

  it('deduplicates a re-registered id (Set semantics)', () => {
    registerActiveSession('s1')
    registerActiveSession('s1')
    expect(getActiveSessions()).toEqual(['s1'])
  })

  it('unregister removes only the requested id', () => {
    registerActiveSession('s1')
    registerActiveSession('s2')
    unregisterActiveSession('s1')
    expect(getActiveSessions()).toEqual(['s2'])
  })

  it('register/unregister are no-ops for falsy ids — never poisons the registry', () => {
    registerActiveSession(null)
    registerActiveSession(undefined)
    registerActiveSession('')
    expect(getActiveSessions()).toEqual([])
    unregisterActiveSession(null)
    expect(getActiveSessions()).toEqual([])
  })

  it('getActiveSessions returns a snapshot — iterating it is safe against concurrent unregister', () => {
    registerActiveSession('s1')
    registerActiveSession('s2')
    const snap = getActiveSessions()
    unregisterActiveSession('s1')
    expect(snap.sort()).toEqual(['s1', 's2'])    // snapshot unchanged
    expect(getActiveSessions()).toEqual(['s2'])  // live view reflects the change
  })
})
