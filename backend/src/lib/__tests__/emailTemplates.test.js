import { describe, it, expect } from 'vitest'
import { thankYouTemplate, staffAlertTemplate } from '../emailTemplates.js'

// ── thankYouTemplate ──────────────────────────────────────────────────────────

describe('thankYouTemplate', () => {
  it('returns a non-empty HTML string', () => {
    const html = thankYouTemplate({ name: 'Alice', category: 'BUG', message: 'Something broke.' })
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('includes the user name', () => {
    const html = thankYouTemplate({ name: 'Alice', category: 'BUG', message: 'Test' })
    expect(html).toContain('Alice')
  })

  it('includes the category (capitalised)', () => {
    const html = thankYouTemplate({ name: 'Alice', category: 'BUG', message: 'Test' })
    expect(html).toContain('Bug')
  })

  it('includes acknowledgement text', () => {
    const html = thankYouTemplate({ name: 'Alice', category: 'OTHER', message: 'Good work' })
    expect(html.toLowerCase()).toMatch(/thank|feedback|improve/i)
  })

  it('includes a truncated version of the message when long', () => {
    const long = 'x'.repeat(250)
    const html = thankYouTemplate({ name: 'Alice', category: 'OTHER', message: long })
    // Truncation at 200 chars + ellipsis
    expect(html).toContain('x'.repeat(200))
    expect(html).toContain('…')
  })

  it('includes full message when under 200 chars', () => {
    const msg = 'Short feedback'
    const html = thankYouTemplate({ name: 'Alice', category: 'OTHER', message: msg })
    expect(html).toContain(msg)
    expect(html).not.toContain('…')
  })

  it('does not throw when name is null', () => {
    expect(() =>
      thankYouTemplate({ name: null, category: 'OTHER', message: 'Test' })
    ).not.toThrow()
  })

  it('does not throw when name is undefined', () => {
    expect(() =>
      thankYouTemplate({ name: undefined, category: 'OTHER', message: 'Test' })
    ).not.toThrow()
  })

  it('handles FEATURE_REQUEST category label', () => {
    const html = thankYouTemplate({ name: 'Bob', category: 'FEATURE_REQUEST', message: 'Add dark mode' })
    // First letter uppercase, rest lowercase
    expect(html).toContain('Feature_request')
  })
})

// ── staffAlertTemplate ────────────────────────────────────────────────────────

describe('staffAlertTemplate', () => {
  const BASE = {
    category: 'BUG',
    message:  'Something is broken on the game page.',
    pageUrl:  'https://xo-arena.app/game/123',
    appId:    'xo-arena',
  }

  it('returns a non-empty HTML string', () => {
    const html = staffAlertTemplate(BASE)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('includes the category', () => {
    const html = staffAlertTemplate(BASE)
    expect(html).toContain('Bug')
  })

  it('includes the appId', () => {
    const html = staffAlertTemplate(BASE)
    expect(html).toContain('xo-arena')
  })

  it('includes the pageUrl', () => {
    const html = staffAlertTemplate(BASE)
    expect(html).toContain('https://xo-arena.app/game/123')
  })

  it('includes a truncated version of message when over 300 chars', () => {
    const long = 'y'.repeat(350)
    const html = staffAlertTemplate({ ...BASE, message: long })
    expect(html).toContain('y'.repeat(300))
    expect(html).toContain('…')
  })

  it('includes full message when under 300 chars', () => {
    const html = staffAlertTemplate(BASE)
    expect(html).toContain(BASE.message)
    expect(html).not.toContain('…')
  })

  it('includes the app name in the heading', () => {
    const html = staffAlertTemplate({ ...BASE, appId: 'my-app' })
    expect(html).toContain('my-app')
  })
})
