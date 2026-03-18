import React from 'react'
import { useState, useEffect } from 'react'
import { useGameStore } from '../../store/gameStore.js'
import { api } from '../../lib/api.js'

const DIFFICULTIES = ['easy', 'medium', 'hard']

export default function ModeSelection({ onStart, onPvpCreate }) {
  const { setMode, setDifficulty, setAIImplementation, setPlayerMark, setPlayerName, startGame } = useGameStore()

  const [selectedMode, setSelectedMode] = useState(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState('medium')
  const [selectedImpl, setSelectedImpl] = useState('minimax')
  const [selectedMark, setSelectedMark] = useState('X')
  const [playerName, setPlayerNameLocal] = useState('')
  const [implementations, setImplementations] = useState([])
  const [loadingImpls, setLoadingImpls] = useState(false)

  // Load AI implementations
  useEffect(() => {
    if (selectedMode !== 'pvai') return
    setLoadingImpls(true)
    api.ai.implementations()
      .then((res) => setImplementations(res.implementations || []))
      .catch(() => setImplementations([{ id: 'minimax', name: 'Minimax', supportedDifficulties: ['easy', 'medium', 'hard'] }]))
      .finally(() => setLoadingImpls(false))
  }, [selectedMode])

  const canStart = selectedMode === 'pvp' || (selectedMode === 'pvai' && selectedImpl)

  function handleStart() {
    if (selectedMode === 'pvp') {
      onPvpCreate?.()
      return
    }
    setMode(selectedMode)
    setDifficulty(selectedDifficulty)
    setAIImplementation(selectedImpl)
    setPlayerMark(selectedMark)
    setPlayerName(playerName)
    startGame()
    onStart?.()
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto w-full">
      <h1 className="text-3xl font-bold text-center" style={{ fontFamily: 'var(--font-display)' }}>
        XO Arena
      </h1>

      {/* Mode cards */}
      <div className="flex gap-3">
        <ModeCard
          selected={selectedMode === 'pvai'}
          onClick={() => setSelectedMode('pvai')}
          title="vs AI"
          description="Play against the computer"
          icon="🤖"
        />
        <ModeCard
          selected={selectedMode === 'pvp'}
          onClick={() => setSelectedMode('pvp')}
          title="vs Player"
          description="Play with a friend online"
          icon="👥"
        />
      </div>

      {/* PvAI options */}
      {selectedMode === 'pvai' && (
        <div className="space-y-4">
          {/* Difficulty */}
          <div>
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

          {/* AI Implementation */}
          <div>
            <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
              AI Engine
            </label>
            {loadingImpls ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {/* Mark + name options (both modes) */}
      {selectedMode && (
        <div className="space-y-4">
          {/* Mark preference */}
          <div>
            <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
              Play as
            </label>
            <div className="flex gap-2">
              {['X', 'O'].map((mark) => (
                <button
                  key={mark}
                  onClick={() => setSelectedMark(mark)}
                  className={`flex-1 py-2 rounded-lg text-lg font-bold border-2 transition-colors`}
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

          {/* Player name (optional) */}
          <div>
            <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
              Your name <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerNameLocal(e.target.value)}
              placeholder="Enter name…"
              maxLength={20}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="w-full py-3 rounded-xl font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: canStart ? 'var(--color-blue-600)' : 'var(--color-gray-300)' }}
          >
            {selectedMode === 'pvai' ? 'Play vs AI' : 'Create Room'}
          </button>
        </div>
      )}
    </div>
  )
}

function ModeCard({ selected, onClick, title, description, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors text-center`}
      style={{
        borderColor: selected ? 'var(--color-blue-600)' : 'var(--border-default)',
        backgroundColor: selected ? 'var(--color-blue-50)' : 'var(--bg-surface)',
      }}
    >
      <span className="text-3xl">{icon}</span>
      <span className="font-semibold text-sm">{title}</span>
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{description}</span>
    </button>
  )
}
