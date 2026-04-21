// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Landing site uses Web Audio synthesis only — no Howler/file dependency.
export const SOUND_PACKS = [
  { id: 'retro',  label: 'Retro',  description: '8-bit arcade style' },
  { id: 'nature', label: 'Nature', description: 'Soft ambient sounds' },
]

// ── Web Audio state machine ───────────────────────────────────────────────────
//
// macOS Space switch DOES NOT fire `visibilitychange` (the tab stays "visible"
// per spec, the window is just on another Space). Only `window.focus`/`blur`
// fire reliably. Safari's AudioContext can also end up in `interrupted` state
// after such switches, where `.resume()` silently no-ops. After an OS audio
// device route change (Bluetooth, AirPlay, sleep/wake), `state` can report
// `running` while no sound is produced ("silent running" bug).
//
// Strategy:
//   1. Mark the context "stale" on ANY focus/blur/visibility transition.
//   2. Non-gesture callers (socket events) that hit a stale-or-not-running
//      context return NULL and skip playback entirely — playing into such a
//      context queues tones that may fire as random beeps when the context
//      finally resumes, AND the tones aren't actually audible during the
//      broken window anyway.
//   3. On the next user gesture (pointerdown, capture phase), close and
//      recreate the context — this is the only universal recovery path
//      across Safari's `interrupted` state, Chrome's `suspended` state,
//      and all OS audio route-change edge cases.

let _audioCtx    = null
let _masterGain  = null
let _synthVolume = 0.15
let _maybeStale  = false

function attachStateChangeWatcher(ac) {
  // Safari transitions to `interrupted` without firing focus/blur events
  // during some audio route changes. Mark stale so the next gesture recreates.
  ac.addEventListener?.('statechange', () => {
    if (ac.state !== 'running') _maybeStale = true
  })
}

function createFreshCtx() {
  try { _audioCtx?.close() } catch (_) {}
  _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  _masterGain = _audioCtx.createGain()
  _masterGain.gain.value = _synthVolume
  _masterGain.connect(_audioCtx.destination)
  attachStateChangeWatcher(_audioCtx)
  _maybeStale = false
  return _audioCtx
}

// Return the context ONLY if it's safe to schedule tones on it right now.
// Return null for non-gesture callers when the context is stale, missing, or
// not `running`. Null callers bail silently — no queued beeps. The next user
// gesture recreates the context and playback resumes automatically.
function ctx() {
  // Guard against playing while on another macOS Space / another app.
  // `blur` does NOT fire reliably on Space switches (the window stays the
  // frontmost in its Space per AppKit), so `_maybeStale` may still be false
  // even when the user can't hear anything. `document.hasFocus()` is the
  // authoritative "am I the active window right now" check — it returns
  // false on all forms of backgrounding (Space switch, Cmd+Tab, minimize,
  // occlusion) regardless of which DOM events fired.
  if (typeof document !== 'undefined' && !document.hasFocus()) return null
  if (_maybeStale) return null
  if (!_audioCtx || _audioCtx.state === 'closed') return null
  if (_audioCtx.state !== 'running') {
    // Kick resume() for Chrome's `suspended` path, but don't schedule onto it
    // right now — Safari's `interrupted` state silently no-ops resume().
    _audioCtx.resume().catch(() => {})
    return null
  }
  return _audioCtx
}

