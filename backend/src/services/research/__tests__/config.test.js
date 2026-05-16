// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the `researchLog.publishEnabled` feature flag helper.
 * Sprint 2 of doc/Research_Log_Plan.md §7 C6.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../lib/db.js', () => ({
  default: {
    systemConfig: { findUnique: vi.fn() },
  },
}))

import db from '../../../lib/db.js'
import { isPublishEnabled, PUBLISH_FLAG_KEY } from '../config.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('researchLog config — isPublishEnabled', () => {
  it('returns false when the SystemConfig row is missing (default OFF)', async () => {
    db.systemConfig.findUnique.mockResolvedValueOnce(null)
    expect(await isPublishEnabled()).toBe(false)
    expect(db.systemConfig.findUnique).toHaveBeenCalledWith({ where: { key: PUBLISH_FLAG_KEY } })
  })

  it('returns true when the row stores a JSON boolean true', async () => {
    db.systemConfig.findUnique.mockResolvedValueOnce({ key: PUBLISH_FLAG_KEY, value: true })
    expect(await isPublishEnabled()).toBe(true)
  })

  it('returns true when the row stores the literal string "true"', async () => {
    db.systemConfig.findUnique.mockResolvedValueOnce({ key: PUBLISH_FLAG_KEY, value: 'true' })
    expect(await isPublishEnabled()).toBe(true)
  })

  it('returns true when the row stores { enabled: true }', async () => {
    db.systemConfig.findUnique.mockResolvedValueOnce({ key: PUBLISH_FLAG_KEY, value: { enabled: true } })
    expect(await isPublishEnabled()).toBe(true)
  })

  it('returns false for falsy / unrecognized JSON shapes', async () => {
    db.systemConfig.findUnique.mockResolvedValueOnce({ key: PUBLISH_FLAG_KEY, value: false })
    expect(await isPublishEnabled()).toBe(false)
    db.systemConfig.findUnique.mockResolvedValueOnce({ key: PUBLISH_FLAG_KEY, value: { enabled: false } })
    expect(await isPublishEnabled()).toBe(false)
    db.systemConfig.findUnique.mockResolvedValueOnce({ key: PUBLISH_FLAG_KEY, value: 'maybe' })
    expect(await isPublishEnabled()).toBe(false)
  })
})
