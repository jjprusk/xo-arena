import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Howl } from 'howler'

export const SOUND_PACKS = [
  { id: 'default', label: 'Default', description: 'Clean classic sounds' },
  { id: 'retro',   label: 'Retro',   description: '8-bit arcade style' },
  { id: 'nature',  label: 'Nature',  description: 'Soft ambient sounds' },
]

// Sounds are loaded lazily per pack — cache keyed by `{pack}/{key}`
const soundCache = {}

function getSound(pack, key) {
  const cacheKey = `${pack}/${key}`
  if (!soundCache[cacheKey]) {
    // Fall back to default pack if file missing (non-default packs may not exist yet)
    const src = pack === 'default'
      ? [`/sounds/${key}.wav`]
      : [`/sounds/${pack}/${key}.wav`, `/sounds/${key}.wav`]
    soundCache[cacheKey] = new Howl({ src, volume: 0.5 })
  }
  return soundCache[cacheKey]
}

export const useSoundStore = create(
  persist(
    (set, get) => ({
      muted: false,
      volume: 0.5,
      soundPack: 'default',

      toggleMute() {
        const next = !get().muted
        set({ muted: next })
        Howler.mute(next)
      },

      setVolume(v) {
        set({ volume: v })
        Howler.volume(v)
      },

      setSoundPack(pack) {
        set({ soundPack: pack })
      },

      play(key) {
        const { muted, soundPack } = get()
        if (!muted) {
          getSound(soundPack, key)?.play()
        }
      },
    }),
    { name: 'xo-sound' },
  ),
)
