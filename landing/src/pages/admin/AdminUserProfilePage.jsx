import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { ListTable, ListTh, ListTr, ListTd } from '../../components/ui/ListTable.jsx'

export default function AdminUserProfilePage() {
  const { id } = useParams()
  const [user, setUser]         = useState(null)
  const [stats, setStats]       = useState(null)
  const [eloData, setEloData]   = useState(null)
  const [bots, setBots]         = useState([])
  const [limitInfo, setLimitInfo]           = useState(null)
  const [provisionalThreshold, setProvisionalThreshold] = useState(5)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [botActionError, setBotActionError] = useState(null)
  const [renamingBot, setRenamingBot]       = useState(null) // { id, value }

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = await getToken()
        const { user: u } = await api.admin.getUser(id, token)
        setUser(u)

        const [statsRes, eloRes, botsRes] = await Promise.allSettled([
          api.users.stats(u.id),
          api.users.eloHistory(u.id),
          api.bots.list({ ownerId: u.id, includeInactive: true }),
        ])
        if (statsRes.status === 'fulfilled') setStats(statsRes.value.stats)
        if (eloRes.status === 'fulfilled')   setEloData(eloRes.value)
        if (botsRes.status === 'fulfilled') {
          const { bots: b, limitInfo: li, provisionalThreshold: pt } = botsRes.value
          setBots(b ?? [])
          if (li) setLimitInfo(li)
          if (pt != null) setProvisionalThreshold(pt)
        }
      } catch {
        setError('Failed to load user profile.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  async function handleToggleBotActive(bot) {
    setBotActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.admin.updateBot(bot.id, { botActive: !bot.botActive }, token)
      setBots(prev => prev.map(b => b.id === bot.id ? { ...b, botActive: updated.botActive } : b))
    } catch (err) {
      setBotActionError(err.message || 'Action failed.')
    }
  }

  async function handleRenameBot(botId) {
    if (!renamingBot || renamingBot.id !== botId) return
    const newName  = renamingBot.value
    const previous = bots.find(b => b.id === botId)?.displayName
    setBots(prev => prev.map(b => b.id === botId ? { ...b, displayName: newName } : b))
    setRenamingBot(null)
    setBotActionError(null)
    try {
      const token = await getToken()
      const { bot: updated } = await api.admin.updateBot(botId, { displayName: newName }, token)
      setBots(prev => prev.map(b => b.id === botId ? { ...b, displayName: updated.displayName } : b))
    } catch (err) {
      setBots(prev => prev.map(b => b.id === botId ? { ...b, displayName: previous } : b))
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
      await api.admin.deleteBot(bot.id, token)
      setBots(prev => prev.filter(b => b.id !== bot.id))
      setLimitInfo(prev => prev ? { ...prev, count: prev.count - 1 } : prev)
    } catch (err) {
      setBotActionError(err.message || 'Delete failed.')
    }
  }

  if (loading) return (
    <div className="max-w-lg mx-auto flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="max-w-lg mx-auto space-y-8">
      <PageHeader />
      <p className="text-sm text-center" style={{ color: 'var(--color-red-600)' }}>{error}</p>
    </div>
  )

  if (!user) return null

  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const initial = (user.displayName?.[0] || '?').toUpperCase()

  return (
    <div className="max-w-lg mx-auto space-y-8">
      <PageHeader />

      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 overflow-hidden"
            style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
          >
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
              : initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-bold truncate">{user.displayName}</span>
              {user.banned && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' }}>banned</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {user.baRole === 'admin' && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-purple-100)', color: 'var(--color-purple-700)' }}>admin</span>
              )}
              {(user.roles ?? []).map(role => (
                <span key={role} className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-orange-100)', color: 'var(--color-orange-700)' }}>{role}</span>
              ))}
            </div>
            {user.online && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--color-teal-50)', color: 'var(--color-teal-600)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-teal-500)' }} />
                  Online
                </span>
                {user.signedInAt && (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    since {new Date(user.signedInAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />

        <dl className="space-y-3">
          <Row label="Email"          value={user.email || '—'} />
          <Row label="Sign-in method" value={user.oauthProvider ? capitalize(user.oauthProvider) : 'Email'} />
          <Row label="Member since"   value={memberSince} />
          {eloData && (
            <Row
              label="ELO"
              value={
                <span className="flex items-center gap-1.5 justify-end">
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

      {stats && stats.totalGames > 0 && (
        <section className="space-y-3">
          <SectionLabel>Quick Stats</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Games"    value={stats.totalGames} />
            <StatCard label="Wins"     value={stats.wins}       color="var(--color-teal-600)" />
            <StatCard label="Win Rate" value={`${Math.round(stats.winRate * 100)}%`} color="var(--color-teal-600)" />
          </div>
          {(() => {
            const pvaiWins  = Object.values(stats.pvai).reduce((s, v) => s + v.wins, 0)
            const pvbotWins = stats.pvbot?.wins ?? 0
            const pvpWins   = stats.pvp?.wins   ?? 0
            return (
              <div
                className="rounded-lg border px-4 py-2.5 grid grid-cols-3 divide-x text-center"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
              >
                {[
                  { label: 'vs Humans',   wins: pvpWins,   played: stats.pvp?.played  ?? 0 },
                  { label: 'vs Quick AI', wins: pvaiWins,  played: Object.values(stats.pvai).reduce((s, v) => s + v.played, 0) },
                  { label: 'vs Bots',     wins: pvbotWins, played: stats.pvbot?.played ?? 0 },
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
        </section>
      )}

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

        {bots.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No bots.</p>
        )}

        {bots.length > 0 && (
          <ListTable fitViewport topOffset={56} bottomPadding={32}>
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
                        <button onClick={() => setRenamingBot(null)}     className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }}>✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {bot.displayName}
                        </span>
                        {bot.botProvisional && (
                          <span className="text-xs px-1.5 py-0 rounded-full font-medium" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>provisional</span>
                        )}
                        {!bot.botActive && (
                          <span className="text-xs px-1.5 py-0 rounded-full font-medium" style={{ backgroundColor: 'var(--color-gray-100)', color: 'var(--text-muted)' }}>inactive</span>
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
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}>
                      {bot.botModelType}
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
                          color:       bot.botActive ? 'var(--color-orange-600)' : 'var(--color-teal-600)',
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
      </section>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <Link
        to="/admin/users"
        className="text-sm font-medium mb-2 inline-block"
        style={{ color: 'var(--color-blue-600)' }}
      >
        ← Back to Users
      </Link>
      <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Profile</h1>
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
