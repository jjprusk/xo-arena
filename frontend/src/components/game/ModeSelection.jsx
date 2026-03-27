import React from 'react'
import { useState, useEffect } from 'react'
import { useGameStore } from '../../store/gameStore.js'
import { useSession } from '../../lib/auth-client.js'
import { api } from '../../lib/api.js'
import { loadModel } from '../../lib/mlInference.js'

const ALGO_LABELS = {
  minimax: 'Minimax',
  mcts: 'MCTS',
  rule_based: 'Rule-Based',
  Q_LEARNING: 'Q-Learning',
  SARSA: 'SARSA',
  MONTE_CARLO: 'Monte Carlo',
  POLICY_GRADIENT: 'Policy Gradient',
  DQN: 'DQN',
  ALPHA_ZERO: 'AlphaZero',
}

/** Derive AI play config from a bot record */
function getBotPlayConfig(bot) {
  const id = bot.botModelId || ''
  if (id.startsWith('builtin:minimax:')) {
    return { implementation: 'minimax', difficulty: id.split(':')[2] || 'intermediate', mlModelId: null }
  }
  if (id.startsWith('user:')) {
    const parts = id.split(':')
    const algo = parts[2] || 'minimax'
    const diff = parts[3] || 'intermediate'
    const impl = algo === 'rule_based' ? 'rule_based' : 'minimax'
    return { implementation: impl, difficulty: diff, mlModelId: bot.mlModel?.id || null }
  }
  // ML model ID direct
  return { implementation: 'ml', difficulty: 'intermediate', mlModelId: id }
}

const DIFFICULTIES = ['novice', 'intermediate', 'advanced', 'master']
const BEST_OF_OPTIONS = [{ label: 'Single', value: 1 }, { label: 'Best of 3', value: 3 }, { label: 'Best of 5', value: 5 }, { label: 'Best of 7', value: 7 }, { label: 'Unlimited', value: null }]
const TIMER_PRESETS = [15, 30, 60]
const BOARD_THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'neon',    label: 'Neon' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'retro',   label: 'Retro' },
]

