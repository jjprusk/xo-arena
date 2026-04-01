import { describe, it, expect } from 'vitest'
import { VALID_ROLES } from '../roles.js'

describe('VALID_ROLES', () => {
  it('includes SUPPORT', () => {
    expect(VALID_ROLES).toContain('SUPPORT')
  })
})
