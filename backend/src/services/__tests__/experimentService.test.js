// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — experimentService tests.
 *
 * Surface-only A/B helper. Verifies:
 *   - Stable hashing — same (userId, key) → same bucket every call
 *   - Different keys → independent assignment for the same user
 *   - SystemConfig `buckets` value drives the split (default 1 = control)
 *   - Bucket label format and range
 *   - Defensive guards (missing user, missing key, malformed config)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    systemConfig: { findUnique: vi.fn() },
  },
}))

const db = (await import('../../lib/db.js')).default
const { experimentVariant } = await import('../experimentService.js')

beforeEach(() => {
  vi.clearAllMocks()
  db.systemConfig.findUnique.mockResolvedValue(null)  // default = no split
})

describe('experimentVariant — defaults', () => {
  it('returns the defaultBucket when no SystemConfig row exists', async () => {
    const v = await experimentVariant('user_1', 'reward.amount', 'control')
    expect(v).toBe('control')
  })

  it('returns the defaultBucket when buckets is 1 (no split active)', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 1 })
    const v = await experimentVariant('user_1', 'reward.amount', 'baseline')
    expect(v).toBe('baseline')
  })

  it('returns the defaultBucket on missing userId or key', async () => {
    expect(await experimentVariant('',     'reward.amount', 'ctrl')).toBe('ctrl')
    expect(await experimentVariant('u_1',  '',              'ctrl')).toBe('ctrl')
    expect(await experimentVariant(null,   'reward.amount', 'ctrl')).toBe('ctrl')
  })

  it('treats malformed buckets values as 1 (no split)', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 'banana' })
    expect(await experimentVariant('user_1', 'reward.amount', 'control')).toBe('control')
  })
})

describe('experimentVariant — split active', () => {
  it('returns a stable bucket label across repeated calls', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 4 })
    const a = await experimentVariant('user_42', 'reward.amount', 'control')
    const b = await experimentVariant('user_42', 'reward.amount', 'control')
    const c = await experimentVariant('user_42', 'reward.amount', 'control')
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a).toMatch(/^bucket-[0-3]$/)
  })

  it('produces independent assignments for different experiment keys', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 8 })
    // Drift across many users so we can be confident the assignments diverge.
    let diffs = 0
    for (let i = 0; i < 50; i++) {
      const a = await experimentVariant(`user_${i}`, 'reward.amount', 'control')
      const b = await experimentVariant(`user_${i}`, 'rec.algorithm', 'control')
      if (a !== b) diffs++
    }
    // Two independent uniform assignments over 8 buckets should disagree
    // ~7/8 of the time. Be loose to avoid flakiness.
    expect(diffs).toBeGreaterThan(35)
  })

  it('respects the SystemConfig buckets value (every label in range)', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 3 })
    for (let i = 0; i < 30; i++) {
      const v = await experimentVariant(`user_${i}`, 'reward.amount', 'control')
      expect(v).toMatch(/^bucket-[0-2]$/)
    }
  })

  it('parses string-encoded JSON SystemConfig values (Prisma row shape variance)', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: '5' })
    const v = await experimentVariant('user_xyz', 'reward.amount', 'control')
    expect(v).toMatch(/^bucket-[0-4]$/)
  })

  it('distributes users across all buckets for buckets=2', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 2 })
    const counts = { 'bucket-0': 0, 'bucket-1': 0 }
    for (let i = 0; i < 200; i++) {
      const v = await experimentVariant(`user_${i}`, 'reward.amount', 'control')
      counts[v]++
    }
    // SHA-256 over the 200 user ids should produce both buckets — neither
    // 0 nor 200. Loose bound (≥40 in each) avoids any flake risk.
    expect(counts['bucket-0']).toBeGreaterThan(40)
    expect(counts['bucket-1']).toBeGreaterThan(40)
  })

  it('reads from the namespaced SystemConfig key', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 2 })
    await experimentVariant('user_1', 'reward.amount', 'control')
    expect(db.systemConfig.findUnique).toHaveBeenCalledWith({
      where: { key: 'guide.experiments.reward.amount.buckets' },
    })
  })
})
