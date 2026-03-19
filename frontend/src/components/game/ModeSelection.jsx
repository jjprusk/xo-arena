import React from 'react'
import { useState, useEffect } from 'react'
import { useGameStore } from '../../store/gameStore.js'
import { api } from '../../lib/api.js'

const DIFFICULTIES = ['easy', 'medium', 'hard']

export default function ModeSelection({ onStart, onPvpCreate, onPvpJoin }) {
  const { setMode, setDifficulty, setAIImplementation, setPlayerMark, setPlayerName, startGame } = useGameStore()

  const [aiExpanded, setAiExpanded] = useState(false)
  const [selectedDifficulty, setSelectedDifficulty] = useState('medium')
  const [selectedImpl, setSelectedImpl] = useState('minimax')
  const [selectedMark, setSelectedMark] = useState('X')
  const [playerName, setPlayerNameLocal] = useState('')
  const [implementations, setImplementations] = useState([])
  const [loadingImpls, setLoadingImpls] = useState(false)
  const [joinInput, setJoinInput] = useState('')

  useEffect(() => {
    if (!aiExpanded) return
    setLoadingImpls(true)
    api.ai.implementations()
      .then((res) => setImplementations(res.implementations || []))
      .catch(() => setImplementations([{ id: 'minimax', name: 'Minimax', supportedDifficulties: ['easy', 'medium', 'hard'] }]))
      .finally(() => setLoadingImpls(false))
  }, [aiExpanded])

  function handlePlayAI() {
    setMode('pvai')
    setDifficulty(selectedDifficulty)
    setAIImplementation(selectedImpl)
    setPlayerMark(selectedMark)
    setPlayerName(playerName)
    startGame()
    onStart?.()
  }

  function extractSlug(input) {
    const trimmed = input.trim()
    try {
      const url = new URL(trimmed)
      return url.searchParams.get('join') || trimmed
    } catch {
      return trimmed
    }
  }

  function handleJoin() {
    const slug = extractSlug(joinInput)
    if (slug) onPvpJoin?.(slug)
  }

  return (
    <div className="flex flex-col gap-4 max-w-sm mx-auto w-full">
      <h1 className="text-3xl font-bold text-center" style={{ fontFamily: 'var(--font-display)' }}>
        XO Arena
      </h1>

      {/* ── Play vs AI ─────────────────────────────────────── */}
      <div
        className="rounded-xl border-2 overflow-hidden transition-colors"
        style={{
          borderColor: aiExpanded ? 'var(--color-blue-600)' : 'var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <button
          onClick={() => setAiExpanded((v) => !v)}
          className="w-full flex items-center gap-4 p-4 text-left"
        >
          <span className="text-3xl">🤖</span>
          <div className="flex-1">
            <div className="font-semibold">Play vs AI</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Solo game against the computer
            </div>
          </div>
          <span className="text-lg" style={{ color: 'var(--text-muted)' }}>
            {aiExpanded ? '▲' : '▼'}
          </span>
        </button>

        {aiExpanded && (
          <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
            {/* Difficulty */}
            <div className="pt-3">
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                Difficulty
              </label>
              <div className="flex gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelectedDifficulty(d)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 capitalize transition-colors ${
                      selectedDifficulty === d
                        ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-600)]'
                        : 'border-[var(--border-default)] hover:border-[var(--color-gray-400)]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Engine */}
            {!loadingImpls && implementations.length > 1 && (
              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                  AI Engine
                </label>
                <div className="space-y-2">
                  {implementations.map((impl) => (
                    <label
                      key={impl.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                        selectedImpl === impl.id
                          ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]'
                          : 'border-[var(--border-default)] hover:border-[var(--color-gray-400)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="impl"
                        value={impl.id}
                        checked={selectedImpl === impl.id}
                        onChange={() => setSelectedImpl(impl.id)}
                        className="mt-0.5 accent-[var(--color-blue-600)]"
                      />
                      <div>
                        <div className="font-medium text-sm">{impl.name}</div>
                        {impl.description && (
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{impl.description}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Mark */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                Play as
              </label>
              <div className="flex gap-2">
                {['X', 'O'].map((mark) => (
                  <button
                    key={mark}
                    onClick={() => setSelectedMark(mark)}
                    className="flex-1 py-2 rounded-lg text-lg font-bold border-2 transition-colors"
                    style={{
                      borderColor: selectedMark === mark
                        ? (mark === 'X' ? 'var(--color-blue-600)' : 'var(--color-teal-600)')
                        : 'var(--border-default)',
                      backgroundColor: selectedMark === mark
                        ? (mark === 'X' ? 'var(--color-blue-50)' : 'var(--color-teal-50)')
                        : 'var(--bg-surface)',
                      color: mark === 'X' ? 'var(--color-blue-600)' : 'var(--color-teal-600)',
                    }}
                  >
                    {mark}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handlePlayAI}
              className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', boxShadow: 'var(--shadow-md)' }}
            >
              Play vs AI
            </button>
          </div>
        )}
      </div>

      {/* ── Create a Room ──────────────────────────────────── */}
      <button
        onClick={onPvpCreate}
        className="w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-colors hover:border-[var(--color-teal-600)] hover:bg-[var(--color-teal-50)]"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
      >
        <span className="text-3xl">👥</span>
        <div className="flex-1">
          <div className="font-semibold">Create a Room</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Get an invite link to share with a friend
          </div>
        </div>
        <span className="text-lg" style={{ color: 'var(--text-muted)' }}>→</span>
      </button>

      {/* ── Join a Room ────────────────────────────────────── */}
      <div
        className="rounded-xl border-2 p-4 space-y-3"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <div>
            <div className="font-semibold text-sm">Join a Room</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Have an invite link? Paste it below
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="Invite link or room code…"
            className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-teal-600)] transition-colors"
            style={{
              backgroundColor: 'var(--bg-page)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={handleJoin}
            disabled={!joinInput.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))' }}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  )
}
