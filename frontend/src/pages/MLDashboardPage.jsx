import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import { api } from '../lib/api.js'
import { evictModel, isModelCached } from '../lib/mlInference.js'
import { getSocket } from '../lib/socket.js'
import { runTrainingSession } from '../services/trainingService.js'
import QValueHeatmap from '../components/ml/QValueHeatmap.jsx'

// Module-level ML model cache — keyed by modelId, survives component unmount/navigation
const _mlModelCache = new Map()

const ITERATIONS_MIN = 100
const ITERATIONS_MAX = 100_000
const ITERATIONS_STEP = 100

const MODES = [
  { value: 'SELF_PLAY', label: 'Self-play', desc: 'Plays both X and O' },
  { value: 'VS_MINIMAX', label: 'vs Minimax', desc: 'Plays against the Minimax engine' },
  { value: 'VS_HUMAN', label: 'vs Human', desc: 'Learns from real player games' },
]
const DIFFICULTIES = ['novice', 'intermediate', 'advanced', 'master']
const ALGORITHMS = [
  { value: 'Q_LEARNING',      label: 'Q-Learning',     desc: 'Off-policy TD control' },
  { value: 'SARSA',           label: 'SARSA',           desc: 'On-policy TD control' },
  { value: 'MONTE_CARLO',     label: 'Monte Carlo',     desc: 'Every-visit MC control' },
  { value: 'POLICY_GRADIENT', label: 'Policy Gradient', desc: 'REINFORCE (softmax policy)' },
  { value: 'DQN',             label: 'DQN',             desc: 'Deep Q-Network (neural net)' },
  { value: 'ALPHA_ZERO',      label: 'AlphaZero',       desc: 'MCTS + policy/value nets' },
]
const STATUS_COLOR = { IDLE: 'teal', TRAINING: 'blue' }
const SESSION_COLOR = { COMPLETED: 'teal', RUNNING: 'blue', FAILED: 'red', CANCELLED: 'amber', PENDING: 'gray', QUEUED: 'yellow' }

// Returns the display name for a player profile, substituting the logged-in
// user's current name when the profile belongs to them.
function playerLabel(profile, domainUserId, currentUserName) {
  if (domainUserId && profile.userId === domainUserId) {
    return currentUserName || profile.displayName || profile.username || 'You'
  }
  return profile.displayName || profile.username || `${profile.userId.slice(0, 12)}…`
}

