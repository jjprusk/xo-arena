// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useMemo, useEffect } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { GAMES } from '../../lib/gameRegistry.js'

/**
 * AddSkillModal — Phase 3.8 Multi-Skill Bots.
 *
 * Adds a new BotSkill to an existing skill-less identity bot. The dropdown
 * lists games the bot does NOT already have a skill for; in the single-game
 * world this is just XO (or empty if it already has one). The structure is
 * deliberate so Phase 4 (Connect4) lights up the dropdown by adding a row to
 * `gameRegistry.js`, no UI change needed.
 *
 * Algorithm choice surfaces the canonical algorithm allow-list shared by the
 * /bots/:id/skills endpoint (`SUPPORTED_SKILL_ALGORITHMS`). The friendly
 * labels here are display-only — the value posted is the raw algorithm key
 * the backend validator accepts.
 *
 * Props:
 *   bot       — the identity bot { id, displayName, skills?: BotSkill[] }
 *   onClose() — close handler (caller resets focus / clears error state)
 *   onAdded(skill) — fired with the created (or existing-on-idempotent-replay)
 *                    skill so the caller can refresh its bot list.
 */
const ALGORITHM_OPTIONS = [
  { value: 'qlearning',      label: 'Q-Learning (recommended starter)' },
  { value: 'sarsa',          label: 'SARSA' },
  { value: 'montecarlo',     label: 'Monte Carlo' },
  { value: 'policygradient', label: 'Policy Gradient' },
  { value: 'dqn',            label: 'DQN (Deep Q-Network)' },
  { value: 'alphazero',      label: 'AlphaZero' },
  { value: 'minimax',        label: 'Minimax (rules-based, no training)' },
]

export default function AddSkillModal({ bot, onClose, onAdded }) {
  const existingGameIds = useMemo(
    () => new Set((bot?.skills ?? []).map(s => s.gameId)),
    [bot]
  )
  const availableGames = useMemo(
    () => GAMES.filter(g => !existingGameIds.has(g.id)),
    [existingGameIds]
  )

  const [gameId, setGameId]       = useState(availableGames[0]?.id ?? '')
  const [algorithm, setAlgorithm] = useState('qlearning')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState(null)

  // Re-pin the gameId default if the bot prop swaps under us (rare —
  // happens only if the parent reuses the modal across two bots).
  useEffect(() => {
    if (!gameId && availableGames[0]) setGameId(availableGames[0].id)
  }, [availableGames, gameId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    if (!gameId) { setError('Pick a game.'); return }
    if (!algorithm) { setError('Pick an algorithm.'); return }

    setSubmitting(true)
    setError(null)
    try {
      const token = await getToken()
      const { skill } = await api.bots.skills.add(bot.id, { gameId, algorithm }, token)
      onAdded?.(skill)
      onClose?.()
    } catch (err) {
      setError(err.message || 'Could not add skill.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-skill-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className="w-full max-w-md rounded-xl border shadow-xl"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <h2 id="add-skill-title" className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Add a skill to {bot?.displayName ?? 'this bot'}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Pick the game and the algorithm. You'll train it in the Gym.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {availableGames.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This bot already has a skill for every supported game.
            </p>
          ) : (
            <>
              <label className="space-y-1 block">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Game</span>
                <select
                  value={gameId}
                  onChange={e => setGameId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  data-testid="add-skill-game"
                >
                  {availableGames.map(g => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Algorithm</span>
                <select
                  value={algorithm}
                  onChange={e => setAlgorithm(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  data-testid="add-skill-algorithm"
                >
                  {ALGORITHM_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting || availableGames.length === 0}
              className="btn btn-primary btn-sm"
              data-testid="add-skill-submit"
            >
              {submitting ? 'Adding…' : 'Add skill'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm border"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
