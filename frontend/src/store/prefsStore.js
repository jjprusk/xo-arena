import { create } from 'zustand'

export const usePrefsStore = create(set => ({
  loaded: false,
  setPrefs: (prefs) => set({ ...prefs, loaded: true }),
}))
