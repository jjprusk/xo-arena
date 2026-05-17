// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Smoke tests for the client-side PII preview scrubber. The server-side
 * regex set has its own deep tests at
 * backend/src/services/research/__tests__/pii.test.js — this file just
 * confirms the client mirror catches the same headline cases.
 */
import { describe, it, expect } from 'vitest'
import { scrubForPublishPreview } from '../pii.js'

describe('scrubForPublishPreview', () => {
  it('redacts email + IPv4 + phone in one pass', () => {
    const text = 'mail alice@example.com or call 415-555-0199; lab IP 10.0.0.5'
    const { scrubbed, matches } = scrubForPublishPreview(text)
    expect(scrubbed).toContain('[email redacted]')
    expect(scrubbed).toContain('[ipv4 redacted]')
    expect(scrubbed).toContain('[phone redacted]')
    const kinds = matches.map(m => m.kind)
    expect(kinds).toContain('email')
    expect(kinds).toContain('ipv4')
    expect(kinds).toContain('phone')
  })

  it('leaves hyperparameter-shaped numerics alone', () => {
    const text = 'lr=3e-4 gamma=0.99 epsilon_decay=0.995'
    const { scrubbed, matches } = scrubForPublishPreview(text)
    expect(scrubbed).toBe(text)
    expect(matches).toEqual([])
  })

  it('returns empty for non-string input', () => {
    expect(scrubForPublishPreview(null).scrubbed).toBe('')
    expect(scrubForPublishPreview(undefined).scrubbed).toBe('')
    expect(scrubForPublishPreview(42).scrubbed).toBe('')
  })

  it('is idempotent', () => {
    const text = 'reach me at joe@example.com today'
    const a = scrubForPublishPreview(text).scrubbed
    const b = scrubForPublishPreview(a).scrubbed
    expect(b).toBe(a)
  })
})
