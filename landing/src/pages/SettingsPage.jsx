// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'
import { useNotifSoundStore, NOTIF_SOUND_TYPES } from '../store/notifSoundStore.js'
import { changePassword } from '../lib/auth-client.js'
import {
  isPushSupported,
  currentPermission,
  subscribePush,
  unsubscribePush,
  hasActiveSubscription,
} from '../lib/pushSubscribe.js'

// ── Guide notification toggle groups ─────────────────────────────────────────
// Each group maps to one or more event types on the backend.
// systemCritical events are never shown here — they can't be disabled.
const NOTIF_GROUPS = [
  {
    key:    'new_tournaments',
    label:  'New tournament announcements',
    desc:   'Alert me when new tournaments open for registration.',
    types:  ['tournament.published', 'tournament.flash_announced'],
  },
  {
    key:    'my_tournament_updates',
    label:  'My tournament reminders',
    desc:   'Remind me before my tournaments start and notify me when they begin.',
    types:  ['tournament.registration_closing', 'tournament.starting_soon', 'tournament.started'],
  },
  {
    key:    'my_tournament_results',
    label:  'My tournament results',
    desc:   'Notify me when my tournaments finish or are cancelled.',
    types:  ['tournament.completed', 'tournament.cancelled', 'match.result'],
  },
  {
    key:    'achievements',
    label:  'Achievements',
    desc:   'Notify me when I reach a new tier or milestone.',
    types:  ['achievement.tier_upgrade', 'achievement.milestone'],
  },
]

function Toggle({ on, disabled, onChange, label }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-label={label}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-gray-300)]'}`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

