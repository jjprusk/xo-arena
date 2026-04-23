// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 3.7a.1 — admin view of recurring-tournament templates.
 *
 * Separate page from AdminTournamentsPage so the refactored
 * config-vs-runtime split has a dedicated surface. Shows each template
 * with its recurrence config, subscriber count, next-occurrence preview,
 * and pause/unpause action. Editing config still routes through the
 * existing tournament edit modal (dual-write keeps the Tournament +
 * TournamentTemplate rows in sync).
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getToken } from '../../lib/getToken.js'
import { tournamentApi } from '../../lib/tournamentApi.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'

function Spinner() {
  return <div className="w-6 h-6 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
}

function PausedBadge({ paused }) {
  if (paused) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>
        PAUSED
      </span>
    )
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: 'var(--color-teal-100)', color: 'var(--color-teal-700)' }}>
      ACTIVE
    </span>
  )
}

function formatRecurrence(template) {
  const parts = []
  parts.push(template.recurrenceInterval)
  if (template.recurrenceEndDate) {
    parts.push(`ends ${new Date(template.recurrenceEndDate).toLocaleDateString()}`)
  }
  return parts.join(' · ')
}

function formatDateTime(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return String(d) }
}

export default function AdminTemplatesPage() {
  const { data: session } = useOptimisticSession()
  const [token, setToken]         = useState(null)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busyId, setBusyId]       = useState(null)
  const isAdmin = session?.user?.role === 'admin'

  useEffect(() => {
    getToken().then(setToken).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const { templates: rows } = await tournamentApi.listTemplates(token)
      setTemplates(rows ?? [])
    } catch (err) {
      setError(err.message || 'Failed to load templates.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { if (token) load() }, [token, load])

  async function togglePause(template) {
    setBusyId(template.id); setActionError(null)
    try {
      if (template.paused) {
        await tournamentApi.unpauseTemplate(template.id, token)
      } else {
        await tournamentApi.pauseTemplate(template.id, token)
      }
      await load()
    } catch (err) {
      setActionError(err.message || 'Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Admin access required.</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            Admin
          </p>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Recurring Templates
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Recurring-tournament configurations. Each template spawns Tournament occurrences on its schedule.
          </p>
        </div>
        <Link
          to="/admin/tournaments"
          className="text-sm font-semibold underline underline-offset-2"
          style={{ color: 'var(--color-blue-600)' }}
        >
          ← Tournaments
        </Link>
      </div>

      {actionError && (
        <div className="mb-4 p-3 rounded-lg border"
          style={{ backgroundColor: 'var(--color-red-50)', borderColor: 'var(--color-red-200)', color: 'var(--color-red-700)' }}>
          <p className="text-sm">{actionError}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <div className="p-4 rounded-lg border text-center"
          style={{ backgroundColor: 'var(--color-red-50)', borderColor: 'var(--color-red-200)', color: 'var(--color-red-700)' }}>
          <p className="text-sm">{error}</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="p-8 rounded-lg border text-center"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No recurring templates yet. Create one via the Tournaments admin page.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Name</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Game</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Recurrence</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Subscribers</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Seed bots</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Last occurrence</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Status</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border-default)' }}>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t.name}
                    {t.isTest && (
                      <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                        TEST
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{t.game}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{formatRecurrence(t)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{t.subscriberCount}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{t.seedBotCount}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.lastOccurrence
                      ? `${t.lastOccurrence.status} · ${formatDateTime(t.lastOccurrence.startTime)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3"><PausedBadge paused={t.paused} /></td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => togglePause(t)}
                      disabled={busyId === t.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded border transition-colors disabled:opacity-50"
                      style={{
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                        backgroundColor: 'var(--bg-base)',
                      }}>
                      {busyId === t.id ? '…' : t.paused ? 'Unpause' : 'Pause'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
