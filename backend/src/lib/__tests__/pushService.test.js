import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  pushSubscription: {
    findMany:   vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
}
vi.mock('../db.js', () => ({ default: mockDb }))

const mockSend = vi.fn()
const mockSetVapid = vi.fn()
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...a) => mockSetVapid(...a),
    sendNotification: (...a) => mockSend(...a),
  },
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { sendToUser, buildPushPayload, getPublicVapidKey, getPushCounters, _resetForTests } =
  await import('../pushService.js')

beforeEach(() => {
  vi.resetAllMocks()
  _resetForTests()
  process.env.VAPID_PUBLIC_KEY     = 'test-pub'
  process.env.VAPID_PRIVATE_KEY    = 'test-priv'
  process.env.VAPID_CONTACT_EMAIL  = 'mailto:test@example.com'
  mockDb.pushSubscription.findMany.mockResolvedValue([])
  mockDb.pushSubscription.deleteMany.mockResolvedValue({ count: 0 })
  mockDb.pushSubscription.updateMany.mockResolvedValue({ count: 0 })
  mockSend.mockResolvedValue({})
})

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  delete process.env.VAPID_CONTACT_EMAIL
})

// ─── sendToUser ──────────────────────────────────────────────────────────────

describe('sendToUser', () => {
  it('returns zero counts when VAPID env is missing', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    const result = await sendToUser('u1', { title: 'hi', body: 'there' })
    expect(result).toEqual({ sent: 0, removed: 0 })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns zero when the user has no subscriptions', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([])
    const result = await sendToUser('u1', { title: 'hi' })
    expect(result).toEqual({ sent: 0, removed: 0 })
  })

  it('sends to every subscription and returns sent count', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'https://push.example/a', p256dh: 'p1', auth: 'a1' },
      { id: 's2', endpoint: 'https://push.example/b', p256dh: 'p2', auth: 'a2' },
    ])
    const result = await sendToUser('u1', { title: 'hi', body: 'there', url: '/x' })
    expect(result).toEqual({ sent: 2, removed: 0 })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/a' }),
      expect.stringContaining('"title":"hi"'),
    )
  })

  it('purges endpoints that return 410 Gone', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([
      { id: 's_live', endpoint: 'https://push.example/live', p256dh: 'p1', auth: 'a1' },
      { id: 's_dead', endpoint: 'https://push.example/dead', p256dh: 'p2', auth: 'a2' },
    ])
    mockSend.mockImplementation(async (sub) => {
      if (sub.endpoint.endsWith('dead')) {
        const err = new Error('Gone')
        err.statusCode = 410
        throw err
      }
      return {}
    })
    const result = await sendToUser('u1', { title: 'hi' })
    expect(result).toEqual({ sent: 1, removed: 1 })
    expect(mockDb.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s_dead'] } },
    })
  })

  it('keeps endpoints that fail transiently (non-404/410)', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' },
    ])
    mockSend.mockImplementation(async () => {
      const err = new Error('flaky')
      err.statusCode = 500
      throw err
    })
    const result = await sendToUser('u1', { title: 'hi' })
    expect(result).toEqual({ sent: 0, removed: 0 })
    expect(mockDb.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('configures VAPID once across multiple calls', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([])
    await sendToUser('u1', { title: 'a' })
    await sendToUser('u2', { title: 'b' })
    expect(mockSetVapid).toHaveBeenCalledTimes(1)
  })
})

// ─── buildPushPayload ────────────────────────────────────────────────────────

describe('buildPushPayload', () => {
  it('returns a match-ready payload with tournament url', () => {
    const p = buildPushPayload('match.ready', { tournamentId: 't1', name: 'Finals' })
    expect(p).toMatchObject({ type: 'match.ready', title: 'Match ready', url: '/tournaments/t1' })
    expect(p.body).toContain('Finals')
  })

  it('returns a starting_soon payload with minutes', () => {
    const p = buildPushPayload('tournament.starting_soon', { tournamentId: 't1', name: 'Cup', minutesUntilStart: 5 })
    expect(p.body).toContain('5 minutes')
    expect(p.url).toBe('/tournaments/t1')
  })

  it('returns null for unknown types', () => {
    expect(buildPushPayload('something.else', {})).toBeNull()
  })

  it('handles missing payload fields gracefully', () => {
    const p = buildPushPayload('tournament.cancelled', {})
    expect(p).toMatchObject({ type: 'tournament.cancelled', title: expect.stringMatching(/Tournament cancelled/) })
  })
})

// ─── getPublicVapidKey ───────────────────────────────────────────────────────

describe('getPublicVapidKey', () => {
  it('returns the env value when set', () => {
    expect(getPublicVapidKey()).toBe('test-pub')
  })

  it('returns null when env is unset', () => {
    delete process.env.VAPID_PUBLIC_KEY
    expect(getPublicVapidKey()).toBeNull()
  })
})

// ─── getPushCounters — delivery metrics for observability ───────────────────

describe('getPushCounters', () => {
  it('increments `sent` on a 2xx delivery, `attempts` once per endpoint', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([
      { id: 'sub_ok', endpoint: 'https://fcm.google/x', p256dh: 'p', auth: 'a' },
    ])
    mockSend.mockResolvedValueOnce({})

    const before = getPushCounters()
    await sendToUser('u1', { title: 'hi' })
    const after = getPushCounters()

    expect(after.attempts).toBe(before.attempts + 1)
    expect(after.sent).toBe(before.sent + 1)
    expect(after.purged).toBe(before.purged)
    expect(after.failed).toBe(before.failed)
  })

  it('increments `purged` on 410 Gone, leaves `failed` unchanged', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([
      { id: 'sub_dead', endpoint: 'https://apple.gone/x', p256dh: 'p', auth: 'a' },
    ])
    mockSend.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))

    const before = getPushCounters()
    await sendToUser('u1', { title: 'hi' })
    const after = getPushCounters()

    expect(after.attempts).toBe(before.attempts + 1)
    expect(after.purged).toBe(before.purged + 1)
    expect(after.failed).toBe(before.failed)
    expect(after.sent).toBe(before.sent)
  })

  it('increments `failed` on transient errors (5xx / network), leaves the sub in place', async () => {
    mockDb.pushSubscription.findMany.mockResolvedValue([
      { id: 'sub_flaky', endpoint: 'https://mozilla.push/x', p256dh: 'p', auth: 'a' },
    ])
    mockSend.mockRejectedValueOnce(Object.assign(new Error('500'), { statusCode: 502 }))

    const before = getPushCounters()
    await sendToUser('u1', { title: 'hi' })
    const after = getPushCounters()

    expect(after.attempts).toBe(before.attempts + 1)
    expect(after.failed).toBe(before.failed + 1)
    expect(after.purged).toBe(before.purged)
    expect(after.sent).toBe(before.sent)
  })
})
