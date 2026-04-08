import { create } from 'zustand'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'

/**
 * GuideStore — manages the Guide panel state, slots, and notification queue.
 *
 * Hydrates from server on sign-in via hydrate(). Changes to slots are
 * persisted immediately (optimistic) and synced to the server.
 */
export const useGuideStore = create((set, get) => ({
  // Panel state
  panelOpen: false,

  // Slot configuration — array of up to 8 action objects
  // { id, actionKey, label, icon, href, type }
  slots: [],

  // Notification queue — newest first
  // { id, type, title, body, createdAt, meta? }
  // types: 'flash' | 'match_ready' | 'admin' | 'invite' | 'room_invite'
  notifications: [],

  // Journey state (populated by Phase 4; stored here for Phase 3 hydration)
  journeyProgress: { completedSteps: [], dismissedAt: null },

  // Whether we've fetched from server at least once this session
  hydrated: false,

  // ── Panel actions ─────────────────────────────────────────────────

  open()   { set({ panelOpen: true }) },
  close()  { set({ panelOpen: false }) },
  toggle() { set(s => ({ panelOpen: !s.panelOpen })) },

  // ── Notification actions ──────────────────────────────────────────

  addNotification(notif) {
    set(s => {
      // Deduplicate by id
      if (s.notifications.some(n => n.id === notif.id)) return {}
      return { notifications: [notif, ...s.notifications] }
    })
  },

  dismissNotification(id) {
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }))
  },

  clearNotifications() {
    set({ notifications: [] })
  },

  // Derived — badge count
  get badgeCount() {
    return get().notifications.length
  },

  // ── Slot actions ──────────────────────────────────────────────────

  async updateSlots(slots) {
    set({ slots })
    try {
      const token = await getToken()
      if (token) await api.guide.patchPreferences({ guideSlots: slots }, token)
    } catch { /* non-fatal — slots will re-sync on next hydrate */ }
  },

  // ── Hydration ─────────────────────────────────────────────────────

  async hydrate() {
    try {
      const token = await getToken()
      if (!token) return
      const data = await api.guide.getPreferences(token)
      set({
        slots:           data.guideSlots        ?? [],
        journeyProgress: data.journeyProgress   ?? { completedSteps: [], dismissedAt: null },
        hydrated:        true,
      })
    } catch { /* non-fatal */ }
  },

  reset() {
    set({
      panelOpen:       false,
      slots:           [],
      notifications:   [],
      journeyProgress: { completedSteps: [], dismissedAt: null },
      hydrated:        false,
    })
  },
}))
