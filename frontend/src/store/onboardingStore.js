import { create } from 'zustand'
import { api } from '../lib/api.js'

/**
 * Tracks whether the user has done any ML training.
 * Used to show/hide the Getting Started button in the header.
 *
 * "Done" = at least one ML model has totalEpisodes > 0.
 * Result is cached in localStorage keyed by userId so it's instant on
 * subsequent page loads and survives tab close.
 */
export const useOnboardingStore = create((set, get) => ({
  trainingDone: null, // null = unchecked, true = done, false = not done yet
  _userId: null,

  async check(userId, token) {
    const cacheKey = `xo_training_done_${userId}`

    // Fast path: already cached as done
    if (localStorage.getItem(cacheKey) === '1') {
      set({ trainingDone: true, _userId: userId })
      return
    }

    set({ _userId: userId })

    try {
      const data = await api.get('/ml/models', token)
      const done = Array.isArray(data?.models)
        ? data.models.filter(m => m.createdBy === userId).some(m => (m.totalEpisodes ?? 0) > 0)
        : false
      if (done) localStorage.setItem(cacheKey, '1')
      set({ trainingDone: done })
    } catch {
      // On error, hide the button rather than showing a stale prompt
      set({ trainingDone: true })
    }
  },

  markDone() {
    const { _userId } = get()
    if (_userId) localStorage.setItem(`xo_training_done_${_userId}`, '1')
    set({ trainingDone: true })
  },
}))