export default function SettingsPage() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null

  const { enabled: notifSoundEnabled, type: notifSoundType, setEnabled: setNotifSoundEnabled, setType: setNotifSoundType, play: previewSound } = useNotifSoundStore()

  const [tournamentNotifPref, setTournamentNotifPref] = useState(null)
  const [savingNotifPref, setSavingNotifPref]         = useState(false)
  const [flashStartAlerts, setFlashStartAlerts]       = useState(null)
  const [savingFlashAlerts, setSavingFlashAlerts]     = useState(false)

  // Guide notification preferences: { eventType → { inApp: bool } }
  const [notifPrefs, setNotifPrefs]       = useState(null)   // null = loading
  const [savingPrefs, setSavingPrefs]     = useState({})     // { groupKey → bool }
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState(null) // { ok: bool, text: string }

  // Push notifications (Tier 3). Subscription status is per-browser; push
  // event opt-ins are per-event-type and stored on NotificationPreference.
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushPermission, setPushPermission] = useState('default')
  const [pushBusy, setPushBusy]             = useState(false)
  const [pushMsg, setPushMsg]               = useState(null) // { ok, text }

  useEffect(() => {
    if (!user) return
    setPushPermission(currentPermission())
    hasActiveSubscription().then(setPushSubscribed).catch(() => setPushSubscribed(false))
  }, [user?.id])

  async function handleTogglePush(next) {
    setPushBusy(true); setPushMsg(null)
    try {
      if (next) {
        const res = await subscribePush()
        if (res.ok) {
          setPushSubscribed(true)
          setPushPermission(currentPermission())
        } else {
          const reasonMsg = {
            unsupported: 'Push notifications are not supported in this browser.',
            denied:      'Notification permission was denied. Enable it in your browser settings.',
            'no-vapid':  'Push is not configured on the server.',
            'sw-failed': 'Service worker could not be registered.',
            network:     'Could not reach the server. Try again.',
          }[res.reason] ?? 'Could not enable push.'
          setPushMsg({ ok: false, text: reasonMsg })
          setPushPermission(currentPermission())
        }
      } else {
        await unsubscribePush()
        setPushSubscribed(false)
      }
    } finally {
      setPushBusy(false)
    }
  }

  async function togglePushPref(eventType, value) {
    const token = await getToken()
    try {
      await api.users.putNotifPref(eventType, { push: value }, token)
      setNotifPrefs(prev => ({ ...prev, [eventType]: { ...(prev?.[eventType] ?? {}), push: value } }))
    } catch {
      // refetch on error
      getToken().then(t => api.users.getNotifPrefs(t)).then(rows => {
        const map = {}
        for (const r of rows) map[r.eventType] = r
        setNotifPrefs(map)
      }).catch(() => {})
    }
  }

  const PUSH_EVENT_TYPES = [
    { key: 'match.ready',             label: 'Match ready',          desc: 'Your tournament match is about to start.' },
    { key: 'tournament.starting_soon', label: 'Tournament reminders', desc: 'Before your tournaments begin.' },
    { key: 'tournament.started',      label: 'Tournament started',   desc: 'A tournament you joined has started.' },
    { key: 'tournament.cancelled',    label: 'Tournament cancelled', desc: 'A tournament you joined was cancelled.' },
    { key: 'achievement.tier_upgrade', label: 'Tier upgrades',       desc: 'When your rank goes up.' },
  ]

  useEffect(() => {
    if (!user) return
    getToken().then(token => api.users.getPreferences(token)).then(data => {
      setTournamentNotifPref(data.tournamentResultNotifPref ?? 'AS_PLAYED')
      setFlashStartAlerts(data.flashStartAlerts !== false)
    }).catch(() => {})
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    getToken()
      .then(token => api.users.getNotifPrefs(token))
      .then(rows => {
        const map = {}
        for (const r of rows) map[r.eventType] = r
        setNotifPrefs(map)
      })
      .catch(() => setNotifPrefs({}))
  }, [user?.id])

  // A group is "on" if ANY of its types has inApp === true (or defaults true)
  function groupIsOn(group) {
    if (!notifPrefs) return true
    return group.types.some(t => notifPrefs[t]?.inApp !== false)
  }

  async function toggleGroup(group, value) {
    setSavingPrefs(p => ({ ...p, [group.key]: true }))
    const token = await getToken()
    try {
      await Promise.all(
        group.types.map(eventType =>
          api.users.putNotifPref(eventType, { inApp: value }, token)
        )
      )
      setNotifPrefs(prev => {
        const next = { ...prev }
        for (const t of group.types) next[t] = { ...(next[t] ?? {}), inApp: value }
        return next
      })
    } catch {
      // revert on error — just refetch
      getToken().then(t => api.users.getNotifPrefs(t)).then(rows => {
        const map = {}
        for (const r of rows) map[r.eventType] = r
        setNotifPrefs(map)
      }).catch(() => {})
    } finally {
      setSavingPrefs(p => ({ ...p, [group.key]: false }))
    }
  }

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

      {/* Notification sounds — client-side preference, always shown when signed in */}
      {user && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Notifications
          </h2>
          <div
            className="rounded-xl border p-5 space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            {/* Sound on/off toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Notification sound</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Play a sound when a new guide message arrives.
                </div>
              </div>
              <button
                onClick={() => setNotifSoundEnabled(!notifSoundEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
                  notifSoundEnabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-gray-300)]'
                }`}
                aria-label={notifSoundEnabled ? 'Disable notification sound' : 'Enable notification sound'}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${notifSoundEnabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Sound type picker */}
            {notifSoundEnabled && (
              <>
                <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />
                <div>
                  <div className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Sound type</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    {NOTIF_SOUND_TYPES.map(({ id, label, description }) => (
                      <button
                        key={id}
                        onClick={() => { setNotifSoundType(id); previewSound() }}
                        className={`flex-1 text-left p-3 rounded-xl border-2 transition-all active:scale-[0.98] ${
                          notifSoundType === id
                            ? 'border-[var(--color-primary)] bg-[var(--color-slate-50)]'
                            : 'border-[var(--border-default)] bg-[var(--bg-base)] hover:border-[var(--color-gray-400)]'
                        }`}
                      >
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{description}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Clicking a sound type plays a preview.</p>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Push notifications — Tier 3. Subscription is per-browser; toggles for
          specific event types are per-account and stored on the server. */}
      {user && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Push notifications
          </h2>
          <div
            className="rounded-xl border p-5 space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            {!isPushSupported() ? (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Push notifications are not supported in this browser.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="pr-3">
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      Enable push on this device
                    </div>
                    <div className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      Get notified even when this tab isn't open.
                      {pushPermission === 'denied' && (
                        <> You'll need to allow notifications in your browser settings first.</>
                      )}
                    </div>
                  </div>
                  <Toggle
                    on={pushSubscribed}
                    disabled={pushBusy || pushPermission === 'denied'}
                    onChange={handleTogglePush}
                    label={pushSubscribed ? 'Disable push on this device' : 'Enable push on this device'}
                  />
                </div>

                {pushMsg && (
                  <div
                    className="text-xs rounded-lg px-3 py-2"
                    style={{
                      backgroundColor: pushMsg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(220,38,38,0.08)',
                      color: pushMsg.ok ? 'var(--color-green-700)' : 'var(--color-red-700)',
                    }}
                  >
                    {pushMsg.text}
                  </div>
                )}

                {pushSubscribed && notifPrefs !== null && (
                  <>
                    <div className="h-px" style={{ backgroundColor: 'var(--border-default)' }} />
                    <div className="space-y-3">
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        What to send
                      </div>
                      {PUSH_EVENT_TYPES.map(({ key, label, desc }) => {
                        const on = notifPrefs[key]?.push === true
                        return (
                          <div key={key} className="flex items-center justify-between">
                            <div className="pr-3">
                              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</div>
                              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</div>
                            </div>
                            <Toggle
                              on={on}
                              onChange={(v) => togglePushPref(key, v)}
                              label={`${on ? 'Disable' : 'Enable'} ${label} push`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}

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

      {/* Change Password */}
      {user && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Security</h2>
          <div
            className="rounded-xl border p-5 space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Change password</div>
            <div className="space-y-3">
              {['current', 'next', 'confirm'].map((field, i) => (
                <input
                  key={field}
                  type="password"
                  placeholder={['Current password', 'New password', 'Confirm new password'][i]}
                  value={pwForm[field]}
                  onChange={e => { setPwForm(f => ({ ...f, [field]: e.target.value })); setPwMsg(null) }}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  disabled={pwSaving}
                />
              ))}
            </div>
            {pwMsg && (
              <p className="text-sm" style={{ color: pwMsg.ok ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}>
                {pwMsg.text}
              </p>
            )}
            <button
              disabled={pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm}
              onClick={async () => {
                if (pwForm.next !== pwForm.confirm) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return }
                if (pwForm.next.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters.' }); return }
                setPwSaving(true); setPwMsg(null)
                try {
                  const result = await changePassword({ currentPassword: pwForm.current, newPassword: pwForm.next, revokeOtherSessions: false })
                  if (result?.error) { setPwMsg({ ok: false, text: result.error.message ?? 'Password change failed.' }) }
                  else { setPwMsg({ ok: true, text: 'Password updated.' }); setPwForm({ current: '', next: '', confirm: '' }) }
                } catch (err) {
                  setPwMsg({ ok: false, text: err?.message ?? 'Password change failed.' })
                } finally { setPwSaving(false) }
              }}
              className="w-full py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}
            >
              {pwSaving ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </section>
      )}

      {/* Guide notification preferences */}
      {user && notifPrefs !== null && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Guide Notifications
          </h2>
          <div
            className="rounded-xl border divide-y"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            {NOTIF_GROUPS.map((group, i) => (
              <div key={group.key} className={`flex items-center justify-between gap-4 p-4 ${i === 0 ? 'rounded-t-xl' : ''} ${i === NOTIF_GROUPS.length - 1 ? 'rounded-b-xl' : ''}`}>
                <div className="min-w-0">
                  <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{group.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{group.desc}</div>
                </div>
                <Toggle
                  on={groupIsOn(group)}
                  disabled={!!savingPrefs[group.key]}
                  onChange={val => toggleGroup(group, val)}
                  label={`${groupIsOn(group) ? 'Disable' : 'Enable'} ${group.label}`}
                />
              </div>
            ))}
            <div className="px-4 py-3 rounded-b-xl" style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Match ready alerts and system messages are always on and cannot be disabled.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
