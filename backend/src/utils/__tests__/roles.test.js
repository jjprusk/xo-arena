import { describe, it, expect } from 'vitest'
import { hasRole, getRoles, VALID_ROLES } from '../roles.js'

const makeUser = (...roles) => ({
  userRoles: roles.map(role => ({ role })),
})

describe('hasRole', () => {
  it('returns false for null user', () => {
    expect(hasRole(null, 'BOT_ADMIN')).toBe(false)
  })

  it('returns false for undefined user', () => {
    expect(hasRole(undefined, 'BOT_ADMIN')).toBe(false)
  })

  it('returns false for user with no roles', () => {
    expect(hasRole(makeUser(), 'BOT_ADMIN')).toBe(false)
  })

  it('returns false when user has a different role', () => {
    expect(hasRole(makeUser('TOURNAMENT_ADMIN'), 'BOT_ADMIN')).toBe(false)
  })

  it('returns true when user has the exact role', () => {
    expect(hasRole(makeUser('BOT_ADMIN'), 'BOT_ADMIN')).toBe(true)
  })

  it('ADMIN implicitly satisfies BOT_ADMIN', () => {
    expect(hasRole(makeUser('ADMIN'), 'BOT_ADMIN')).toBe(true)
  })

  it('ADMIN implicitly satisfies TOURNAMENT_ADMIN', () => {
    expect(hasRole(makeUser('ADMIN'), 'TOURNAMENT_ADMIN')).toBe(true)
  })

  it('ADMIN implicitly satisfies ADMIN itself', () => {
    expect(hasRole(makeUser('ADMIN'), 'ADMIN')).toBe(true)
  })

  it('returns true when user has multiple roles including the requested one', () => {
    expect(hasRole(makeUser('BOT_ADMIN', 'TOURNAMENT_ADMIN'), 'TOURNAMENT_ADMIN')).toBe(true)
  })

  it('returns false when userRoles is missing from the user object', () => {
    expect(hasRole({}, 'BOT_ADMIN')).toBe(false)
  })
})

describe('getRoles', () => {
  it('returns empty array for null user', () => {
    expect(getRoles(null)).toEqual([])
  })

  it('returns empty array for user with no roles', () => {
    expect(getRoles(makeUser())).toEqual([])
  })

  it('returns all role strings', () => {
    const roles = getRoles(makeUser('ADMIN', 'BOT_ADMIN'))
    expect(roles).toContain('ADMIN')
    expect(roles).toContain('BOT_ADMIN')
    expect(roles).toHaveLength(2)
  })
})

describe('VALID_ROLES', () => {
  it('contains all expected roles', () => {
    expect(VALID_ROLES).toContain('ADMIN')
    expect(VALID_ROLES).toContain('BOT_ADMIN')
    expect(VALID_ROLES).toContain('TOURNAMENT_ADMIN')
  })
})
