import { describe, it, expect, beforeEach } from 'vitest'
import { MountainNamePool } from '../mountainNames.js'

const TEST_NAMES = ['Everest', 'K2', 'Kangchenjunga', 'Lhotse', 'Makalu']

describe('MountainNamePool', () => {
  let pool

  beforeEach(() => {
    pool = new MountainNamePool([...TEST_NAMES])
  })

  it('acquires a name from the pool', () => {
    const name = pool.acquire()
    expect(TEST_NAMES).toContain(name)
  })

  it('reduces available count on acquire', () => {
    pool.acquire()
    expect(pool.available).toBe(TEST_NAMES.length - 1)
  })

  it('returns null when pool exhausted', () => {
    for (let i = 0; i < TEST_NAMES.length; i++) pool.acquire()
    expect(pool.acquire()).toBeNull()
  })

  it('releases name back to pool', () => {
    const name = pool.acquire()
    pool.release(name)
    expect(pool.available).toBe(TEST_NAMES.length)
  })

  it('swap returns a different name', () => {
    const first = pool.acquire()
    const second = pool.swap(first)
    expect(second).not.toBe(first)
    expect(TEST_NAMES).toContain(second)
  })

  it('toSlug formats correctly', () => {
    expect(MountainNamePool.toSlug('Everest')).toBe('mt-everest')
    expect(MountainNamePool.toSlug('K2')).toBe('mt-k2')
  })

  it('fromSlug formats correctly', () => {
    expect(MountainNamePool.fromSlug('mt-everest')).toBe('Mt. Everest')
  })
})
