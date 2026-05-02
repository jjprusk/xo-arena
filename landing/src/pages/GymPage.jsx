// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'
import { evictModel, isModelCached } from '../lib/mlInference.js'
import { useEventStream } from '../lib/useEventStream.js'
import { useGuideStore } from '../store/guideStore.js'
import TrainingCompletePopup from '../components/ui/TrainingCompletePopup.jsx'
import AddSkillModal from '../components/ui/AddSkillModal.jsx'
import { skillCategory, gameLabel } from '../lib/skillCategory.js'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import {
  MODES, DIFFICULTIES, ALGORITHMS, STATUS_COLOR, SESSION_COLOR,
  playerLabel, Card, SectionLabel, MiniStat, ChartPanel,
  StatusBadge, Btn, Spinner, tooltipStyle, downloadJSON, normalizeAlgorithm,
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
  // Phase 3.8 — Multi-Skill Bots: detail panel is keyed by (botId, skillId),
  // not the legacy primary-skill shortcut. `selectedSkillId === null` while
  // the user has picked a bot but not yet a skill — the panel shows a
  // skill-picker prompt in that state.
  const [selectedSkillId, setSelectedSkillId] = useState(null)
  const [skillModels, setSkillModels]     = useState({})   // { skillId: mlModel }
  const [modelLoading, setModelLoading]   = useState(false)
  const [showTrainingCompletePopup, setShowTrainingCompletePopup] = useState(false)
  const [showAddSkill, setShowAddSkill]   = useState(false)
  const [searchParams, setSearchParams]   = useSearchParams()
  // ?action=start-training — land on the train tab (already the default, but explicit for clarity)
  const initialTab = searchParams.get('action') === 'start-training' ? 'train' : 'train'
  const [activeTab, setActiveTab]         = useState(initialTab)
  const [regressions, setRegressions]     = useState(new Set())
  const [toasts, setToasts]               = useState([])
  const [sessions, setSessions]           = useState([])    // shared across tabs

  // Keep-alive: track which tabs have been visited so they stay mounted (hidden)
  const visitedTabsRef = useRef(new Set())

  const selectedBot    = bots.find(b => b.id === selectedBotId) ?? null
  const skillsForBot   = selectedBot?.skills ?? []
  const selectedSkill  = skillsForBot.find(s => s.id === selectedSkillId) ?? null
  const selectedModel  = selectedSkill ? skillModels[selectedSkillId] ?? null : null
  const skillKind      = skillCategory(selectedSkill?.algorithm)
  const isMlSkill      = skillKind === 'ml'
  const isMinimaxSkill = skillKind === 'minimax'
  const allLoadedModels = Object.values(skillModels)

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

  // Auto-select: honor ?bot= and ?gameId= deep-links (Phase 3.8 — used by the
  // Profile "Train in Gym →" button + skill-pill links), then prefer a newly
  // created bot from the journey, then fall back to the first bot.
  useEffect(() => {
    if (bots.length === 0) return
    const urlBotId = searchParams.get('bot')
    if (urlBotId && bots.some(b => b.id === urlBotId)) {
      setSelectedBotId(urlBotId)
      return
    }
    try {
      const newBotId = sessionStorage.getItem('xo_new_bot_id')
      if (newBotId && bots.some(b => b.id === newBotId)) {
        sessionStorage.removeItem('xo_new_bot_id')
        setSelectedBotId(newBotId)
        return
      }
    } catch {}
    if (!selectedBotId) setSelectedBotId(bots[0].id)
    // selectedBotId omitted on purpose — once set we stop reacting to `bots`
    // unless it changes shape (which is the meaningful trigger here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots])

  // Auto-select skill: honor ?gameId= against the active bot's skills,
  // otherwise default to the bot's first skill (or null when skill-less).
  useEffect(() => {
    if (!selectedBot) { setSelectedSkillId(null); return }
    const urlGameId = searchParams.get('gameId')
    if (urlGameId) {
      const match = skillsForBot.find(s => s.gameId === urlGameId)
      if (match) { setSelectedSkillId(match.id); return }
    }
    if (selectedSkillId && skillsForBot.some(s => s.id === selectedSkillId)) return
    setSelectedSkillId(skillsForBot[0]?.id ?? null)
    // skillsForBot is derived from selectedBot.skills; depending on selectedBot
    // covers both the bot change and any skill-list mutation (e.g. add-skill).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBot, selectedBot?.skills?.length])

  // Load ML model when an ML skill is selected for the first time. Each
  // BotSkill row IS the model — `skill.id` and `model.id` are the same value.
  useEffect(() => {
    if (!selectedSkillId || !isMlSkill) {
      setModelLoading(false)
      return
    }
    if (skillModels[selectedSkillId]) {
      setModelLoading(false)
      return
    }
    const cached = _mlModelCache.get(selectedSkillId)
    if (cached) {
      setSkillModels(prev => ({ ...prev, [selectedSkillId]: cached }))
      setModelLoading(false)
      return
    }
    setModelLoading(true)
    const id = selectedSkillId
    api.ml.getModel(selectedSkillId)
      .then(({ model }) => {
        _mlModelCache.set(model.id, model)
        setSkillModels(prev => ({ ...prev, [id]: model }))
      })
      .catch(() => {})
      .finally(() => setModelLoading(false))
    // skillModels intentionally omitted — we don't want to re-run after models load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkillId, isMlSkill])

  const addToast = useCallback((msg, color = 'blue') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, msg, color }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  // Page-wide ML toasts now ride the SSE per-session channels covered by
  // the active model's TrainTab; this page-wide listener was a duplicate of
  // those signals and was retired with the socket cut.

  const refreshModel = useCallback(async (skillId) => {
    const { model } = await api.ml.getModel(skillId)
    _mlModelCache.set(model.id, model)
    setSkillModels(prev => ({ ...prev, [skillId]: model }))
    evictModel(skillId)
  }, [])

  function handleTrainingComplete(botId, skillId) {
    refreshModel(skillId)
    setShowTrainingCompletePopup(true)
    // Stash trained bot name so the play page can search for it
    const trainedBot = bots.find(b => b.id === botId)
    if (trainedBot) {
      try { sessionStorage.setItem('xo_trained_bot_name', trainedBot.displayName) } catch {}
    }
    // Phase 3.8.4.3 — auto-repoint the bot's primary skill so Profile
    // "last-trained" reflects what just finished. Backend already updates
    // User.botModelId in mlService.completeSession; this is the optimistic
    // mirror so the Gym sidebar / Profile cache don't show stale state until
    // the next bots refetch.
    setBots(prev => prev.map(b => b.id === botId ? { ...b, botModelId: skillId } : b))
    const { journeyProgress } = useGuideStore.getState()
    const steps = journeyProgress?.completedSteps ?? []
    if (!steps.includes(6)) {
      useGuideStore.getState().applyJourneyStep({ completedSteps: [...steps, 6] })
    }
  }

  // Helper: when the user picks a skill (URL or click), keep ?bot/?gameId
  // in sync so the deep-link is shareable and a refresh restores the same
  // panel. URL state is the source of truth for deep-link wiring; React
  // state mirrors it for the render loop.
  const selectSkill = useCallback((botId, skill) => {
    setSelectedBotId(botId)
    setSelectedSkillId(skill?.id ?? null)
    setActiveTab('train')
    visitedTabsRef.current = new Set(['train'])
    const next = new URLSearchParams(searchParams)
    next.set('bot', botId)
    if (skill?.gameId) next.set('gameId', skill.gameId)
    else next.delete('gameId')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  function handleSkillAdded(skill) {
    // Optimistic: append the new skill into the active bot's row, then
    // auto-select it so the user lands on the freshly added training surface.
    setBots(prev => prev.map(b => (
      b.id === selectedBotId
        ? { ...b, skills: [...(b.skills ?? []), { ...skill, elo: null }] }
        : b
    )))
    setShowAddSkill(false)
    setSelectedSkillId(skill.id)
    const next = new URLSearchParams(searchParams)
    next.set('bot', selectedBotId)
    next.set('gameId', skill.gameId)
    setSearchParams(next, { replace: true })
  }

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
          {/* Bot sidebar — Phase 3.8 bot→skill drilldown.
              Each bot row is clickable; when expanded, its BotSkill rows
              render as second-level entries. Today every bot has at most one
              skill (XO), but the structure is the carrier for Phase 4
              (Connect4) — adding a Connect4 skill row to an existing bot
              will surface a second sub-row here with no UI change required. */}
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
                  {bots.flatMap((bot, i) => {
                    const isExpanded = selectedBotId === bot.id
                    const skills = bot.skills ?? []
                    const isLastBot = i === bots.length - 1
                    const rows = []

                    rows.push(
                      <ListTr
                        key={bot.id}
                        last={isLastBot && skills.length === 0}
                        onClick={() => {
                          // Expand + auto-select the first skill (or null if
                          // skill-less). selectSkill keeps URL state in sync.
                          selectSkill(bot.id, skills[0] ?? null)
                        }}
                        className={isExpanded ? 'bg-[var(--color-blue-50)]' : ''}
                        data-testid={`gym-bot-row-${bot.id}`}
                      >
                        <ListTd style={isExpanded ? { color: 'var(--color-blue-700)' } : undefined}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold truncate max-w-[140px]">{bot.displayName || bot.username}</span>
                            {skills.length === 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--color-gray-600)' }}>
                                no skills
                              </span>
                            )}
                          </div>
                        </ListTd>
                        <ListTd align="right">
                          <span className="font-mono tabular-nums">{Math.round(bot.eloRating || 1200)}</span>
                        </ListTd>
                      </ListTr>
                    )

                    if (isExpanded) {
                      skills.forEach((skill, j) => {
                        const isSelected = selectedSkillId === skill.id
                        const skillModel = skillModels[skill.id]
                        const cat = skillCategory(skill.algorithm)
                        const algoBg    = cat === 'ml' ? 'var(--color-blue-100)' : 'var(--color-gray-100)'
                        const algoColor = cat === 'ml' ? 'var(--color-blue-700)' : 'var(--color-gray-600)'
                        rows.push(
                          <ListTr
                            key={skill.id}
                            last={isLastBot && j === skills.length - 1}
                            onClick={(e) => { e.stopPropagation(); selectSkill(bot.id, skill) }}
                            className={isSelected ? 'bg-[var(--color-blue-100)]' : ''}
                            data-testid={`gym-skill-row-${bot.id}-${skill.gameId}`}
                          >
                            <ListTd style={isSelected ? { color: 'var(--color-blue-800)' } : undefined}>
                              <div className="pl-4 flex items-center gap-1.5">
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>↳</span>
                                <span className="text-xs font-medium truncate max-w-[110px]">{gameLabel(skill.gameId)}</span>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0" style={{ backgroundColor: algoBg, color: algoColor }}>
                                  {skill.algorithm}
                                </span>
                                {skillModel && regressions.has(skillModel.id) && (
                                  <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full bg-[var(--color-amber-100)] text-[var(--color-amber-700)] shrink-0">⚠</span>
                                )}
                              </div>
                              {skillModel && cat === 'ml' && (
                                <div className="pl-6 text-xs mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                  <span>{skillModel.totalEpisodes.toLocaleString()} eps</span>
                                  {isModelCached(skillModel.id) && <span title="Q-table loaded in browser" style={{ color: 'var(--color-teal-600)' }}>⚡</span>}
                                </div>
                              )}
                            </ListTd>
                            <ListTd align="right">
                              <span className="font-mono tabular-nums text-xs">{skill.elo?.rating ? Math.round(skill.elo.rating) : '—'}</span>
                            </ListTd>
                          </ListTr>
                        )
                      })
                    }

                    return rows
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
            ) : skillsForBot.length === 0 ? (
              // Phase 3.8 — skill-less identity bot. The Profile flow lets a
              // user mint a bot before adding any skill, so the Gym has to
              // handle the empty-state explicitly: prompt them to add one
              // here without bouncing back to /profile.
              <div className="rounded-xl border p-8 text-center space-y-3" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-lg font-semibold">{selectedBot.displayName || selectedBot.username} has no skills yet</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Add a skill to start training.</p>
                <button
                  type="button"
                  onClick={() => setShowAddSkill(true)}
                  className="btn btn-primary btn-sm"
                  data-testid="gym-add-skill-empty"
                >+ Add a skill</button>
              </div>
            ) : !selectedSkill ? (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Pick a skill on the left to view its training surface.</p>
              </div>
            ) : isMinimaxSkill ? (
              <MinimaxSkillView bot={selectedBot} skill={selectedSkill} onAddSkill={() => setShowAddSkill(true)} />
            ) : isMlSkill && modelLoading ? (
              <div className="space-y-4">
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
                  <Skeleton style={{ height: 28, width: '40%', marginBottom: 8 }} />
                  <Skeleton style={{ height: 16, width: '60%' }} />
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
                  <Skeleton style={{ height: 200 }} className="rounded-none" />
                </div>
              </div>
            ) : isMlSkill && selectedModel ? (
              <div className="space-y-4">
                {/* Bot + skill header */}
                <div className="rounded-xl border p-4 flex items-center justify-between flex-wrap gap-3"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold">{selectedBot.displayName || selectedBot.username}</h2>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}>
                        {gameLabel(selectedSkill.gameId)}
                      </span>
                      <StatusBadge status={selectedModel.status} />
                    </div>
                    {selectedBot.bio && <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{selectedBot.bio}</p>}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{ALGORITHMS.find(a => a.value === normalizeAlgorithm(selectedModel.algorithm))?.label ?? '—'}</span>
                      <span>{selectedModel.totalEpisodes.toLocaleString()} / {selectedModel.maxEpisodes > 0 ? selectedModel.maxEpisodes.toLocaleString() : '∞'} episodes</span>
                      <span>ELO {selectedSkill.elo?.rating ? Math.round(selectedSkill.elo.rating) : Math.round(selectedBot.eloRating || 1200)}</span>
                      <span title={isModelCached(selectedModel.id) ? 'Q-table loaded in browser — moves run locally' : 'Not yet cached'} style={{ color: isModelCached(selectedModel.id) ? 'var(--color-teal-600)' : 'var(--text-muted)' }}>
                        {isModelCached(selectedModel.id) ? '⚡ cached' : '○ not cached'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn onClick={() => setShowAddSkill(true)} variant="ghost" data-testid="gym-add-skill-header">+ Add skill</Btn>
                    <Btn onClick={async () => {
                      const data = await api.ml.exportModel(selectedModel.id)
                      downloadJSON(data, `${(selectedBot.username || 'bot').replace(/\s+/g, '_')}.ml.json`)
                    }} variant="ghost">Export</Btn>
                    <Btn onClick={async () => {
                      if (!confirm('Reset to untrained baseline? All Q-table data will be lost.')) return
                      const token = await getToken()
                      await api.ml.resetModel(selectedModel.id, token)
                      refreshModel(selectedModel.id)
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

                {/* Tab panels — keep-alive via visited set + display:none.
                    Keyed by skillId so swapping between two skills on the
                    same bot remounts the per-skill tab state cleanly. */}
                {(() => {
                  const TAB_PANELS = [
                    { id: 'train',          el: <TrainTab model={selectedModel} sessions={sessions} onSessionsChange={setSessions} onComplete={() => handleTrainingComplete(selectedBotId, selectedModel.id)} /> },
                    { id: 'analytics',      el: <AnalyticsTab model={selectedModel} sessions={sessions} /> },
                    { id: 'evaluation',     el: <EvaluationTab model={selectedModel} models={allLoadedModels} domainUserId={domainUserId} currentUserName={currentUserName} /> },
                    { id: 'explainability', el: <ExplainabilityTab model={selectedModel} domainUserId={domainUserId} currentUserName={currentUserName} /> },
                    { id: 'checkpoints',    el: <CheckpointsTab model={selectedModel} onRestore={() => refreshModel(selectedModel.id)} /> },
                    { id: 'sessions',       el: <SessionsTab model={selectedModel} sessions={sessions} /> },
                    { id: 'export',         el: <ExportTab model={selectedModel} sessions={sessions} /> },
                    { id: 'rules',          el: <RulesTab model={selectedModel} models={allLoadedModels} /> },
                  ]
                  return TAB_PANELS.map(({ id, el }) =>
                    visitedTabsRef.current.has(id) && (
                      <div key={`${selectedSkillId}:${id}`} style={{ display: activeTab === id ? '' : 'none' }}>
                        <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}>
                          {el}
                        </Suspense>
                      </div>
                    )
                  )
                })()}
              </div>
            ) : isMlSkill ? (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Could not load model for this skill.</p>
              </div>
            ) : (
              <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>This algorithm doesn't have training options in the Gym.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showAddSkill && selectedBot && (
        <AddSkillModal
          bot={selectedBot}
          onClose={() => setShowAddSkill(false)}
          onAdded={handleSkillAdded}
        />
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

      {showTrainingCompletePopup && (
        <TrainingCompletePopup onDismiss={() => {
          setShowTrainingCompletePopup(false)
          useGuideStore.getState().open()
        }} />
      )}
    </div>
  )
}

// ─── Minimax / MCTS Skill Read-Only View ──────────────────────────────────────
// Phase 3.8 — keyed by (bot, skill). The same identity bot can hold multiple
// skills with different algorithms; this view shows the *skill's* view, not
// the bot's, and exposes "+ Add skill" so the user has a path off this dead-
// end surface without bouncing back to /profile.

function MinimaxSkillView({ bot, skill, onAddSkill }) {
  const typeLabel = skill.algorithm === 'mcts' ? 'MCTS' : 'Minimax'
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4 flex items-center justify-between flex-wrap gap-3" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-xl font-bold">{bot.displayName || bot.username}</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}>
              {gameLabel(skill.gameId)}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--color-gray-600)' }}>
              {typeLabel}
            </span>
          </div>
          {bot.bio && <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{bot.bio}</p>}
          <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            ELO {skill.elo?.rating ? Math.round(skill.elo.rating) : Math.round(bot.eloRating || 1200)}
          </div>
        </div>
        {onAddSkill && (
          <Btn onClick={onAddSkill} variant="ghost" data-testid="gym-add-skill-header">+ Add skill</Btn>
        )}
      </div>
      <Card>
        <SectionLabel>About</SectionLabel>
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          {typeLabel} skills use a deterministic algorithm and cannot be trained. Their play
          strength is fixed. Challenge this bot in the Play area to test it.
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