if (typeof window !== 'undefined') {
  // Capture-phase pointerdown fires BEFORE any component handlers, so we can
  // prepare the audio pipeline before the click sound needs to play. Inside
  // a user gesture, a fresh AudioContext starts 'running' on every browser —
  // this bypasses `.resume()` entirely and is the only reliable recovery
  // path from Safari's `interrupted` state or the silent-running bug.
  document.addEventListener('pointerdown', () => {
    if (!_audioCtx || _audioCtx.state !== 'running' || _maybeStale) {
      createFreshCtx()
    }
  }, { capture: true, passive: true })

  // On departure, close the AudioContext — not just mark stale. Tones are
  // scheduled `LOOKAHEAD` seconds into the future (~50ms); without close(),
  // those already-queued `osc.start(t)` calls fire while the user is on the
  // other Space / tab, producing "spontaneous beeps". close() cancels them.
  // Marking stale also blocks future schedules from socket-driven events.
  // pointerdown (capture) recreates the context on return.
  function suspendAndClose() {
    _maybeStale = true
    try { _audioCtx?.close() } catch (_) {}
    _audioCtx   = null
    _masterGain = null
  }

  // `window.focus`/`blur` are the ONLY reliable macOS Space-switch signals.
  window.addEventListener('blur',  suspendAndClose)
  // focus just marks stale — actual recreation happens on the next gesture.
  window.addEventListener('focus', () => { _maybeStale = true })

  // visibilitychange covers tab-switch / minimize / occlusion. Only close on
  // transition TO hidden; the visible transition is handled by pointerdown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') suspendAndClose()
  })

  // `pagehide` fires on bfcache eviction and tab close — close to release.
  window.addEventListener('pagehide', suspendAndClose)
}

const LOOKAHEAD = 0.05

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

const SYNTH = {
  retro: {
    move()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 330, t, 0.08, 0.15); tone(ac, 'square', 440, t + 0.05, 0.07, 0.12) },
    win()     { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; [523, 659, 784, 1047].forEach((f, i) => tone(ac, 'square', f, t + i * 0.1, 0.15, 0.15)) },
    draw()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 440, t, 0.1, 0.15); tone(ac, 'square', 330, t + 0.12, 0.1, 0.12) },
    forfeit() { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'square', 330, t, 0.12, 0.15); tone(ac, 'square', 220, t + 0.14, 0.18, 0.15); tone(ac, 'square', 165, t + 0.30, 0.22, 0.12) },
  },
  nature: {
    move()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'sine', 528, t, 0.18, 0.12); tone(ac, 'sine', 792, t + 0.02, 0.12, 0.08) },
    win()     { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; [528, 660, 792, 1056].forEach((f, i) => { tone(ac, 'sine', f, t + i * 0.14, 0.28, 0.14); tone(ac, 'sine', f * 1.5, t + i * 0.14, 0.20, 0.06) }) },
    draw()    { const ac = ctx(); if (!ac) return; const t = ac.currentTime + LOOKAHEAD; tone(ac, 'sine', 440, t, 0.25, 0.10); tone(ac, 'sine', 528, t + 0.05, 0.20, 0.08) },
    forfeit() {
      const ac = ctx(); if (!ac) return
      const t = ac.currentTime + LOOKAHEAD
      const osc = ac.createOscillator(); const env = ac.createGain()
      osc.type = 'sine'; osc.frequency.setValueAtTime(330, t); osc.frequency.exponentialRampToValueAtTime(165, t + 0.5)
      env.gain.setValueAtTime(0.14, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
      osc.connect(env); env.connect(_masterGain); osc.start(t); osc.stop(t + 0.55)
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
        set({ muted: !get().muted })
      },

      setVolume(v) {
        _synthVolume = v
        if (_masterGain) _masterGain.gain.value = v
        set({ volume: v })
      },

      setSoundPack(pack) {
        set({ soundPack: pack })
      },

      play(key) {
        const { muted, soundPack } = get()
        if (muted) return
        // Debug trace — enable via `window.__debugSound = true` in DevTools console
        if (typeof window !== 'undefined' && window.__debugSound) {
          // eslint-disable-next-line no-console
          console.trace(`[sound] play('${key}')`)
        }
        // Fallback to 'retro' if stored pack is invalid (e.g. 'default' from frontend)
        const pack = SYNTH[soundPack] ? soundPack : 'retro'
        SYNTH[pack][key]?.()
      },
    }),
    {
      name: 'xo-sound',
      version: 1,
      // Migrate old persisted state: 'default' pack was removed; map it to 'retro'.
      migrate: (old) => ({
        ...old,
        soundPack: ['retro', 'nature'].includes(old?.soundPack) ? old.soundPack : 'retro',
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.volume != null) _synthVolume = state.volume
      },
    },
  ),
)
