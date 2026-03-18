import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Howl } from 'howler'

// Sounds are loaded lazily — Howl instances created on first play
let sounds = {}

function getSound(key) {
  if (!sounds[key]) {
    sounds[key] = new Howl({ src: [`/sounds/${key}.mp3`], volume: 0.5 })
  }
  return sounds[key]
}

export const useSoundStore = create(
  persist(
    (set, get) => ({
      muted: false,
      volume: 0.5,

      toggleMute() {
        const next = !get().muted
        set({ muted: next })
        Howler.mute(next)
      },

      setVolume(v) {
        set({ volume: v })
        Howler.volume(v)
      },

      play(key) {
        if (!get().muted) {
          getSound(key)?.play()
        }
      },
    }),
    { name: 'xo-sound' },
  ),
)
