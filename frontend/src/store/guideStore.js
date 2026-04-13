// Copyright © 2026 Joe Pruskowski. All rights reserved.
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

  // Online presence — list of { userId, displayName, avatarUrl } for OnlineStrip
  onlineUsers: [],

  // Journey state (populated by Phase 4; stored here for Phase 3 hydration)
  journeyProgress: { completedSteps: [], dismissedAt: null },

  // One-time UI hint flags — stored server-side so they coordinate across sites
  uiHints: {},

  // Whether we've fetched from server at least once this session
  hydrated: false,

  // ── Panel actions ─────────────────────────────────────────────────

  open()   { set({ panelOpen: true }) },
  close()  { set({ panelOpen: false }) },
  toggle() { set(s => ({ panelOpen: !s.panelOpen })) },

  setOnlineUsers(users) {
    set({ onlineUsers: users ?? [] })
  },

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

  // ── Journey actions ───────────────────────────────────────────────

  // Apply a step completion received via socket (guide:journeyStep)
  applyJourneyStep({ completedSteps }) {
    set(s => ({
      journeyProgress: { ...s.journeyProgress, completedSteps },
    }))
  },

  dismissJourney(slots) {
    const dismissedAt = new Date().toISOString()
    const updates = { journeyProgress: { ...get().journeyProgress, dismissedAt } }
    if (slots) updates.slots = slots
    set(updates)
    getToken().then(token => {
      if (!token) return
      const patch = { journeyProgress: get().journeyProgress }
      if (slots) patch.guideSlots = slots
      api.guide.patchPreferences(patch, token).catch(() => {})
    }).catch(() => {})
  },

  // Marks step 8 complete, sets dismissedAt, and saves slots — all in one PATCH to avoid race.
  async completeJourney(postJourneySlots) {
    const { journeyProgress } = get()
    const completedSteps = [...new Set([...(journeyProgress?.completedSteps ?? []), 8])]
    const dismissedAt    = new Date().toISOString()
    set({ journeyProgress: { completedSteps, dismissedAt }, slots: postJourneySlots })
    try {
      const token = await getToken()
      if (token) await api.guide.patchPreferences({
        journeyProgress: { completedSteps, dismissedAt },
        guideSlots: postJourneySlots,
      }, token)
    } catch { /* non-fatal */ }
  },

  async restartJourney() {
    try {
      const token = await getToken()
      if (token) await api.guide.restartJourney(token)
      set({ journeyProgress: { completedSteps: [], dismissedAt: null } })
    } catch { /* non-fatal */ }
  },

  // ── UI hint actions ───────────────────────────────────────────────

  // Mark a one-time hint as seen locally and persist to server (cross-site coordination)
  setUiHint(key) {
    const uiHints = { ...get().uiHints, [key]: true }
    set({ uiHints })
    getToken().then(token => {
      if (token) api.guide.patchPreferences({ uiHints }, token).catch(() => {})
    }).catch(() => {})
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
        uiHints:         data.uiHints           ?? {},
        hydrated:        true,
      })
    } catch { /* non-fatal */ }
  },

  reset() {
    set({
      panelOpen:       false,
      slots:           [],
      notifications:   [],
      onlineUsers:     [],
      journeyProgress: { completedSteps: [], dismissedAt: null },
      uiHints:         {},
      hydrated:        false,
    })
  },
}))
