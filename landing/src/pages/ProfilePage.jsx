// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useRef, useState } from 'react'
import { useOptimisticSession, clearSessionCache, triggerSessionRefresh } from '../lib/useOptimisticSession.js'
import { getToken, clearTokenCache } from '../lib/getToken.js'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { tournamentApi } from '../lib/tournamentApi.js'
import { signOut } from '../lib/auth-client.js'
import { useGuideStore } from '../store/guideStore.js'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'
import BotCreatedPopup from '../components/ui/BotCreatedPopup.jsx'
import QuickBotWizard from '../components/guide/QuickBotWizard.jsx'
import { GAMES } from '../lib/gameRegistry.js'

const BOT_MODEL_LABELS = {
  ml: 'ML',
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

export default function ProfilePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data: session, isPending } = useOptimisticSession()
  const clerkUser = session?.user ?? null
  const isSignedIn = !!clerkUser
  const [dbUser, setDbUser] = useState(null)
  const [stats, setStats] = useState(null)
  const [eloData, setEloData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Display name editing
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // My Bots
  const [bots, setBots] = useState([])
  const [limitInfo, setLimitInfo] = useState(null)
  const [provisionalThreshold, setProvisionalThreshold] = useState(5)
  // Starts `true` so effects that wait for the bot list (notably the
  // ?action=train-bot redirect) don't fire on the initial empty `bots = []`
  // and bounce a user with bots over to the QuickBotWizard. Cleared at the
  // end of the load() Promise.allSettled below.
  const [botsLoading, setBotsLoading] = useState(true)
  const [showCreateBot, setShowCreateBot] = useState(false)
  const [botActionError, setBotActionError] = useState(null)
  const [renamingBot, setRenamingBot] = useState(null)
  const [createForm, setCreateForm] = useState({ name: '', modelType: 'Q_LEARNING', competitive: true, gameId: 'xo' })
  const [showBotCreatedPopup, setShowBotCreatedPopup] = useState(false)
  const [creatingBot, setCreatingBot] = useState(false)

  // Credits & tier
  const [credits, setCredits] = useState(null)
  const [emailAchievements, setEmailAchievements] = useState(false)
  const [savingEmailPref, setSavingEmailPref] = useState(false)

  // Tournament classification / merits
  const [classification, setClassification] = useState(null)
  const [botClassifications, setBotClassifications] = useState({})

  // Accordion open state
  const [openSections, setOpenSections] = useState(() => ({
    profile: false, stats: true, credits: true, merits: true,
    bots: searchParams.get('action') === 'create-bot' || searchParams.get('section') === 'bots',
    recurring: searchParams.get('section') === 'recurring',
    danger: false,
  }))
  const toggle = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  // Account deletion
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  // Ref for the name input inside the create-bot panel — focused programmatically on open
  const nameInputRef = useRef(null)
  useEffect(() => {
    if (!showCreateBot) return
    const id = setTimeout(() => nameInputRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [showCreateBot])

  // ?action=create-bot — close guide, open panel with default name once dbUser loads
  useEffect(() => {
    if (searchParams.get('action') !== 'create-bot') return
    useGuideStore.getState().close()
    if (!dbUser) return
    setShowCreateBot(true)
    setCreateForm(f => f.name ? f : { ...f, name: `${dbUser.username}-bot` })
  }, [dbUser]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?action=quick-bot — Curriculum step 3 entry point. The journey CTA points
  // here; we mount the QuickBotWizard as a modal overlay. Backend POST
  // /bots/quick fires journey step 3 server-side, so completing the wizard
  // advances the JourneyCard naturally via the guide:journeyStep socket event.
  const [showQuickBot, setShowQuickBot] = useState(false)
  useEffect(() => {
    if (searchParams.get('action') !== 'quick-bot') return
    useGuideStore.getState().close()
    setShowQuickBot(true)
  }, [searchParams])

  // ?action=cup — Curriculum step 6 entry point. Calls the tournament-service
  // clone endpoint, which spawns a fresh 4-bot single-elim Curriculum Cup,
  // registers the user's bot, and starts the bracket immediately. Step 6
  // fires server-side via `tournament:participant:joined`. We then route the
  // user to the cup detail page so they can watch their bot's matches —
  // landing on /profile with no follow-up was a flat dead-end.
  //
  // Gate on `!botsLoading` for the same reason train-bot/spar do — the
  // service auto-picks the user's most-recent bot, but we want to bounce
  // them to the bot wizard if they somehow have zero bots.
  const [cupBusy,  setCupBusy]  = useState(false)
  const [cupError, setCupError] = useState(null)
  useEffect(() => {
    if (searchParams.get('action') !== 'cup') return
    if (botsLoading) return
    if (cupBusy) return
    if (bots.length === 0) {
      navigate('/profile?action=quick-bot', { replace: true })
      return
    }
    let cancelled = false
    ;(async () => {
      setCupBusy(true)
      setCupError(null)
      try {
        const token = await getToken()
        const res = await tournamentApi.cloneCurriculumCup(token, {})
        if (cancelled) return
        const tid = res?.tournament?.id
        if (!tid) throw new Error('No tournament id in response')
        useGuideStore.getState().close()
        navigate(`/tournaments/${tid}`, { replace: true })
      } catch (err) {
        if (cancelled) return
        setCupError(err?.message || 'Could not start the Curriculum Cup')
      } finally {
        if (!cancelled) setCupBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [searchParams, botsLoading, bots.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?section=bots — close guide, bots accordion already open via lazy initializer
  useEffect(() => {
    if (searchParams.get('section') !== 'bots') return
    useGuideStore.getState().close()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ?action=train-bot — Curriculum step 4. The journey CTA lands here. The
  // actual Train button lives on the bot detail page, so once the bot list
  // has loaded we forward the user there. With multiple bots we just expand
  // the accordion and let them pick. With zero bots, defer to step 3.
  //
  // Gate on `!botsLoading` — that flag now starts `true` and clears only
  // after the bots fetch resolves, so the effect can't fire with the initial
  // empty `bots = []` and falsely bounce a returning user (who has bots)
  // over to the QuickBotWizard.
  //
  // ?action=spar (Curriculum step 5) follows the same shape — same target
  // (bot detail page), different spotlight target on arrival. We forward
  // the action= query through so BotProfilePage can light the right CTA.
  useEffect(() => {
    const action = searchParams.get('action')
    if (action !== 'train-bot' && action !== 'spar') return
    if (botsLoading) return
    useGuideStore.getState().close()
    if (bots.length === 1) {
      navigate(`/bots/${bots[0].id}?action=${action}`, { replace: true })
    } else if (bots.length === 0) {
      navigate('/profile?action=quick-bot', { replace: true })
    }
    // Multiple bots: stay on /profile with My Bots open (lazy initializer
    // already opens it because section/action gating doesn't include this
    // case — we open it explicitly below).
    setOpenSections(prev => ({ ...prev, bots: true }))
  }, [searchParams, botsLoading, bots]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clerkUser) return

    setLoading(true)
    async function load() {
      try {
        const token = await getToken()

        const cacheKey = `xo_dbuser_${clerkUser.id}`
        let user = null
        try {
          const raw = sessionStorage.getItem(cacheKey)
          if (raw) user = JSON.parse(raw)
        } catch {}

        if (!user) {
          const { user: synced } = await api.users.sync(token)
          user = synced
          try { sessionStorage.setItem(cacheKey, JSON.stringify(user)) } catch {}
        }

        setDbUser(user)
        setNameInput(user.displayName)

        const [statsRes, eloRes, botsRes, creditsRes, classificationRes] = await Promise.allSettled([
          api.users.stats(user.id),
          api.users.eloHistory(user.id),
          api.bots.list({ ownerId: user.id, includeInactive: true }),
          api.users.credits(user.id),
          tournamentApi.getMyClassification(token),
        ])

        if (statsRes.status === 'fulfilled') setStats(statsRes.value.stats)
        if (eloRes.status === 'fulfilled') setEloData(eloRes.value)
        if (botsRes.status === 'fulfilled') {
          const { bots: b, limitInfo: li, provisionalThreshold: pt } = botsRes.value
          setBots(b ?? [])
          if (li) setLimitInfo(li)
          if (pt != null) setProvisionalThreshold(pt)
        }
        if (creditsRes.status === 'fulfilled') {
          setCredits(creditsRes.value.credits)
          setEmailAchievements(creditsRes.value.credits.emailAchievements ?? false)
        }
        if (classificationRes.status === 'fulfilled' && classificationRes.value?.classification) {
          setClassification(classificationRes.value.classification)
        }

        // Fetch bot classifications in parallel
        if (botsRes.status === 'fulfilled') {
          const botList = botsRes.value.bots ?? []
          if (botList.length > 0) {
            const botClassResults = await Promise.allSettled(
              botList.map(b => tournamentApi.getPlayerClassification(b.id))
            )
            const map = {}
            botList.forEach((b, i) => {
              if (botClassResults[i].status === 'fulfilled' && botClassResults[i].value?.classification) {
                map[b.id] = botClassResults[i].value.classification
              }
            })
            setBotClassifications(map)
          }
        }
      } catch {
        setError('Failed to load profile.')
      } finally {
        setLoading(false)
        setBotsLoading(false)
      }
    }
    load()
  }, [clerkUser?.id])

  async function handleSaveName() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === dbUser.displayName) {
      setEditing(false)
      return
    }
    const previous = dbUser.displayName
    setDbUser(prev => ({ ...prev, displayName: trimmed }))
    setEditing(false)
    setSaveError(null)
    try {
      const token = await getToken()
      const { user: updated } = await api.patch(`/users/${dbUser.id}`, { displayName: trimmed }, token)
      setDbUser(updated)
      try { sessionStorage.setItem(`xo_dbuser_${clerkUser.id}`, JSON.stringify(updated)) } catch {}
    } catch {
      setDbUser(prev => ({ ...prev, displayName: previous }))
      setNameInput(previous)
      setSaveError('Could not save. Try again.')
      setEditing(true)
    }
  }

  async function handleToggleEmailAchievements() {
    const next = !emailAchievements
    setEmailAchievements(next)
    setSavingEmailPref(true)
    try {
      const token = await getToken()
      await api.users.updateSettings({ emailAchievements: next }, token)
    } catch {
      setEmailAchievements(!next)
    } finally {
      setSavingEmailPref(false)
    }
  }

  if (loading || (isPending && !clerkUser)) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isPending && !isSignedIn) {
    return (
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Profile" />
        <div
          className="rounded-xl border p-8 text-center"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-lg font-semibold mb-2">Sign in to view your profile</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Your account details and game history are available once you sign in.
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Profile" />
        <p className="text-sm text-center" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      </div>
    )
  }

  async function handleToggleBotActive(bot) {
    setBotActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.bots.update(bot.id, { botActive: !bot.botActive }, token)
      setBots(prev => prev.map(b => b.id === bot.id ? { ...b, botActive: updated.botActive } : b))
    } catch (err) {
      setBotActionError(err.message || 'Action failed.')
    }
  }

  async function handleRenameBot(id) {
    if (!renamingBot || renamingBot.id !== id) return
    const newName = renamingBot.value
    const previous = bots.find(b => b.id === id)?.displayName
    setBots(prev => prev.map(b => b.id === id ? { ...b, displayName: newName } : b))
    setRenamingBot(null)
    setBotActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.bots.update(id, { displayName: newName }, token)
      setBots(prev => prev.map(b => b.id === id ? { ...b, displayName: updated.displayName } : b))
    } catch (err) {
      setBots(prev => prev.map(b => b.id === id ? { ...b, displayName: previous } : b))
      setBotActionError(err.message || 'Rename failed.')
    }
  }

  async function handleResetElo(bot) {
    if (!confirm(`Reset ELO for "${bot.displayName}"? This will wipe the bot's rating to 1200 and mark it provisional again. This cannot be undone.`)) return
    setBotActionError(null)
    try {
      const token = await getToken()
      await api.bots.resetElo(bot.id, token)
      setBots(prev => prev.map(b => b.id === bot.id ? { ...b, eloRating: 1200, botProvisional: true, botGamesPlayed: 0 } : b))
    } catch (err) {
      setBotActionError(err.message || 'Reset failed.')
    }
  }

  async function handleDeleteBot(bot) {
    if (!confirm(`Delete "${bot.displayName}"? This is permanent and cannot be undone.`)) return
    setBotActionError(null)
    try {
      const token = await getToken()
      await api.bots.delete(bot.id, token)
      setBots(prev => prev.filter(b => b.id !== bot.id))
      setLimitInfo(prev => prev ? { ...prev, count: prev.count - 1 } : prev)
    } catch (err) {
      setBotActionError(err.message || 'Delete failed.')
    }
  }

  async function handleCreateBot(e) {
    e.preventDefault()
    if (creatingBot) return
    setCreatingBot(true)
    setBotActionError(null)
    try {
      const token = await getToken()
      const payload = {
        name: createForm.name,
        algorithm: 'ml',
        modelType: createForm.modelType,
        competitive: createForm.competitive,
        gameId: createForm.gameId,
      }
      const { bot: newBot } = await api.bots.create(payload, token)
      setBots(prev => [newBot, ...prev])
      setLimitInfo(prev => prev ? { ...prev, count: prev.count + 1 } : prev)
      setCreateForm({ name: '', modelType: 'Q_LEARNING', competitive: true })
      setShowCreateBot(false)
      setShowBotCreatedPopup(true)

      try { sessionStorage.setItem('xo_new_bot_id', newBot.id) } catch {}

      const { journeyProgress } = useGuideStore.getState()
      const steps = journeyProgress?.completedSteps ?? []
      if (!steps.includes(5)) {
        useGuideStore.getState().applyJourneyStep({ completedSteps: [...steps, 5] })
      }
    } catch (err) {
      setBotActionError(err.message || 'Create failed.')
    } finally {
      setCreatingBot(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const token = await getToken()
      await api.delete('/users/me', token)
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('xo_'))
        .forEach(k => sessionStorage.removeItem(k))
      clearSessionCache()
      clearTokenCache()
      await signOut()
      triggerSessionRefresh()  // update useOptimisticSession state immediately
      navigate('/')
    } catch (err) {
      setDeleteError(err.message || 'Could not delete account. Try again.')
      setDeleting(false)
    }
  }

  if (!dbUser) return null

  const memberSince = new Date(dbUser.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const initial = (dbUser.displayName?.[0] || '?').toUpperCase()

  const profileHeader = (
    <div className="flex items-center gap-3 min-w-0 py-0.5">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden"
        style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
      >
        {clerkUser?.image
          ? <img src={clerkUser.image} alt="" className="w-full h-full object-cover" />
          : initial}
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditing(false) }}
              maxLength={40}
              className="w-full px-3 py-1 rounded-lg border text-sm font-semibold outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
            <div className="flex gap-2">
              <button
                onClick={e => { e.stopPropagation(); handleSaveName() }}
                disabled={saving || !nameInput.trim()}
                className="px-3 py-1 text-xs font-semibold rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}
              >{saving ? 'Saving…' : 'Save'}</button>
              <button
                onClick={e => { e.stopPropagation(); setEditing(false); setNameInput(dbUser.displayName) }}
                className="px-3 py-1 text-xs font-medium rounded-lg transition-colors"
                style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}
              >Cancel</button>
            </div>
            {saveError && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveError}</p>}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{dbUser.displayName}</span>
              <button
                onClick={e => { e.stopPropagation(); setEditing(true) }}
                className="text-xs px-2 py-0.5 rounded-md transition-colors flex-shrink-0"
                style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface-hover)' }}
                title="Edit display name"
              >Edit</button>
              {eloData && (
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>
                    {Math.round(eloData.currentElo)}
                  </span>
                  {eloData.eloHistory?.[0]?.delta != null && (
                    <span
                      className="text-xs font-semibold tabular-nums"
                      style={{ color: eloData.eloHistory[0].delta >= 0 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}
                    >
                      {eloData.eloHistory[0].delta >= 0 ? '+' : ''}{Math.round(eloData.eloHistory[0].delta)}
                    </span>
                  )}
                </span>
              )}
              <Link
                to="/settings"
                state={{ from: '/profile' }}
                onClick={e => e.stopPropagation()}
                className="text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 flex-shrink-0"
                style={{ color: 'var(--color-blue-600)' }}
              >Settings</Link>
            </div>
            {(dbUser.baRole === 'admin' || (dbUser.roles ?? []).length > 0) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {dbUser.baRole === 'admin' && (
                  <span className="badge badge-mixed">admin</span>
                )}
                {(dbUser.roles ?? []).map(role => (
                  <span key={role} className="badge badge-closed">{role}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto space-y-2">
      <PageHeader title="Profile" />

      {/* Curriculum Cup status — only renders while we're starting the cup
          (`?action=cup`) or if the start failed. Success-path navigates away
          before this can render, so users normally never see this banner. */}
      {(cupBusy || cupError) && (
        <div
          role={cupError ? 'alert' : 'status'}
          aria-live="polite"
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            background:    cupError ? 'rgba(220, 38, 38, 0.07)' : 'rgba(212, 137, 30, 0.07)',
            borderColor:   cupError ? 'rgba(220, 38, 38, 0.35)' : 'rgba(212, 137, 30, 0.35)',
            color:         'var(--text-primary)',
          }}
        >
          {cupError
            ? <>Couldn't start the Curriculum Cup: {cupError}.{' '}
                <button
                  type="button"
                  onClick={() => { setCupError(null); navigate('/profile?action=cup', { replace: true }) }}
                  className="underline font-semibold"
                  style={{ color: 'var(--color-amber-700)' }}
                >Try again</button>
              </>
            : 'Starting your Curriculum Cup… spawning opponents and seeding the bracket.'}
        </div>
      )}

      {/* ── Create Bot Panel ─────────────────────────────────────────────── */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: showCreateBot ? 'var(--color-blue-400)' : 'var(--border-default)',
          boxShadow: 'var(--shadow-card)',
          transition: 'border-color 0.2s',
        }}
      >
        {/* Header — always visible */}
        <button
          className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
          onClick={() => {
            if (!showCreateBot && limitInfo && !limitInfo.isExempt && limitInfo.count >= limitInfo.limit) {
              setBotActionError(`Bot limit reached (${limitInfo.limit}). Delete a bot to create a new one.`)
              setOpenSections(prev => ({ ...prev, bots: true }))
              return
            }
            setBotActionError(null)
            setShowCreateBot(v => !v)
          }}
          aria-expanded={showCreateBot}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>🤖</span>
          <span className="flex-1 min-w-0">
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Create Bot</span>
            {!showCreateBot && (
              <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>Add a new AI bot to train and compete</span>
            )}
          </span>
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{ color: 'var(--text-muted)', transform: showCreateBot ? 'rotate(180deg)' : 'rotate(0deg)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Animated body — grid trick keeps content in DOM for smooth transition */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: showCreateBot ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.28s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <div
              className="px-5 pt-4 pb-5 border-t space-y-3"
              style={{ borderColor: 'var(--border-default)' }}
            >
              {botActionError && showCreateBot && (
                <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{botActionError}</p>
              )}
              <form onSubmit={handleCreateBot} className="space-y-3">
                <label className="space-y-1 block">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</span>
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    maxLength={40}
                    placeholder={dbUser?.username ? `${dbUser.username}-bot` : 'my-bot'}
                    value={createForm.name}
                    onInvalid={e => e.target.setCustomValidity('Enter your Bot name')}
                    onChange={e => { e.target.setCustomValidity(''); setCreateForm(f => ({ ...f, name: e.target.value })) }}
                    className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Game</span>
                  <select
                    value={createForm.gameId}
                    onChange={e => setCreateForm(f => ({ ...f, gameId: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  >
                    {GAMES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Brain Architecture</span>
                  <select
                    value={createForm.modelType}
                    onChange={e => setCreateForm(f => ({ ...f, modelType: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  >
                    <option value="Q_LEARNING">Q-Learning</option>
                    <option value="SARSA">SARSA</option>
                    <option value="MONTE_CARLO">Monte Carlo</option>
                    <option value="POLICY_GRADIENT">Policy Gradient</option>
                    <option value="DQN">DQN (Deep Q-Network)</option>
                    <option value="ALPHA_ZERO">AlphaZero</option>
                  </select>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    A fresh untrained brain of this type will be created. Train it in the Gym.
                  </p>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.competitive}
                    onChange={e => setCreateForm(f => ({ ...f, competitive: e.target.checked }))}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Competitive (eligible for leaderboard &amp; tournaments)</span>
                </label>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={creatingBot}
                    className="btn btn-primary btn-sm"
                  >
                    {creatingBot ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreateBot(false); setBotActionError(null) }}
                    className="px-4 py-1.5 rounded-lg text-sm border"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Profile */}
      <AccordionSection
        header={profileHeader}
        open={openSections.profile}
        onToggle={() => toggle('profile')}
      >
        <dl className="space-y-3">
          <Row label="Email" value={dbUser.email || clerkUser?.email || '—'} />
          <Row label="Sign-in method" value={dbUser.oauthProvider ? capitalize(dbUser.oauthProvider) : 'Email'} />
          <Row label="Member since" value={memberSince} />
        </dl>
      </AccordionSection>

      {/* Quick Stats */}
      {stats && stats.totalGames > 0 && (() => {
        const pvaiWins = Object.values(stats.hva).reduce((s, v) => s + v.wins, 0)
        const pvbotWins = stats.hvb?.wins ?? 0
        const pvpWins = stats.hvh?.wins ?? 0
        return (
          <AccordionSection
            title="Quick Stats"
            summary={`${stats.totalGames} games · ${stats.wins} wins · ${Math.round(stats.winRate * 100)}%`}
            open={openSections.stats}
            onToggle={() => toggle('stats')}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Games" value={stats.totalGames} />
                <StatCard label="Wins" value={stats.wins} color="var(--color-teal-600)" />
                <StatCard label="Win Rate" value={`${Math.round(stats.winRate * 100)}%`} color="var(--color-teal-600)" />
              </div>
              <div
                className="rounded-lg border px-4 py-2.5 grid grid-cols-3 divide-x text-center"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
              >
                {[
                  { label: 'vs Humans', wins: pvpWins, played: stats.hvh?.played ?? 0 },
                  { label: 'vs Quick AI', wins: pvaiWins, played: Object.values(stats.hva).reduce((s, v) => s + v.played, 0) },
                  { label: 'vs Bots', wins: pvbotWins, played: stats.hvb?.played ?? 0 },
                ].map(({ label, wins, played }) => (
                  <div key={label} className="px-2">
                    <div className="text-sm font-bold" style={{ color: played > 0 ? 'var(--color-teal-600)' : 'var(--text-muted)' }}>
                      {played > 0 ? `${wins}W` : '—'}
                    </div>
                    <div className="text-[10px] mt-0.5 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                ))}
              </div>
              <Link
                to="/stats"
                className="text-sm font-medium transition-colors"
                style={{ color: 'var(--color-blue-600)' }}
              >
                View full stats →
              </Link>
            </div>
          </AccordionSection>
        )
      })()}

      {/* Credits & Tier */}
      {credits && (
        <AccordionSection
          title="Credits & Tier"
          summary={`${credits.tierIcon} ${credits.tierName} · ${credits.activityScore} pts`}
          open={openSections.credits}
          onToggle={() => toggle('credits')}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl" aria-hidden="true">{credits.tierIcon}</span>
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{credits.tierName}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Activity Score: {credits.activityScore}</p>
                </div>
              </div>
              {credits.nextTier !== null && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{credits.pointsToNextTier} pts to next tier</p>
              )}
            </div>

            {credits.nextTier !== null && (() => {
              const THRESHOLDS = [0, 25, 100, 500, 2000]
              const tierStart = THRESHOLDS[credits.tier]
              const tierEnd   = THRESHOLDS[credits.nextTier]
              const pct = Math.min(100, Math.round(((credits.activityScore - tierStart) / (tierEnd - tierStart)) * 100))
              return (
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-default)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: 'linear-gradient(90deg, var(--color-blue-500), var(--color-teal-500))' }}
                  />
                </div>
              )
            })()}

            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'HPC', value: credits.hpc, title: 'Human Play Credits' },
                { label: 'BPC', value: credits.bpc, title: 'Bot Play Credits' },
                { label: 'TC',  value: credits.tc,  title: 'Tournament Credits' },
              ].map(({ label, value, title }) => (
                <div key={label} className="rounded-lg p-2" style={{ backgroundColor: 'var(--bg-base)' }} title={title}>
                  <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>{value}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${emailAchievements ? 'bg-[var(--color-blue-600)]' : 'bg-[var(--border-default)]'} ${savingEmailPref ? 'opacity-60' : ''}`}
                onClick={!savingEmailPref ? handleToggleEmailAchievements : undefined}
              >
                <div
                  className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: emailAchievements ? 'translateX(16px)' : 'translateX(0)' }}
                />
              </div>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Email me when I earn an achievement
              </span>
            </label>
          </div>
        </AccordionSection>
      )}

      {/* Tournament Ranking */}
      <MeritsSection
        classification={classification}
        bots={bots}
        botClassifications={botClassifications}
        open={openSections.merits}
        onToggle={() => toggle('merits')}
      />

      {/* Recurring Tournaments — standing subscriptions */}
      <RecurringSubscriptionsSection
        open={openSections.recurring}
        onToggle={() => toggle('recurring')}
      />

      {/* My Bots */}
      <AccordionSection
        title="My Bots"
        summary={limitInfo
          ? (limitInfo.isExempt ? `${limitInfo.count} bots (no limit)` : `${limitInfo.count} / ${limitInfo.limit} bots`)
          : bots.length > 0 ? `${bots.length} bots` : null}
        open={openSections.bots}
        onToggle={() => toggle('bots')}
      >
        <div className="space-y-3">
          {botActionError && !showCreateBot && (
            <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{botActionError}</p>
          )}

          <button
            onClick={() => {
              if (limitInfo && !limitInfo.isExempt && limitInfo.count >= limitInfo.limit) {
                setBotActionError(`Bot limit reached (${limitInfo.limit}). Delete a bot to create a new one.`)
                return
              }
              setBotActionError(null)
              setShowCreateBot(true)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            className="text-sm font-medium underline underline-offset-2 transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-blue-600)' }}
          >
            + Create new bot
          </button>

          {botsLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!botsLoading && bots.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You have no bots yet.</p>
          )}

          {!botsLoading && bots.length > 0 && (
            <ListTable fitViewport topOffset={56} bottomPadding={32} columns={['33%', '13%', '11%', '43%']}>
              <thead>
                <tr>
                  <ListTh>Bot</ListTh>
                  <ListTh>Type</ListTh>
                  <ListTh align="right">ELO</ListTh>
                  <ListTh align="right">Actions</ListTh>
                </tr>
              </thead>
              <tbody>
                {bots.map((bot, i) => (
                  <ListTr key={bot.id} dimmed={!bot.botActive} last={i === bots.length - 1}>
                    <ListTd>
                      {renamingBot?.id === bot.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={renamingBot.value}
                            onChange={e => setRenamingBot({ id: bot.id, value: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') handleRenameBot(bot.id); if (e.key === 'Escape') setRenamingBot(null) }}
                            maxLength={40}
                            className="px-2 py-0.5 rounded border text-sm focus:outline-none"
                            style={{ borderColor: 'var(--color-blue-400)', backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', width: '140px' }}
                          />
                          <button onClick={() => handleRenameBot(bot.id)} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}>✓</button>
                          <button onClick={() => setRenamingBot(null)} className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }}>✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            to={`/bots/${bot.id}`}
                            className="font-semibold hover:underline"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {bot.displayName}
                          </Link>
                          {bot.botProvisional && (
                            <span className="badge badge-closed">provisional</span>
                          )}
                          {!bot.botActive && (
                            <span className="badge badge-done">inactive</span>
                          )}
                        </div>
                      )}
                      {bot.botProvisional && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--color-amber-600)' }}>
                          {Math.max(0, provisionalThreshold - (bot.botGamesPlayed ?? 0))} game{Math.max(0, provisionalThreshold - (bot.botGamesPlayed ?? 0)) !== 1 ? 's' : ''} to establish rating
                        </div>
                      )}
                    </ListTd>
                    <ListTd>
                      <span className="badge badge-live">
                        {BOT_MODEL_LABELS[bot.botModelType] ?? bot.botModelType ?? 'AI'}
                      </span>
                    </ListTd>
                    <ListTd align="right">
                      <span className="font-mono tabular-nums">{Math.round(bot.eloRating)}</span>
                    </ListTd>
                    <ListTd align="right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setRenamingBot({ id: bot.id, value: bot.displayName })}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                          title="Rename"
                        >✎</button>
                        <button
                          onClick={() => handleToggleBotActive(bot)}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                          style={{
                            borderColor: bot.botActive ? 'var(--color-orange-300)' : 'var(--color-teal-300)',
                            color: bot.botActive ? 'var(--color-orange-600)' : 'var(--color-teal-600)',
                          }}
                          title={bot.botActive ? 'Disable bot' : 'Enable bot'}
                        >{bot.botActive ? 'Disable' : 'Enable'}</button>
                        <button
                          onClick={() => handleResetElo(bot)}
                          disabled={bot.botInTournament}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ borderColor: 'var(--color-purple-300)', color: 'var(--color-purple-600)' }}
                          title={bot.botInTournament ? 'Cannot reset ELO while in tournament' : 'Reset ELO to 1200'}
                        >Reset ELO</button>
                        <button
                          onClick={() => handleDeleteBot(bot)}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)]"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                          title="Delete bot"
                        >✕</button>
                      </div>
                    </ListTd>
                  </ListTr>
                ))}
              </tbody>
            </ListTable>
          )}
        </div>
      </AccordionSection>

      {/* Danger Zone — hidden for admins */}
      {dbUser.baRole !== 'admin' && (
        <AccordionSection
          title="Danger Zone"
          open={openSections.danger}
          onToggle={() => toggle('danger')}
          danger
        >
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Delete account</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Permanently removes your account, all your bots, stats, and game history. This cannot be undone.
              </p>
            </div>
            {deleteError && (
              <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{deleteError}</p>
            )}
            {!deleteConfirm ? (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="text-sm font-medium px-4 py-1.5 rounded-lg border transition-colors hover:bg-[var(--color-red-50)]"
                style={{ borderColor: 'var(--color-red-300)', color: 'var(--color-red-600)' }}
              >
                Delete my account…
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-red-600)' }}>
                  Are you sure? This is permanent and cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting}
                    className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-red-600)', color: 'white' }}
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete my account'}
                  </button>
                  <button
                    onClick={() => { setDeleteConfirm(false); setDeleteError(null) }}
                    disabled={deleting}
                    className="text-sm font-medium px-4 py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </AccordionSection>
      )}

      {showBotCreatedPopup && (
        <BotCreatedPopup
          onDismiss={() => {
            setShowBotCreatedPopup(false)
            useGuideStore.getState().open()
            window.location.href = '/gym'
          }}
        />
      )}

      {showQuickBot && (
        <div
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowQuickBot(false); navigate('/profile', { replace: true }) } }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(8,12,22,0.6)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <QuickBotWizard
            getToken={getToken}
            onCancel={() => { setShowQuickBot(false); navigate('/profile', { replace: true }) }}
            onCreated={(bot) => {
              setShowQuickBot(false)
              navigate(`/bots/${bot.id}`, { replace: true })
            }}
          />
        </div>
      )}
    </div>
  )
}

// ── Tournament Ranking (Merits) ───────────────────────────────────────────────

const TIER_META = [
  { tier: 'RECRUIT',   label: 'Recruit',   icon: '⚪', required: 4  },
  { tier: 'CONTENDER', label: 'Contender', icon: '🔵', required: 6  },
  { tier: 'VETERAN',   label: 'Veteran',   icon: '🟢', required: 10 },
  { tier: 'ELITE',     label: 'Elite',     icon: '🟡', required: 18 },
  { tier: 'CHAMPION',  label: 'Champion',  icon: '🟠', required: 25 },
  { tier: 'LEGEND',    label: 'Legend',    icon: '🔴', required: null },
]

function tierMeta(tier) {
  const idx = TIER_META.findIndex(t => t.tier === tier)
  return { meta: TIER_META[idx] ?? TIER_META[0], idx: idx === -1 ? 0 : idx }
}

function MeritsSection({ classification, bots, botClassifications, open, onToggle }) {
  const roster = [
    { id: 'me', label: 'You', classification: classification ?? null, isBot: false },
    ...bots.map(b => ({
      id: b.id,
      label: b.displayName,
      classification: botClassifications[b.id] ?? null,
      isBot: true,
      botId: b.id,
    })),
  ]

  let summaryParts
  if (classification) {
    const { meta: userTier, idx: userIdx } = tierMeta(classification.tier)
    const userNext = TIER_META[userIdx + 1] ?? null
    const userMerits = classification.merits ?? 0
    summaryParts = [`${userTier.icon} ${userTier.label} · ${userMerits} merit${userMerits !== 1 ? 's' : ''}`]
    if (userNext) summaryParts.push(`${userTier.required - userMerits} to next`)
    else summaryParts.push('Max tier')
  } else {
    summaryParts = ['No rank yet']
  }
  if (bots.length > 0) summaryParts.push(`${bots.length} bot${bots.length !== 1 ? 's' : ''}`)

  return (
    <AccordionSection
      title="Tournament Ranking"
      summary={summaryParts.join(' · ')}
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-4">
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-base)', borderBottom: '1px solid var(--border-default)' }}>
                <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Player</th>
                <th className="px-3 py-2 text-center font-semibold" style={{ color: 'var(--text-muted)' }}>Tier</th>
                <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Merits</th>
                <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>To next</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row, i) => {
                const cls = row.classification
                if (!cls) {
                  return (
                    <tr key={row.id} style={{ borderTop: i > 0 ? '1px solid var(--border-default)' : undefined }}>
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {row.isBot ? (
                          <a href={`/bots/${row.botId}`} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>
                            {row.label}
                          </a>
                        ) : row.label}
                        {row.isBot && <span className="ml-1.5 badge badge-done" style={{ fontSize: '9px' }}>bot</span>}
                      </td>
                      <td className="px-3 py-2 text-center" style={{ color: 'var(--text-muted)' }}>—</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>—</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>—</td>
                    </tr>
                  )
                }
                const { meta: t, idx: tIdx } = tierMeta(cls.tier)
                const nextT = TIER_META[tIdx + 1] ?? null
                const m = cls.merits ?? 0
                const toNext = nextT ? t.required - m : null
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderTop: i > 0 ? '1px solid var(--border-default)' : undefined,
                      backgroundColor: !row.isBot ? 'var(--color-blue-50, rgba(59,130,246,0.06))' : 'transparent',
                    }}
                  >
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {row.isBot ? (
                        <a href={`/bots/${row.botId}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>
                          {row.label}
                        </a>
                      ) : row.label}
                      {row.isBot && <span className="ml-1.5 badge badge-done" style={{ fontSize: '9px' }}>bot</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span title={t.label}>{t.icon} {t.label}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--color-blue-600)' }}>
                      {m}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: toNext === 0 ? 'var(--color-teal-600)' : 'var(--text-secondary)' }}>
                      {toNext != null ? toNext : <span style={{ color: 'var(--text-muted)' }}>max</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <details>
          <summary
            className="text-[10px] font-semibold uppercase tracking-wide cursor-pointer select-none"
            style={{ color: 'var(--text-muted)' }}
          >
            Tier ladder ▸
          </summary>
          <div className="mt-2 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-base)', borderBottom: '1px solid var(--border-default)' }}>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Tier</th>
                  <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Merits to promote</th>
                </tr>
              </thead>
              <tbody>
                {TIER_META.map((t, i) => (
                  <tr key={t.tier} style={{ borderTop: i > 0 ? '1px solid var(--border-default)' : undefined }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{t.icon} {t.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{t.required ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {classification?.history?.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Your recent tier changes</p>
            {classification.history.slice(0, 5).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>
                  {h.fromTier ? `${h.fromTier} → ${h.toTier}` : h.toTier}
                  {' '}<span style={{ color: 'var(--text-muted)' }}>({h.reason?.replace(/_/g, ' ')})</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{new Date(h.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AccordionSection>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm" style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="text-sm font-medium text-right truncate" style={{ color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div
      className="rounded-xl border p-4 text-center"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="text-xs mt-1 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

/**
 * Lists the signed-in user's standing recurring-tournament subscriptions and
 * lets them withdraw. Data comes from `GET /api/recurring/my` via
 * `tournamentApi.listMyRecurring`. Renders inside its own AccordionSection so
 * users who never subscribe see an empty collapsed row rather than a wall of
 * "none found" text.
 */
function RecurringSubscriptionsSection({ open, onToggle }) {
  const [subs, setSubs]       = useState(null)   // null = loading
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)

  const load = async () => {
    const token = await getToken().catch(() => null)
    if (!token) { setSubs([]); return }
    try {
      const { subscriptions } = await tournamentApi.listMyRecurring(token)
      setSubs(subscriptions ?? [])
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load subscriptions.')
      setSubs([])
    }
  }

  useEffect(() => { load() }, [])

  async function withdraw(templateId) {
    if (!confirm('Unsubscribe from this recurring tournament?')) return
    setBusyId(templateId)
    try {
      const token = await getToken()
      await tournamentApi.recurringWithdraw(templateId, token)
      await load()
    } catch (e) {
      setError(e.message || 'Withdraw failed.')
    } finally {
      setBusyId(null)
    }
  }

  const summary = subs === null
    ? null
    : subs.length === 0
      ? 'Not subscribed to any'
      : `${subs.length} subscription${subs.length === 1 ? '' : 's'}`

  return (
    <AccordionSection title="Recurring Tournament Subscriptions" summary={summary} open={open} onToggle={onToggle}>
      {error && <p className="text-sm mb-2" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
      {subs === null && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {subs && subs.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          You're not subscribed to any recurring tournaments. Open a recurring tournament's page and register to have every future occurrence auto-enroll you.
        </p>
      )}
      {subs && subs.length > 0 && (
        <ListTable>
          <thead>
            <tr>
              <ListTh>Tournament</ListTh>
              <ListTh>Game · Mode</ListTh>
              <ListTh>Interval</ListTh>
              <ListTh align="right"><span className="sr-only">Action</span></ListTh>
            </tr>
          </thead>
          <tbody>
            {subs.map((s, i) => {
              const t = s.template ?? {}
              const intervalLabel = t.recurrenceInterval
                ? t.recurrenceInterval.toLowerCase().replace(/^\w/, c => c.toUpperCase())
                : '—'
              return (
                <ListTr key={s.id} last={i === subs.length - 1}>
                  <ListTd>
                    <Link
                      to={`/tournaments/${t.id}`}
                      className="text-sm font-medium hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t.name ?? '(deleted)'}
                    </Link>
                    {t.paused && (
                      <span
                        className="ml-2 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)', border: '1px solid var(--color-amber-300)' }}
                        title="New occurrences are currently paused by an admin"
                      >
                        Paused
                      </span>
                    )}
                  </ListTd>
                  <ListTd>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {(t.game ?? '').toUpperCase()} · {t.mode ?? ''}
                    </span>
                  </ListTd>
                  <ListTd>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{intervalLabel}</span>
                  </ListTd>
                  <ListTd align="right">
                    <button
                      onClick={() => withdraw(t.id)}
                      disabled={busyId === t.id}
                      className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)] disabled:opacity-40"
                      style={{ borderColor: 'var(--color-red-300)', color: 'var(--color-red-600)' }}
                    >
                      {busyId === t.id ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  </ListTd>
                </ListTr>
              )
            })}
          </tbody>
        </ListTable>
      )}
    </AccordionSection>
  )
}

function AccordionSection({ title, summary, header, open, onToggle, danger, children }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: danger ? 'var(--color-red-200)' : 'var(--border-default)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {header ? (
        <div
          className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-surface-hover)] cursor-pointer"
          onClick={onToggle}
          role="button"
          aria-label="Toggle section"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}
        >
          <span className="flex-1 min-w-0">{header}</span>
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      ) : (
        <button
          className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
          onClick={onToggle}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-widest flex-shrink-0 w-20"
            style={{ color: danger ? 'var(--color-red-500)' : 'var(--text-muted)' }}
          >
            {title}
          </span>
          {!open && summary && (
            <span className="flex-1 min-w-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {summary}
            </span>
          )}
          <span className="flex-1" />
          <svg
            className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
            style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
      {open && (
        <div
          className="px-5 pt-4 pb-5 border-t"
          style={{ borderColor: danger ? 'var(--color-red-200)' : 'var(--border-default)' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

function PageHeader({ title }) {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
    </div>
  )
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : str
}
