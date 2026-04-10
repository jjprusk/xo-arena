import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGuideStore } from '../guideStore.js'

vi.mock('../../lib/getToken.js', () => ({ getToken: () => Promise.resolve(null) }))

function s() { return useGuideStore.getState() }

beforeEach(() => {
  s().reset()
  vi.restoreAllMocks()
})

// ── Initial state ──────────────────────────────────────────────────────────────

describe('guideStore — initial state', () => {
  it('panelOpen is false', () => { expect(s().panelOpen).toBe(false) })
  it('slots is empty array', () => { expect(s().slots).toEqual([]) })
  it('notifications is empty array', () => { expect(s().notifications).toEqual([]) })
  it('hydrated is false', () => { expect(s().hydrated).toBe(false) })
  it('journeyProgress defaults to empty', () => {
    expect(s().journeyProgress).toEqual({ completedSteps: [], dismissedAt: null })
  })
})

// ── Panel actions ──────────────────────────────────────────────────────────────

describe('guideStore — panel', () => {
  it('open() sets panelOpen to true', () => {
    s().open()
    expect(s().panelOpen).toBe(true)
  })

  it('close() sets panelOpen to false', () => {
    s().open()
    s().close()
    expect(s().panelOpen).toBe(false)
  })

  it('toggle() flips panelOpen', () => {
    expect(s().panelOpen).toBe(false)
    s().toggle()
    expect(s().panelOpen).toBe(true)
    s().toggle()
    expect(s().panelOpen).toBe(false)
  })
})

// ── Notifications ──────────────────────────────────────────────────────────────

describe('guideStore — addNotification', () => {
  const notif = { id: 'n1', type: 'match_ready', title: 'Match Ready', body: '', createdAt: new Date().toISOString() }

  it('adds a notification', () => {
    s().addNotification(notif)
    expect(s().notifications).toHaveLength(1)
    expect(s().notifications[0].id).toBe('n1')
  })

  it('newest notification is first (prepend)', () => {
    s().addNotification({ ...notif, id: 'n1' })
    s().addNotification({ ...notif, id: 'n2' })
    expect(s().notifications[0].id).toBe('n2')
  })

  it('deduplicates by id', () => {
    s().addNotification(notif)
    s().addNotification(notif)
    expect(s().notifications).toHaveLength(1)
  })
})

describe('guideStore — dismissNotification', () => {
  it('removes notification by id', () => {
    const n1 = { id: 'n1', type: 'flash', title: 'A', body: '', createdAt: '' }
    const n2 = { id: 'n2', type: 'admin', title: 'B', body: '', createdAt: '' }
    s().addNotification(n1)
    s().addNotification(n2)
    s().dismissNotification('n1')
    expect(s().notifications.map(n => n.id)).toEqual(['n2'])
  })

  it('badge count decrements on dismiss', () => {
    s().addNotification({ id: 'n1', type: 'flash', title: '', body: '', createdAt: '' })
    s().addNotification({ id: 'n2', type: 'flash', title: '', body: '', createdAt: '' })
    expect(s().notifications.length).toBe(2)
    s().dismissNotification('n1')
    expect(s().notifications.length).toBe(1)
  })

  it('is a no-op for unknown id', () => {
    s().addNotification({ id: 'n1', type: 'flash', title: '', body: '', createdAt: '' })
    s().dismissNotification('no-such-id')
    expect(s().notifications).toHaveLength(1)
  })

  it('badge is 0 when all dismissed', () => {
    s().addNotification({ id: 'n1', type: 'flash', title: '', body: '', createdAt: '' })
    s().dismissNotification('n1')
    expect(s().notifications.length).toBe(0)
  })
})

describe('guideStore — clearNotifications', () => {
  it('empties all notifications', () => {
    s().addNotification({ id: 'n1', type: 'flash', title: '', body: '', createdAt: '' })
    s().addNotification({ id: 'n2', type: 'admin', title: '', body: '', createdAt: '' })
    s().clearNotifications()
    expect(s().notifications).toEqual([])
  })
})

// ── Slot actions ───────────────────────────────────────────────────────────────

describe('guideStore — updateSlots (sync, no API)', () => {

  it('sets slots in state', async () => {
    const slots = [{ key: 'play', actionKey: 'play', label: 'Play', icon: '⊞', href: '/play' }]
    await s().updateSlots(slots)
    expect(s().slots).toEqual(slots)
  })

  it('replaces all slots on each call', async () => {
    await s().updateSlots([{ key: 'play', actionKey: 'play', label: 'Play', icon: '⊞', href: '/play' }])
    await s().updateSlots([{ key: 'gym',  actionKey: 'gym',  label: 'Gym',  icon: '⚡', href: '/gym'  }])
    expect(s().slots).toHaveLength(1)
    expect(s().slots[0].key).toBe('gym')
  })
})

// ── Reset ──────────────────────────────────────────────────────────────────────

describe('guideStore — reset', () => {
  it('clears all state', () => {
    s().open()
    s().addNotification({ id: 'n1', type: 'flash', title: '', body: '', createdAt: '' })
    useGuideStore.setState({ slots: [{ key: 'play' }], hydrated: true })
    s().reset()
    expect(s().panelOpen).toBe(false)
    expect(s().notifications).toEqual([])
    expect(s().slots).toEqual([])
    expect(s().hydrated).toBe(false)
  })
})
