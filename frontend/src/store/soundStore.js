import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Howl, Howler } from 'howler'

export const SOUND_PACKS = [
  { id: 'default', label: 'Default', description: 'Clean classic sounds' },
  { id: 'retro',   label: 'Retro',   description: '8-bit arcade style' },
  { id: 'nature',  label: 'Nature',  description: 'Soft ambient sounds' },
]

// ── Default pack — file-based via Howler ─────────────────────────────────────
const howlCache = {}

function getHowl(key) {
  if (!howlCache[key]) {
    // html5: true uses HTMLAudioElement instead of Web Audio API.
    // This avoids the AudioContext suspended-state problem in Chrome where
    // newly created AudioContexts start suspended even inside click handlers.
    howlCache[key] = new Howl({ src: [`/sounds/${key}.wav`], html5: true })
  }
  return howlCache[key]
}

// ── Retro / Nature packs — Web Audio synthesis ───────────────────────────────
let _audioCtx = null
function ctx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  // Resume if suspended (browser autoplay policy)
  if (_audioCtx.state === 'suspended') _audioCtx.resume()
  return _audioCtx
}

function tone(type, freq, startTime, duration, gain = 0.18, fadeOut = true) {
  const ac = ctx()
  const osc = ac.createOscillator()
  const env = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(gain, startTime)
  if (fadeOut) env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(env)
  env.connect(ac.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

const SYNTH = {
  retro: {
    move() {
      const ac = ctx(); const t = ac.currentTime
      tone('square', 330, t, 0.08, 0.15)
      tone('square', 440, t + 0.05, 0.07, 0.12)
    },
    win() {
      const ac = ctx(); const t = ac.currentTime
      const notes = [523, 659, 784, 1047]
      notes.forEach((f, i) => tone('square', f, t + i * 0.1, 0.15, 0.15))
    },
    draw() {
      const ac = ctx(); const t = ac.currentTime
      tone('square', 440, t,        0.1, 0.15)
      tone('square', 330, t + 0.12, 0.1, 0.12)
    },
    forfeit() {
      const ac = ctx(); const t = ac.currentTime
      tone('square', 330, t,        0.12, 0.15)
      tone('square', 220, t + 0.14, 0.18, 0.15)
      tone('square', 165, t + 0.30, 0.22, 0.12)
    },
  },

  nature: {
    move() {
      const ac = ctx(); const t = ac.currentTime
      tone('sine', 528, t, 0.18, 0.12)
      tone('sine', 792, t + 0.02, 0.12, 0.08)
    },
    win() {
      const ac = ctx(); const t = ac.currentTime
      const notes = [528, 660, 792, 1056]
      notes.forEach((f, i) => {
        tone('sine', f,       t + i * 0.14, 0.28, 0.14)
        tone('sine', f * 1.5, t + i * 0.14, 0.20, 0.06)
      })
    },
    draw() {
      const ac = ctx(); const t = ac.currentTime
      tone('sine', 440, t,        0.25, 0.10)
      tone('sine', 528, t + 0.05, 0.20, 0.08)
    },
    forfeit() {
      const ac = ctx(); const t = ac.currentTime
      const osc = ac.createOscillator()
      const env = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(330, t)
      osc.frequency.exponentialRampToValueAtTime(165, t + 0.5)
      env.gain.setValueAtTime(0.14, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
      osc.connect(env); env.connect(ac.destination)
      osc.start(t); osc.stop(t + 0.55)
    },
  },
}

// ── Store ─────────────────────────────────────────────────────────────────────
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
        if (muted) return
        if (soundPack === 'default') {
          getHowl(key)?.play()
        } else {
          SYNTH[soundPack]?.[key]?.()
        }
      },
    }),
    { name: 'xo-sound' },
  ),
)