export default function GymPage() {
  const { data: session } = useOptimisticSession()
  const user = session?.user ?? null
  const currentUserName = user?.name || user?.username || null

  const [domainUserId, setDomainUserId]   = useState(null)
  const [bots, setBots]                   = useState([])
  const [selectedBotId, setSelectedBotId] = useState(null)
  const [botModels, setBotModels]         = useState({})   // { botId: mlModel }
  const [modelLoading, setModelLoading]   = useState(false)
  const [activeTab, setActiveTab]         = useState('train')
  const [regressions, setRegressions]     = useState(new Set())
  const [toasts, setToasts]               = useState([])
  const [sessions, setSessions]           = useState([])    // shared across tabs

  const selectedBot    = bots.find(b => b.id === selectedBotId) ?? null
  const selectedModel  = selectedBot ? botModels[selectedBotId] ?? null : null
  const isMlBot        = selectedBot?.botModelType === 'ml'
  const isMinimaxBot   = selectedBot?.botModelType === 'minimax' || selectedBot?.botModelType === 'mcts'
  const allLoadedModels = Object.values(botModels)

  // Resolve the domain User.id (different from Better Auth session user.id)
  useEffect(() => {
    if (!user) return
    // Use cached DB user to skip the sync round-trip on repeat visits.
    async function resolveUserId() {
      try {
        const cacheKey = `xo_dbuser_${user.id}`
        let domainId = null
        try {
          const raw = sessionStorage.getItem(cacheKey)
          if (raw) domainId = JSON.parse(raw)?.id ?? null
        } catch {}
        if (domainId) { setDomainUserId(domainId); return }
        const token = await getToken()
        const { user: u } = await api.users.sync(token)
        setDomainUserId(u.id)
        try { sessionStorage.setItem(cacheKey, JSON.stringify(u)) } catch {}
      } catch {}
    }
    resolveUserId()
  }, [user?.id])

  const loadBots = useCallback(async () => {
    if (!domainUserId) return
    // Show stale bots immediately so the sidebar isn't blank while fetching
    const cacheKey = `xo_bots_${domainUserId}`
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) setBots(JSON.parse(raw))
    } catch {}
    const token = await getToken()
    const { bots: bs } = await api.bots.list({ ownerId: domainUserId, token })
    setBots(bs || [])
    try { sessionStorage.setItem(cacheKey, JSON.stringify(bs || [])) } catch {}
  }, [domainUserId])

  useEffect(() => { loadBots() }, [loadBots])

  // Fetch sessions once when model is selected — shared across all tabs
  useEffect(() => {
    if (!selectedModel?.id) { setSessions([]); return }
    api.ml.getSessions(selectedModel.id)
      .then(r => setSessions(r.sessions || []))
      .catch(() => {})
  }, [selectedModel?.id])

  // Auto-select first bot
  useEffect(() => {
    if (bots.length > 0 && !selectedBotId) setSelectedBotId(bots[0].id)
  }, [bots, selectedBotId])

  // Load ML model when an ML bot is selected for the first time
  useEffect(() => {
    if (!selectedBotId || !selectedBot?.botModelId) {
      setModelLoading(false)
      return
    }
    // Check React state first (in-session bot switches)
    if (botModels[selectedBotId]) {
      setModelLoading(false)
      return
    }
    // Check module-level cache (survives navigation/unmount)
    const cached = _mlModelCache.get(selectedBot.botModelId)
    if (cached) {
      setBotModels(prev => ({ ...prev, [selectedBotId]: cached }))
      setModelLoading(false)
      return
    }
    setModelLoading(true)
    const id = selectedBotId
    api.ml.getModel(selectedBot.botModelId)
      .then(({ model }) => {
        _mlModelCache.set(model.id, model)
        setBotModels(prev => ({ ...prev, [id]: model }))
      })
      .catch(() => {})
      .finally(() => setModelLoading(false))
    // botModels intentionally omitted — we don't want to re-run after models are added
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBotId, selectedBot?.botModelId])

  const addToast = useCallback((msg, color = 'blue') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg, color }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.on('ml:regression_detected', ({ modelId }) => {
      setRegressions(prev => new Set([...prev, modelId]))
    })
    socket.on('ml:curriculum_advance', ({ difficulty }) => {
      addToast(`Curriculum advanced! Now training at: ${difficulty}`, 'teal')
    })
    socket.on('ml:early_stop', () => {
      addToast('Early stopping triggered', 'amber')
    })
    return () => {
      socket.off('ml:regression_detected')
      socket.off('ml:curriculum_advance')
      socket.off('ml:early_stop')
    }
  }, [addToast])

  const refreshModel = useCallback(async (botId, modelId) => {
    const { model } = await api.ml.getModel(modelId)
    _mlModelCache.set(model.id, model)
    setBotModels(prev => ({ ...prev, [botId]: model }))
    evictModel(modelId)
  }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Gym</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Train and evaluate your bots. Create bots in your profile settings.</p>
          </div>
          <Link
            to="/gym/guide"
            className="text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors mt-1"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            Training Guide
          </Link>
        </div>
      </div>

      {!domainUserId ? (
        <Card>
          <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sign in to access the Gym.</p>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* Bot sidebar */}
          <aside className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Your Bots</p>
            {bots.length === 0 && (
              <div className="text-center py-6 px-3">
                <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>No bots yet.</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Go to Profile → Bots to create bots.</p>
              </div>
            )}
            {bots.map(bot => {
              const typeLabel = bot.botModelType === 'ml' ? 'ML' : bot.botModelType === 'rule_based' ? 'Rules' : bot.botModelType === 'mcts' ? 'MCTS' : 'Minimax'
              const typeBg    = bot.botModelType === 'ml' ? 'var(--color-blue-100)' : bot.botModelType === 'rule_based' ? 'var(--color-teal-100)' : 'var(--color-gray-100)'
              const typeColor = bot.botModelType === 'ml' ? 'var(--color-blue-700)' : bot.botModelType === 'rule_based' ? 'var(--color-teal-700)' : 'var(--color-gray-600)'
              const model = botModels[bot.id]
              return (
                <button key={bot.id} onClick={() => { setSelectedBotId(bot.id); setActiveTab('train') }}
                  className={`w-full text-left rounded-xl border p-3 transition-all ${selectedBotId === bot.id ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]' : 'hover:border-[var(--color-gray-400)]'}`}
                  style={{ borderColor: selectedBotId === bot.id ? undefined : 'var(--border-default)', backgroundColor: selectedBotId === bot.id ? undefined : 'var(--bg-surface)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm truncate">{bot.displayName || bot.username}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: typeBg, color: typeColor }}>{typeLabel}</span>
                      {model && regressions.has(model.id) && (
                        <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full bg-[var(--color-amber-100)] text-[var(--color-amber-700)]">⚠</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs mt-1 flex gap-2" style={{ color: 'var(--text-muted)' }}>
                    <span>ELO {Math.round(bot.eloRating || 1200)}</span>
                    {model && <><span>·</span><span>{model.totalEpisodes.toLocaleString()} eps</span></>}
                    {model && isModelCached(model.id) && <span title="Q-table loaded in browser" style={{ color: 'var(--color-teal-600)' }}>⚡</span>}
                  </div>
                </button>
              )
            })}
          </aside>

          {/* Detail panel */}
          <div>
            {!selectedBot ? (
              <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-lg font-semibold mb-1">No bot selected</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a bot from the list.</p>
              </div>
            ) : isMinimaxBot ? (
              <MinimaxBotView bot={selectedBot} />
            ) : isMlBot && modelLoading ? (
              <div className="flex justify-center py-16"><Spinner /></div>
            ) : isMlBot && selectedModel ? (
              <div className="space-y-4">
                {/* Bot + model header */}
                <div className="rounded-xl border p-4 flex items-center justify-between flex-wrap gap-3"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold">{selectedBot.displayName || selectedBot.username}</h2>
                      <StatusBadge status={selectedModel.status} />
                    </div>
                    {selectedBot.bio && <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{selectedBot.bio}</p>}
                    <div className="flex gap-4 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{selectedModel.algorithm?.replace(/_/g, '-')}</span>
                      <span>{selectedModel.totalEpisodes.toLocaleString()} / {selectedModel.maxEpisodes > 0 ? selectedModel.maxEpisodes.toLocaleString() : '∞'} episodes</span>
                      <span>ELO {Math.round(selectedBot.eloRating || 1200)}</span>
                      <span title={isModelCached(selectedModel.id) ? 'Q-table loaded in browser — moves run locally' : 'Not yet cached'} style={{ color: isModelCached(selectedModel.id) ? 'var(--color-teal-600)' : 'var(--text-muted)' }}>
                        {isModelCached(selectedModel.id) ? '⚡ cached' : '○ not cached'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn onClick={async () => {
                      const data = await api.ml.exportModel(selectedModel.id)
                      downloadJSON(data, `${(selectedBot.username || 'bot').replace(/\s+/g, '_')}.ml.json`)
                    }} variant="ghost">Export</Btn>
                    <Btn onClick={async () => {
                      if (!confirm('Reset to untrained baseline? All Q-table data will be lost.')) return
                      const token = await getToken()
                      await api.ml.resetModel(selectedModel.id, token)
                      refreshModel(selectedBotId, selectedModel.id)
                    }} variant="ghost">Reset</Btn>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border-default)' }}>
                  {['train', 'analytics', 'evaluation', 'explainability', 'checkpoints', 'sessions', 'export', 'rules'].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-[var(--color-blue-600)] text-[var(--color-blue-600)]' : 'border-transparent'}`}
                      style={{ color: activeTab === tab ? undefined : 'var(--text-secondary)' }}>
                      {tab}
                    </button>
                  ))}
                </div>

                {activeTab === 'train'          && <TrainTab model={selectedModel} sessions={sessions} onSessionsChange={setSessions} onComplete={() => refreshModel(selectedBotId, selectedModel.id)} />}
                {activeTab === 'analytics'      && <AnalyticsTab model={selectedModel} sessions={sessions} />}
                {activeTab === 'evaluation'     && <EvaluationTab model={selectedModel} models={allLoadedModels} domainUserId={domainUserId} currentUserName={currentUserName} />}
                {activeTab === 'explainability' && <ExplainabilityTab model={selectedModel} domainUserId={domainUserId} currentUserName={currentUserName} />}
                {activeTab === 'checkpoints'    && <CheckpointsTab model={selectedModel} onRestore={() => refreshModel(selectedBotId, selectedModel.id)} />}
                {activeTab === 'sessions'       && <SessionsTab model={selectedModel} sessions={sessions} />}
                {activeTab === 'export'         && <ExportTab model={selectedModel} sessions={sessions} />}
                {activeTab === 'rules'          && <RulesTab model={selectedModel} models={allLoadedModels} />}
              </div>
            ) : isMlBot ? (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Could not load model for this bot.</p>
              </div>
            ) : (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>This bot type doesn't have training options in the Gym.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg transition-all"
            style={{
              backgroundColor: t.color === 'teal' ? 'var(--color-teal-600)' : t.color === 'amber' ? 'var(--color-amber-600)' : 'var(--color-blue-600)',
              color: 'white',
            }}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Minimax / MCTS Bot Read-Only View ────────────────────────────────────────

function MinimaxBotView({ bot }) {
  const typeLabel = bot.botModelType === 'mcts' ? 'MCTS' : 'Minimax'
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-xl font-bold">{bot.displayName || bot.username}</h2>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--color-gray-600)' }}>
            {typeLabel}
          </span>
        </div>
        {bot.bio && <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{bot.bio}</p>}
        <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>ELO {Math.round(bot.eloRating || 1200)}</div>
      </div>
      <Card>
        <SectionLabel>About</SectionLabel>
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          {typeLabel} bots use a deterministic algorithm and cannot be trained. Their play strength
          is fixed. Challenge this bot in the Play area to test it.
        </p>
      </Card>
    </div>
  )
}

// ─── Train Tab ───────────────────────────────────────────────────────────────

function TrainTab({ model, sessions, onSessionsChange, onComplete }) {
  const [mode, setMode]                     = useState('SELF_PLAY')
  const [iterations, setIterations]         = useState(1000)
  const [difficulty, setDifficulty]         = useState('intermediate')
  const [mlMark, setMlMark]                 = useState('alternating')
  const algorithm = model.algorithm || 'Q_LEARNING'
  const [curriculum, setCurriculum]         = useState(false)
  const [earlyStopEnabled, setEarlyStop]    = useState(false)
  const [patience, setPatience]             = useState(200)
  const [minDelta, setMinDelta]             = useState(0.01)
  // Epsilon config (all models except AlphaZero)
  const [epsilonDecay, setEpsilonDecay]           = useState(0.995)
  const [epsilonMin, setEpsilonMin]               = useState(0.05)
  const [decayMethod, setDecayMethod]             = useState('exponential')
  const [resetEpsilon, setResetEpsilon]           = useState(true)
  // DQN-specific config
  const [dqnBatchSize, setDqnBatchSize]           = useState(32)
  const [dqnReplayBuffer, setDqnReplayBuffer]     = useState(10000)
  const [dqnTargetUpdate, setDqnTargetUpdate]     = useState(100)
  const [dqnLayers, setDqnLayers]                 = useState(() => model.config?.networkShape ?? [32])
  const [dqnGamma, setDqnGamma]                   = useState(0.9)
  // AlphaZero-specific config
  const [azSimulations, setAzSimulations]   = useState(50)
  const [azCPuct, setAzCPuct]               = useState(1.5)
  const [azTemperature, setAzTemperature]   = useState(1.0)
  const [running, setRunning]               = useState(false)
  const [sessionId, setSessionId]           = useState(null)
  const [progress, setProgress]             = useState(null)
  const [chartData, setChartData]           = useState([])
  const [curriculumDifficulty, setCurriculumDifficulty] = useState(null)
  const socketRef   = useRef(null)
  const cleanupRef  = useRef(null)
  const cancelRef   = useRef(false)

  // Clean up on unmount: tear down socket listeners and stop any running frontend loop
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cancelRef.current = true
    }
  }, [])

  // Re-attach to in-progress training when navigating back to the page.
  // Frontend sessions can't resume after navigation — auto-cancel them.
  useEffect(() => {
    if (model.status !== 'TRAINING' || running) return
    let cancelled = false

    api.ml.getSessions(model.id).then(async r => {
      if (cancelled) return
      const runningSession = r.sessions.find(s => s.status === 'RUNNING')
      if (!runningSession) return

      onSessionsChange(r.sessions)

      // Frontend session left running after navigation — clean it up
      if (runningSession.config?.frontend) {
        const tok = await getToken().catch(() => null)
        if (tok) api.ml.cancelSession(runningSession.id, tok).catch(() => {})
        return
      }

      setSessionId(runningSession.id)
      setIterations(runningSession.iterations)
      setRunning(true)
      setProgress(null)
      setChartData([])
      setCurriculumDifficulty(runningSession.config?.difficulty ?? null)

      const socket = getSocket()
      if (!socket.connected) socket.connect()
      socketRef.current = socket
      socket.emit('ml:watch', { sessionId: runningSession.id })

      const onProgress = (data) => {
        if (data.sessionId !== runningSession.id) return
        setProgress(data)
        setChartData(prev => [...prev, {
          ep: data.episode,
          winRate:  Math.round(data.winRate  * 100),
          lossRate: Math.round(data.lossRate * 100),
          drawRate: Math.round(data.drawRate * 100),
          epsilon: parseFloat((data.epsilon * 100).toFixed(1)),
          qDelta: data.avgQDelta,
        }])
      }

      const onCurriculumAdvance = (data) => {
        if (data.sessionId !== runningSession.id) return
        setCurriculumDifficulty(data.difficulty)
      }

      const teardown = () => {
        socket.emit('ml:unwatch', { sessionId: runningSession.id })
        socket.off('ml:progress',           onProgress)
        socket.off('ml:curriculum_advance',  onCurriculumAdvance)
        socket.off('ml:complete',           onComplete_)
        socket.off('ml:cancelled',          onCancelled)
        socket.off('ml:error',              onError)
        cleanupRef.current = null
      }

      const onComplete_  = () => { setRunning(false); teardown(); onComplete() }
      const onCancelled  = () => { setRunning(false); teardown(); onComplete() }
      const onError      = (d) => { setRunning(false); alert(`Training failed: ${d.error}`); teardown() }

      socket.on('ml:progress',           onProgress)
      socket.on('ml:curriculum_advance',  onCurriculumAdvance)
      socket.once('ml:complete',           onComplete_)
      socket.once('ml:cancelled',          onCancelled)
      socket.once('ml:error',              onError)

      cleanupRef.current = teardown
    }).catch(() => {})

    return () => { cancelled = true }
  }, [model.id, model.status, running, onComplete])

  async function handleStart() {
    cleanupRef.current?.()
    cleanupRef.current = null
    cancelRef.current = false

    // Show the progress panel immediately before the API call
    flushSync(() => {
      setRunning(true)
      setProgress(null)
      setChartData([])
      setCurriculumDifficulty(null)
    })

    const token = await getToken()
    const cfg = {
      ...(mode === 'VS_MINIMAX' ? { difficulty: curriculum ? 'novice' : difficulty, mlMark: mlMark === 'alternating' ? undefined : mlMark } : {}),
      algorithm,
      ...(curriculum ? { curriculum: true } : {}),
      ...(earlyStopEnabled ? { earlyStop: { patience, minDelta } } : {}),
      ...(algorithm !== 'ALPHA_ZERO' ? { epsilonDecay, epsilonMin, decayMethod, ...(resetEpsilon ? { currentEpsilon: 1.0 } : {}) } : {}),
      ...(algorithm === 'DQN' ? { batchSize: dqnBatchSize, replayBufferSize: dqnReplayBuffer, targetUpdateFreq: dqnTargetUpdate, networkShape: dqnLayers, gamma: dqnGamma } : {}),
      ...(algorithm === 'ALPHA_ZERO' ? { numSimulations: azSimulations, cPuct: azCPuct, temperature: azTemperature } : {}),
    }
    try {
      // Create session on backend and get current model weights for engine init
      const { session, model: modelState } = await api.ml.train(model.id, { mode, iterations, config: cfg, frontend: true }, token)

      flushSync(() => {
        onSessionsChange(prev => [session, ...prev])
        setSessionId(session.id)
        if (curriculum && mode === 'VS_MINIMAX') setCurriculumDifficulty('novice')
      })

      // Run all episodes locally in the browser
      const result = await runTrainingSession({
        model: modelState,
        session: { ...session, config: cfg },
        cancelRef,
        onProgress: (data) => {
          flushSync(() => {
            setProgress({ ...data, sessionId: session.id })
            setChartData(prev => [...prev, {
              ep: data.episode,
              winRate:  Math.round(data.winRate  * 100),
              lossRate: Math.round(data.lossRate * 100),
              drawRate: Math.round(data.drawRate * 100),
              recentWinRate:  Math.round((data.recentWinRate  ?? data.winRate)  * 100),
              recentLossRate: Math.round((data.recentLossRate ?? data.lossRate) * 100),
              recentDrawRate: Math.round((data.recentDrawRate ?? data.drawRate) * 100),
              epsilon: parseFloat((data.epsilon * 100).toFixed(1)),
              qDelta: data.avgQDelta,
            }])
          })
        },
        onCurriculumAdvance: ({ difficulty: newDiff }) => setCurriculumDifficulty(newDiff),
      })

      // Show 100% while finishSession uploads weights (covers early-stop and normal completion)
      flushSync(() => {
        setProgress(prev => prev ? { ...prev, episode: prev.totalEpisodes } : prev)
      })

      // Persist weights + stats to backend; it handles ELO calibration async
      await api.ml.finishSession(session.id, {
        weights:    result.weights,
        stats:      result.stats,
        iterations: result.iterations,
        status:     result.status,
        samples:    result.samples,
      }, token)

      setRunning(false)
      onComplete()
    } catch (err) {
      setRunning(false)
      alert(err.message)
    }
  }

  async function handleCancel() {
    // Signal the training loop to stop; handleStart will call finishSession with CANCELLED
    cancelRef.current = true
  }

  const pct = progress ? Math.round((progress.episode / progress.totalEpisodes) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Config */}
      {!running && (
        <Card>
          <SectionLabel>Training Configuration</SectionLabel>
          <div className="mt-3 space-y-4">
            {/* Mode */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Mode</label>
              <select
                value={mode}
                onChange={e => { setMode(e.target.value); setCurriculum(false) }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >
                {MODES.map(m => <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>)}
              </select>
            </div>

            {/* VS_MINIMAX options: difficulty + play as */}
            {mode === 'VS_MINIMAX' && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                    {curriculum ? 'Starting difficulty' : 'Difficulty'}
                    {curriculum && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(locked to Easy — curriculum advances automatically)</span>}
                  </label>
                  <select
                    value={curriculum ? 'novice' : difficulty}
                    onChange={e => setDifficulty(e.target.value)}
                    disabled={curriculum}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  >
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Play as</label>
                  <div className="flex gap-2">
                    {[{ v: 'X', label: 'X' }, { v: 'O', label: 'O' }, { v: 'alternating', label: '±' }].map(({ v, label }) => (
                      <button key={v} onClick={() => setMlMark(v)}
                        title={v === 'alternating' ? 'Alternate X/O each episode' : `Always play as ${v}`}
                        className={`w-10 py-2 rounded-lg text-sm font-bold border-2 transition-colors ${mlMark === v ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-600)]' : 'border-[var(--border-default)]'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Algorithm — fixed at model creation, read-only here */}
            <div>
              <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Algorithm</label>
              {(() => { const a = ALGORITHMS.find(x => x.value === algorithm); return (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a?.label}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{a?.desc}</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>Set at creation</span>
                </div>
              )})()}</div>

            {/* DQN config fields */}
            {algorithm === 'DQN' && (() => {
              const storedShape = model.config?.networkShape ?? [32]
              const archChanged = JSON.stringify(dqnLayers) !== JSON.stringify(storedShape)
              const LAYER_SIZES = [8, 16, 32, 64, 128]
              return (
                <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>DQN Configuration</p>

                  {/* Numeric controls row */}
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Batch</label>
                      <input type="number" min="8" max="256" step="8" value={dqnBatchSize}
                        onChange={e => setDqnBatchSize(Number(e.target.value))}
                        className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Replay buffer</label>
                      <input type="number" min="1000" max="100000" step="1000" value={dqnReplayBuffer}
                        onChange={e => setDqnReplayBuffer(Number(e.target.value))}
                        className="w-28 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Target update</label>
                      <input type="number" min="10" max="1000" step="10" value={dqnTargetUpdate}
                        onChange={e => setDqnTargetUpdate(Number(e.target.value))}
                        className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Gamma (γ)
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(discount)</span>
                      </label>
                      <select value={dqnGamma} onChange={e => setDqnGamma(Number(e.target.value))}
                        className="text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                        <option value={0.85}>0.85</option>
                        <option value={0.90}>0.90 — default</option>
                        <option value={0.95}>0.95 — recommended</option>
                        <option value={0.99}>0.99</option>
                      </select>
                    </div>
                  </div>

                  {/* Network architecture layer builder */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Network architecture
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(input:9 → hidden → output:9)</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {dqnLayers.map((size, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <select value={size}
                            onChange={e => setDqnLayers(prev => prev.map((v, j) => j === i ? Number(e.target.value) : v))}
                            className="text-sm rounded-lg border px-2 py-1 outline-none"
                            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                            {LAYER_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          {dqnLayers.length > 1 && (
                            <button onClick={() => setDqnLayers(prev => prev.filter((_, j) => j !== i))}
                              className="text-xs px-1.5 py-1 rounded border"
                              style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                              title="Remove layer">×</button>
                          )}
                          {i < dqnLayers.length - 1 && (
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
                          )}
                        </div>
                      ))}
                      {dqnLayers.length < 3 && (
                        <button onClick={() => setDqnLayers(prev => [...prev, 32])}
                          className="text-xs px-2 py-1 rounded border font-medium"
                          style={{ borderColor: 'var(--color-blue-600)', color: 'var(--color-blue-600)' }}>
                          + Add layer
                        </button>
                      )}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Current: [9 → {dqnLayers.join(' → ')} → 9]
                    </p>
                  </div>

                  {/* Architecture changed warning */}
                  {archChanged && (
                    <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)', border: '1px solid var(--color-amber-300)' }}>
                      Architecture changed from [{storedShape.join(', ')}] → [{dqnLayers.join(', ')}] — existing weights will be reset and training starts fresh.
                    </div>
                  )}
                </div>
              )
            })()}

            {/* AlphaZero config fields */}
            {algorithm === 'ALPHA_ZERO' && (
              <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>AlphaZero Configuration</p>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Simulations</label>
                    <input type="number" min="10" max="500" step="10" value={azSimulations}
                      onChange={e => setAzSimulations(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>PUCT</label>
                    <input type="number" min="0.1" max="5" step="0.1" value={azCPuct}
                      onChange={e => setAzCPuct(Number(e.target.value))}
                      className="w-20 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Temperature</label>
                    <input type="number" min="0.1" max="2.0" step="0.1" value={azTemperature}
                      onChange={e => setAzTemperature(Number(e.target.value))}
                      className="w-20 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              </div>
            )}


            {/* Epsilon config (all models except AlphaZero) */}
            {algorithm !== 'ALPHA_ZERO' && (
              <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Exploration</p>

                {/* Decay method */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Decay schedule</label>
                  <div className="flex gap-2">
                    {[
                      { v: 'exponential', label: 'Exponential', hint: 'ε × rate each step' },
                      { v: 'linear',      label: 'Linear',      hint: 'straight line to min' },
                      { v: 'cosine',      label: 'Cosine',      hint: 'smooth S-curve to min' },
                    ].map(({ v, label, hint }) => (
                      <button key={v} onClick={() => setDecayMethod(v)}
                        title={hint}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${decayMethod === v ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-600)]' : 'border-[var(--border-default)]'}`}
                        style={{ color: decayMethod === v ? undefined : 'var(--text-secondary)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-4">
                  {/* Rate multiplier — only meaningful for exponential */}
                  {decayMethod === 'exponential' && (
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Rate
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(0.99–0.9999)</span>
                      </label>
                      <input type="number" min="0.99" max="0.9999" step="0.0001" value={epsilonDecay}
                        onChange={e => setEpsilonDecay(Number(e.target.value))}
                        className="w-28 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Epsilon min
                      <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(floor)</span>
                    </label>
                    <input type="number" min="0.01" max="0.5" step="0.01" value={epsilonMin}
                      onChange={e => setEpsilonMin(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                </div>

                {/* Reset epsilon checkbox */}
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="resetEps" checked={resetEpsilon} onChange={e => setResetEpsilon(e.target.checked)}
                    className="accent-[var(--color-blue-600)]" />
                  <label htmlFor="resetEps" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Reset ε to 1.0 at start
                    <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(recommended — otherwise continues from saved ε)</span>
                  </label>
                </div>

                {/* Schedule hint */}
                {decayMethod === 'exponential' && (() => {
                  const epsAtMin = Math.ceil(Math.log(epsilonMin) / Math.log(epsilonDecay))
                  const pct = Math.min(100, Math.round((epsAtMin / iterations) * 100))
                  return (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Reaches min after ~<span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {epsAtMin.toLocaleString()}
                      </span> episodes ({pct}% of your {iterations.toLocaleString()} iterations)
                    </p>
                  )
                })()}
                {decayMethod === 'linear' && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Decreases at a constant rate, reaching min at exactly {iterations.toLocaleString()} episodes
                  </p>
                )}
                {decayMethod === 'cosine' && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Starts slow, accelerates in the middle, slows again — reaches min at {iterations.toLocaleString()} episodes
                  </p>
                )}
              </div>
            )}

            {/* Curriculum learning (VS_MINIMAX only — advances Easy→Medium→Hard) */}
            {mode === 'VS_MINIMAX' && (
              <div className="flex items-center gap-3">
                <input type="checkbox" id="curriculum" checked={curriculum} onChange={e => setCurriculum(e.target.checked)}
                  className="accent-[var(--color-blue-600)]" />
                <label htmlFor="curriculum" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Curriculum learning — auto-advance Easy → Medium → Hard when win rate &gt; 65%
                </label>
              </div>
            )}

            {/* Iterations */}
            {(() => {
              const remaining = model.maxEpisodes > 0 ? model.maxEpisodes - model.totalEpisodes : Infinity
              const atLimit = remaining <= 0
              const sliderMax = remaining === Infinity ? ITERATIONS_MAX : Math.max(ITERATIONS_MIN, Math.min(ITERATIONS_MAX, remaining))
              const displayIterations = Math.min(iterations, sliderMax)
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Iterations</label>
                    <div className="flex items-center gap-2">
                      {model.maxEpisodes > 0 && (
                        <span className="text-xs tabular-nums" style={{ color: atLimit ? 'var(--color-red-600)' : remaining < 10_000 ? 'var(--color-amber-600)' : 'var(--text-muted)' }}>
                          {atLimit ? 'Episode limit reached' : `${remaining.toLocaleString()} remaining`}
                        </span>
                      )}
                      <input
                        type="number"
                        min={ITERATIONS_MIN} max={sliderMax} step={ITERATIONS_STEP}
                        value={displayIterations}
                        disabled={atLimit}
                        onChange={e => {
                          const v = Number(e.target.value)
                          if (!isNaN(v)) setIterations(Math.max(ITERATIONS_MIN, Math.min(sliderMax, v)))
                        }}
                        className="w-24 px-2 py-0.5 rounded text-sm font-bold tabular-nums text-right disabled:opacity-40"
                        style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface-hover)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                  </div>
                  <input type="range" min={ITERATIONS_MIN} max={sliderMax} step={ITERATIONS_STEP} value={displayIterations}
                    onChange={e => setIterations(Number(e.target.value))}
                    disabled={atLimit}
                    className="w-full accent-[var(--color-blue-600)] disabled:opacity-40" />
                  <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    <span>{ITERATIONS_MIN.toLocaleString()}</span><span>{sliderMax.toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}

            {/* Early stopping */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="earlyStop" checked={earlyStopEnabled} onChange={e => setEarlyStop(e.target.checked)}
                  className="accent-[var(--color-blue-600)]" />
                <label htmlFor="earlyStop" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Early stopping
                </label>
              </div>
              {earlyStopEnabled && (
                <div className="ml-6 flex flex-wrap gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Patience (episodes)</label>
                    <input type="number" min="50" max="10000" step="50" value={patience}
                      onChange={e => setPatience(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Min delta</label>
                    <input type="number" min="0.001" max="0.1" step="0.001" value={minDelta}
                      onChange={e => setMinDelta(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              )}
            </div>

            <Btn onClick={handleStart} disabled={running || (model.maxEpisodes > 0 && model.totalEpisodes >= model.maxEpisodes)}>
              {model.maxEpisodes > 0 && model.totalEpisodes >= model.maxEpisodes ? 'Episode limit reached' : 'Start Training'}
            </Btn>
          </div>
        </Card>
      )}

      {/* Live progress */}
      {running && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <SectionLabel>{sessionId ? 'Training in Progress' : 'Starting…'}</SectionLabel>
              {curriculumDifficulty && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize"
                  style={{
                    backgroundColor: curriculumDifficulty === 'novice' ? 'var(--color-teal-100)' : curriculumDifficulty === 'intermediate' ? 'var(--color-amber-100)' : curriculumDifficulty === 'advanced' ? 'var(--color-orange-100)' : 'var(--color-red-100)',
                    color:           curriculumDifficulty === 'novice' ? 'var(--color-teal-700)' : curriculumDifficulty === 'intermediate' ? 'var(--color-amber-700)' : curriculumDifficulty === 'advanced' ? 'var(--color-orange-700)' : 'var(--color-red-700)',
                  }}>
                  {curriculumDifficulty}
                </span>
              )}
            </div>
            <Btn onClick={handleCancel} variant="ghost">Cancel</Btn>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--color-blue-600)' }} />
            </div>
            <span className="text-xs font-mono font-semibold tabular-nums w-9 text-right" style={{ color: 'var(--text-secondary)' }}>{pct}%</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <MiniStat label="Episode" value={progress ? `${progress.episode.toLocaleString()} / ${progress.totalEpisodes.toLocaleString()}` : `0 / ${iterations.toLocaleString()}`} />
            <MiniStat label="Win Rate" value={progress ? `${Math.round(progress.winRate * 100)}%` : '—'} color="var(--color-teal-600)" />
            <MiniStat label="Epsilon ε" value={progress ? progress.epsilon.toFixed(4) : '1.0000'} color="var(--color-amber-600)" />
            <MiniStat label="Avg ΔQ" value={progress ? (progress.avgQDelta === 0 ? '0 ✓' : progress.avgQDelta < 0.0001 ? progress.avgQDelta.toExponential(2) : progress.avgQDelta.toFixed(5)) : '—'} />
            <MiniStat label="Avg game" value={progress?.avgGameMs != null ? `${progress.avgGameMs.toFixed(1)}ms` : '—'} />
          </div>
          <div className="flex gap-4 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>Wins (X): <b style={{ color: 'var(--color-teal-600)' }}>{(progress?.outcomes.wins ?? 0).toLocaleString()}</b></span>
            <span>Losses (O wins): <b style={{ color: 'var(--color-red-600)' }}>{(progress?.outcomes.losses ?? 0).toLocaleString()}</b></span>
            <span>Draws: <b style={{ color: 'var(--color-amber-600)' }}>{(progress?.outcomes.draws ?? 0).toLocaleString()}</b></span>
          </div>
          {mode === 'SELF_PLAY' && (
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Self-play goal: Draw rate → 100% (both sides approaching perfect play). Win rate should <em>decrease</em> as draws increase.
            </p>
          )}

          {/* Live charts */}
          {chartData.length > 1 && (
            <div className="space-y-4">
              <ChartPanel label="Win Rate % over Episodes">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="recentWinRate"  stroke="var(--color-teal-600)"  dot={false} name="Win % (recent)"  strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="recentDrawRate" stroke="var(--color-amber-600)" dot={false} name="Draw % (recent)" strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="recentLossRate" stroke="var(--color-red-500)"   dot={false} name="Loss % (recent)" strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="winRate"  stroke="var(--color-teal-600)"  dot={false} name="Win % (avg)"  strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.45} />
                  <Line isAnimationActive={false} type="monotone" dataKey="drawRate" stroke="var(--color-amber-600)" dot={false} name="Draw % (avg)" strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.45} />
                  <Line isAnimationActive={false} type="monotone" dataKey="lossRate" stroke="var(--color-red-500)"   dot={false} name="Loss % (avg)" strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.45} />
                </LineChart>
              </ChartPanel>
              <ChartPanel label="Exploration Rate (ε) Decay">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                  <Line isAnimationActive={false} type="monotone" dataKey="epsilon" stroke="var(--color-blue-600)" dot={false} name="ε %" strokeWidth={2} />
                </LineChart>
              </ChartPanel>
            </div>
          )}
        </Card>
      )}

      {/* Queued sessions */}
      {sessions.some(s => s.status === 'PENDING') && (
        <Card>
          <SectionLabel>Queued Sessions</SectionLabel>
          <div className="mt-2 space-y-1">
            {sessions.filter(s => s.status === 'PENDING').map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg"
                style={{ backgroundColor: 'var(--bg-base)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps</span>
                <StatusBadge status="QUEUED" tiny />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Completed — show summary */}
      {!running && chartData.length > 0 && (
        <Card>
          <SectionLabel>Last Training Summary</SectionLabel>
          <div className="mt-3 space-y-4">
            <ChartPanel label="Win Rate over Episodes">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="winRate"  stroke="var(--color-teal-600)"  dot={false} name="Win %"  strokeWidth={2} />
                <Line type="monotone" dataKey="lossRate" stroke="var(--color-blue-500)"   dot={false} name="Loss %" strokeWidth={1} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="drawRate" stroke="var(--color-amber-600)" dot={false} name="Draw %" strokeWidth={1} strokeDasharray="2 3" />
              </LineChart>
            </ChartPanel>
            <ChartPanel label="Q-delta Convergence (→ 0 = converged)">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="qDelta" stroke="var(--color-blue-600)" dot={false} name="Avg ΔQ" strokeWidth={2} />
              </LineChart>
            </ChartPanel>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

const ROLLING_WINDOWS = [50, 100, 500]
const SESSION_LINE_COLORS = ['var(--color-teal-600)', 'var(--color-blue-600)', 'var(--color-amber-600)', 'var(--color-red-600)']

function buildRolling(episodes, W) {
  if (episodes.length === 0) return []
  const step = Math.max(1, Math.floor(episodes.length / 200))
  return episodes.filter((_, i) => i % step === 0).map((_, idx) => {
    const realIdx = idx * step
    const slice = episodes.slice(Math.max(0, realIdx - W), realIdx + 1)
    const wins   = slice.filter(e => e.outcome === 'WIN').length
    const losses = slice.filter(e => e.outcome === 'LOSS').length
    const draws  = slice.filter(e => e.outcome === 'DRAW').length
    return {
      ep:       episodes[realIdx].episodeNum,
      winRate:  Math.round((wins   / slice.length) * 100),
      lossRate: Math.round((losses / slice.length) * 100),
      drawRate: Math.round((draws  / slice.length) * 100),
    }
  })
}

function buildChartData(episodes) {
  if (episodes.length === 0) return []
  const step = Math.max(1, Math.floor(episodes.length / 200))
  return episodes.filter((_, i) => i % step === 0).map(e => ({
    ep:      e.episodeNum,
    qDelta:  parseFloat(e.avgQDelta.toFixed(5)),
    epsilon: parseFloat((e.epsilon * 100).toFixed(1)),
  }))
}

function AnalyticsTab({ model, sessions }) {
  const [selSession, setSelSession]   = useState(null)
  const [cmpSession, setCmpSession]   = useState(null)   // comparison session
  const [episodes, setEpisodes]       = useState([])
  const [cmpEpisodes, setCmpEpisodes] = useState([])
  const [window, setWindow]           = useState(50)
  const [loading, setLoading]         = useState(false)

  // Set initial session when sessions become available from parent
  useEffect(() => {
    if (sessions.length > 0 && !selSession) setSelSession(sessions[0])
  }, [sessions])

  useEffect(() => {
    if (!selSession) return
    setLoading(true)
    api.ml.getEpisodes(selSession.id, 1).then(r => setEpisodes(r.episodes)).finally(() => setLoading(false))
  }, [selSession])

  useEffect(() => {
    if (!cmpSession) { setCmpEpisodes([]); return }
    api.ml.getEpisodes(cmpSession.id, 1).then(r => setCmpEpisodes(r.episodes))
  }, [cmpSession])

  const rollingA   = buildRolling(episodes, window)
  const rollingB   = buildRolling(cmpEpisodes, window)
  const chartData  = buildChartData(episodes)

  // Merge primary + comparison rolling data by episode index
  const comparisonData = (() => {
    if (rollingB.length === 0) return rollingA.map(d => ({ ...d, winRateA: d.winRate }))
    const maxLen = Math.max(rollingA.length, rollingB.length)
    return Array.from({ length: maxLen }).map((_, i) => ({
      i,
      winRateA: rollingA[i]?.winRate ?? null,
      winRateB: rollingB[i]?.winRate ?? null,
    }))
  })()

  if (sessions.length === 0) {
    return <Card><p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>No training sessions yet. Train this model first.</p></Card>
  }

  return (
    <div className="space-y-4">
      {/* Session selector + comparison */}
      <Card>
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-1 min-w-[180px]">
            <SectionLabel>Primary session</SectionLabel>
            <select
              className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
              value={selSession?.id ?? ''}
              onChange={e => setSelSession(sessions.find(s => s.id === e.target.value) ?? null)}
            >
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
                </option>
              ))}
            </select>
          </div>
          {sessions.length > 1 && (
            <div className="flex-1 min-w-[180px]">
              <SectionLabel>Compare with</SectionLabel>
              <select
                className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                value={cmpSession?.id ?? ''}
                onChange={e => setCmpSession(sessions.find(s => s.id === e.target.value) ?? null)}
              >
                <option value="">None</option>
                {sessions.filter(s => s.id !== selSession?.id).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Rolling window selector */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Rolling window:</span>
          {ROLLING_WINDOWS.map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${window === w ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
              style={{ backgroundColor: window === w ? undefined : 'var(--bg-surface-hover)', color: window === w ? undefined : 'var(--text-secondary)' }}>
              {w}
            </button>
          ))}
        </div>

        {selSession?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <MiniStat label="Win Rate" value={`${Math.round((selSession.summary.winRate ?? 0) * 100)}%`} color="var(--color-teal-600)" />
            <MiniStat label="Final ε" value={(selSession.summary.finalEpsilon ?? 0).toFixed(4)} />
            <MiniStat label="Avg ΔQ" value={(selSession.summary.avgQDelta ?? 0).toFixed(5)} />
            <MiniStat label="States" value={(selSession.summary.stateCount ?? 0).toLocaleString()} />
          </div>
        )}
      </Card>

      {loading && <div className="flex justify-center py-8"><Spinner /></div>}

      {!loading && comparisonData.length > 1 && (
        <>
          <ChartPanel label={`Rolling Win Rate (window=${window})${cmpSession ? ' — comparison overlay' : ''}`}>
            <LineChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} label={{ value: 'episode →', position: 'insideRight', offset: -10, fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="winRateA" stroke="var(--color-teal-600)" dot={false} strokeWidth={2} name={selSession?.mode?.replace('_', ' ') ?? 'Session A'} connectNulls />
              {cmpSession && <Line type="monotone" dataKey="winRateB" stroke="var(--color-blue-600)" dot={false} strokeWidth={2} strokeDasharray="5 3" name={cmpSession.mode.replace('_', ' ') + ' (cmp)'} connectNulls />}
            </LineChart>
          </ChartPanel>
          <ChartPanel label="Q-delta Convergence">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="qDelta" stroke="var(--color-blue-600)" dot={false} strokeWidth={2} name="Avg ΔQ" />
            </LineChart>
          </ChartPanel>
          <ChartPanel label="Exploration Rate Decay">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`, 'ε']} />
              <Line type="monotone" dataKey="epsilon" stroke="var(--color-amber-600)" dot={false} strokeWidth={2} />
            </LineChart>
          </ChartPanel>
        </>
      )}
    </div>
  )
}

// ─── Explainability Tab ───────────────────────────────────────────────────────

const EMPTY_BOARD = Array(9).fill(null)

function ExplainabilityTab({ model, domainUserId, currentUserName }) {
  const [board, setBoard]           = useState([...EMPTY_BOARD])
  const [qValues, setQValues]       = useState(null)
  const [bestCell, setBestCell]     = useState(null)
  const [loading, setLoading]       = useState(false)
  const [openingBook, setOpeningBook] = useState(null)
  const [obLoading, setObLoading]   = useState(false)
  const [activeSection, setSection] = useState('position') // 'position' | 'opening' | 'diff' | 'activations'

  const isNeuralNet = model.algorithm === 'DQN' || model.algorithm === 'ALPHA_ZERO'

  // Fetch Q-values whenever board changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.ml.explainMove(model.id, board)
      .then(r => { if (!cancelled) { setQValues(r.qvalues); setBestCell(r.bestCell) } })
      .catch(() => { if (!cancelled) { setQValues(null); setBestCell(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [model.id, board.join(',')])

  function handleCellClick(i) {
    setBoard(prev => {
      const next = [...prev]
      if (next[i] === null)      next[i] = 'X'
      else if (next[i] === 'X')  next[i] = 'O'
      else                       next[i] = null
      return next
    })
  }

  function handleLoadOpeningBook() {
    setObLoading(true)
    api.ml.getOpeningBook(model.id)
      .then(r => setOpeningBook(r))
      .finally(() => setObLoading(false))
  }

  // Ranked legal moves by Q-value
  const rankedMoves = qValues
    ? qValues
        .map((v, i) => ({ i, v, mark: board[i] }))
        .filter(m => m.mark === null && m.v !== null)
        .sort((a, b) => b.v - a.v)
    : []

  const topQ = rankedMoves[0]?.v ?? 0
  const secondQ = rankedMoves[1]?.v ?? 0
  const confidence = rankedMoves.length >= 2 && topQ !== secondQ
    ? Math.min(100, Math.round(((topQ - secondQ) / (Math.abs(topQ) + Math.abs(secondQ) + 1e-6)) * 100))
    : 0

  return (
    <div className="space-y-4">
      {/* Section toggle */}
      <div className="flex gap-2 flex-wrap">
        {[
          ['position', 'Position Analysis'],
          ['opening', 'Opening Book'],
          ['diff', 'Version Diff'],
          ['hypersearch', 'Hyperparam Search'],
          ['opponent', 'Opponent Model'],
          ...(isNeuralNet ? [['activations', 'Network Activations']] : []),
        ].map(([s, label]) => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeSection === s ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
            style={{ backgroundColor: activeSection === s ? undefined : 'var(--bg-surface-hover)', color: activeSection === s ? undefined : 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>

      {activeSection === 'position' && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Left: interactive board */}
          <Card>
            <SectionLabel>Board Position</SectionLabel>
            <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
              Click cells to cycle X → O → empty. Q-values update live.
            </p>
            <div className="flex justify-center mb-4">
              <QValueHeatmap board={board} qValues={qValues} highlight={bestCell} onCellClick={handleCellClick} />
            </div>
            <div className="flex gap-2 mt-2">
              <Btn onClick={() => setBoard([...EMPTY_BOARD])} variant="ghost">Clear</Btn>
              {bestCell !== null && (
                <p className="text-xs self-center" style={{ color: 'var(--text-muted)' }}>
                  Best cell: <b style={{ color: 'var(--color-blue-600)' }}>#{bestCell + 1}</b>
                  {' '}· Confidence: <b>{confidence}%</b>
                </p>
              )}
            </div>
          </Card>

          {/* Right: ranked moves */}
          <Card>
            <SectionLabel>Move Rankings</SectionLabel>
            {loading && <div className="flex justify-center py-8"><Spinner /></div>}
            {!loading && rankedMoves.length === 0 && (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                {board.every(c => c !== null) ? 'Board is full.' : 'No Q-values for this state yet — train the model first.'}
              </p>
            )}
            {!loading && rankedMoves.length > 0 && (
              <div className="mt-3 space-y-2">
                {rankedMoves.map(({ i, v }, rank) => {
                  const pct = topQ !== 0 ? Math.max(0, Math.round((v / Math.max(Math.abs(topQ), 1e-6)) * 100)) : 50
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs w-4 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>#{rank + 1}</span>
                      <span className="text-xs w-12 font-mono font-bold" style={{ color: rank === 0 ? 'var(--color-teal-600)' : 'var(--text-secondary)' }}>
                        Cell {i + 1}
                      </span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.abs(pct))}%`, backgroundColor: v >= 0 ? 'var(--color-teal-500)' : 'var(--color-red-500)' }} />
                      </div>
                      <span className="text-xs font-mono w-14 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {v.toFixed(4)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeSection === 'opening' && (
        <div className="space-y-4">
          {!openingBook ? (
            <Card>
              <SectionLabel>Opening Book</SectionLabel>
              <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                Analyze the model's first-move preferences and responses to opponent openings.
              </p>
              <Btn onClick={handleLoadOpeningBook} disabled={obLoading}>
                {obLoading ? 'Loading…' : 'Load Opening Book'}
              </Btn>
            </Card>
          ) : (
            <>
              {/* Agent's own first move */}
              <Card>
                <SectionLabel>Agent's Preferred First Move</SectionLabel>
                <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                  Q-values from the empty board ({openingBook.stateCount.toLocaleString()} states learned).
                </p>
                <div className="flex gap-6 items-start flex-wrap">
                  <QValueHeatmap
                    board={EMPTY_BOARD}
                    qValues={openingBook.firstMoveQVals}
                    highlight={openingBook.firstMoveQVals.indexOf(Math.max(...openingBook.firstMoveQVals))}
                  />
                  <div className="space-y-1.5 text-xs flex-1 min-w-[140px]">
                    {openingBook.firstMoveQVals
                      .map((v, i) => ({ i, v }))
                      .sort((a, b) => b.v - a.v)
                      .slice(0, 5)
                      .map(({ i, v }, rank) => (
                        <div key={i} className="flex items-center gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>#{rank + 1}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>Cell {i + 1}</span>
                          <span className="font-mono" style={{ color: rank === 0 ? 'var(--color-teal-600)' : 'var(--text-secondary)' }}>{v.toFixed(4)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </Card>

              {/* Responses to opponent openings */}
              <Card>
                <SectionLabel>Responses to Opponent Openings</SectionLabel>
                <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                  Hover a cell below to see the agent's Q-values when the opponent plays there first.
                </p>
                <OpeningResponseGrid responses={openingBook.responses} />
              </Card>
            </>
          )}
        </div>
      )}

      {activeSection === 'diff' && <VersionDiffViewer model={model} />}
      {activeSection === 'hypersearch' && <HyperparamSearchPanel model={model} />}
      {activeSection === 'opponent' && <OpponentModelPanel model={model} board={board} qValues={qValues} domainUserId={domainUserId} currentUserName={currentUserName} />}
      {activeSection === 'activations' && isNeuralNet && <NetworkActivationsPanel model={model} />}
    </div>
  )
}

// ─── Opponent Model Panel ─────────────────────────────────────────────────────

function OpponentModelPanel({ model, board, qValues, domainUserId, currentUserName }) {
  const [profiles, setProfiles]         = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [profile, setProfile]           = useState(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [loadingProfile, setLoadingProfile]   = useState(false)

  const PROFILE_WEIGHT = 0.2

  useEffect(() => {
    setLoadingProfiles(true)
    api.ml.getPlayerProfiles(model.id)
      .then(r => {
        setProfiles(r.profiles)
        if (r.profiles.length > 0) setSelectedUserId(r.profiles[0].userId)
      })
      .catch(() => {})
      .finally(() => setLoadingProfiles(false))
  }, [model.id])

  useEffect(() => {
    if (!selectedUserId) { setProfile(null); return }
    setLoadingProfile(true)
    api.ml.getPlayerProfile(model.id, selectedUserId)
      .then(r => setProfile(r.profile))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false))
  }, [model.id, selectedUserId])

  // Compute adapted Q-values from profile move patterns for the current board
  const adaptedQValues = (() => {
    if (!qValues || !profile) return null
    const movePatterns = profile.movePatterns || {}
    const stateKey = board.join(',')
    const statePatterns = movePatterns[stateKey] || {}
    const totalMovesFromState = Object.values(statePatterns).reduce((s, c) => s + Number(c), 0)

    return qValues.map((v, i) => {
      if (v === null) return null
      const bias = totalMovesFromState > 0
        ? (Number(statePatterns[i] || 0) / totalMovesFromState)
        : 0
      return v + PROFILE_WEIGHT * bias
    })
  })()

  // Find cells where ranking shifted
  const rankingShifts = (() => {
    if (!qValues || !adaptedQValues) return new Set()
    const baseOrder = qValues
      .map((v, i) => ({ i, v }))
      .filter(x => x.v !== null)
      .sort((a, b) => b.v - a.v)
      .map(x => x.i)
    const adaptOrder = adaptedQValues
      .map((v, i) => ({ i, v }))
      .filter(x => x.v !== null)
      .sort((a, b) => b.v - a.v)
      .map(x => x.i)
    const shifted = new Set()
    baseOrder.forEach((cell, rank) => {
      if (adaptOrder[rank] !== cell) shifted.add(cell)
    })
    return shifted
  })()

  if (loadingProfiles) {
    return <Card><div className="flex justify-center py-8"><Spinner /></div></Card>
  }

  if (profiles.length === 0) {
    return (
      <Card>
        <SectionLabel>Opponent Model</SectionLabel>
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No player profiles yet. Play against this ML model while signed in to build opponent models.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel>Opponent Model</SectionLabel>
        <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          Select a player profile to see how their move history influences the AI's Q-values for the current board position.
          Cells highlighted in amber shifted ranking when adaptation is applied.
        </p>

        {/* Profile selector */}
        <div className="mb-4">
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Player</label>
          <select
            value={selectedUserId || ''}
            onChange={e => setSelectedUserId(e.target.value)}
            className="w-full sm:w-auto text-sm rounded-lg border px-3 py-1.5 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            {profiles.map(p => (
              <option key={p.userId} value={p.userId}>
                {playerLabel(p, domainUserId, currentUserName)} ({p.gamesRecorded} games)
              </option>
            ))}
          </select>
        </div>

        {loadingProfile && <div className="flex justify-center py-4"><Spinner /></div>}

        {!loadingProfile && profile && adaptedQValues && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Base Q-values */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Base Q-values</p>
              <QValueHeatmap
                board={board}
                qValues={qValues}
                highlight={qValues ? qValues.reduce((b, v, i) => v !== null && (b === -1 || v > qValues[b]) ? i : b, -1) : null}
              />
            </div>

            {/* Adapted Q-values */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                Adapted Q-values <span style={{ color: 'var(--color-amber-600)' }}>(profile weight {PROFILE_WEIGHT})</span>
              </p>
              <QValueHeatmap
                board={board}
                qValues={adaptedQValues}
                highlight={adaptedQValues ? adaptedQValues.reduce((b, v, i) => v !== null && (b === -1 || v > adaptedQValues[b]) ? i : b, -1) : null}
              />
            </div>

            {/* Shift summary */}
            {rankingShifts.size > 0 && (
              <div className="md:col-span-2">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Ranking shifted for cells:{' '}
                  {[...rankingShifts].map(c => (
                    <span key={c} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mx-0.5"
                      style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>
                      #{c + 1}
                    </span>
                  ))}
                </p>
              </div>
            )}

            {rankingShifts.size === 0 && (
              <div className="md:col-span-2">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  No ranking changes for this board state — the player has no recorded moves here yet.
                </p>
              </div>
            )}
          </div>
        )}

        {!loadingProfile && !profile && selectedUserId && (
          <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>Profile not found.</p>
        )}
      </Card>
    </div>
  )
}

// ─── Network Activations Panel ────────────────────────────────────────────────

function NetworkActivationsPanel({ model }) {
  const [board, setBoard]           = useState([...EMPTY_BOARD])
  const [activations, setActivations] = useState(null)
  const [qValues, setQValues]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)

  function handleCellClick(i) {
    setBoard(prev => {
      const next = [...prev]
      if (next[i] === null)      next[i] = 'X'
      else if (next[i] === 'X')  next[i] = 'O'
      else                       next[i] = null
      return next
    })
  }

  async function handleInspect() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.ml.explainActivations(model.id, board)
      setActivations(result.activations)
      setQValues(result.qValues)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const MAX_CIRCLES = 64

  return (
    <Card>
      <SectionLabel>Network Activations</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Inspect the internal activations of the neural network for a given board position.
        Each row represents one layer; blue = positive activation, red = negative.
      </p>

      <div className="flex gap-6 flex-wrap items-start mb-4">
        {/* Interactive board */}
        <div>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Click cells to cycle X → O → empty</p>
          <div className="grid grid-cols-3 gap-1 w-[140px]">
            {board.map((cell, i) => (
              <button key={i} type="button" onClick={() => handleCellClick(i)}
                className="aspect-square flex items-center justify-center rounded-lg border-2 text-sm font-bold transition-all"
                style={{
                  minHeight: 40,
                  backgroundColor: 'var(--bg-base)',
                  borderColor: 'var(--border-default)',
                  color: cell === 'X' ? 'var(--color-blue-600)' : 'var(--color-red-600)',
                }}>
                {cell ?? ''}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Btn onClick={() => setBoard([...EMPTY_BOARD])} variant="ghost">Clear</Btn>
            <Btn onClick={handleInspect} disabled={loading}>
              {loading ? 'Inspecting…' : 'Inspect activations'}
            </Btn>
          </div>
          {error && <p className="text-xs mt-2" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
        </div>

        {/* Q-values summary */}
        {qValues && (
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Q-values (legal moves)</p>
            <div className="space-y-1">
              {qValues.map((v, i) => v !== null && (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-10" style={{ color: 'var(--text-muted)' }}>Cell {i + 1}</span>
                  <span className="font-mono w-14 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {typeof v === 'number' ? v.toFixed(4) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Layer visualizations */}
      {activations && (
        <div className="space-y-4 mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Layer Activations ({activations.length} layers)
          </p>
          {activations.map((layer, li) => {
            const displayed = layer.slice(0, MAX_CIRCLES)
            const maxAbs    = Math.max(...displayed.map(Math.abs), 1e-6)
            return (
              <div key={li}>
                <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Layer {li} — {layer.length} {li === 0 ? 'inputs' : li === activations.length - 1 ? 'outputs' : 'neurons'}
                  {layer.length > MAX_CIRCLES && <span> (showing first {MAX_CIRCLES})</span>}
                </p>
                <div className="flex flex-wrap gap-1">
                  {displayed.map((val, ni) => {
                    const intensity = Math.min(1, Math.abs(val) / maxAbs)
                    const alpha     = 0.15 + intensity * 0.85
                    const color     = val >= 0
                      ? `rgba(37, 99, 235, ${alpha.toFixed(2)})`   // blue for positive
                      : `rgba(220, 38, 38, ${alpha.toFixed(2)})`   // red for negative
                    return (
                      <div
                        key={ni}
                        title={`Neuron ${ni}: ${val.toFixed(4)}`}
                        className="rounded-full transition-colors"
                        style={{ width: 14, height: 14, backgroundColor: color, flexShrink: 0 }}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ─── Hyperparameter Search Panel ──────────────────────────────────────────────

function HyperparamSearchPanel({ model }) {
  const [alphaMin,        setAlphaMin]        = useState(0.1)
  const [alphaMax,        setAlphaMax]        = useState(0.5)
  const [gammaMin,        setGammaMin]        = useState(0.8)
  const [gammaMax,        setGammaMax]        = useState(0.95)
  const [epsDecayMin,     setEpsDecayMin]     = useState(0.99)
  const [epsDecayMax,     setEpsDecayMax]     = useState(0.999)
  const [gamesPerConfig,  setGamesPerConfig]  = useState(500)
  const [running,  setRunning]  = useState(false)
  const [results,  setResults]  = useState(null)
  const [error,    setError]    = useState(null)

  async function handleRun() {
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const token = await getToken()
      const paramGrid = {
        learningRate:  linspace(alphaMin, alphaMax, 3),
        discountFactor: linspace(gammaMin, gammaMax, 2),
        epsilonDecay:  linspace(epsDecayMin, epsDecayMax, 2),
      }
      const data = await api.ml.startHyperparamSearch(model.id, { paramGrid, gamesPerConfig }, token)
      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  async function handleApplyBest() {
    if (!results?.bestConfig) return
    const token = await getToken()
    await api.ml.updateModel(model.id, { config: { ...model.config, ...results.bestConfig } }, token)
  }

  return (
    <Card>
      <SectionLabel>Hyperparameter Search</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Grid search over α, γ, εDecay ranges. Each config trains for {gamesPerConfig} episodes vs Hard then evaluates 50 games.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <RangeInputPair label="Learning rate (α)" min={alphaMin} max={alphaMax} setMin={setAlphaMin} setMax={setAlphaMax} step={0.05} />
        <RangeInputPair label="Discount factor (γ)" min={gammaMin} max={gammaMax} setMin={setGammaMin} setMax={setGammaMax} step={0.05} />
        <RangeInputPair label="Epsilon decay" min={epsDecayMin} max={epsDecayMax} setMin={setEpsDecayMin} setMax={setEpsDecayMax} step={0.001} />
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Games per config</label>
          <input type="number" min="100" max="2000" step="100" value={gamesPerConfig}
            onChange={e => setGamesPerConfig(Number(e.target.value))}
            className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Btn onClick={handleRun} disabled={running}>
          {running ? 'Searching…' : 'Run Search'}
        </Btn>
        {results?.bestConfig && (
          <Btn onClick={handleApplyBest} variant="ghost">Apply best config</Btn>
        )}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

      {running && (
        <div className="flex items-center gap-3 py-4">
          <Spinner />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Running grid search — this may take a moment…</span>
        </div>
      )}

      {results && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            Best: α={results.bestConfig.learningRate} γ={results.bestConfig.discountFactor} εDecay={results.bestConfig.epsilonDecay}
            {' '}— {Math.round((results.results[0]?.winRate ?? 0) * 100)}% win rate
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">α</th>
                  <th className="pb-2 pr-3">γ</th>
                  <th className="pb-2 pr-3">εDecay</th>
                  <th className="pb-2 pr-3">Win rate</th>
                  <th className="pb-2">W / Total</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                    <td className="py-1.5 pr-3 font-bold" style={{ color: i === 0 ? 'var(--color-teal-600)' : 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.config.learningRate}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.config.discountFactor}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.config.epsilonDecay}</td>
                    <td className="py-1.5 pr-3 font-bold" style={{ color: r.winRate >= 0.5 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}>
                      {Math.round(r.winRate * 100)}%
                    </td>
                    <td className="py-1.5" style={{ color: 'var(--text-muted)' }}>{r.wins} / {r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}

function RangeInputPair({ label, min, max, setMin, setMax, step }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" step={step} value={min} onChange={e => setMin(Number(e.target.value))}
          className="w-20 text-xs rounded-lg border px-2 py-1 outline-none"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>–</span>
        <input type="number" step={step} value={max} onChange={e => setMax(Number(e.target.value))}
          className="w-20 text-xs rounded-lg border px-2 py-1 outline-none"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
      </div>
    </div>
  )
}

function linspace(min, max, n) {
  if (n <= 1) return [min]
  const step = (max - min) / (n - 1)
  return Array.from({ length: n }, (_, i) => parseFloat((min + step * i).toFixed(6)))
}

// ─── Version Diff Viewer ──────────────────────────────────────────────────────

function VersionDiffViewer({ model }) {
  const [checkpoints, setCheckpoints] = useState([])
  const [versionA, setVersionA] = useState('current')
  const [versionB, setVersionB] = useState(null)
  const [qtableA, setQtableA]   = useState(null)
  const [qtableB, setQtableB]   = useState(null)
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    api.ml.getCheckpoints(model.id).then(r => {
      setCheckpoints(r.checkpoints)
      if (r.checkpoints.length > 0) setVersionB(r.checkpoints[0].id)
    })
  }, [model.id])

  async function fetchQTable(version) {
    if (version === 'current') {
      const r = await api.ml.getQTable(model.id)
      return r.qtable
    }
    const r = await api.ml.getCheckpoint(model.id, version)
    return r.checkpoint.qtable
  }

  async function runDiff() {
    if (!versionB) return
    setLoading(true)
    try {
      const [a, b] = await Promise.all([fetchQTable(versionA), fetchQTable(versionB)])
      setQtableA(a)
      setQtableB(b)
    } finally {
      setLoading(false)
    }
  }

  const diff = (() => {
    if (!qtableA || !qtableB) return null
    const allKeys = new Set([...Object.keys(qtableA), ...Object.keys(qtableB)])
    let added = 0, removed = 0, changed = 0
    const deltas = []
    for (const key of allKeys) {
      const a = qtableA[key]
      const b = qtableB[key]
      if (!a) { added++; continue }
      if (!b) { removed++; continue }
      const maxDelta = Math.max(...a.map((v, i) => Math.abs(v - b[i])))
      if (maxDelta > 1e-6) {
        changed++
        deltas.push({ key, a, b, maxDelta })
      }
    }
    deltas.sort((x, y) => y.maxDelta - x.maxDelta)
    // Build histogram (bins 0-0.1, 0.1-0.2, ..., 1+)
    const bins = Array.from({ length: 11 }).map((_, i) => ({ range: i < 10 ? `${i/10}–${(i+1)/10}` : '1+', count: 0 }))
    for (const d of deltas) {
      const bi = Math.min(10, Math.floor(d.maxDelta * 10))
      bins[bi].count++
    }
    return { added, removed, changed, deltas: deltas.slice(0, 20), histogram: bins }
  })()

  const cpLabel = id => {
    const cp = checkpoints.find(c => c.id === id)
    return cp ? `Ep ${cp.episodeNum.toLocaleString()} (ε=${cp.epsilon.toFixed(3)})` : id
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel>Select Versions to Compare</SectionLabel>
        <div className="mt-3 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Version A</label>
            <select value={versionA} onChange={e => setVersionA(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              <option value="current">Current model (live Q-table)</option>
              {checkpoints.map(cp => <option key={cp.id} value={cp.id}>{cpLabel(cp.id)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Version B</label>
            <select value={versionB || ''} onChange={e => setVersionB(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              {checkpoints.map(cp => <option key={cp.id} value={cp.id}>{cpLabel(cp.id)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Btn onClick={runDiff} disabled={loading || !versionB || versionA === versionB}>
            {loading ? 'Computing…' : 'Compare'}
          </Btn>
        </div>
        {checkpoints.length === 0 && <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>No checkpoints yet — train the model to generate checkpoints.</p>}
      </Card>

      {diff && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="States added" value={diff.added.toLocaleString()} color="var(--color-teal-600)" />
            <MiniStat label="States removed" value={diff.removed.toLocaleString()} color="var(--color-red-600)" />
            <MiniStat label="States changed" value={diff.changed.toLocaleString()} color="var(--color-blue-600)" />
          </div>

          {/* Delta histogram */}
          <ChartPanel label="Q-value Delta Distribution">
            <BarChart data={diff.histogram}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="range" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--color-blue-500)" name="States" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartPanel>

          {/* Top changed states */}
          {diff.deltas.length > 0 && (
            <Card>
              <SectionLabel>Top {diff.deltas.length} Most Changed States</SectionLabel>
              <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                States with the largest max Q-value change between versions.
              </p>
              <div className="space-y-4">
                {diff.deltas.map(({ key, a, b, maxDelta }) => {
                  const board = key.split('').map(c => c === 'X' ? 'X' : c === 'O' ? 'O' : null)
                  return (
                    <div key={key} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-default)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{key}</code>
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-amber-600)' }}>Δmax={maxDelta.toFixed(4)}</span>
                      </div>
                      <div className="flex gap-6 flex-wrap">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Version A</p>
                          <QValueHeatmap board={board} qValues={a.map((v, i) => board[i] !== null ? null : v)} />
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Version B</p>
                          <QValueHeatmap board={board} qValues={b.map((v, i) => board[i] !== null ? null : v)} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function OpeningResponseGrid({ responses }) {
  const [hovered, setHovered] = useState(null)
  const active = hovered !== null ? responses[hovered] : null

  return (
    <div className="flex gap-6 flex-wrap items-start">
      {/* Opponent move selector — 3×3 grid */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Opponent plays:</p>
        <div className="grid grid-cols-3 gap-1.5 w-[140px]">
          {Array.from({ length: 9 }).map((_, i) => (
            <button key={i} type="button"
              onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)} onBlur={() => setHovered(null)}
              className="aspect-square flex items-center justify-center rounded-lg border-2 text-sm font-bold transition-all"
              style={{
                minHeight: 40,
                backgroundColor: hovered === i ? 'var(--color-teal-100)' : 'var(--bg-base)',
                borderColor: hovered === i ? 'var(--color-teal-600)' : 'var(--border-default)',
                color: 'var(--color-teal-600)',
              }}>
              O
            </button>
          ))}
        </div>
      </div>

      {/* Agent's response heatmap */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          {active ? `Agent's response (opponent played cell ${active.opponentCell + 1}):` : 'Hover a cell to see response'}
        </p>
        {active ? (
          <QValueHeatmap
            board={Array(9).fill(null).map((_, i) => i === active.opponentCell ? 'O' : null)}
            qValues={active.qvals.map((v, i) => i === active.opponentCell ? null : v)}
            highlight={active.qvals.reduce((best, v, i) => i !== active.opponentCell && (best === -1 || v > active.qvals[best]) ? i : best, -1)}
          />
        ) : (
          <div className="w-[220px] h-[160px] rounded-xl border flex items-center justify-center"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Checkpoints Tab ──────────────────────────────────────────────────────────

function CheckpointsTab({ model, onRestore }) {
  const [checkpoints, setCheckpoints] = useState([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    api.ml.getCheckpoints(model.id).then(r => {
      setCheckpoints(r.checkpoints)
      if (r.checkpoints.length > 0) setSelected(r.checkpoints[0].id)
    })
  }, [model.id])

  async function handleSave() {
    setSaving(true)
    try {
      const token = await getToken()
      const { checkpoint } = await api.ml.saveCheckpoint(model.id, token)
      setCheckpoints(prev => [checkpoint, ...prev])
      setSelected(checkpoint.id)
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore() {
    if (!selected) return
    if (!confirm('Restore this checkpoint? Current Q-table will be replaced.')) return
    setRestoring(true)
    try {
      const token = await getToken()
      await api.ml.restoreCheckpoint(model.id, selected, token)
      onRestore()
    } finally {
      setRestoring(false)
    }
  }

  const selectedCp = checkpoints.find(cp => cp.id === selected) ?? null

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionLabel>Checkpoints</SectionLabel>
        <Btn onClick={handleSave} disabled={saving} variant="ghost">
          {saving ? 'Saving…' : '+ Save now'}
        </Btn>
      </div>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Auto-saved every 1,000 episodes. Restore any checkpoint to roll back the model.
      </p>
      {checkpoints.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No checkpoints yet.</p>
      ) : (
        <div className="space-y-3">
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="w-full text-sm rounded-lg border px-3 py-2 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            {checkpoints.map(cp => (
              <option key={cp.id} value={cp.id}>
                Episode {cp.episodeNum.toLocaleString()} · ε={cp.epsilon.toFixed(4)} · ELO {Math.round(cp.eloRating)} · {new Date(cp.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {selectedCp && (
            <div className="rounded-lg border px-4 py-3 flex items-center justify-between"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <div className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Episode {selectedCp.episodeNum.toLocaleString()}</span></p>
                <p>ε = {selectedCp.epsilon.toFixed(4)} · ELO {Math.round(selectedCp.eloRating)}</p>
                <p>{new Date(selectedCp.createdAt).toLocaleString()}</p>
              </div>
              <Btn onClick={handleRestore} disabled={restoring} variant="ghost">
                {restoring ? 'Restoring…' : 'Restore'}
              </Btn>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab({ model, sessions }) {
  const [selected, setSelected] = useState(() => sessions[0]?.id ?? '')

  // Keep selection valid when sessions list changes
  useEffect(() => {
    if (sessions.length > 0 && !selected) setSelected(sessions[0].id)
  }, [sessions])

  const sel = sessions.find(s => s.id === selected) ?? null

  function fmtDuration(s) {
    if (!s.startedAt || !s.completedAt) return '—'
    const ms = new Date(s.completedAt) - new Date(s.startedAt)
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  return (
    <Card>
      <SectionLabel>Training Sessions</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        History of all training runs for this model.
      </p>
      {sessions.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No training sessions yet.</p>
      ) : (
        <div className="space-y-3">
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="w-full text-sm rounded-lg border px-3 py-2 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {new Date(s.startedAt).toLocaleDateString()} · {s.mode.replace(/_/g, ' ')} · {s.iterations.toLocaleString()} eps · {s.status}
              </option>
            ))}
          </select>
          {sel && (
            <div className="rounded-lg border px-4 py-4 space-y-3"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{sel.mode.replace(/_/g, ' ')}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full`}
                  style={{
                    backgroundColor: `var(--color-${SESSION_COLOR[sel.status] || 'gray'}-100)`,
                    color: `var(--color-${SESSION_COLOR[sel.status] || 'gray'}-700)`,
                  }}>{sel.status}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCell label="Episodes" value={sel.iterations.toLocaleString()} />
                <StatCell label="Duration" value={fmtDuration(sel)} />
                <StatCell label="Started" value={new Date(sel.startedAt).toLocaleString()} />
                {sel.summary && <>
                  <StatCell label="Win rate" value={sel.summary.winRate != null ? `${(sel.summary.winRate * 100).toFixed(1)}%` : '—'} />
                  <StatCell label="Wins" value={sel.summary.wins ?? '—'} />
                  <StatCell label="Losses" value={sel.summary.losses ?? '—'} />
                  <StatCell label="Draws" value={sel.summary.draws ?? '—'} />
                  <StatCell label="Final ε" value={sel.summary.finalEpsilon != null ? sel.summary.finalEpsilon.toFixed(4) : '—'} />
                  {sel.summary.avgQDelta != null && <StatCell label="Avg Q-Δ" value={sel.summary.avgQDelta.toFixed(4)} />}
                </>}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function StatCell({ label, value }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-default)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  )
}

// ─── Export Tab ───────────────────────────────────────────────────────────────

function ExportTab({ model, sessions }) {
  const [selSession, setSelSession] = useState(() => sessions[0]?.id ?? null)

  async function exportQTable() {
    const data = await api.ml.getQTable(model.id)
    downloadJSON(data, `qtable_${model.name.replace(/\s+/g, '_')}.json`)
  }

  async function exportEpisodes() {
    if (!selSession) return
    const { episodes } = await api.ml.getEpisodes(selSession, 1)
    downloadCSV(episodes, ['episodeNum', 'outcome', 'totalMoves', 'avgQDelta', 'epsilon', 'durationMs'],
      `episodes_${model.name.replace(/\s+/g, '_')}_${selSession.slice(-6)}.csv`)
  }

  return (
    <Card>
      <SectionLabel>Export Data</SectionLabel>
      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <p className="text-sm font-semibold">Q-Table (JSON)</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Full state→Q-value mapping. {model.totalEpisodes.toLocaleString()} episodes learned.</p>
          </div>
          <Btn onClick={exportQTable}>Download</Btn>
        </div>

        {sessions.length > 0 && (
          <div className="rounded-lg border px-4 py-3 space-y-2" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Episode Data (CSV)</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Per-episode outcome, Q-delta, epsilon for selected session.</p>
              </div>
              <Btn onClick={exportEpisodes}>Download</Btn>
            </div>
            <select value={selSession || ''} onChange={e => setSelSession(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps · {new Date(s.startedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Card>
  )
}

// ─── Clone Model Modal ────────────────────────────────────────────────────────

function CloneModelModal({ src, onClose, onCreate }) {
  const [name, setName]     = useState(`${src.name} (copy)`)
  const [desc, setDesc]     = useState(src.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const { model } = await api.ml.cloneModel(src.id, { name: name.trim(), description: desc.trim() || undefined }, token)
      onCreate(model)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <h2 className="text-xl font-bold">Clone "{src.name}"</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Btn type="button" onClick={onClose} variant="ghost">Cancel</Btn>
            <Btn type="submit" disabled={saving || !name.trim()}>{saving ? 'Cloning…' : 'Clone'}</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Import Model Modal ───────────────────────────────────────────────────────

function ImportModelModal({ onClose, onCreate }) {
  const [error, setError]   = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSaving(true)
    setError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const token = await getToken()
      const { model } = await api.ml.importModel(data, token)
      onCreate(model)
    } catch (err) {
      setError(err.message || 'Invalid model file')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <h2 className="text-xl font-bold">Import Model</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Select a <code className="font-mono text-xs">.ml.json</code> file exported from this dashboard.
        </p>
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-[var(--color-blue-600)]"
          style={{ borderColor: 'var(--border-default)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {saving ? 'Importing…' : 'Click to select file'}
          </p>
          <input ref={fileRef} type="file" accept=".json,.ml.json" className="hidden" onChange={handleFile} disabled={saving} />
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
        <div className="flex justify-end">
          <Btn type="button" onClick={onClose} variant="ghost">Cancel</Btn>
        </div>
      </div>
    </div>
  )
}

// ─── Create Model Modal ───────────────────────────────────────────────────────

function CreateModelModal({ onClose, onCreate }) {
  const [name, setName]           = useState('')
  const [desc, setDesc]           = useState('')
  const [algorithm, setAlgorithm] = useState('Q_LEARNING')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  // DQN network shape
  const [networkShape, setNetworkShape] = useState([32])
  const [netCfg, setNetCfg]             = useState(null) // { maxHiddenLayers, maxUnitsPerLayer }

  useEffect(() => {
    api.ml.getNetworkConfig().then(({ dqn }) => {
      setNetCfg(dqn)
      setNetworkShape(dqn.defaultHiddenLayers ?? [32])
    }).catch(() => {})
  }, [])

  function addLayer() {
    if (!netCfg || networkShape.length >= netCfg.maxHiddenLayers) return
    setNetworkShape(s => [...s, s[s.length - 1] ?? 32])
  }
  function removeLayer(i) {
    setNetworkShape(s => s.filter((_, idx) => idx !== i))
  }
  function setLayerSize(i, v) {
    setNetworkShape(s => s.map((u, idx) => idx === i ? v : u))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      const body = { name: name.trim(), description: desc.trim() || undefined, algorithm }
      if (algorithm === 'DQN') body.config = { networkShape: networkShape.map(Number) }
      const { model } = await api.ml.createModel(body, token)
      onCreate(model)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <h2 className="text-xl font-bold">New ML Model</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alpha v1"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Algorithm</label>
            <div className="grid grid-cols-2 gap-2">
              {ALGORITHMS.map(a => (
                <button key={a.value} type="button" onClick={() => setAlgorithm(a.value)}
                  className="text-left rounded-lg border p-2.5 transition-all"
                  style={{
                    borderColor: algorithm === a.value ? 'var(--color-blue-600)' : 'var(--border-default)',
                    backgroundColor: algorithm === a.value ? 'var(--color-blue-50)' : 'var(--bg-base)',
                  }}>
                  <div className="text-sm font-semibold" style={{ color: algorithm === a.value ? 'var(--color-blue-700)' : 'var(--text-primary)' }}>{a.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.desc}</div>
                </button>
              ))}
            </div>
          </div>
          {algorithm === 'DQN' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Hidden Layers
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    → [{['9', ...networkShape.map(String), '9'].join(', ')}]
                  </span>
                </label>
                <button
                  type="button"
                  onClick={addLayer}
                  disabled={!!netCfg && networkShape.length >= netCfg.maxHiddenLayers}
                  className="text-xs px-2 py-0.5 rounded font-medium disabled:opacity-40"
                  style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
                >
                  + Add layer
                </button>
              </div>
              <div className="space-y-1.5">
                {networkShape.map((units, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs w-16 shrink-0" style={{ color: 'var(--text-muted)' }}>Layer {i + 1}</span>
                    <input
                      type="number"
                      min="1"
                      max={netCfg?.maxUnitsPerLayer ?? 256}
                      value={units}
                      onChange={e => setLayerSize(i, parseInt(e.target.value) || 1)}
                      className="w-24 px-2 py-1 rounded border text-sm font-mono outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>units</span>
                    {networkShape.length > 1 && (
                      <button type="button" onClick={() => removeLayer(i)}
                        className="text-xs ml-auto px-1.5 py-0.5 rounded hover:bg-[var(--color-red-50)]"
                        style={{ color: 'var(--text-muted)' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              {netCfg && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Max {netCfg.maxHiddenLayers} layers · max {netCfg.maxUnitsPerLayer} units per layer
                </p>
              )}
            </div>
          )}
          {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Btn type="button" onClick={onClose} variant="ghost">Cancel</Btn>
            <Btn type="submit" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create'}</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Evaluation Tab ───────────────────────────────────────────────────────────

function EvaluationTab({ model, models, domainUserId, currentUserName }) {
  const [section, setSection] = useState('benchmark') // 'benchmark' | 'elo' | 'versus' | 'tournament' | 'profiles'

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          ['benchmark', 'Benchmark'],
          ['elo', 'ELO History'],
          ['versus', 'Head-to-Head'],
          ['tournament', 'Tournament'],
          ['profiles', 'Player Profiles'],
        ].map(([s, label]) => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${section === s ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
            style={{ backgroundColor: section === s ? undefined : 'var(--bg-surface-hover)', color: section === s ? undefined : 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>
      {section === 'benchmark'  && <BenchmarkPanel model={model} />}
      {section === 'elo'        && <EloPanel model={model} />}
      {section === 'versus'     && <VersusPanel model={model} models={models} />}
      {section === 'tournament' && <TournamentPanel models={models} />}
      {section === 'profiles'   && <PlayerProfilesPanel model={model} domainUserId={domainUserId} currentUserName={currentUserName} />}
    </div>
  )
}

function BenchmarkPanel({ model }) {
  const [benchmarks, setBenchmarks] = useState([])
  const [running, setRunning] = useState(false)
  const [activeBid, setActiveBid] = useState(null)
  const socketRef = useRef(null)

  useEffect(() => {
    api.ml.listBenchmarks(model.id).then(r => setBenchmarks(r.benchmarks))
  }, [model.id])

  async function handleRun() {
    const token = await getToken()
    const { benchmark } = await api.ml.startBenchmark(model.id, token)
    setRunning(true)
    setActiveBid(benchmark.id)
    setBenchmarks(prev => [{ ...benchmark, summary: { status: 'RUNNING' } }, ...prev])

    // Poll for result
    let attempts = 0
    const poll = async () => {
      attempts++
      try {
        const r = await api.ml.getBenchmark(benchmark.id)
        if (r.benchmark?.summary?.status === 'COMPLETED' || r.benchmark?.summary?.status === 'FAILED') {
          setRunning(false)
          setBenchmarks(prev => prev.map(b => b.id === benchmark.id ? r.benchmark : b))
          return
        }
      } catch (_) {}
      if (attempts < 30) setTimeout(poll, 1000)
      else setRunning(false)
    }
    setTimeout(poll, 1000)
  }

  const latest = benchmarks.find(b => b.summary?.status === 'COMPLETED')

  const OPPONENTS = [
    { key: 'vsRandom', label: 'vs Random' },
    { key: 'vsEasy',   label: 'vs Easy AI' },
    { key: 'vsMedium', label: 'vs Medium AI' },
    { key: 'vsTough',  label: 'vs Tough AI' },
    { key: 'vsHard',   label: 'vs Hard AI' },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>Benchmark</SectionLabel>
          <div className="flex items-center gap-3">
            {latest && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Last run: {new Date(latest.runAt).toLocaleDateString()}</span>}
            <Btn onClick={handleRun} disabled={running || model.status === 'TRAINING'}>
              {running ? 'Running…' : 'Run Benchmark'}
            </Btn>
          </div>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          1,000 games vs each opponent using pure exploitation (ε=0).
        </p>

        {running && (
          <div className="flex items-center gap-3 mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
            <Spinner />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Running 5,000 benchmark games…</span>
          </div>
        )}

        {latest && !running && (
          <div className="mt-4 space-y-3">
            {OPPONENTS.map(({ key, label }) => {
              const r = latest[key]
              if (!r || !r.total) return null
              const pct = Math.round(r.winRate * 100)
              const sig = r.pValue !== undefined && r.pValue <= 0.05
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {r.wins}W / {r.draws}D / {r.losses}L
                      </span>
                      <span className="text-sm font-bold" style={{ color: pct >= 60 ? 'var(--color-teal-600)' : pct >= 40 ? 'var(--color-amber-600)' : 'var(--color-red-600)' }}>
                        {pct}%
                      </span>
                      {r.pValue !== undefined && (
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${sig ? 'bg-[var(--color-teal-100)] text-[var(--color-teal-700)]' : 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'}`}>
                          {sig ? `p=${r.pValue}` : `p=${r.pValue} ns`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: pct >= 60 ? 'var(--color-teal-500)' : pct >= 40 ? 'var(--color-amber-500)' : 'var(--color-red-500)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!latest && !running && (
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>No benchmark results yet.</p>
        )}
      </Card>

      {/* Benchmark history */}
      {benchmarks.length > 1 && (
        <Card>
          <SectionLabel>History ({benchmarks.length} runs)</SectionLabel>
          <div className="mt-2 space-y-2">
            {benchmarks.filter(b => b.summary?.status === 'COMPLETED').slice(0, 5).map(b => (
              <div key={b.id} className="flex items-center justify-between text-xs py-1.5 border-b last:border-0"
                style={{ borderColor: 'var(--border-default)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{new Date(b.runAt).toLocaleDateString()}</span>
                <span style={{ color: 'var(--text-secondary)' }}>Avg {Math.round((b.summary?.avgWinRate ?? 0) * 100)}% win rate</span>
                {b.vsHard?.winRate !== undefined && (
                  <span style={{ color: 'var(--color-blue-600)' }}>Hard: {Math.round(b.vsHard.winRate * 100)}%</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function EloPanel({ model }) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.ml.getEloHistory(model.id).then(r => setHistory(r.history))
  }, [model.id])

  const chartData = history.map((h, i) => ({ i: i + 1, elo: Math.round(h.eloRating), delta: h.delta }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Current ELO" value={Math.round(model.eloRating)} color="var(--color-blue-600)" />
        <MiniStat label="Peak ELO" value={history.length > 0 ? Math.round(Math.max(...history.map(h => h.eloRating))) : '—'} color="var(--color-teal-600)" />
        <MiniStat label="Games" value={history.length.toLocaleString()} />
      </div>

      {chartData.length > 1 ? (
        <ChartPanel label="ELO Rating over Time">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
            <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} formatter={v => [v, 'ELO']} />
            <Line type="monotone" dataKey="elo" stroke="var(--color-blue-600)" dot={false} strokeWidth={2} />
          </LineChart>
        </ChartPanel>
      ) : (
        <Card>
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
            No ELO history yet. Run head-to-head or tournament to generate ELO data.
          </p>
        </Card>
      )}
    </div>
  )
}

function VersusPanel({ model, models }) {
  const [opponent, setOpponent] = useState(null)
  const [games, setGames] = useState(100)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const others = models.filter(m => m.id !== model.id)

  useEffect(() => {
    if (others.length > 0 && !opponent) setOpponent(others[0].id)
  }, [others.length])

  async function handleRun() {
    if (!opponent) return
    setRunning(true)
    setResult(null)
    try {
      const token = await getToken()
      const data = await api.ml.runVersus(model.id, opponent, games, token)
      setResult(data)
    } catch (err) {
      alert(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <SectionLabel>Head-to-Head</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Pit two models against each other. ELO is updated based on the aggregate result.
      </p>

      {others.length === 0 ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>Need at least two models to run head-to-head.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Opponent</label>
              <select value={opponent || ''} onChange={e => setOpponent(e.target.value)}
                className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                {others.map(m => <option key={m.id} value={m.id}>{m.name} (ELO {Math.round(m.eloRating)})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Games: <b>{games}</b>
              </label>
              <input type="range" min="10" max="1000" step="10" value={games}
                onChange={e => setGames(Number(e.target.value))}
                className="w-full accent-[var(--color-blue-600)]" />
            </div>
          </div>

          <Btn onClick={handleRun} disabled={running || !opponent}>
            {running ? 'Running…' : `Run ${games} games`}
          </Btn>

          {running && (
            <div className="flex items-center gap-3">
              <Spinner />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Playing {games} games…</span>
            </div>
          )}

          {result && (
            <div className="mt-2 space-y-3 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label={`${model.name} wins`} value={result.winsA} color="var(--color-teal-600)" />
                <MiniStat label="Draws" value={result.draws} />
                <MiniStat label={`${models.find(m => m.id === result.modelBId)?.name || 'Opponent'} wins`} value={result.winsB} color="var(--color-red-600)" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>
                  {model.name} win rate: <b style={{ color: 'var(--color-blue-600)' }}>{Math.round(result.winRateA * 100)}%</b>
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${result.pValue <= 0.05 ? 'bg-[var(--color-teal-100)] text-[var(--color-teal-700)]' : 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'}`}>
                  {result.pValue <= 0.05 ? `Significant (p=${result.pValue})` : `Not significant (p=${result.pValue})`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Player Profiles Panel ────────────────────────────────────────────────────

function MiniBoard({ counts }) {
  // counts: { cellIndex: count } — render a 3×3 heatmap of move frequencies
  const values = Array.from({ length: 9 }, (_, i) => Number(counts[i] || 0))
  const maxVal = Math.max(...values, 1)
  return (
    <div className="grid grid-cols-3 gap-0.5 w-[90px]">
      {values.map((v, i) => {
        const intensity = v / maxVal
        const alpha = 0.1 + intensity * 0.9
        return (
          <div
            key={i}
            title={`Cell ${i + 1}: ${v} times`}
            className="rounded"
            style={{
              width: 28,
              height: 28,
              backgroundColor: `rgba(37, 99, 235, ${alpha.toFixed(2)})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              color: intensity > 0.5 ? 'white' : 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            {v > 0 ? v : ''}
          </div>
        )
      })}
    </div>
  )
}

function TendencyBar({ label, value }) {
  const pct = Math.round((value || 0) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5" style={{ color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span className="font-mono font-semibold">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--color-blue-500)' }} />
      </div>
    </div>
  )
}

function PlayerProfilesPanel({ model, domainUserId, currentUserName }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.ml.getPlayerProfiles(model.id)
      .then(r => setProfiles(r.profiles))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [model.id])

  function toggleRow(id) {
    setExpanded(prev => prev === id ? null : id)
  }

  return (
    <Card>
      <SectionLabel>Player Profiles</SectionLabel>
      <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        Move pattern profiles recorded from human players who played this model. Profiles adapt the AI's responses per player.
      </p>

      {loading && <div className="flex justify-center py-6"><Spinner /></div>}

      {!loading && profiles.length === 0 && (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No player profiles yet. Play a game against this ML model while signed in to start building profiles.
        </p>
      )}

      {!loading && profiles.length > 0 && (
        <div className="space-y-2">
          {/* Header row */}
          <div className="grid gap-3 text-xs font-semibold uppercase tracking-wide px-3 py-1"
            style={{ color: 'var(--text-muted)', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
            <span>Player</span>
            <span>Games</span>
            <span>Center %</span>
            <span>Corner %</span>
            <span>Since</span>
          </div>

          {profiles.map(p => {
            const tendencies = p.tendencies || {}
            const isExpanded = expanded === p.id
            return (
              <div key={p.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
                {/* Summary row */}
                <button
                  onClick={() => toggleRow(p.id)}
                  className="w-full grid gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
                  style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', backgroundColor: 'var(--bg-base)' }}
                >
                  <span className="text-xs truncate font-medium" style={{ color: 'var(--text-secondary)' }} title={playerLabel(p, domainUserId, currentUserName)}>
                    {playerLabel(p, domainUserId, currentUserName)}
                  </span>
                  <span className="font-bold" style={{ color: 'var(--color-blue-600)' }}>{p.gamesRecorded}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{Math.round((tendencies.centerRate || 0) * 100)}%</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{Math.round((tendencies.cornerRate || 0) * 100)}%</span>
                  <span style={{ color: 'var(--text-muted)' }}>{new Date(p.createdAt).toLocaleDateString()}</span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 py-4 border-t space-y-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                    <div className="flex flex-wrap gap-8 items-start">
                      {/* Opening preferences heatmap */}
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Opening Preferences</p>
                        {Object.keys(p.openingPreferences || {}).length > 0 ? (
                          <MiniBoard counts={p.openingPreferences} />
                        ) : (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No opening data yet</p>
                        )}
                      </div>

                      {/* Tendencies bars */}
                      <div className="flex-1 min-w-[180px] space-y-2">
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Move Tendencies</p>
                        <TendencyBar label="Center rate" value={tendencies.centerRate} />
                        <TendencyBar label="Corner rate" value={tendencies.cornerRate} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function TournamentPanel({ models }) {
  const [selected, setSelected] = useState([])
  const [gamesPerPair, setGamesPerPair] = useState(50)
  const [running, setRunning] = useState(false)
  const [tournament, setTournament] = useState(null)
  const [history, setHistory] = useState([])
  const socketRef = useRef(null)

  useEffect(() => {
    api.ml.listTournaments().then(r => setHistory(r.tournaments))
  }, [])

  function toggleModel(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleRun() {
    if (selected.length < 2) return
    setRunning(true)
    const token = await getToken()
    try {
      const { tournament: t } = await api.ml.startTournament({ modelIds: selected, gamesPerPair }, token)
      setTournament({ ...t, status: 'RUNNING' })

      const socket = getSocket()
      if (!socket.connected) socket.connect()
      socketRef.current = socket
      socket.on('ml:tournament_complete', (data) => {
        if (data.tournamentId !== t.id) return
        api.ml.getTournament(t.id).then(r => {
          setTournament(r.tournament)
          setRunning(false)
          setHistory(prev => [r.tournament, ...prev.filter(x => x.id !== r.tournament.id)])
        })
        socket.off('ml:tournament_complete')
      })
    } catch (err) {
      alert(err.message)
      setRunning(false)
    }
  }

  const latest = tournament?.status === 'COMPLETED' ? tournament : history.find(t => t.status === 'COMPLETED')
  const standings = latest?.results?.standings ?? []

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel>New Tournament</SectionLabel>
        <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          Round-robin: every pair plays {gamesPerPair} games. ELO updated after each matchup.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {models.map(m => (
            <button key={m.id} onClick={() => toggleModel(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${selected.includes(m.id) ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-700)]' : ''}`}
              style={{ borderColor: selected.includes(m.id) ? undefined : 'var(--border-default)', backgroundColor: selected.includes(m.id) ? undefined : 'var(--bg-base)', color: selected.includes(m.id) ? undefined : 'var(--text-secondary)' }}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 mb-4">
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Games/pair: <b>{gamesPerPair}</b></label>
          <input type="range" min="10" max="200" step="10" value={gamesPerPair}
            onChange={e => setGamesPerPair(Number(e.target.value))}
            className="w-32 accent-[var(--color-blue-600)]" />
        </div>
        <Btn onClick={handleRun} disabled={running || selected.length < 2}>
          {running ? 'Tournament running…' : `Start (${selected.length} models)`}
        </Btn>
      </Card>

      {standings.length > 0 && (
        <Card>
          <SectionLabel>Tournament Results</SectionLabel>
          {latest?.completedAt && <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-muted)' }}>Completed {new Date(latest.completedAt).toLocaleString()}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-left" style={{ color: 'var(--text-muted)' }}>
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Model</th>
                  <th className="pb-2 pr-4">Pts</th>
                  <th className="pb-2 pr-4">W</th>
                  <th className="pb-2 pr-4">D</th>
                  <th className="pb-2">L</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.modelId} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                    <td className="py-2 pr-4 font-bold" style={{ color: i === 0 ? 'var(--color-amber-600)' : 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{s.name}</td>
                    <td className="py-2 pr-4 font-bold" style={{ color: 'var(--color-blue-600)' }}>{s.points}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--color-teal-600)' }}>{s.wins}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--color-amber-600)' }}>{s.draws}</td>
                    <td className="py-2" style={{ color: 'var(--color-red-600)' }}>{s.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Card({ children }) {
  return (
    <div className="rounded-xl border p-5 space-y-1"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{children}</h3>
}

function MiniStat({ label, value, color }) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function ChartPanel({ label, children }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <ResponsiveContainer width="100%" height={200}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function StatusBadge({ status, tiny }) {
  const colors = { IDLE: ['var(--color-teal-100)', 'var(--color-teal-700)'], TRAINING: ['var(--color-blue-100)', 'var(--color-blue-700)'], COMPLETED: ['var(--color-teal-100)', 'var(--color-teal-700)'], FAILED: ['var(--color-red-100)', 'var(--color-red-700)'], CANCELLED: ['var(--color-amber-100)', 'var(--color-amber-700)'], PENDING: ['var(--color-gray-100)', 'var(--color-gray-600)'], RUNNING: ['var(--color-blue-100)', 'var(--color-blue-700)'], QUEUED: ['#fef9c3', '#a16207'] }
  const [bg, text] = colors[status] || colors.PENDING
  return (
    <span className={`font-semibold rounded-full ${tiny ? 'text-[9px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'}`}
      style={{ backgroundColor: bg, color: text }}>
      {status}
    </span>
  )
}

function Btn({ children, onClick, variant = 'primary', disabled, type = 'button' }) {
  const styles = {
    primary: { backgroundColor: 'var(--color-blue-600)', color: 'white' },
    ghost:   { backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' },
    danger:  { backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
      style={styles[variant]}>
      {children}
    </button>
  )
}

function Spinner() {
  return <div className="w-6 h-6 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
}

const tooltipStyle = { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); URL.revokeObjectURL(url)
}

function downloadCSV(rows, keys, filename) {
  const header = keys.join(',')
  const lines  = rows.map(r => keys.map(k => r[k] ?? '').join(','))
  const blob   = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url    = URL.createObjectURL(blob)
  const a      = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); URL.revokeObjectURL(url)
}

// ─── Rule Sets Sidebar ────────────────────────────────────────────────────────

function RuleSetsSidebar() {
  const [ruleSets, setRuleSets] = useState([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    api.ml.listRuleSets().then(r => setRuleSets(r.ruleSets || [])).catch(() => {})
  }, [])

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-widest mb-2"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>Rule Sets</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        ruleSets.length === 0
          ? <p className="text-xs py-2 text-center" style={{ color: 'var(--text-muted)' }}>No rule sets yet.</p>
          : ruleSets.map(rs => (
            <div
              key={rs.id}
              className="w-full text-left rounded-lg border p-2 mb-1.5 text-xs"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="font-semibold truncate">{rs.name}</div>
              <div style={{ color: 'var(--text-muted)' }}>
                {Array.isArray(rs.sourceModels) ? rs.sourceModels.length : 0} source model{rs.sourceModels?.length !== 1 ? 's' : ''}
                {' · '}{Array.isArray(rs.rules) ? rs.rules.length : 0} rules
              </div>
            </div>
          ))
      )}
    </div>
  )
}

// ─── Rules Tab ────────────────────────────────────────────────────────────────

const RULE_META_FRONTEND = {
  win:             { label: 'Win',             desc: 'Complete a two-in-a-row to win immediately' },
  block:           { label: 'Block',           desc: "Stop the opponent's two-in-a-row threat" },
  fork:            { label: 'Fork',            desc: 'Create two simultaneous winning threats' },
  block_fork:      { label: 'Block fork',      desc: 'Deny the opponent a fork opportunity' },
  center:          { label: 'Center',          desc: 'Take the center square for maximum control' },
  opposite_corner: { label: 'Opposite corner', desc: "Play opposite the opponent's corner to neutralise it" },
  corner:          { label: 'Corner',          desc: 'Claim an empty corner' },
  side:            { label: 'Side',            desc: 'Play an empty side square' },
}

function RulesTab({ model, models }) {
  const [sourceModels, setSourceModels] = useState([{ modelId: model.id, weight: 1.0 }])
  const [rules, setRules] = useState(null)
  const [analyzed, setAnalyzed] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [ruleSetName, setRuleSetName] = useState(`${model.name} Rules`)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [existingSets, setExistingSets] = useState([])

  useEffect(() => {
    api.ml.listRuleSets().then(r => setExistingSets(r.ruleSets || [])).catch(() => {})
  }, [])

  async function handleExtract() {
    setExtracting(true)
    setRules(null)
    setSavedId(null)
    try {
      const token = await getToken()
      // Create a temporary rule set to trigger extraction, then read the result
      const res = await api.ml.createRuleSet({
        name: '__preview__',
        sourceModels,
      }, token)
      setRules(res.ruleSet.rules)
      setAnalyzed(res.ruleSet)
      // Clean up the temp rule set
      await api.ml.deleteRuleSet(res.ruleSet.id, token)
    } catch (e) {
      alert('Extraction failed: ' + e.message)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSave() {
    if (!rules || !ruleSetName.trim()) return
    setSaving(true)
    try {
      const token = await getToken()
      const res = await api.ml.createRuleSet({ name: ruleSetName, sourceModels, rules }, token)
      setSavedId(res.ruleSet.id)
      setExistingSets(prev => [res.ruleSet, ...prev])
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleReExtract(rs) {
    try {
      const token = await getToken()
      const res = await api.ml.extractRules(rs.id, { sourceModels }, token)
      setExistingSets(prev => prev.map(s => s.id === rs.id ? res.ruleSet : s))
    } catch (e) {
      alert('Re-extraction failed: ' + e.message)
    }
  }

  async function handleDeleteSet(id) {
    if (!confirm('Delete this rule set?')) return
    const token = await getToken()
    await api.ml.deleteRuleSet(id, token)
    setExistingSets(prev => prev.filter(s => s.id !== id))
  }

  async function handleToggleRule(ruleId) {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
  }

  function handleMovePriority(ruleId, dir) {
    setRules(prev => {
      const idx = prev.findIndex(r => r.id === ruleId)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = idx + dir
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next.map((r, i) => ({ ...r, priority: i + 1 }))
    })
  }

  function handleWeightChange(modelId, weight) {
    setSourceModels(prev => prev.map(m => m.modelId === modelId ? { ...m, weight } : m))
  }

  function handleAddModel(modelId) {
    if (sourceModels.find(m => m.modelId === modelId)) return
    setSourceModels(prev => [...prev, { modelId, weight: 1.0 }])
  }

  function handleRemoveModel(modelId) {
    if (sourceModels.length <= 1) return
    setSourceModels(prev => prev.filter(m => m.modelId !== modelId))
  }

  const otherModels = models.filter(m => !sourceModels.find(s => s.modelId === m.id))

  return (
    <div className="space-y-6">

      {/* Source Models */}
      <Card>
        <SectionLabel>Source Models</SectionLabel>
        <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
          Rules are extracted by analysing how each model plays. Add multiple models to create an ensemble.
        </p>
        <div className="space-y-2">
          {sourceModels.map(({ modelId, weight }) => {
            const m = models.find(x => x.id === modelId)
            return (
              <div key={modelId} className="flex items-center gap-3 p-2 rounded-lg border"
                style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{m?.name ?? modelId}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {m?.algorithm?.replace(/_/g, '-')} · ELO {Math.round(m?.eloRating ?? 0)}
                  </div>
                </div>
                {sourceModels.length > 1 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Weight</span>
                    <input
                      type="number" min="0.1" max="10" step="0.1"
                      value={weight}
                      onChange={e => handleWeightChange(modelId, parseFloat(e.target.value) || 1)}
                      className="w-16 px-2 py-1 text-xs rounded border outline-none"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
                    />
                  </div>
                )}
                <button
                  onClick={() => handleRemoveModel(modelId)}
                  disabled={sourceModels.length <= 1}
                  className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-30"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--color-red-600)' }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
        {otherModels.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Add model:</span>
            <select
              onChange={e => { if (e.target.value) { handleAddModel(e.target.value); e.target.value = '' } }}
              className="text-xs px-2 py-1 rounded border outline-none flex-1"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            >
              <option value="">— select —</option>
              {otherModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.algorithm?.replace(/_/g, '-')})</option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="mt-3 w-full py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {extracting ? 'Extracting…' : rules ? 'Re-extract' : 'Extract Rules'}
        </button>
      </Card>

      {/* Extracted Rules */}
      {rules && (
        <Card>
          <SectionLabel>Extracted Rules</SectionLabel>
          <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
            Rules are listed in priority order. Toggle, reorder, then save as a Rule Set.
          </p>
          <div className="space-y-1">
            {rules.map((rule, idx) => (
              <div
                key={rule.id}
                className="flex items-center gap-2 p-2 rounded-lg border transition-colors"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: rule.enabled ? 'var(--bg-surface)' : 'var(--bg-page)',
                  opacity: rule.enabled ? 1 : 0.5,
                }}
              >
                {/* Priority badge */}
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: rule.enabled ? 'var(--color-blue-600)' : 'var(--color-gray-300)',
                    color: rule.enabled ? 'white' : 'var(--text-muted)',
                  }}
                >
                  {idx + 1}
                </span>

                {/* Label + confidence bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {RULE_META_FRONTEND[rule.id]?.label ?? rule.id}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {Math.round(rule.confidence * 100)}% · {rule.coverage} states
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round(rule.confidence * 100)}%`,
                        backgroundColor: rule.confidence > 0.8
                          ? 'var(--color-teal-500)'
                          : rule.confidence > 0.5
                            ? 'var(--color-amber-500)'
                            : 'var(--color-red-400)',
                      }}
                    />
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {RULE_META_FRONTEND[rule.id]?.desc}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => handleMovePriority(rule.id, -1)} disabled={idx === 0}
                    className="text-xs leading-none px-1 py-0.5 rounded disabled:opacity-30"
                    style={{ color: 'var(--text-muted)' }}>▲</button>
                  <button onClick={() => handleMovePriority(rule.id, 1)} disabled={idx === rules.length - 1}
                    className="text-xs leading-none px-1 py-0.5 rounded disabled:opacity-30"
                    style={{ color: 'var(--text-muted)' }}>▼</button>
                </div>
                <button
                  onClick={() => handleToggleRule(rule.id)}
                  className="shrink-0 text-xs px-2 py-1 rounded border transition-colors"
                  style={{
                    borderColor: rule.enabled ? 'var(--color-teal-600)' : 'var(--border-default)',
                    color: rule.enabled ? 'var(--color-teal-600)' : 'var(--text-muted)',
                  }}
                >
                  {rule.enabled ? 'On' : 'Off'}
                </button>
              </div>
            ))}
          </div>

          {/* Save */}
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={ruleSetName}
              onChange={e => setRuleSetName(e.target.value)}
              placeholder="Rule set name…"
              className="flex-1 px-3 py-2 text-sm rounded-lg border outline-none"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !ruleSetName.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))' }}
            >
              {saving ? 'Saving…' : savedId ? '✓ Saved' : 'Save Rule Set'}
            </button>
          </div>
        </Card>
      )}

      {/* Existing Rule Sets */}
      {existingSets.length > 0 && (
        <Card>
          <SectionLabel>Saved Rule Sets</SectionLabel>
          <div className="mt-3 space-y-2">
            {existingSets.map(rs => (
              <div key={rs.id} className="rounded-lg border p-3"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{rs.name}</div>
                    {rs.description && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{rs.description}</div>
                    )}
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {Array.isArray(rs.sourceModels) ? rs.sourceModels.length : 0} source model{rs.sourceModels?.length !== 1 ? 's' : ''}
                      {' · '}{Array.isArray(rs.rules) ? rs.rules.filter(r => r.enabled !== false).length : 0} active rules
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleReExtract(rs)}
                      className="text-xs px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: 'var(--border-default)', color: 'var(--color-blue-600)' }}
                    >
                      Re-extract
                    </button>
                    <button
                      onClick={() => handleDeleteSet(rs.id)}
                      className="text-xs px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: 'var(--border-default)', color: 'var(--color-red-600)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {/* Rules mini-list */}
                {Array.isArray(rs.rules) && rs.rules.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rs.rules.filter(r => r.enabled !== false).map(r => (
                      <span key={r.id}
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
                      >
                        {r.priority}. {RULE_META_FRONTEND[r.id]?.label ?? r.id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
