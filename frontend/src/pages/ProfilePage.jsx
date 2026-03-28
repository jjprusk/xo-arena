import React, { useEffect, useState, useCallback } from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'

export default function ProfilePage() {
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
  const [botsLoading, setBotsLoading] = useState(false)
  const [showCreateBot, setShowCreateBot] = useState(false)
  const [botActionError, setBotActionError] = useState(null)
  const [renamingBot, setRenamingBot] = useState(null) // { id, value }
  const [createForm, setCreateForm] = useState({ name: '', modelType: 'DQN', competitive: false })

  useEffect(() => {
    if (!clerkUser) return

    setLoading(true)
    async function load() {
      try {
        const token = await getToken()
        const { user } = await api.users.sync(token)
        setDbUser(user)
        setNameInput(user.displayName)
        const [{ stats: s }, eloRes] = await Promise.all([
          api.users.stats(user.id),
          api.users.eloHistory(user.id).catch(() => null),
        ])
        setStats(s)
        if (eloRes) setEloData(eloRes)
        // Load bots
        setBotsLoading(true)
        try {
          const { bots: b, limitInfo: li, provisionalThreshold: pt } = await api.bots.list({ ownerId: user.id, includeInactive: true })
          setBots(b)
          setLimitInfo(li)
          if (pt != null) setProvisionalThreshold(pt)
        } catch { /* non-fatal */ } finally {
          setBotsLoading(false)
        }
      } catch {
        setError('Failed to load profile.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [clerkUser?.id])

  async function handleSaveName() {
    if (!nameInput.trim() || nameInput === dbUser.displayName) {
      setEditing(false)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const token = await getToken()
      const { user: updated } = await api.patch(`/users/${dbUser.id}`, { displayName: nameInput.trim() }, token)
      setDbUser(updated)
      setEditing(false)
    } catch {
      setSaveError('Could not save. Try again.')
    } finally {
      setSaving(false)
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
    setBotActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.bots.update(id, { displayName: renamingBot.value }, token)
      setBots(prev => prev.map(b => b.id === id ? { ...b, displayName: updated.displayName } : b))
      setRenamingBot(null)
    } catch (err) {
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
    setBotActionError(null)
    try {
      const token = await getToken()
      const payload = {
        name: createForm.name,
        algorithm: 'ml',
        modelType: createForm.modelType,
        competitive: createForm.competitive,
      }
      const { bot: newBot } = await api.bots.create(payload, token)
      setBots(prev => [newBot, ...prev])
      setLimitInfo(prev => prev ? { ...prev, count: prev.count + 1 } : prev)
      setCreateForm({ name: '', modelType: 'DQN', competitive: false })
      setShowCreateBot(false)
    } catch (err) {
      setBotActionError(err.message || 'Create failed.')
    }
  }

  if (!dbUser) return null

  const memberSince = new Date(dbUser.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const initial = (dbUser.displayName?.[0] || '?').toUpperCase()

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <PageHeader title="Profile" />

      {/* Identity card */}
      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        {/* Avatar + name row */}
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 overflow-hidden"
            style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
          >
            {clerkUser?.image
              ? <img src={clerkUser.image} alt={dbUser.displayName} className="w-full h-full object-cover" />
              : initial}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditing(false) }}
                  maxLength={40}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm font-semibold outline-none focus:border-[var(--color-blue-600)] transition-colors"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveName}
                    disabled={saving || !nameInput.trim()}
                    className="px-3 py-1 text-xs font-semibold rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setNameInput(dbUser.displayName) }}
                    className="px-3 py-1 text-xs font-medium rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}
                  >
                    Cancel
                  </button>
                </div>
                {saveError && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveError}</p>}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold truncate">{dbUser.displayName}</span>
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs px-2 py-0.5 rounded-md transition-colors flex-shrink-0"
                    style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface-hover)' }}
                    title="Edit display name"
                  >
                    Edit
                  </button>
                </div>
                {(dbUser.baRole === 'admin' || (dbUser.roles ?? []).length > 0) && (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {dbUser.baRole === 'admin' && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-purple-100)', color: 'var(--color-purple-700)' }}>admin</span>
                    )}
                    {(dbUser.roles ?? []).map(role => (
                      <span key={role} className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-orange-100)', color: 'var(--color-orange-700)' }}>{role}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />

        {/* Details */}
        <dl className="space-y-3">
          <Row label="Email" value={dbUser.email || clerkUser?.email || '—'} />
          <Row label="Sign-in method" value={dbUser.oauthProvider ? capitalize(dbUser.oauthProvider) : 'Email'} />
          <Row label="Member since" value={memberSince} />
          {eloData && (
            <Row
              label="ELO"
              value={
                <span className="flex items-center gap-1.5">
                  <span className="font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>
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
              }
            />
          )}
        </dl>
      </div>

      {/* Quick stats */}
      {stats && stats.totalGames > 0 && (
        <section className="space-y-3">
          <SectionLabel>Quick Stats</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Games" value={stats.totalGames} />
            <StatCard label="Wins" value={stats.wins} color="var(--color-teal-600)" />
            <StatCard label="Win Rate" value={`${Math.round(stats.winRate * 100)}%`} color="var(--color-teal-600)" />
          </div>
          {/* Win breakdown by opponent type (B-15e) */}
          {stats.totalGames > 0 && (() => {
            const pvaiWins = Object.values(stats.pvai).reduce((s, v) => s + v.wins, 0)
            const pvbotWins = stats.pvbot?.wins ?? 0
            const pvpWins = stats.pvp?.wins ?? 0
            return (
              <div
                className="rounded-lg border px-4 py-2.5 grid grid-cols-3 divide-x text-center"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)', divideColor: 'var(--border-default)' }}
              >
                {[
                  { label: 'vs Humans', wins: pvpWins, played: stats.pvp?.played ?? 0 },
                  { label: 'vs Quick AI', wins: pvaiWins, played: Object.values(stats.pvai).reduce((s, v) => s + v.played, 0) },
                  { label: 'vs Bots', wins: pvbotWins, played: stats.pvbot?.played ?? 0 },
                ].map(({ label, wins, played }) => (
                  <div key={label} className="px-2">
                    <div className="text-sm font-bold" style={{ color: played > 0 ? 'var(--color-teal-600)' : 'var(--text-muted)' }}>
                      {played > 0 ? `${wins}W` : '—'}
                    </div>
                    <div className="text-[10px] mt-0.5 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                ))}
              </div>
            )
          })()}
          <Link
            to="/stats"
            className="text-sm font-medium transition-colors"
            style={{ color: 'var(--color-blue-600)' }}
          >
            View full stats →
          </Link>
        </section>
      )}

      {/* My Bots */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>My Bots</SectionLabel>
          {limitInfo && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {limitInfo.isExempt
                ? `${limitInfo.count} bots (no limit)`
                : `${limitInfo.count} / ${limitInfo.limit} bots`}
            </span>
          )}
        </div>

        {botActionError && (
          <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{botActionError}</p>
        )}

        {botsLoading && (
          <div className="flex items-center justify-center py-4">
            <div className="w-5 h-5 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!botsLoading && bots.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You have no bots yet.</p>
        )}

        {!botsLoading && bots.length > 0 && (
          <div
            className="rounded-xl border divide-y overflow-hidden"
            style={{ borderColor: 'var(--border-default)', borderWidth: '1px' }}
          >
            {bots.map(bot => (
              <div
                key={bot.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              >
                {/* Name + badges */}
                <div className="flex-1 min-w-0">
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
                        className="text-sm font-semibold hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {bot.displayName}
                      </Link>
                      <span
                        className="text-xs px-1.5 py-0 rounded-full font-medium"
                        style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
                      >
                        {bot.botModelType}
                      </span>
                      {bot.botProvisional && (
                        <span className="text-xs px-1.5 py-0 rounded-full font-medium" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>provisional</span>
                      )}
                      {!bot.botActive && (
                        <span className="text-xs px-1.5 py-0 rounded-full font-medium" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }}>inactive</span>
                      )}
                    </div>
                  )}
                  <div className="text-xs mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                    ELO {Math.round(bot.eloRating)}
                    {bot.botProvisional && (
                      <span className="ml-1 font-sans not-italic" style={{ color: 'var(--color-amber-600)' }}>
                        · {Math.max(0, provisionalThreshold - (bot.botGamesPlayed ?? 0))} game{Math.max(0, provisionalThreshold - (bot.botGamesPlayed ?? 0)) !== 1 ? 's' : ''} to establish rating
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setRenamingBot({ id: bot.id, value: bot.displayName })}
                    className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => handleToggleBotActive(bot)}
                    className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                    style={{
                      borderColor: bot.botActive ? 'var(--color-orange-300)' : 'var(--color-teal-300)',
                      color: bot.botActive ? 'var(--color-orange-600)' : 'var(--color-teal-600)',
                    }}
                    title={bot.botActive ? 'Disable bot' : 'Enable bot'}
                  >
                    {bot.botActive ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleResetElo(bot)}
                    disabled={bot.botInTournament}
                    className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ borderColor: 'var(--color-purple-300)', color: 'var(--color-purple-600)' }}
                    title={bot.botInTournament ? 'Cannot reset ELO while in tournament' : 'Reset ELO to 1200'}
                  >
                    Reset ELO
                  </button>
                  <button
                    onClick={() => handleDeleteBot(bot)}
                    className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)]"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                    title="Delete bot"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create bot form */}
        {showCreateBot ? (
          <form
            onSubmit={handleCreateBot}
            className="rounded-xl border p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>New bot</p>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</span>
              <input
                type="text"
                required
                maxLength={40}
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Brain Architecture</span>
              <select
                value={createForm.modelType}
                onChange={e => setCreateForm(f => ({ ...f, modelType: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >
                <option value="DQN">DQN (Deep Q-Network)</option>
                <option value="ALPHA_ZERO">AlphaZero</option>
                <option value="POLICY_GRADIENT">Policy Gradient</option>
                <option value="Q_LEARNING">Q-Learning</option>
                <option value="SARSA">SARSA</option>
                <option value="MONTE_CARLO">Monte Carlo</option>
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
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Competitive (eligible for leaderboard & tournaments)</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-white"
                style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
              >
                Create
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
        ) : (
          <button
            onClick={() => {
              if (limitInfo && !limitInfo.isExempt && limitInfo.count >= limitInfo.limit) {
                setBotActionError(`Bot limit reached (${limitInfo.limit}). Delete a bot to create a new one.`)
                return
              }
              setBotActionError(null)
              setShowCreateBot(true)
              setMlModels([])
            }}
            className="text-sm font-medium transition-colors"
            style={{ color: 'var(--color-blue-600)' }}
          >
            + Create new bot
          </button>
        )}
      </section>
    </div>
  )
}

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

function PageHeader({ title }) {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h2>
  )
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
