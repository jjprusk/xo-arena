import React, { useEffect, useState } from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { tournamentApi } from '../lib/tournamentApi.js'

const TIER_ORDER = ['RECRUIT', 'CONTENDER', 'VETERAN', 'ELITE', 'CHAMPION', 'LEGEND']
const TIER_ICONS = {
  RECRUIT:   '🎖️',
  CONTENDER: '🥉',
  VETERAN:   '🥈',
  ELITE:     '🥇',
  CHAMPION:  '🏆',
  LEGEND:    '👑',
}

export default function ProfilePage() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null

  const [classification, setClassification] = useState(null)
  const [classLoading, setClassLoading]     = useState(false)
  const [optOutBusy, setOptOutBusy]         = useState(false)
  const [optOutError, setOptOutError]       = useState(null)

  useEffect(() => {
    if (!user) return
    setClassLoading(true)
    getToken().then(token => tournamentApi.getMyClassification(token))
      .then(setClassification)
      .catch(() => {})
      .finally(() => setClassLoading(false))
  }, [user?.id])

  async function handleDemotionOptOut() {
    setOptOutBusy(true)
    setOptOutError(null)
    try {
      const token = await getToken()
      const updated = await tournamentApi.useDemotionOptOut(token)
      setClassification(updated)
    } catch (err) {
      setOptOutError(err.message || 'Failed to use opt-out')
    } finally {
      setOptOutBusy(false)
    }
  }

  if (isPending) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="h-6 w-32 rounded animate-pulse" style={{ backgroundColor: 'var(--border-default)' }} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to view your profile.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          {user.name ?? user.email}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
      </div>

      {/* Tournament Rank */}
      {classLoading && (
        <div className="rounded-xl border p-4 animate-pulse" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
          <div className="h-4 w-32 rounded" style={{ backgroundColor: 'var(--border-default)' }} />
        </div>
      )}

      {!classLoading && classification && (
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Tournament Rank
          </h2>

          {/* Tier + merits */}
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">{TIER_ICONS[classification.tier] ?? '🏅'}</span>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{classification.tier}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {classification.merits} merit{classification.merits !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Tier ladder */}
          <div className="flex items-center gap-1 flex-wrap">
            {TIER_ORDER.map(tier => {
              const active = tier === classification.tier
              return (
                <span
                  key={tier}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: active ? 'var(--color-primary)' : 'var(--bg-base)',
                    color: active ? 'white' : 'var(--text-muted)',
                  }}
                >
                  {TIER_ICONS[tier]} {tier}
                </span>
              )
            })}
          </div>

          {/* Recent tier history */}
          {classification.history?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Recent changes
              </p>
              {classification.history.slice(0, 3).map((h, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {h.fromTier ? `${h.fromTier} → ` : ''}{h.toTier}
                  <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                    ({h.reason}) · {new Date(h.createdAt).toLocaleDateString()}
                  </span>
                </p>
              ))}
            </div>
          )}

          {/* Demotion opt-out */}
          {classification.tier !== 'RECRUIT' && (() => {
            const usedAt = classification.demotionOptOutUsedAt
            const usedRecently = usedAt && (Date.now() - new Date(usedAt).getTime()) < 30 * 24 * 60 * 60 * 1000
            return (
              <div className="pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Demotion protection
                </p>
                {usedRecently ? (
                  <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
                    ✓ Protected this review cycle
                  </p>
                ) : (
                  <div>
                    <button
                      onClick={handleDemotionOptOut}
                      disabled={optOutBusy}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
                      style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                    >
                      {optOutBusy ? 'Saving…' : 'Protect from demotion this cycle'}
                    </button>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      Once per review period (~30 days). Skips your next demotion check.
                    </p>
                    {optOutError && (
                      <p className="text-[10px] mt-1" style={{ color: 'var(--color-red-600)' }}>{optOutError}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {!classLoading && !classification && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
            Tournament Rank
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No classification record yet. Participate in a tournament to earn your rank.
          </p>
        </div>
      )}
    </div>
  )
}