export default function ModeSelection({ onStart, onPvpJoin, inviteUrl, roomName }) {
  const {
    setMode, setDifficulty, setAIImplementation, setMLModelId, setPvbotModelId,
    setAI2Implementation, setAI2Difficulty, setAI2ModelId,
    setPlayerMark, setAlternating, setPlayerName, startGame,
    setTimerEnabled, setTimerSeconds, setBestOf, setMisereMode, setBoardTheme,
    timerEnabled, timerSeconds, bestOf, misereMode, boardTheme,
  } = useGameStore()

  const { data: session } = useSession()
  const isSignedIn = !!session?.user

  const [aiExpanded, setAiExpanded] = useState(false)
  const [aivaiExpanded, setAivaiExpanded] = useState(false)
  const [botExpanded, setBotExpanded] = useState(false)
  const [selectedDifficulty, setSelectedDifficulty] = useState('intermediate')
  const [selectedImpl, setSelectedImpl] = useState('minimax')
  const [selectedMark, setSelectedMark] = useState('X')
  const [playerName, setPlayerNameLocal] = useState('')
  const [mlModels, setMlModels] = useState([])
  const [selectedModelId, setSelectedModelId] = useState(null)
  const [ruleSets, setRuleSets] = useState([])
  const [selectedRuleSetId, setSelectedRuleSetId] = useState(null)
  const [joinInput, setJoinInput] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [rooms, setRooms] = useState([])
  const [showRoomList, setShowRoomList] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const joinRef = React.useRef(null)

  // Challenge a bot state
  const [bots, setBots] = useState([])
  const [botsLoading, setBotsLoading] = useState(false)
  const [selectedBotId, setSelectedBotId] = useState(null)

  // AI vs AI config
  const [ai1Impl, setAi1Impl] = useState('minimax')
  const [ai1Diff, setAi1Diff] = useState('master')
  const [ai1ModelId, setAi1ModelId] = useState(null)
  const [ai2Impl, setAi2Impl] = useState('minimax')
  const [ai2Diff, setAi2Diff] = useState('intermediate')
  const [ai2ModelId, setAi2ModelId] = useState(null)
  const [aivaiModels, setAivaiModels] = useState([])

  // Local timer/options state mirrors store
  const [localTimerEnabled, setLocalTimerEnabled] = useState(timerEnabled)
  const [localTimerSeconds, setLocalTimerSeconds] = useState(timerSeconds)
  const [localBestOf, setLocalBestOf] = useState(bestOf)
  const [localMisere, setLocalMisere] = useState(misereMode)
  const [localTheme, setLocalTheme] = useState(boardTheme)

  function handleJoinFocus() {
    api.rooms.list()
      .then((res) => setRooms(res.rooms || []))
      .catch(() => setRooms([]))
    setShowRoomList(true)
  }

  function handleJoinBlur() {
    setTimeout(() => setShowRoomList(false), 150)
  }

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
    if (selectedImpl !== 'ml') return
    api.ml.listModels()
      .then((res) => {
        const models = res.models || []
        setMlModels(models)
        if (models.length > 0 && !selectedModelId) setSelectedModelId(models[0].id)
      })
      .catch(() => setMlModels([]))
  }, [selectedImpl])

  // Preload PvAI model weights as soon as a model is selected
  useEffect(() => {
    if (selectedImpl === 'ml' && selectedModelId) {
      loadModel(selectedModelId, api.ml.exportModel).catch(() => {})
    }
  }, [selectedImpl, selectedModelId])

  useEffect(() => {
    if (selectedImpl !== 'rule_based') return
    api.ml.listRuleSets()
      .then((res) => {
        const sets = res.ruleSets || []
        setRuleSets(sets)
        if (sets.length > 0 && !selectedRuleSetId) setSelectedRuleSetId(sets[0].id)
      })
      .catch(() => setRuleSets([]))
  }, [selectedImpl])

  useEffect(() => {
    if (!botExpanded) return
    setBotsLoading(true)
    api.bots.list()
      .then((res) => {
        const sorted = (res.bots || []).sort((a, b) => (b.eloRating ?? 1200) - (a.eloRating ?? 1200))
        setBots(sorted)
        if (sorted.length > 0 && !selectedBotId) setSelectedBotId(sorted[0].id)
      })
      .catch(() => setBots([]))
      .finally(() => setBotsLoading(false))
  }, [botExpanded])

  useEffect(() => {
    if (!aivaiExpanded) return
    api.ml.listModels()
      .then((res) => {
        const models = res.models || []
        setAivaiModels(models)
        if (models.length > 0) {
          setAi1ModelId(prev => prev ?? models[0].id)
          setAi2ModelId(prev => prev ?? models[0].id)
        }
      })
      .catch(() => setAivaiModels([]))
  }, [aivaiExpanded])

  // Preload AI vs AI model weights when models are selected
  useEffect(() => {
    if (ai1Impl === 'ml' && ai1ModelId) loadModel(ai1ModelId, api.ml.exportModel).catch(() => {})
  }, [ai1Impl, ai1ModelId])

  useEffect(() => {
    if (ai2Impl === 'ml' && ai2ModelId) loadModel(ai2ModelId, api.ml.exportModel).catch(() => {})
  }, [ai2Impl, ai2ModelId])

  // Apply options to store
  function applyOptions() {
    setTimerEnabled(localTimerEnabled)
    setTimerSeconds(localTimerSeconds)
    setBestOf(localBestOf)
    setMisereMode(localMisere)
    setBoardTheme(localTheme)
  }

  function handlePlayAI() {
    applyOptions()
    const isAlternating = selectedMark === 'alternate'
    setMode('pvai')
    setDifficulty(selectedDifficulty)
    setAIImplementation(selectedImpl)
    if (selectedImpl === 'ml') {
      setMLModelId(selectedModelId)
      setPvbotModelId(null)
    } else if (selectedImpl === 'rule_based') {
      setMLModelId(selectedRuleSetId)
      setPvbotModelId(null)
    } else {
      // minimax — record as PVBOT against the built-in bot persona
      setMLModelId(null)
      setPvbotModelId(`builtin:minimax:${selectedDifficulty}`)
    }
    setPlayerMark(isAlternating ? 'X' : selectedMark)
    setAlternating(isAlternating)
    setPlayerName(playerName)
    startGame()
    onStart?.()
  }

  function handleChallengeBot(bot) {
    applyOptions()
    const cfg = getBotPlayConfig(bot)
    const isAlternating = selectedMark === 'alternate'
    setMode('pvai')
    setDifficulty(cfg.difficulty)
    setAIImplementation(cfg.implementation)
    setMLModelId(cfg.mlModelId)
    setPvbotModelId(bot.botModelId)
    setPlayerMark(isAlternating ? 'X' : selectedMark)
    setAlternating(isAlternating)
    setPlayerName(playerName)
    startGame()
    onStart?.()
  }

  function handleWatchAIvsAI() {
    applyOptions()
    setMode('aivai')
    setAIImplementation(ai1Impl)
    setDifficulty(ai1Diff)
    setMLModelId(ai1Impl === 'ml' ? ai1ModelId : null)
    setAI2Implementation(ai2Impl)
    setAI2Difficulty(ai2Diff)
    setAI2ModelId(ai2Impl === 'ml' ? ai2ModelId : null)
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
          onClick={() => { setAiExpanded(v => !v); setAivaiExpanded(false); setBotExpanded(false) }}
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
          <div className="border-t" style={{ borderColor: 'var(--border-default)' }}>
            {/* Tabs */}
            <div className="flex border-b" style={{ borderColor: 'var(--border-default)' }}>
              {[{ id: 'minimax', label: 'Minimax' }, { id: 'ml', label: 'ML Agent' }, { id: 'rule_based', label: 'Rule-Based' }].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedImpl(tab.id)}
                  className="flex-1 py-2.5 text-sm font-medium transition-colors"
                  style={{
                    borderBottom: selectedImpl === tab.id ? '2px solid var(--color-blue-600)' : '2px solid transparent',
                    color: selectedImpl === tab.id ? 'var(--color-blue-600)' : 'var(--text-muted)',
                    marginBottom: '-1px',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="px-4 pb-4 pt-4 space-y-4">
              {/* Minimax tab */}
              {selectedImpl === 'minimax' && (
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Difficulty</label>
                  <select
                    value={selectedDifficulty}
                    onChange={e => setSelectedDifficulty(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  >
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
              )}

              {/* ML Agent tab */}
              {selectedImpl === 'ml' && (
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Model</label>
                  {mlModels.length === 0 ? (
                    <p className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>
                      No models found. Train one in the ML dashboard first.
                    </p>
                  ) : (
                    <select
                      value={selectedModelId ?? ''}
                      onChange={e => setSelectedModelId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                    >
                      {mlModels.map((m) => (
                        <option key={m.id} value={m.id} title={m.creatorName ? `by ${m.creatorName}` : undefined}>
                          {m.name} — {m.algorithm?.replace(/_/g, '-')} · {m.totalEpisodes?.toLocaleString() ?? 0} eps · ELO {m.eloRating ?? 1200}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Rule-Based tab */}
              {selectedImpl === 'rule_based' && (
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Rule Set</label>
                  {ruleSets.length === 0 ? (
                    <div
                      className="rounded-lg border p-3 space-y-2 text-xs"
                      style={{ borderColor: 'var(--color-amber-500)', backgroundColor: 'var(--color-amber-50)' }}
                    >
                      <p className="font-semibold" style={{ color: 'var(--color-amber-700)' }}>
                        No rule sets yet
                      </p>
                      <ol className="space-y-1 list-decimal list-inside" style={{ color: 'var(--color-amber-700)' }}>
                        <li>Train an ML model in the <a href="/admin/ml" className="underline font-medium">ML Dashboard</a></li>
                        <li>Open the model and go to the <strong>Rules</strong> tab</li>
                        <li>Click <strong>Extract rules</strong>, then <strong>Save as rule set</strong></li>
                      </ol>
                      <a
                        href="/admin/ml"
                        className="inline-block mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110"
                        style={{ background: 'linear-gradient(135deg, var(--color-amber-500), var(--color-amber-700))' }}
                      >
                        Go to ML Dashboard →
                      </a>
                    </div>
                  ) : (
                    <select
                      value={selectedRuleSetId ?? ''}
                      onChange={e => setSelectedRuleSetId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                    >
                      {ruleSets.map((rs) => (
                        <option key={rs.id} value={rs.id}>
                          {rs.name} — {Array.isArray(rs.rules) ? rs.rules.filter(r => r.enabled !== false).length : 0} active rules
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Play as — shared by all tabs */}
              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Play as</label>
                <div className="flex gap-2">
                  {[
                    { id: 'X',         label: 'X',  color: 'var(--color-blue-600)',   bg: 'var(--color-blue-50)' },
                    { id: 'O',         label: 'O',  color: 'var(--color-teal-600)',   bg: 'var(--color-teal-50)' },
                    { id: 'alternate', label: '±',  color: 'var(--color-amber-600)',  bg: 'var(--color-amber-50)' },
                  ].map(({ id, label, color, bg }) => (
                    <button
                      key={id}
                      onClick={() => setSelectedMark(id)}
                      className="flex-1 py-2 rounded-lg text-lg font-bold border-2 transition-colors"
                      style={{
                        borderColor: selectedMark === id ? color : 'var(--border-default)',
                        backgroundColor: selectedMark === id ? bg : 'var(--bg-surface)',
                        color,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selectedMark === 'alternate' && (
                  <p className="text-xs mt-1.5 px-0.5" style={{ color: 'var(--text-muted)' }}>
                    Starts as X — marks swap each rematch.
                  </p>
                )}
              </div>

              {/* Game Options accordion */}
              <div>
                <button
                  onClick={() => setShowOptions(v => !v)}
                  className="w-full flex items-center justify-between text-xs px-2 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                >
                  <span className="font-medium">Game options</span>
                  <span>{showOptions ? '▲' : '▼'}</span>
                </button>
                {showOptions && (
                  <div className="mt-2 space-y-3 px-1">
                    {/* Best of N */}
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Series</label>
                      <select
                        value={localBestOf ?? ''}
                        onChange={e => setLocalBestOf(e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none transition-colors"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                      >
                        {BEST_OF_OPTIONS.map(opt => <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>)}
                      </select>
                    </div>

                    {/* Turn timer */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Turn timer</label>
                        <button
                          onClick={() => setLocalTimerEnabled(v => !v)}
                          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                          style={{ backgroundColor: localTimerEnabled ? 'var(--color-blue-600)' : 'var(--color-gray-300)' }}
                        >
                          <span
                            className="inline-block h-3.5 w-3.5 rounded-full bg-white transform transition-transform"
                            style={{ transform: localTimerEnabled ? 'translateX(18px)' : 'translateX(3px)' }}
                          />
                        </button>
                      </div>
                      {localTimerEnabled && (
                        <div className="flex gap-1.5">
                          {TIMER_PRESETS.map(s => (
                            <button
                              key={s}
                              onClick={() => setLocalTimerSeconds(s)}
                              className="flex-1 py-1 rounded-lg text-xs font-medium border-2 transition-colors"
                              style={{
                                borderColor: localTimerSeconds === s ? 'var(--color-blue-600)' : 'var(--border-default)',
                                backgroundColor: localTimerSeconds === s ? 'var(--color-blue-50)' : 'var(--bg-surface)',
                                color: localTimerSeconds === s ? 'var(--color-blue-600)' : 'var(--text-secondary)',
                              }}
                            >
                              {s}s
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Misère mode */}
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Misère mode</label>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Complete a line = you lose</p>
                      </div>
                      <button
                        onClick={() => setLocalMisere(v => !v)}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        style={{ backgroundColor: localMisere ? 'var(--color-amber-600)' : 'var(--color-gray-300)' }}
                      >
                        <span
                          className="inline-block h-3.5 w-3.5 rounded-full bg-white transform transition-transform"
                          style={{ transform: localMisere ? 'translateX(18px)' : 'translateX(3px)' }}
                        />
                      </button>
                    </div>

                    {/* Board theme */}
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Board theme</label>
                      <select
                        value={localTheme}
                        onChange={e => setLocalTheme(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none transition-colors"
                        style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                      >
                        {BOARD_THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handlePlayAI}
                disabled={(selectedImpl === 'ml' && !selectedModelId) || (selectedImpl === 'rule_based' && !selectedRuleSetId)}
                className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', boxShadow: 'var(--shadow-md)' }}
              >
                Play vs AI
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Challenge a Bot ─────────────────────────────────── */}
      <div
        className="rounded-xl border-2 overflow-hidden transition-colors"
        style={{
          borderColor: botExpanded ? 'var(--color-purple-600, #9333ea)' : 'var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <button
          onClick={() => { setBotExpanded(v => !v); setAiExpanded(false); setAivaiExpanded(false) }}
          className="w-full flex items-center gap-4 p-4 text-left"
        >
          <span className="text-3xl">🤺</span>
          <div className="flex-1">
            <div className="font-semibold">Challenge a Bot</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Play a ranked match against a named bot
            </div>
          </div>
          <span className="text-lg" style={{ color: 'var(--text-muted)' }}>
            {botExpanded ? '▲' : '▼'}
          </span>
        </button>

        {botExpanded && (
          <div className="border-t" style={{ borderColor: 'var(--border-default)' }}>
            {botsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <div className="w-5 h-5 border-2 border-[#9333ea] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading bots…</span>
              </div>
            ) : bots.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No active bots available yet.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ divideColor: 'var(--border-default)' }}>
                {bots.map((bot) => {
                  const initial = (bot.displayName?.[0] || '?').toUpperCase()
                  const algoLabel = ALGO_LABELS[bot.botModelType] ?? bot.botModelType ?? 'AI'
                  const elo = Math.round(bot.eloRating ?? 1200)
                  return (
                    <div key={bot.id} className="flex items-center gap-3 px-4 py-3">
                      {/* Avatar */}
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden"
                        style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
                      >
                        {bot.avatarUrl
                          ? <img src={bot.avatarUrl} alt={bot.displayName} className="w-full h-full object-cover" />
                          : initial}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold truncate">{bot.displayName}</span>
                          {bot.botCalibrating && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>
                              Calibrating
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            ELO {elo}{bot.botCalibrating && <span style={{ color: 'var(--color-amber-600)' }}> (provisional)</span>}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--border-default)' }}>·</span>
                          <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>{algoLabel}</span>
                          {bot.botCompetitive && (
                            <>
                              <span className="text-[10px]" style={{ color: 'var(--border-default)' }}>·</span>
                              <span className="text-[10px] font-semibold" style={{ color: '#0d9488' }}>Competitive</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Challenge button */}
                      {isSignedIn ? (
                        <button
                          onClick={() => handleChallengeBot(bot)}
                          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
                          style={{ background: 'linear-gradient(135deg, #9333ea, #6d28d9)' }}
                        >
                          Challenge
                        </button>
                      ) : (
                        <a
                          href="/sign-in"
                          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                          style={{ backgroundColor: 'var(--bg-page)', borderColor: 'var(--border-default)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                        >
                          Sign in
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Play as selector — shown for signed-in users so they can pick X/O */}
            {isSignedIn && bots.length > 0 && (
              <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
                <label className="text-xs font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Play as</label>
                <div className="flex gap-2">
                  {[
                    { id: 'X',         label: 'X',  color: 'var(--color-blue-600)',   bg: 'var(--color-blue-50)' },
                    { id: 'O',         label: 'O',  color: 'var(--color-teal-600)',   bg: 'var(--color-teal-50)' },
                    { id: 'alternate', label: '±',  color: 'var(--color-amber-600)',  bg: 'var(--color-amber-50)' },
                  ].map(({ id, label, color, bg }) => (
                    <button
                      key={id}
                      onClick={() => setSelectedMark(id)}
                      className="flex-1 py-1.5 rounded-lg text-sm font-bold border-2 transition-colors"
                      style={{
                        borderColor: selectedMark === id ? color : 'var(--border-default)',
                        backgroundColor: selectedMark === id ? bg : 'var(--bg-surface)',
                        color,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI vs AI Spectator ──────────────────────────────── */}
      <div
        className="rounded-xl border-2 overflow-hidden transition-colors"
        style={{
          borderColor: aivaiExpanded ? 'var(--color-teal-600)' : 'var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <button
          onClick={() => { setAivaiExpanded(v => !v); setAiExpanded(false); setBotExpanded(false) }}
          className="w-full flex items-center gap-4 p-4 text-left"
        >
          <span className="text-3xl">👁</span>
          <div className="flex-1">
            <div className="font-semibold">Watch AI vs AI</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Spectate two AI engines battle it out
            </div>
          </div>
          <span className="text-lg" style={{ color: 'var(--text-muted)' }}>
            {aivaiExpanded ? '▲' : '▼'}
          </span>
        </button>

        {aivaiExpanded && (
          <div className="border-t px-4 pb-4 pt-4 space-y-4" style={{ borderColor: 'var(--border-default)' }}>
            {/* AI 1 (plays X) */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--color-blue-600)' }}>X — First AI</label>
              <div className="flex gap-2 mb-2">
                {['minimax', 'ml'].map(impl => (
                  <button
                    key={impl}
                    onClick={() => setAi1Impl(impl)}
                    className="flex-1 py-1.5 rounded-lg text-sm font-medium border-2 capitalize transition-colors"
                    style={{
                      borderColor: ai1Impl === impl ? 'var(--color-blue-600)' : 'var(--border-default)',
                      backgroundColor: ai1Impl === impl ? 'var(--color-blue-50)' : 'var(--bg-surface)',
                      color: ai1Impl === impl ? 'var(--color-blue-600)' : 'var(--text-secondary)',
                    }}
                  >
                    {impl === 'minimax' ? 'Minimax' : 'ML'}
                  </button>
                ))}
              </div>
              {ai1Impl === 'minimax' && (
                <select
                  value={ai1Diff}
                  onChange={e => setAi1Diff(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none transition-colors"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                >
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              )}
              {ai1Impl === 'ml' && (
                aivaiModels.length === 0
                  ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No models available.</p>
                  : <select
                      value={ai1ModelId ?? aivaiModels[0]?.id ?? ''}
                      onChange={e => setAi1ModelId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                    >
                      {aivaiModels.map(m => <option key={m.id} value={m.id} title={m.creatorName ? `by ${m.creatorName}` : undefined}>{m.name}</option>)}
                    </select>
              )}
            </div>

            {/* AI 2 (plays O) */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--color-teal-600)' }}>O — Second AI</label>
              <div className="flex gap-2 mb-2">
                {['minimax', 'ml'].map(impl => (
                  <button
                    key={impl}
                    onClick={() => setAi2Impl(impl)}
                    className="flex-1 py-1.5 rounded-lg text-sm font-medium border-2 capitalize transition-colors"
                    style={{
                      borderColor: ai2Impl === impl ? 'var(--color-teal-600)' : 'var(--border-default)',
                      backgroundColor: ai2Impl === impl ? 'var(--color-teal-50)' : 'var(--bg-surface)',
                      color: ai2Impl === impl ? 'var(--color-teal-600)' : 'var(--text-secondary)',
                    }}
                  >
                    {impl === 'minimax' ? 'Minimax' : 'ML'}
                  </button>
                ))}
              </div>
              {ai2Impl === 'minimax' && (
                <select
                  value={ai2Diff}
                  onChange={e => setAi2Diff(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none transition-colors"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                >
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              )}
              {ai2Impl === 'ml' && (
                aivaiModels.length === 0
                  ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No models available.</p>
                  : <select
                      value={ai2ModelId ?? aivaiModels[0]?.id ?? ''}
                      onChange={e => setAi2ModelId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                    >
                      {aivaiModels.map(m => <option key={m.id} value={m.id} title={m.creatorName ? `by ${m.creatorName}` : undefined}>{m.name}</option>)}
                    </select>
              )}
            </div>

            {/* Best of N for spectator */}
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Series</label>
              <select
                value={localBestOf ?? ''}
                onChange={e => setLocalBestOf(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none transition-colors"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >
                {BEST_OF_OPTIONS.map(opt => <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>)}
              </select>
            </div>

            <button
              onClick={handleWatchAIvsAI}
              className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))', boxShadow: 'var(--shadow-md)' }}
            >
              Watch AI vs AI
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
