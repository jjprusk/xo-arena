// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 3.7a.1 — admin view of recurring-tournament templates.
 *
 * Lists each template with recurrence config, subscriber / seed-bot /
 * occurrence counts, last-occurrence peek, pause state, and a row of
 * actions (Pause/Unpause, Edit, View, Seeds, Delete). Edit + View +
 * Seeds all drill into /admin/templates/:id — the detail page handles
 * the heavy-lift UI for each.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getToken } from '../../lib/getToken.js'
import { tournamentApi } from '../../lib/tournamentApi.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { ListTable, ListTh, ListTr, ListTd } from '../../components/ui/ListTable.jsx'
import { ActionMenu, ActionMenuTrigger } from '../../components/ui/ActionMenu.jsx'

function Spinner() {
  return <div className="w-6 h-6 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
}

function StatusBadge({ paused }) {
  const [bg, color, label] = paused
    ? ['var(--color-amber-100)', 'var(--color-amber-700)', 'PAUSED']
    : ['var(--color-teal-100)',  'var(--color-teal-700)',  'ACTIVE']
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  )
}

function formatDateTime(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return String(d) }
}

function DeleteConfirm({ template, onCancel, onConfirm, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={() => !busy && onCancel()}>
      <div className="w-full max-w-md rounded-xl border p-5 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
        onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Delete template "{template.name}"?
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            The template, its subscriber list, and its seed bots will be removed. Any historical occurrences stay but lose their link back to this template.
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Subscribers: {template.subscriberCount} · Seed bots: {template.seedBotCount} · Occurrences: {template.occurrenceCount}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="text-sm px-4 py-2 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-red-600)' }}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminTemplatesPage() {
  const { data: session } = useOptimisticSession()
  const [token, setToken]         = useState(null)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busyId, setBusyId]       = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
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
      if (template.paused) await tournamentApi.unpauseTemplate(template.id, token)
      else                 await tournamentApi.pauseTemplate(template.id, token)
      await load()
    } catch (err) {
      setActionError(err.message || 'Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusyId(confirmDelete.id); setActionError(null)
    try {
      await tournamentApi.deleteTemplate(confirmDelete.id, token)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(err.message || 'Delete failed.')
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
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Admin</p>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Recurring Templates
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Recurring-tournament configurations. Each template spawns Tournament occurrences on its schedule.
          </p>
        </div>
        <Link to="/admin/tournaments"
          className="text-sm font-semibold underline underline-offset-2 shrink-0 mt-2"
          style={{ color: 'var(--color-blue-600)' }}>
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
        <ListTable>
          <thead>
            <tr>
              <ListTh>Name</ListTh>
              <ListTh>Game</ListTh>
              <ListTh>Recurrence</ListTh>
              <ListTh align="right">Subs</ListTh>
              <ListTh align="right">Seeds</ListTh>
              <ListTh>Last occurrence</ListTh>
              <ListTh>Status</ListTh>
              <ListTh align="right">Actions</ListTh>
            </tr>
          </thead>
          <tbody>
            {templates.map((t, i) => (
              <ListTr key={t.id} last={i === templates.length - 1}>
                <ListTd>
                  <div className="flex items-center gap-2">
                    <Link to={`/admin/templates/${t.id}`} className="font-medium no-underline hover:underline"
                      style={{ color: 'var(--text-primary)' }}>
                      {t.name}
                    </Link>
                    {t.isTest && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                        TEST
                      </span>
                    )}
                  </div>
                </ListTd>
                <ListTd><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.game}</span></ListTd>
                <ListTd><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.recurrenceInterval}</span></ListTd>
                <ListTd align="right"><span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{t.subscriberCount}</span></ListTd>
                <ListTd align="right"><span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{t.seedBotCount}</span></ListTd>
                <ListTd>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.lastOccurrence ? `${t.lastOccurrence.status} · ${formatDateTime(t.lastOccurrence.startTime)}` : '—'}
                  </span>
                </ListTd>
                <ListTd><StatusBadge paused={t.paused} /></ListTd>
                <ListTd align="right">
                  <ActionMenu
                    trigger={<ActionMenuTrigger aria-label={`Actions for ${t.name}`} />}
                    items={[
                      { label: t.paused ? 'Unpause' : 'Pause', onSelect: () => togglePause(t), disabled: busyId === t.id },
                      { label: 'View',        href: `/admin/templates/${t.id}` },
                      { label: 'Edit',        href: `/admin/templates/${t.id}?edit=1` },
                      { label: 'Manage seed bots', href: `/admin/templates/${t.id}#seed-bots` },
                      { label: 'Delete',      onSelect: () => setConfirmDelete(t), tone: 'danger', disabled: busyId === t.id },
                    ]}
                  />
                </ListTd>
              </ListTr>
            ))}
          </tbody>
        </ListTable>
      )}

      {confirmDelete && (
        <DeleteConfirm
          template={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={doDelete}
          busy={busyId === confirmDelete.id}
        />
      )}
    </div>
  )
}
