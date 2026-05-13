import { describe, it, expect } from 'vitest'
import { scan, _denylistSize } from '../contentFilter.js'

describe('contentFilter.scan', () => {
  it('passes clean text', () => {
    const r = scan('How do I train a quick bot for the curriculum cup?')
    expect(r.triggered).toBe(false)
    expect(r.terms).toEqual([])
  })

  it('detects a denylisted slur (case-insensitive)', () => {
    const r = scan('this is a Faggot comment')
    expect(r.triggered).toBe(true)
    expect(r.terms).toContain('faggot')
  })

  it('does not match partial substrings (word boundaries enforced)', () => {
    // "Spica" is a star name; should not trigger on "spic" partial.
    const r = scan('the constellation Virgo contains the bright star Spica')
    expect(r.triggered).toBe(false)
  })

  it('returns false for empty / non-string inputs', () => {
    expect(scan('').triggered).toBe(false)
    expect(scan(null).triggered).toBe(false)
    expect(scan(undefined).triggered).toBe(false)
    expect(scan(42).triggered).toBe(false)
  })

  it('returns multiple terms when more than one matches', () => {
    const r = scan('cunt and motherfucker both appear')
    expect(r.triggered).toBe(true)
    expect(r.terms).toEqual(expect.arrayContaining(['cunt', 'motherfucker']))
  })

  it('denylist is non-trivial in size', () => {
    expect(_denylistSize()).toBeGreaterThan(10)
  })
})
