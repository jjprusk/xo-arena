// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Sound types ───────────────────────────────────────────────────────────────
export const NOTIF_SOUND_TYPES = [
  { id: 'ding',  label: 'Ding',  description: 'Single bell tone' },
  { id: 'chime', label: 'Chime', description: 'Ascending two-note' },
  { id: 'blip',  label: 'Blip',  description: 'Short retro beep' },
]

// ── Web Audio synthesis ───────────────────────────────────────────────────────
// Chrome's autoplay policy rejects AudioContext creation before a user gesture
// and logs a warning per attempt. SSE replay on page load can deliver several
// queued notifications before the user has clicked anything, so we defer the
// AudioContext until the first user gesture. `play()` silently no-ops until
// then — the missed notification sounds are not worth a console full of
// "AudioContext was not allowed to start" warnings.
let _audioCtx = null
let _gestureHappened = false
let _lastPlay = { type: null, at: 0, result: 'none' }

function ctx() {
  if (!_gestureHappened) { _lastPlay.result = 'no-gesture'; return null }
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  // resume() is async — on iOS Safari the context can spend a brief moment
  // in 'suspended' after the unlock gesture. Schedule onto the suspended
  // context anyway (oscillator start() calls queue and fire when state
  // transitions to running).
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {})
    _lastPlay.result = 'suspended:scheduled'
    return _audioCtx
  }
  if (_audioCtx.state !== 'running') { _lastPlay.result = `not-running:${_audioCtx.state}`; return null }
  _lastPlay.result = 'ok'
  return _audioCtx
}

// First user gesture unlocks audio. Capture phase so we beat component
// handlers. Once fired, the context is eagerly created so the next play()
// doesn't pay the construction cost.
if (typeof window !== 'undefined') {
  document.addEventListener('pointerdown', () => {
    _gestureHappened = true
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)() } catch {}
    }
    // iOS Safari: resume() inside the gesture + prime with a silent buffer.
    // Without this, a fresh context can stay 'suspended' and later resume()
    // calls (from socket-driven play) silently no-op. Same pattern as
    // soundStore.unlockIOSAudio.
    try { _audioCtx?.resume() } catch {}
    if (_audioCtx) {
      try {
        const buf = _audioCtx.createBuffer(1, 1, 22050)
        const src = _audioCtx.createBufferSource()
        src.buffer = buf
        src.connect(_audioCtx.destination)
        src.start(0)
      } catch {}
    }
  }, { capture: true, passive: true })
}

export function _getNotifAudioDebugState() {
  return {
    hasCtx:     !!_audioCtx,
    state:      _audioCtx?.state ?? 'none',
    gestureHappened: _gestureHappened,
    lastPlay:   { ..._lastPlay },
  }
}

const LOOKAHEAD = 0.05

function tone(ac, freq, startTime, duration, gain = 0.18, type = 'sine') {
  const osc = ac.createOscillator()
  const env = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(gain, startTime)
  env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.connect(env)
  env.connect(ac.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.02)
}

const SOUNDS = {
  ding() {
    const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD
    tone(ac, 880, t,        0.35, 0.20, 'sine')
    tone(ac, 1760, t + 0.01, 0.20, 0.06, 'sine')
  },
  chime() {
    const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD
    tone(ac, 660, t,        0.25, 0.18, 'sine')
    tone(ac, 990, t + 0.15, 0.35, 0.18, 'sine')
  },
  blip() {
    const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD
    tone(ac, 440, t,       0.06, 0.20, 'square')
    tone(ac, 660, t + 0.07, 0.06, 0.15, 'square')
  },
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useNotifSoundStore = create(
  persist(
    (set, get) => ({
      enabled: true,
      type: 'ding',

      setEnabled(enabled) { set({ enabled }) },
      setType(type)       { set({ type }) },

      play() {
        const { enabled, type } = get()
        _lastPlay.type = type
        _lastPlay.at   = Date.now()
        if (!enabled) { _lastPlay.result = 'disabled'; return }
        try {
          SOUNDS[type]?.()
        } catch { /* non-fatal — audio may be unavailable */ }
      },
    }),
    { name: 'xo-notif-sound' },
  ),
)
