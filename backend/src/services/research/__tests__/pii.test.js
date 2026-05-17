// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the Research Log PII scrubber.
 * Sprint 2 of doc/Research_Log_Plan.md §2.3 — covers the locked-in regex
 * set (emails / phones / IPv4-6 / addresses / cards) plus the
 * intentionally-deferred personal-name detection (must NOT strip names).
 */

import { describe, it, expect } from 'vitest'
import { scrubForPublish } from '../pii.js'

function kinds(matches) {
  return matches.map(m => m.kind)
}

describe('scrubForPublish', () => {
  it('strips a bare email address', () => {
    const { scrubbed, matches } = scrubForPublish('ping me at joe@example.com if it breaks')
    expect(scrubbed).toBe('ping me at [email redacted] if it breaks')
    expect(kinds(matches)).toEqual(['email'])
  })

  it('strips an email with subaddressing + ccTLD', () => {
    const { scrubbed } = scrubForPublish('write to joe.smith+research@example.co.uk thanks')
    expect(scrubbed).toContain('[email redacted]')
    expect(scrubbed).not.toContain('joe.smith')
    expect(scrubbed).not.toContain('example.co.uk')
  })

  it('strips an IPv4 address', () => {
    const { scrubbed, matches } = scrubForPublish('the bot ran on 192.168.1.42 last night')
    expect(scrubbed).toBe('the bot ran on [ipv4 redacted] last night')
    expect(kinds(matches)).toEqual(['ipv4'])
  })

  it('strips a full IPv6 address', () => {
    const { scrubbed, matches } = scrubForPublish('hit 2001:0db8:85a3:0000:0000:8a2e:0370:7334 via the bridge')
    expect(scrubbed).toContain('[ipv6 redacted]')
    expect(kinds(matches)).toContain('ipv6')
  })

  it('strips a credit-card-shaped digit run', () => {
    const { scrubbed, matches } = scrubForPublish('paid with 4111 1111 1111 1111 yesterday')
    expect(scrubbed).toContain('[card redacted]')
    expect(kinds(matches)).toEqual(['card'])
  })

  it('does NOT misclassify a short digit run as a credit card', () => {
    const { scrubbed, matches } = scrubForPublish('the seed was 42 episodes')
    expect(scrubbed).toBe('the seed was 42 episodes')
    expect(matches).toEqual([])
  })

  it('strips a loose international phone number', () => {
    const { scrubbed, matches } = scrubForPublish('call me +1 (415) 555-2671 when ready')
    expect(scrubbed).toContain('[phone redacted]')
    expect(kinds(matches).includes('phone')).toBe(true)
  })

  it('does NOT strip short numerics that look like hyperparameters', () => {
    const { scrubbed, matches } = scrubForPublish('lr=3e-4 gamma=0.99 epsilon_decay=0.995')
    expect(scrubbed).toBe('lr=3e-4 gamma=0.99 epsilon_decay=0.995')
    expect(matches).toEqual([])
  })

  it('strips a US-style street address', () => {
    const { scrubbed, matches } = scrubForPublish('move to 123 Maple Street next week')
    expect(scrubbed).toContain('[address redacted]')
    expect(kinds(matches)).toContain('address')
  })

  it('handles addresses with abbreviated suffixes (Ave, Rd, Blvd)', () => {
    const a = scrubForPublish('lab at 4500 California Ave next door')
    expect(a.scrubbed).toContain('[address redacted]')
    const b = scrubForPublish('cabin on 7 Birch Rd in the woods')
    expect(b.scrubbed).toContain('[address redacted]')
    const c = scrubForPublish('office tower at 100 Market Blvd downtown')
    expect(c.scrubbed).toContain('[address redacted]')
  })

  it('does NOT strip personal names (deferred to v2 — modal preview only)', () => {
    const { scrubbed, matches } = scrubForPublish('Alice and Bob both saw the regression')
    expect(scrubbed).toBe('Alice and Bob both saw the regression')
    expect(matches).toEqual([])
  })

  it('handles multiple PII categories in a single string', () => {
    const input = 'reach Alice at alice@example.com or call 415-555-0199; lab IP is 10.0.0.5'
    const { scrubbed, matches } = scrubForPublish(input)
    expect(scrubbed).toContain('[email redacted]')
    expect(scrubbed).toContain('[ipv4 redacted]')
    expect(scrubbed).toContain('[phone redacted]')
    const ks = kinds(matches)
    expect(ks).toContain('email')
    expect(ks).toContain('ipv4')
    expect(ks).toContain('phone')
  })

  it('preserves the original input when no PII is present', () => {
    const text = 'plateau after 20k episodes; epsilon decayed too fast, try 0.999 next time'
    const { scrubbed, matches } = scrubForPublish(text)
    expect(scrubbed).toBe(text)
    expect(matches).toEqual([])
  })

  it('returns the original string unchanged for empty / non-string input', () => {
    expect(scrubForPublish('').scrubbed).toBe('')
    expect(scrubForPublish('').matches).toEqual([])
    expect(scrubForPublish(null).scrubbed).toBe('')
    expect(scrubForPublish(undefined).scrubbed).toBe('')
    expect(scrubForPublish(42).scrubbed).toBe('')
  })

  it('attaches an offset on each match for caller-side highlighting', () => {
    const { matches } = scrubForPublish('the bridge is at 10.0.0.5 today')
    expect(matches).toHaveLength(1)
    expect(matches[0].kind).toBe('ipv4')
    expect(matches[0].original).toBe('10.0.0.5')
    expect(typeof matches[0].offset).toBe('number')
    expect(matches[0].offset).toBeGreaterThanOrEqual(0)
  })

  it('is idempotent — running twice produces the same scrubbed text', () => {
    const text = 'mail joe@example.com or 4111 1111 1111 1111 (test card)'
    const first = scrubForPublish(text).scrubbed
    const second = scrubForPublish(first).scrubbed
    expect(second).toBe(first)
  })
})
