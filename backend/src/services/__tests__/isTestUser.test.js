// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — `isTestUser` auto-flag wiring (Intelligent_Guide_Requirements.md §2 / §8.4).
 *
 * Five layers of pollution prevention:
 *   1. Default false on real account creation
 *   2. Internal email-domain match → true on syncUser create
 *   3. CLI-created accounts (`um create`, setup-qa-users.sh) → true
 *   4. ADMIN role grant via `um role` → true
 *   5. BA admin role assignment via PATCH /admin/users/:id → true
 *
 * This test file covers layers 1–2 (the syncUser path). The CLI + admin-route
 * paths are exercised via their own integration tests (CLI is interactive
 * shell-out; admin route covered by admin.test.js's PATCH suite).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create:     vi.fn(),
      upsert:     vi.fn(),
      update:     vi.fn(),
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
    },
    game:    { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    gameElo: { upsert: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
    $transaction: vi.fn(async (ops) => Array.isArray(ops) ? Promise.all(ops) : ops({})),
    $queryRaw:    vi.fn(),
  },
}))
vi.mock('@xo-arena/db', () => ({
  default: {},
  Prisma:  { sql: (s, ...v) => ({ s, v }), empty: { strings: [''], values: [] } },
}))

const { syncUser, isInternalEmailDomain } = await import('../userService.js')
const db = (await import('../../lib/db.js')).default

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no internal-email-domain config row.
  db.systemConfig.findUnique.mockResolvedValue(null)
  db.user.findUnique.mockResolvedValue(null)
  db.user.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }))
  db.user.upsert.mockImplementation(async ({ create }) => ({ id: 'new', ...create }))
})

// ── isInternalEmailDomain ────────────────────────────────────────────────────

describe('isInternalEmailDomain', () => {
  it('returns false when no SystemConfig row is set', async () => {
    expect(await isInternalEmailDomain('alice@example.com')).toBe(false)
  })

  it('returns false for null/empty inputs', async () => {
    expect(await isInternalEmailDomain(null)).toBe(false)
    expect(await isInternalEmailDomain('')).toBe(false)
    expect(await isInternalEmailDomain('no-at-sign')).toBe(false)
  })

  it('matches a domain stored without leading "@"', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['callidity.com']),
    })
    expect(await isInternalEmailDomain('joe@callidity.com')).toBe(true)
    expect(await isInternalEmailDomain('joe@example.com')).toBe(false)
  })

  it('matches a domain stored with leading "@"', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['@xo-arena.internal']),
    })
    expect(await isInternalEmailDomain('bot@xo-arena.internal')).toBe(true)
  })

  it('is case-insensitive on both the domain and the email', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['Callidity.COM']),
    })
    expect(await isInternalEmailDomain('Joe@callidity.com')).toBe(true)
    expect(await isInternalEmailDomain('joe@CALLIDITY.com')).toBe(true)
  })

  it('handles a malformed SystemConfig value gracefully', async () => {
    db.systemConfig.findUnique.mockResolvedValue({ value: 'not-json' })
    // _getSystemConfig returns the string when JSON.parse fails — Array.isArray
    // is false, so the helper returns false safely.
    expect(await isInternalEmailDomain('joe@example.com')).toBe(false)
  })
})

// ── syncUser auto-flag ───────────────────────────────────────────────────────

describe('syncUser → isTestUser auto-flag', () => {
  it('flags a brand-new BA account whose email is in the internal domain list', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['callidity.com']),
    })
    await syncUser({
      betterAuthId: 'ba_1',
      email:        'joe@callidity.com',
      username:     'joe',
      displayName:  'Joe',
    })
    const args = db.user.create.mock.calls[0][0]
    expect(args.data.isTestUser).toBe(true)
  })

  it('does NOT flag a brand-new BA account when the email is not internal', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['callidity.com']),
    })
    await syncUser({
      betterAuthId: 'ba_2',
      email:        'alice@example.com',
      username:     'alice',
      displayName:  'Alice',
    })
    const args = db.user.create.mock.calls[0][0]
    expect(args.data.isTestUser).toBe(false)
  })

  it('does NOT flip an existing BA-linked account to isTestUser on subsequent sync', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['callidity.com']),
    })
    db.user.findUnique.mockResolvedValueOnce({ id: 'usr_1', betterAuthId: 'ba_1' })
    db.user.update.mockResolvedValueOnce({ id: 'usr_1', betterAuthId: 'ba_1' })

    await syncUser({
      betterAuthId: 'ba_1',
      email:        'joe@callidity.com',
      username:     'joe',
      displayName:  'Joe',
    })
    // Update path was taken; create + isTestUser flip never happened.
    expect(db.user.create).not.toHaveBeenCalled()
    const updateArgs = db.user.update.mock.calls[0][0]
    expect(updateArgs.data).not.toHaveProperty('isTestUser')
  })

  it('flags new Clerk users whose email is internal (legacy upsert path)', async () => {
    db.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify(['xo-arena.internal']),
    })
    await syncUser({
      clerkId:     'clerk_99',
      email:       'old-clerk@xo-arena.internal',
      username:    'old',
      displayName: 'Old',
    })
    const args = db.user.upsert.mock.calls[0][0]
    expect(args.create.isTestUser).toBe(true)
  })
})
