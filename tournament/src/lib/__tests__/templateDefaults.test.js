// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Guard C — default `recurrenceEndDate` for isTest=true templates so a
 * leaked test template self-expires 24h after its start anchor.
 */
import { describe, it, expect } from 'vitest'
import { computeTemplateEndDate, TEST_TEMPLATE_TTL_MS } from '../templateDefaults.js'

const anchor = new Date('2026-05-01T12:00:00.000Z')

describe('computeTemplateEndDate', () => {
  it('returns undefined for a non-test template with no explicit end', () => {
    expect(computeTemplateEndDate(anchor, false, undefined)).toBeUndefined()
  })

  it('respects an explicit end date for a non-test template', () => {
    const explicit = new Date('2026-06-01T00:00:00.000Z')
    expect(computeTemplateEndDate(anchor, false, explicit)).toBe(explicit)
  })

  it('defaults isTest=true templates to anchor + 24h', () => {
    const result = computeTemplateEndDate(anchor, true, undefined)
    expect(result.getTime()).toBe(anchor.getTime() + TEST_TEMPLATE_TTL_MS)
  })

  it('respects an explicit end date even when isTest=true (admin override)', () => {
    const explicit = new Date('2026-05-08T00:00:00.000Z')
    expect(computeTemplateEndDate(anchor, true, explicit)).toBe(explicit)
  })

  it('treats null providedEnd the same as undefined (caller cleared it)', () => {
    const result = computeTemplateEndDate(anchor, true, null)
    expect(result.getTime()).toBe(anchor.getTime() + TEST_TEMPLATE_TTL_MS)
  })
})
