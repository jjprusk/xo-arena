// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { POST_JOURNEY_SLOTS } from '../components/guide/slotActions.js'

export const useGuideStore = create((set, get) => ({
  panelOpen: false,
  slots: [],
  notifications: [],
  onlineUsers: [],
  journeyProgress: { completedSteps: [], dismissedAt: null },

  // One-time UI hint flags — stored server-side so they coordinate across sites
  uiHints: {},

  hydrated: false,

  open()   { set({ panelOpen: true }) },
  close()  { set({ panelOpen: false }) },
  toggle() { set(s => ({ panelOpen: !s.panelOpen })) },

  setOnlineUsers(users) {
    set({ onlineUsers: users ?? [] })
  },

  addNotification(notif) {
    set(s => {
      if (s.notifications.some(n => n.id === notif.id)) return {}
      return { notifications: [notif, ...s.notifications] }
    })
  },

  dismissNotification(id) {
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }))
  },

  dismissNotificationsForTable(tableId) {
    set(s => ({ notifications: s.notifications.filter(n => n.tableId !== tableId) }))
  },

  clearNotifications() {
    set({ notifications: [] })
  },

  get badgeCount() {
    return get().notifications.length
  },

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

  // Marks the terminal step (7) complete, sets dismissedAt, and saves slots —
  // all in one PATCH to avoid race. Idempotent: if step 7 was already marked
  // via the /tournaments popup trigger, Set dedupes.
  async completeJourney(postJourneySlots) {
    const { journeyProgress } = get()
    const completedSteps = [...new Set([...(journeyProgress?.completedSteps ?? []), 7])]
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

  // Mark a one-time hint as seen locally and persist to server (cross-site coordination)
  setUiHint(key) {
    const uiHints = { ...get().uiHints, [key]: true }
    set({ uiHints })
    getToken().then(token => {
      if (token) api.guide.patchPreferences({ uiHints }, token).catch(() => {})
    }).catch(() => {})
  },

  async updateSlots(slots) {
    set({ slots })
    try {
      const token = await getToken()
      if (token) await api.guide.patchPreferences({ guideSlots: slots }, token)
    } catch { /* non-fatal */ }
  },

  async hydrate() {
    try {
      const token = await getToken()
      if (!token) return
      const data = await api.guide.getPreferences(token)
      const journeyProgress = data.journeyProgress ?? { completedSteps: [], dismissedAt: null }
      let slots = data.guideSlots ?? []

      // Back-fill the default slot set for accounts whose journey is already
      // dismissed but whose stored slots are empty — either a pre-defaults
      // account or slots were cleared. Without this the Guide panel shows
      // nothing but "+ Add" tiles, which looks broken. Persist so the user
      // keeps the defaults across sessions.
      if (journeyProgress.dismissedAt && slots.length === 0) {
        slots = POST_JOURNEY_SLOTS
        api.guide.patchPreferences({ guideSlots: slots }, token).catch(() => {})
      }

      set({
        slots,
        journeyProgress,
        uiHints:  data.uiHints ?? {},
        hydrated: true,
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
