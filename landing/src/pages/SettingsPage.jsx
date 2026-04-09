import React, { useState, useEffect } from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'

export default function SettingsPage() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null

  const [tournamentNotifPref, setTournamentNotifPref] = useState(null)
  const [savingNotifPref, setSavingNotifPref]         = useState(false)
  const [flashStartAlerts, setFlashStartAlerts]       = useState(null)
  const [savingFlashAlerts, setSavingFlashAlerts]     = useState(false)

  useEffect(() => {
    if (!user) return
    getToken().then(token => api.users.getPreferences(token)).then(data => {
      setTournamentNotifPref(data.tournamentResultNotifPref ?? 'AS_PLAYED')
      setFlashStartAlerts(data.flashStartAlerts !== false)
    }).catch(() => {})
  }, [user?.id])

  if (isPending) return null

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to manage settings.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Settings
        </h1>
      </div>

      {user && tournamentNotifPref !== null && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Tournaments
          </h2>
          <div
            className="rounded-xl border p-5 space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            {/* Match result notifications */}
            <div>
              <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Match result notifications</div>
              <div className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                Choose when you receive match results during a tournament. This becomes your default when you register.
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                {[
                  { value: 'AS_PLAYED',         label: 'As played',           desc: 'Get each result immediately after the match.' },
                  { value: 'END_OF_TOURNAMENT',  label: 'End of tournament',   desc: 'Receive all results in one batch when the tournament finishes.' },
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    disabled={savingNotifPref}
                    onClick={async () => {
                      if (tournamentNotifPref === value) return
                      setSavingNotifPref(true)
                      try {
                        const token = await getToken()
                        await api.users.patchPreferences({ tournamentResultNotifPref: value }, token)
                        setTournamentNotifPref(value)
                      } finally {
                        setSavingNotifPref(false)
                      }
                    }}
                    className={`flex-1 text-left p-3 rounded-xl border-2 transition-all active:scale-[0.98] disabled:opacity-60 ${
                      tournamentNotifPref === value
                        ? 'border-[var(--color-primary)] bg-[var(--color-slate-50)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-base)] hover:border-[var(--color-gray-400)]'
                    }`}
                  >
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />

            {/* Flash alerts */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Flash tournament alerts</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Get a 2-minute heads-up when a flash tournament you've registered for is about to start.
                </div>
              </div>
              <button
                disabled={savingFlashAlerts || flashStartAlerts === null}
                onClick={async () => {
                  const next = !flashStartAlerts
                  setSavingFlashAlerts(true)
                  try {
                    const token = await getToken()
                    await api.users.patchPreferences({ flashStartAlerts: next }, token)
                    setFlashStartAlerts(next)
                  } finally {
                    setSavingFlashAlerts(false)
                  }
                }}
                className={`relative w-12 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                  flashStartAlerts ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-gray-300)]'
                }`}
                aria-label={flashStartAlerts ? 'Disable flash alerts' : 'Enable flash alerts'}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${flashStartAlerts ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
