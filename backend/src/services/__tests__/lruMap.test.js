import { describe, it, expect } from 'vitest'
import { LRUMap } from '../mlService.js'

describe('LRUMap', () => {
  it('stores and retrieves values', () => {
    const m = new LRUMap(5)
    m.set('a', 1)
    expect(m.has('a')).toBe(true)
    expect(m.get('a')).toBe(1)
  })

  it('returns undefined for missing keys', () => {
    const m = new LRUMap(5)
    expect(m.get('nope')).toBeUndefined()
    expect(m.has('nope')).toBe(false)
  })

  it('evicts the least-recently-used entry when at capacity', () => {
    const m = new LRUMap(3)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3)
    // 'a' is LRU — adding 'd' should evict it
    m.set('d', 4)
    expect(m.has('a')).toBe(false)
    expect(m.has('b')).toBe(true)
    expect(m.has('c')).toBe(true)
    expect(m.has('d')).toBe(true)
  })

  it('get promotes entry so it is not evicted', () => {
    const m = new LRUMap(3)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3)
    // Access 'a' — now 'b' becomes LRU
    m.get('a')
    m.set('d', 4)
    expect(m.has('a')).toBe(true)
    expect(m.has('b')).toBe(false)   // 'b' was LRU
    expect(m.has('c')).toBe(true)
    expect(m.has('d')).toBe(true)
  })

  it('re-setting an existing key refreshes its position', () => {
    const m = new LRUMap(3)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3)
    // Re-set 'a' — now 'b' is LRU
    m.set('a', 99)
    m.set('d', 4)
    expect(m.get('a')).toBe(99)
    expect(m.has('b')).toBe(false)
    expect(m.has('c')).toBe(true)
    expect(m.has('d')).toBe(true)
  })

  it('delete removes an entry', () => {
    const m = new LRUMap(5)
    m.set('a', 1)
    m.set('b', 2)
    expect(m.delete('a')).toBe(true)
    expect(m.has('a')).toBe(false)
    expect(m.has('b')).toBe(true)
  })

  it('delete returns false for missing keys', () => {
    const m = new LRUMap(5)
    expect(m.delete('x')).toBe(false)
  })

  it('does not evict when delete frees up space', () => {
    const m = new LRUMap(3)
    m.set('a', 1)
    m.set('b', 2)
    m.set('c', 3)
    m.delete('a')
    m.set('d', 4)   // should fit without evicting anything
    expect(m.has('b')).toBe(true)
    expect(m.has('c')).toBe(true)
    expect(m.has('d')).toBe(true)
  })

  it('handles maxSize of 1', () => {
    const m = new LRUMap(1)
    m.set('a', 1)
    m.set('b', 2)
    expect(m.has('a')).toBe(false)
    expect(m.get('b')).toBe(2)
  })
})
