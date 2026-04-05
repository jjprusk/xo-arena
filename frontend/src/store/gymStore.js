import { create } from 'zustand'

/**
 * Minimal Gym state shared across components.
 * Currently only tracks whether a client-side training session is running,
 * so the global idle-logout timer can suppress itself during training.
 */
export const useGymStore = create(set => ({
  isTraining: false,
  setTraining: (v) => set({ isTraining: v }),
}))
