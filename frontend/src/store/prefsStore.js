import { create } from 'zustand'

export const usePrefsStore = create(set => ({
  showGuideButton: true,  // optimistic default — replaced once hints are fetched
  loaded: false,
  setPrefs: (prefs) => set({ ...prefs, loaded: true }),
  setShowGuideButton: (val) => set({ showGuideButton: val }),
}))
