import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Theme store — persists user's theme preference.
 * Applies the .dark class to <html> when dark mode is active.
 */
export const useThemeStore = create(
  persist(
    (set, get) => ({
      /** 'light' | 'dark' | 'system' */
      theme: 'light',

      setTheme(theme) {
        set({ theme })
        applyTheme(theme)
      },

      init() {
        applyTheme(get().theme)
      },
    }),
    { name: 'xo-theme' },
  ),
)

function applyTheme(theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
}
