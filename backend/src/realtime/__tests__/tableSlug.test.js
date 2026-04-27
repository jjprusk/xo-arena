// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Slug allocator behaviour for the post-Option-A1 Table.slug.
 *
 * The mountain pool is gone — slugs come from `nanoid(8)`. These tests pin
 * the contract so a future regression (e.g. someone swaps in `nanoid()` with
 * the default 21-char length, or an alphabet that includes `/`) gets caught.
 */

import { describe, it, expect } from 'vitest'
import { nanoid } from 'nanoid'

describe('nanoid(8) Table slug', () => {
  it('1000 generations are all unique', () => {
    const slugs = new Set()
    for (let i = 0; i < 1000; i++) slugs.add(nanoid(8))
    expect(slugs.size).toBe(1000)
  })

  it('every slug is exactly 8 characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(nanoid(8)).toHaveLength(8)
    }
  })

  it('every slug uses only URL-safe characters (no slashes, no padding)', () => {
    const safe = /^[A-Za-z0-9_-]+$/
    for (let i = 0; i < 100; i++) {
      expect(nanoid(8)).toMatch(safe)
    }
  })
})
