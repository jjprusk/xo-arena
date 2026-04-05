import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Howl, Howler } from 'howler'

export const SOUND_PACKS = [
  { id: 'default', label: 'Default', description: 'Clean classic sounds' },
  { id: 'retro',   label: 'Retro',   description: '8-bit arcade style' },
  { id: 'nature',  label: 'Nature',  description: 'Soft ambient sounds' },
]

// ── Default pack — file-based via Howler ─────────────────────────────────────
const SOUND_KEYS = ['move', 'win', 'draw', 'forfeit']
const howlCache = {}

function getHowl(key) {
  if (!howlCache[key]) {
    // html5: true uses HTMLAudioElement — avoids AudioContext unlock/replay
    // issues that cause double sounds with Web Audio API.
    // Eager preloading (SOUND_KEYS.forEach below) reduces first-play delay.
    howlCache[key] = new Howl({ src: [`/sounds/${key}.wav`], html5: true, preload: true })
  }
  return howlCache[key]
}

// Preload after first user interaction — avoids pool exhaustion at module
// init while ensuring sounds are buffered before they're needed.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', function preloadSounds() {
    SOUND_KEYS.forEach(getHowl)
  }, { once: true })
}

// ── Retro / Nature packs — Web Audio synthesis ───────────────────────────────
let _audioCtx = null
let _masterGain = null
let _synthVolume = 0.15 // mirrors store volume; updated by setVolume and onRehydrateStorage

function ctx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    _masterGain = _audioCtx.createGain()
    _masterGain.gain.value = _synthVolume
    _masterGain.connect(_audioCtx.destination)
    // Re-resume immediately whenever the browser auto-suspends the context
    // so it is already mid-resume by the time the next sound needs to play.
    _audioCtx.addEventListener('statechange', () => {
      if (_audioCtx?.state === 'suspended') _audioCtx.resume().catch(() => {})
    })
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
  return _audioCtx
}

function tone(ac, type, freq, startTime, duration, gain = 0.18, fadeOut = true) {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(gain, startTime)
  if (fadeOut) env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(env)
  env.connect(_masterGain)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

// Small lookahead (50 ms) so tones fire after the context resumes from
// suspension without audible lag. Relative timing within each sound is unchanged.
const LOOKAHEAD = 0.05

const SYNTH = {
  retro: {
    move() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      tone(ac, 'square', 330, t, 0.08, 0.15)
      tone(ac, 'square', 440, t + 0.05, 0.07, 0.12)
    },
    win() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      const notes = [523, 659, 784, 1047]
      notes.forEach((f, i) => tone(ac, 'square', f, t + i * 0.1, 0.15, 0.15))
    },
    draw() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      tone(ac, 'square', 440, t,        0.1, 0.15)
      tone(ac, 'square', 330, t + 0.12, 0.1, 0.12)
    },
    forfeit() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      tone(ac, 'square', 330, t,        0.12, 0.15)
      tone(ac, 'square', 220, t + 0.14, 0.18, 0.15)
      tone(ac, 'square', 165, t + 0.30, 0.22, 0.12)
    },
  },

  nature: {
    move() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      tone(ac, 'sine', 528, t, 0.18, 0.12)
      tone(ac, 'sine', 792, t + 0.02, 0.12, 0.08)
    },
    win() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      const notes = [528, 660, 792, 1056]
      notes.forEach((f, i) => {
        tone(ac, 'sine', f,       t + i * 0.14, 0.28, 0.14)
        tone(ac, 'sine', f * 1.5, t + i * 0.14, 0.20, 0.06)
      })
    },
    draw() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      tone(ac, 'sine', 440, t,        0.25, 0.10)
      tone(ac, 'sine', 528, t + 0.05, 0.20, 0.08)
    },
    forfeit() {
      const ac = ctx(); const t = ac.currentTime + LOOKAHEAD
      const osc = ac.createOscillator()
      const env = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(330, t)
      osc.frequency.exponentialRampToValueAtTime(165, t + 0.5)
      env.gain.setValueAtTime(0.14, t)
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
      osc.connect(env); env.connect(_masterGain)
      osc.start(t); osc.stop(t + 0.55)
    },
  },
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useSoundStore = create(
  persist(
    (set, get) => ({
      muted: false,
      volume: 0.15,
      soundPack: 'retro',

      toggleMute() {
        const next = !get().muted
        set({ muted: next })
        Howler.mute(next)
      },

      setVolume(v) {
        _synthVolume = v
        if (_masterGain) _masterGain.gain.value = v
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
    {
      name: 'xo-sound',
      onRehydrateStorage: () => (state) => {
        if (state?.volume != null) _synthVolume = state.volume
      },
    },
  ),
)
