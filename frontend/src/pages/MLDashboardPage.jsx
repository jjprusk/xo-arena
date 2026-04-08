import React, { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'
import { evictModel, isModelCached } from '../lib/mlInference.js'
import { getSocket } from '../lib/socket.js'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import {
  MODES, DIFFICULTIES, ALGORITHMS, STATUS_COLOR, SESSION_COLOR,
  playerLabel, Card, SectionLabel, MiniStat, ChartPanel,
  StatusBadge, Btn, Spinner, tooltipStyle, downloadJSON,
} from '../components/gym/gymShared.jsx'

// Module-level ML model cache — keyed by modelId, survives component unmount/navigation
const _mlModelCache = new Map()

// ─── Lazy tab imports ─────────────────────────────────────────────────────────
const TrainTab        = React.lazy(() => import('../components/gym/TrainTab.jsx'))
const AnalyticsTab    = React.lazy(() => import('../components/gym/AnalyticsTab.jsx'))
const EvaluationTab   = React.lazy(() => import('../components/gym/EvaluationTab.jsx'))
const ExplainabilityTab = React.lazy(() => import('../components/gym/ExplainabilityTab.jsx'))
const CheckpointsTab  = React.lazy(() => import('../components/gym/CheckpointsTab.jsx'))
const SessionsTab     = React.lazy(() => import('../components/gym/SessionsTab.jsx'))
const ExportTab       = React.lazy(() => import('../components/gym/ExportTab.jsx'))
const RulesTab        = React.lazy(() => import('../components/gym/RulesTab.jsx'))

const TAB_IDS = ['train', 'analytics', 'evaluation', 'explainability', 'checkpoints', 'sessions', 'export', 'rules']

export default function GymPage() {
  const { data: session } = useOptimisticSession()
  const user = session?.user ?? null
  const currentUserName = user?.name || user?.username || null

  const [domainUserId, setDomainUserId]   = useState(null)
  const [bots, setBots]                   = useState([])
  const [botsLoaded, setBotsLoaded]       = useState(false)
  const [selectedBotId, setSelectedBotId] = useState(null)
  const [botModels, setBotModels]         = useState({})   // { botId: mlModel }
  const [modelLoading, setModelLoading]   = useState(false)
  const [searchParams] = useSearchParams()
  // ?action=start-training — land on the train tab (already the default, but explicit for clarity)
  const initialTab = searchParams.get('action') === 'start-training' ? 'train' : 'train'
  const [activeTab, setActiveTab]         = useState(initialTab)
  const [regressions, setRegressions]     = useState(new Set())
  const [toasts, setToasts]               = useState([])
  const [sessions, setSessions]           = useState([])    // shared across tabs

  // Keep-alive: track which tabs have been visited so they stay mounted (hidden)
  const visitedTabsRef = useRef(new Set())

  const selectedBot    = bots.find(b => b.id === selectedBotId) ?? null
  const selectedModel  = selectedBot ? botModels[selectedBotId] ?? null : null
  const isMlBot        = selectedBot?.botModelType === 'ml'
  const isMinimaxBot   = selectedBot?.botModelType === 'minimax' || selectedBot?.botModelType === 'mcts'
  const allLoadedModels = Object.values(botModels)

  // Resolve the domain User.id (different from Better Auth session user.id)
  useEffect(() => {
    if (!user) return
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
    const cacheKey = `xo_bots_${domainUserId}`
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) setBots(JSON.parse(raw))
    } catch {}
    const token = await getToken()
    const { bots: bs } = await api.bots.list({ ownerId: domainUserId, token })
    setBots(bs || [])
    setBotsLoaded(true)
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
    if (botModels[selectedBotId]) {
      setModelLoading(false)
      return
    }
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

  // Add current tab to visited set before render so it shows immediately
  visitedTabsRef.current.add(activeTab)

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
            to="/gym/guide" state={{ from: '/gym' }}
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
      ) : botsLoaded && bots.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-base font-medium mb-2" style={{ color: 'var(--text-primary)' }}>You don't have any bots yet.</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Go to your <Link to="/profile" className="underline hover:opacity-80" style={{ color: 'var(--color-blue-600)' }}>Profile</Link> to create one.
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* Bot sidebar */}
          <aside className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Your Bots</p>
            {bots.length === 0 ? null : (
              <ListTable maxHeight="clamp(120px, calc(100dvh - 520px), 500px)">
                <thead>
                  <tr>
                    <ListTh>Bot</ListTh>
                    <ListTh align="right">ELO</ListTh>
                  </tr>
                </thead>
                <tbody>
                  {bots.map((bot, i) => {
                    const typeLabel = bot.botModelType === 'ml' ? 'ML' : bot.botModelType === 'rule_based' ? 'Rules' : bot.botModelType === 'mcts' ? 'MCTS' : 'Minimax'
                    const typeBg    = bot.botModelType === 'ml' ? 'var(--color-blue-100)' : bot.botModelType === 'rule_based' ? 'var(--color-teal-100)' : 'var(--color-gray-100)'
                    const typeColor = bot.botModelType === 'ml' ? 'var(--color-blue-700)' : bot.botModelType === 'rule_based' ? 'var(--color-teal-700)' : 'var(--color-gray-600)'
                    const model = botModels[bot.id]
                    const isSelected = selectedBotId === bot.id
                    return (
                      <ListTr
                        key={bot.id}
                        last={i === bots.length - 1}
                        onClick={() => {
                          setSelectedBotId(bot.id)
                          setActiveTab('train')
                          visitedTabsRef.current = new Set(['train'])
                        }}
                        className={isSelected ? 'bg-[var(--color-blue-50)]' : ''}
                      >
                        <ListTd style={isSelected ? { color: 'var(--color-blue-700)' } : undefined}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold truncate max-w-[120px]">{bot.displayName || bot.username}</span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: typeBg, color: typeColor }}>{typeLabel}</span>
                            {model && regressions.has(model.id) && (
                              <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full bg-[var(--color-amber-100)] text-[var(--color-amber-700)] shrink-0">⚠</span>
                            )}
                          </div>
                          {model && (
                            <div className="text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                              <span>{model.totalEpisodes.toLocaleString()} eps</span>
                              {isModelCached(model.id) && <span title="Q-table loaded in browser" style={{ color: 'var(--color-teal-600)' }}>⚡</span>}
                            </div>
                          )}
                        </ListTd>
                        <ListTd align="right">
                          <span className="font-mono tabular-nums">{Math.round(bot.eloRating || 1200)}</span>
                        </ListTd>
                      </ListTr>
                    )
                  })}
                </tbody>
              </ListTable>
            )}
          </aside>

          {/* Detail panel */}
          <div className="min-w-0">
            {!selectedBot ? (
              <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-lg font-semibold mb-1">No bot selected</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a bot from the list.</p>
              </div>
            ) : isMinimaxBot ? (
              <MinimaxBotView bot={selectedBot} />
            ) : isMlBot && modelLoading ? (
              <div className="space-y-4">
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
                  <Skeleton style={{ height: 28, width: '40%', marginBottom: 8 }} />
                  <Skeleton style={{ height: 16, width: '60%' }} />
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
                  <Skeleton style={{ height: 200 }} className="rounded-none" />
                </div>
              </div>
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
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
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
                <div className="flex gap-1 border-b overflow-x-auto overflow-y-hidden scrollbar-none" style={{ borderColor: 'var(--border-default)' }}>
                  {TAB_IDS.map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`whitespace-nowrap shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-[var(--color-blue-600)] text-[var(--color-blue-600)]' : 'border-transparent'}`}
                      style={{ color: activeTab === tab ? undefined : 'var(--text-secondary)' }}>
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Tab panels — keep-alive via visited set + display:none */}
                {(() => {
                  const TAB_PANELS = [
                    { id: 'train',          el: <TrainTab model={selectedModel} sessions={sessions} onSessionsChange={setSessions} onComplete={() => refreshModel(selectedBotId, selectedModel.id)} /> },
                    { id: 'analytics',      el: <AnalyticsTab model={selectedModel} sessions={sessions} /> },
                    { id: 'evaluation',     el: <EvaluationTab model={selectedModel} models={allLoadedModels} domainUserId={domainUserId} currentUserName={currentUserName} /> },
                    { id: 'explainability', el: <ExplainabilityTab model={selectedModel} domainUserId={domainUserId} currentUserName={currentUserName} /> },
                    { id: 'checkpoints',    el: <CheckpointsTab model={selectedModel} onRestore={() => refreshModel(selectedBotId, selectedModel.id)} /> },
                    { id: 'sessions',       el: <SessionsTab model={selectedModel} sessions={sessions} /> },
                    { id: 'export',         el: <ExportTab model={selectedModel} sessions={sessions} /> },
                    { id: 'rules',          el: <RulesTab model={selectedModel} models={allLoadedModels} /> },
                  ]
                  return TAB_PANELS.map(({ id, el }) =>
                    visitedTabsRef.current.has(id) && (
                      <div key={id} style={{ display: activeTab === id ? '' : 'none' }}>
                        <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>
                          {el}
                        </Suspense>
                      </div>
                    )
                  )
                })()}
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

// Re-export shared items for any code that may import them from this module
export {
  MODES, DIFFICULTIES, ALGORITHMS, STATUS_COLOR, SESSION_COLOR,
  playerLabel, Card, SectionLabel, MiniStat, ChartPanel,
  StatusBadge, Btn, Spinner, tooltipStyle, downloadJSON,
} from '../components/gym/gymShared.jsx'
