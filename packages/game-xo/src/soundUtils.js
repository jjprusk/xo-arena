// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Lightweight game sound utility using the Web Audio API.
 * No external dependencies — synthesized tones that match the platform's 'retro' pack.
 */

let _ctx = null

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {})
  return _ctx
}

function tone(freq, type, startTime, duration, gain = 0.18) {
  const c = ctx()
  const osc = c.createOscillator()
  const env = c.createGain()
  osc.connect(env)
  env.connect(c.destination)
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  env.gain.setValueAtTime(0, startTime)
  env.gain.linearRampToValueAtTime(gain, startTime + 0.01)
  env.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.01)
}

const SYNTH = {
  move() {
    const t = ctx().currentTime
    tone(440, 'square', t, 0.06, 0.12)
    tone(660, 'square', t + 0.06, 0.06, 0.08)
  },
  win() {
    const t = ctx().currentTime
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 'square', t + i * 0.1, 0.15, 0.14))
  },
  draw() {
    const t = ctx().currentTime
    tone(330, 'square', t, 0.1, 0.12)
    tone(294, 'square', t + 0.12, 0.15, 0.10)
  },
  forfeit() {
    const t = ctx().currentTime
    tone(330, 'sawtooth', t, 0.12, 0.12)
    tone(220, 'sawtooth', t + 0.14, 0.18, 0.10)
  },
}

export function playSound(key) {
  if (typeof window === 'undefined') return
  try { SYNTH[key]?.() } catch { /* AudioContext may be unavailable */ }
}
