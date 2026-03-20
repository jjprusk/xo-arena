import React from 'react'
import { useState, useEffect } from 'react'
import { useGameStore } from '../../store/gameStore.js'
import { api } from '../../lib/api.js'

const DIFFICULTIES = ['easy', 'medium', 'hard']

export default function ModeSelection({ onStart, onPvpJoin, inviteUrl, roomName }) {
  const { setMode, setDifficulty, setAIImplementation, setMLModelId, setPlayerMark, setPlayerName, startGame } = useGameStore()

  const [aiExpanded, setAiExpanded] = useState(false)
  const [selectedDifficulty, setSelectedDifficulty] = useState('medium')
  const [selectedImpl, setSelectedImpl] = useState('minimax')
  const [selectedMark, setSelectedMark] = useState('X')
  const [playerName, setPlayerNameLocal] = useState('')
  const [implementations, setImplementations] = useState([])
  const [loadingImpls, setLoadingImpls] = useState(false)
  const [mlModels, setMlModels] = useState([])
  const [selectedModelId, setSelectedModelId] = useState(null)
  const [joinInput, setJoinInput] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [rooms, setRooms] = useState([])
  const [showRoomList, setShowRoomList] = useState(false)
  const joinRef = React.useRef(null)

  // Fetch room list whenever the join input is focused or opened
  function handleJoinFocus() {
    api.rooms.list()
      .then((res) => setRooms(res.rooms || []))
      .catch(() => setRooms([]))
    setShowRoomList(true)
  }

  function handleJoinBlur() {
    // Delay so clicks on dropdown items register first
    setTimeout(() => setShowRoomList(false), 150)
  }

  // Rooms filtered by current input text
  const filteredRooms = joinInput.trim()
    ? rooms.filter((r) =>
        r.displayName.toLowerCase().includes(joinInput.toLowerCase()) ||
        r.slug.toLowerCase().includes(joinInput.toLowerCase())
      )
    : rooms

  function selectRoom(room) {
    setJoinInput(room.slug)
    setShowRoomList(false)
  }

  function handleCopyInvite() {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    })
  }

  useEffect(() => {
    if (!aiExpanded) return
    setLoadingImpls(true)
    api.ai.implementations()
      .then((res) => setImplementations(res.implementations || []))
      .catch(() => setImplementations([{ id: 'minimax', name: 'Minimax', supportedDifficulties: ['easy', 'medium', 'hard'] }]))
      .finally(() => setLoadingImpls(false))
  }, [aiExpanded])

  // Fetch ML models when ML engine is selected
  useEffect(() => {
    if (selectedImpl !== 'ml') return
    api.ml.listModels()
      .then((res) => {
        const models = res.models || []
        setMlModels(models)
        if (models.length > 0 && !selectedModelId) setSelectedModelId(models[0].id)
      })
      .catch(() => setMlModels([]))
  }, [selectedImpl])

  function handlePlayAI() {
    setMode('pvai')
    setDifficulty(selectedDifficulty)
    setAIImplementation(selectedImpl)
    setMLModelId(selectedImpl === 'ml' ? selectedModelId : null)
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
        {roomName || <span style={{ color: 'var(--text-muted)' }}>…</span>}
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

            {/* ML model selector */}
            {selectedImpl === 'ml' && (
              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                  ML Model
                </label>
                {mlModels.length === 0 ? (
                  <p className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>
                    No models found. Train one in the ML dashboard first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {mlModels.map((m) => (
                      <label
                        key={m.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                          selectedModelId === m.id
                            ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]'
                            : 'border-[var(--border-default)] hover:border-[var(--color-gray-400)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="mlmodel"
                          value={m.id}
                          checked={selectedModelId === m.id}
                          onChange={() => setSelectedModelId(m.id)}
                          className="mt-0.5 accent-[var(--color-blue-600)]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{m.name}</div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {m.algorithm?.replace('_', '-')} · {m.totalEpisodes?.toLocaleString() ?? 0} episodes · ELO {m.eloRating ?? 1200}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
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
              disabled={selectedImpl === 'ml' && !selectedModelId}
              className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', boxShadow: 'var(--shadow-md)' }}
            >
              Play vs AI
            </button>
          </div>
        )}
      </div>

      {/* ── Invite a Friend ────────────────────────────────── */}
      <div
        className="rounded-xl border-2 p-4 space-y-3"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">👥</span>
          <div className="flex-1">
            <div className="font-semibold text-sm">Invite a Friend</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Share your room link — they jump straight in
            </div>
          </div>
        </div>
        {inviteUrl ? (
          <div className="flex gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 px-3 py-2 rounded-lg border text-xs font-mono truncate"
              style={{ backgroundColor: 'var(--bg-page)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            />
            <button
              onClick={handleCopyInvite}
              className="px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
              style={{ background: inviteCopied ? 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))' : 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              {inviteCopied ? '✓' : 'Copy'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1">
            <div className="w-3.5 h-3.5 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Creating room…</span>
          </div>
        )}
      </div>

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
              Pick a room or paste an invite link
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1" ref={joinRef}>
            <input
              type="text"
              value={joinInput}
              onChange={(e) => { setJoinInput(e.target.value); setShowRoomList(true) }}
              onFocus={handleJoinFocus}
              onBlur={handleJoinBlur}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="Search rooms or paste invite link…"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-teal-600)] transition-colors"
              style={{
                backgroundColor: 'var(--bg-page)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
            {showRoomList && filteredRooms.length > 0 && (
              <ul
                className="absolute left-0 right-0 top-full mt-1 rounded-lg border overflow-hidden z-50"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                  boxShadow: 'var(--shadow-md)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
              >
                {filteredRooms.map((room) => (
                  <li key={room.slug}>
                    <button
                      onMouseDown={() => selectRoom(room)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
                    >
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {room.displayName}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: room.status === 'waiting'
                            ? 'var(--color-teal-50)'
                            : 'var(--color-amber-50)',
                          color: room.status === 'waiting'
                            ? 'var(--color-teal-700)'
                            : 'var(--color-amber-700)',
                        }}
                      >
                        {room.status === 'waiting' ? 'Open' : 'Playing'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showRoomList && filteredRooms.length === 0 && joinInput.trim() === '' && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-lg border px-3 py-2 text-sm z-50"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-muted)',
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                No open rooms right now
              </div>
            )}
          </div>
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
