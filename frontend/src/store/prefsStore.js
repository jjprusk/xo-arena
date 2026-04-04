import { create } from 'zustand'

export const usePrefsStore = create(set => ({
  showGuideButton: true,  // optimistic default — replaced once hints are fetched
  playHintSeen: true,     // optimistic default — show nothing until hints loaded
  loaded: false,
  setPrefs: (prefs) => set({ ...prefs, loaded: true }),
  setShowGuideButton: (val) => set({ showGuideButton: val }),
  setPlayHintSeen: () => set({ playHintSeen: true }),
}))
