import { describe, it, expect, beforeEach, vi } from 'vitest'
import cache from '../cache.js'

beforeEach(() => cache.clear())

describe('cache', () => {
  it('returns null for missing key', () => {
    expect(cache.get('missing')).toBeNull()
  })

  it('returns stored value within TTL', () => {
    cache.set('k', { data: 1 }, 1000)
    expect(cache.get('k')).toEqual({ data: 1 })
  })

  it('returns null after TTL expires', () => {
    vi.useFakeTimers()
    cache.set('k', 'value', 100)
    vi.advanceTimersByTime(101)
    expect(cache.get('k')).toBeNull()
    vi.useRealTimers()
  })

  it('invalidate removes a key', () => {
    cache.set('k', 'value', 5000)
    cache.invalidate('k')
    expect(cache.get('k')).toBeNull()
  })

  it('invalidatePrefix removes matching keys only', () => {
    cache.set('leaderboard:all:all:50:false', [1], 5000)
    cache.set('leaderboard:all:pvp:50:false', [2], 5000)
    cache.set('bots:public', [3], 5000)

    cache.invalidatePrefix('leaderboard:')

    expect(cache.get('leaderboard:all:all:50:false')).toBeNull()
    expect(cache.get('leaderboard:all:pvp:50:false')).toBeNull()
    expect(cache.get('bots:public')).toEqual([3])
  })

  it('size counts only live entries', () => {
    vi.useFakeTimers()
    cache.set('a', 1, 100)
    cache.set('b', 2, 200)
    expect(cache.size()).toBe(2)
    vi.advanceTimersByTime(150)
    expect(cache.size()).toBe(1)
    vi.useRealTimers()
  })

  it('overwriting a key resets TTL', () => {
    vi.useFakeTimers()
    cache.set('k', 'old', 100)
    vi.advanceTimersByTime(80)
    cache.set('k', 'new', 200)
    vi.advanceTimersByTime(101)
    expect(cache.get('k')).toBe('new')
    vi.useRealTimers()
  })
})
