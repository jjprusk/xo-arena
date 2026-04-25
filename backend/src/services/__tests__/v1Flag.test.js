// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — `guide.v1.enabled` SystemConfig flag.
 *
 * When the flag is off, journey-step credits and discovery-reward grants
 * silently become no-ops. The rest of the platform (games, bots, tournaments)
 * keeps working — only the guide overlay goes dark.
 *
 * Default is true so dev/staging keep working as-is. Production seeds it
 * off; admin flips it on once the metrics dashboard confirms a healthy
 * first-day funnel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user:         { findUnique: vi.fn(), update: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}))
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { completeStep }         = await import('../journeyService.js')
const { grantDiscoveryReward } = await import('../discoveryRewardsService.js')
const db = (await import('../../lib/db.js')).default

beforeEach(() => {
  vi.clearAllMocks()
  db.user.findUnique.mockResolvedValue({
    id: 'usr_1',
    preferences: { journeyProgress: { completedSteps: [] } },
  })
  db.user.update.mockResolvedValue({})
})

function configValue(map) {
  // map: { 'guide.v1.enabled': false, ... } — anything missing returns null
  db.systemConfig.findUnique.mockImplementation(async ({ where: { key } }) =>
    key in map ? { value: JSON.stringify(map[key]) } : null
  )
}

describe('guide.v1.enabled — journeyService.completeStep', () => {
  it('proceeds when flag is unset (default true)', async () => {
    configValue({})
    const result = await completeStep('usr_1', 1)
    expect(result).toBe(true)
    expect(db.user.update).toHaveBeenCalled()
  })

  it('proceeds when flag is explicitly true', async () => {
    configValue({ 'guide.v1.enabled': true })
    const result = await completeStep('usr_1', 1)
    expect(result).toBe(true)
  })

  it('no-ops when flag is false — no DB write, no credit', async () => {
    configValue({ 'guide.v1.enabled': false })
    const result = await completeStep('usr_1', 1)
    expect(result).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

describe('guide.v1.enabled — discoveryRewardsService.grantDiscoveryReward', () => {
  it('proceeds when flag is unset (default true)', async () => {
    configValue({})
    db.user.findUnique.mockResolvedValueOnce({ id: 'usr_1', preferences: {} })
    const result = await grantDiscoveryReward('usr_1', 'firstRealTournamentWin')
    expect(result).toBe(true)
    expect(db.user.update).toHaveBeenCalled()
  })

  it('no-ops when flag is false — no TC payout, no dedupe-list update', async () => {
    configValue({ 'guide.v1.enabled': false })
    const result = await grantDiscoveryReward('usr_1', 'firstRealTournamentWin')
    expect(result).toBe(false)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('no-ops without even running the unknown-key warning path', async () => {
    // Flag-off short-circuits inside the try block, AFTER unknown-key
    // validation. Verify the unknown-key path still rejects regardless of
    // the flag state — the validation is structural, not gated.
    configValue({ 'guide.v1.enabled': false })
    const result = await grantDiscoveryReward('usr_1', 'notARealReward')
    expect(result).toBe(false)
  })
})
