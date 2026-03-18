import { describe, it, expect } from 'vitest'
import registry from '../registry.js'

describe('AI Registry', () => {
  it('lists all registered implementations', () => {
    const list = registry.list()
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      supportedDifficulties: expect.any(Array),
    })
  })

  it('includes minimax by default', () => {
    expect(registry.has('minimax')).toBe(true)
  })

  it('get() returns the implementation', () => {
    const impl = registry.get('minimax')
    expect(impl).toBeTruthy()
    expect(typeof impl.move).toBe('function')
  })

  it('get() returns null for unknown id', () => {
    expect(registry.get('does-not-exist')).toBeNull()
  })

  it('has() returns false for unknown id', () => {
    expect(registry.has('does-not-exist')).toBe(false)
  })

  it('validIds() includes minimax', () => {
    expect(registry.validIds()).toContain('minimax')
  })

  it('rejects registration of impl missing required fields', () => {
    expect(() => registry.register({ id: 'bad' })).toThrow()
  })
})
