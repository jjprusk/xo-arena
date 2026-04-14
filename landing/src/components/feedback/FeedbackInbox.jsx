// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getToken } from '../../lib/getToken.js'

const BASE = import.meta.env.VITE_API_URL ?? ''

const LIMIT = 20

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

function truncate(str, n = 100) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + '…' : str
}

const CATEGORY_COLORS = {
  BUG:        { bg: 'var(--color-red-50)',    text: 'var(--color-red-600)',    label: 'Bug' },
  SUGGESTION: { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-600)',   label: 'Suggestion' },
  OTHER:      { bg: 'var(--color-gray-100)',  text: 'var(--text-muted)',       label: 'Other' },
}

const STATUS_COLORS = {
  OPEN:        { bg: 'var(--color-amber-50)',  text: 'var(--color-amber-700)', label: 'Open' },
  IN_PROGRESS: { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-600)',  label: 'In Progress' },
  RESOLVED:    { bg: 'var(--color-teal-50)',   text: 'var(--color-teal-700)',  label: 'Resolved' },
  WONT_FIX:    { bg: 'var(--color-gray-100)',  text: 'var(--text-muted)',      label: "Won't Fix" },
}

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX']
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'status', label: 'Status' },
  { value: 'category', label: 'Category' },
]
const FILTER_OPTIONS = [
  { value: 'OPEN',        label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED',    label: 'Resolved' },
  { value: 'WONT_FIX',   label: "Won't Fix" },
  { value: 'all',         label: 'All' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBadge({ category }) {
  const c = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.OTHER
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-px rounded-full leading-none shrink-0"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  )
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.OPEN
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-px rounded-full leading-none shrink-0"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  )
}

// ── Screenshot preview + lightbox ────────────────────────────────────────────

function ScreenshotPreview({ src }) {
  const [lightbox, setLightbox] = useState(false)
  return (
    <>
      <div>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Screenshot</p>
        <img
          src={src}
          alt="Screenshot thumbnail"
          onClick={() => setLightbox(true)}
          className="cursor-pointer max-h-32 rounded border object-contain"
          style={{ borderColor: 'var(--border-default)' }}
          data-testid="screenshot-thumbnail"
        />
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(false)}
          data-testid="screenshot-lightbox"
        >
          <img
            src={src}
            alt="Screenshot full size"
            className="max-w-full max-h-full rounded object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(false)}
            aria-label="Close screenshot"
            className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}

// ── Reply form ────────────────────────────────────────────────────────────────

function ReplyForm({ item, apiBase, onUpdate }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError(null)
    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}${apiBase}/${item.id}/reply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text.trim() }),
      })
      if (!res.ok) throw new Error('Failed to send reply')
      const data = await res.json()
      setText('')
      onUpdate({ ...item, replies: data.replies })
    } catch {
      setError('Failed to send reply.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2" data-testid="reply-form">
      <textarea
        value={text}
        onChange={e => setText(e.target.value.slice(0, 1000))}
        placeholder="Write a reply…"
        rows={2}
        className="w-full px-2 py-1.5 rounded border text-xs focus:outline-none resize-none"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
        data-testid="reply-textarea"
      />
      {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
      <button
        type="submit"
        disabled={sending || !text.trim()}
        className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
      >
        {sending ? 'Sending…' : 'Send reply'}
      </button>
    </form>
  )
}

// ── Expanded row ──────────────────────────────────────────────────────────────

function ExpandedRow({ item, apiBase, onUpdate, onDelete }) {
  const [status, setStatus] = useState(item.status)
  const [note, setNote] = useState(item.resolutionNote ?? '')
  const [saving, setSaving] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const prevStatus = useRef(item.status)

  async function patchItem(body) {
    setSaving(true)
    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}${apiBase}/${item.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      onUpdate(data.feedback ?? data)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus) {
    setStatus(newStatus)
    prevStatus.current = newStatus
    await patchItem({ status: newStatus })
  }

  async function handleNoteBlur() {
    if (note === (item.resolutionNote ?? '')) return
    setSavingNote(true)
    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}${apiBase}/${item.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ resolutionNote: note }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      onUpdate(data.feedback ?? data)
    } catch { /* non-fatal */ } finally {
      setSavingNote(false)
    }
  }

  async function handleMarkRead() {
    await patchItem({ markRead: true })
  }

  async function handleArchive() {
    await patchItem({ archived: true })
  }

  async function handleDelete() {
    if (!confirm('Delete this feedback item? This cannot be undone.')) return
    setSaving(true)
    try {
      const token = await getToken()
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}${apiBase}/${item.id}`, { method: 'DELETE', headers })
      if (!res.ok) throw new Error('Failed')
      onDelete(item.id)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  const showNote = status === 'RESOLVED' || status === 'WONT_FIX'

  return (
    <div
      className="px-4 pb-4 pt-2 space-y-3 border-t"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
    >
      <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
        {item.message}
      </p>

      {item.pageUrl && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Page:{' '}
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline break-all"
            style={{ color: 'var(--color-blue-600)' }}
          >
            {item.pageUrl}
          </a>
        </div>
      )}

      {item.screenshotData && (
        <ScreenshotPreview src={item.screenshotData} />
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Status:</label>
        <select
          value={status}
          onChange={e => handleStatusChange(e.target.value)}
          disabled={saving}
          className="text-xs px-2 py-1 rounded border focus:outline-none disabled:opacity-60"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{STATUS_COLORS[s]?.label ?? s}</option>
          ))}
        </select>
        {saving && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Saving…</span>}
      </div>

      {showNote && (
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            Resolution note
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={handleNoteBlur}
            rows={2}
            placeholder="Add a resolution note…"
            className="w-full px-2 py-1.5 rounded border text-xs focus:outline-none resize-none"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          {savingNote && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Saving…</span>}
        </div>
      )}

      <div className="space-y-2" data-testid="reply-thread">
        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {item.replies?.length > 0
            ? `Replies (${item.replies.length})`
            : 'Replies'}
        </p>
        {item.replies?.length > 0 && (
          <div className="space-y-2">
            {item.replies.map(reply => (
              <div
                key={reply.id}
                className="rounded-lg px-3 py-2 text-xs space-y-1 border"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
                data-testid="reply-item"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {reply.adminName ?? 'Staff'}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{timeAgo(reply.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                  {reply.message}
                </p>
              </div>
            ))}
          </div>
        )}
        <ReplyForm item={item} apiBase={apiBase} onUpdate={onUpdate} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!item.readAt && (
          <button
            onClick={handleMarkRead}
            disabled={saving}
            className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Mark read
          </button>
        )}
        {!item.archived && (
          <button
            onClick={handleArchive}
            disabled={saving}
            className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Archive
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={saving}
          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
          style={{ borderColor: 'var(--color-red-300)', color: 'var(--color-red-600)' }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FeedbackInbox({ apiBase = '/api/v1/admin/feedback', apps = [] }) {
  const [tab, setTab] = useState('inbox') // 'inbox' | 'archive'
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [sort, setSort] = useState('newest')
  const [filter, setFilter] = useState('OPEN')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedApp, setSelectedApp] = useState(null)
  const [appCounts, setAppCounts] = useState({})

  const [selected, setSelected] = useState(new Set())
  const [expanded, setExpanded] = useState(null)
  const [bulkLoading, setBulkLoading] = useState(false)

  const totalPages = Math.ceil(total / LIMIT)
  const archived = tab === 'archive'

  useEffect(() => {
    if (!apps.length) return
    async function fetchAppCounts() {
      try {
        const token = await getToken()
        const headers = {}
        if (token) headers['Authorization'] = `Bearer ${token}`
        const res = await fetch(`${BASE}${apiBase}/unread-count?groupByApp=true`, { headers })
        if (!res.ok) return
        const data = await res.json()
        setAppCounts(data.counts ?? {})
      } catch { /* non-fatal */ }
    }
    fetchAppCounts()
  }, [apiBase, apps.length])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelected(new Set())
    setExpanded(null)
    try {
      const token = await getToken()
      const p = new URLSearchParams()
      p.set('archived', String(archived))
      p.set('sort', sort)
      p.set('page', String(page))
      p.set('limit', String(LIMIT))
      if (filter !== 'all') p.set('status', filter)
      if (unreadOnly) p.set('unread', 'true')
      if (selectedApp) p.set('appId', selectedApp)
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const res = await fetch(`${BASE}${apiBase}?${p.toString()}`, { headers })
      if (!res.ok) throw new Error('Failed to load feedback.')
      const data = await res.json()
      setItems(data.items ?? data.feedback ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, archived, sort, filter, unreadOnly, selectedApp, page])

  useEffect(() => { setPage(1) }, [tab, sort, filter, unreadOnly, selectedApp])
  useEffect(() => { load() }, [load])

  function handleUpdate(updated) {
    setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
  }

  function handleDelete(id) {
    setItems(prev => prev.filter(i => i.id !== id))
    setTotal(t => t - 1)
    if (expanded === id) setExpanded(null)
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map(i => i.id)))
    }
  }

  async function bulkAction(action) {
    if (selected.size === 0) return
    setBulkLoading(true)
    try {
      const token = await getToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      await fetch(`${BASE}${apiBase}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: [...selected], action }),
      })
      await load()
    } catch { /* non-fatal */ } finally {
      setBulkLoading(false)
      setSelected(new Set())
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {['inbox', 'archive'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors"
            style={{
              borderColor: tab === t ? 'var(--color-blue-500)' : 'var(--border-default)',
              backgroundColor: tab === t ? 'var(--color-blue-50)' : 'transparent',
              color: tab === t ? 'var(--color-blue-600)' : 'var(--text-muted)',
            }}
          >
            {t === 'inbox' ? 'Inbox' : 'Archive'}
          </button>
        ))}
      </div>

      {apps.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="app-selector">
          <button
            onClick={() => setSelectedApp(null)}
            className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
            data-testid="app-pill-all"
            style={{
              borderColor: selectedApp === null ? 'var(--color-blue-500)' : 'var(--border-default)',
              backgroundColor: selectedApp === null ? 'var(--color-blue-50)' : 'transparent',
              color: selectedApp === null ? 'var(--color-blue-600)' : 'var(--text-muted)',
            }}
          >
            All
          </button>
          {apps.map(appId => {
            const count = appCounts[appId] ?? 0
            const active = selectedApp === appId
            return (
              <button
                key={appId}
                onClick={() => setSelectedApp(appId)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors"
                data-testid={`app-pill-${appId}`}
                style={{
                  borderColor: active ? 'var(--color-blue-500)' : 'var(--border-default)',
                  backgroundColor: active ? 'var(--color-blue-50)' : 'transparent',
                  color: active ? 'var(--color-blue-600)' : 'var(--text-muted)',
                }}
              >
                {appId}
                {count > 0 && (
                  <span
                    className="min-w-[1.1rem] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                    data-testid={`app-pill-count-${appId}`}
                    style={{ backgroundColor: 'var(--color-red-500)' }}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <div
        className="rounded-xl border p-3 flex flex-wrap items-center gap-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Sort:</label>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="text-xs px-2 py-1 rounded border focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-base)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setFilter(o.value)}
              className="px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors"
              style={{
                borderColor: filter === o.value ? 'var(--color-blue-500)' : 'var(--border-default)',
                backgroundColor: filter === o.value ? 'var(--color-blue-50)' : 'transparent',
                color: filter === o.value ? 'var(--color-blue-600)' : 'var(--text-muted)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={e => setUnreadOnly(e.target.checked)}
            className="rounded"
          />
          Unread only
        </label>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-auto" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={items.length > 0 && selected.size === items.length}
            onChange={toggleSelectAll}
            className="rounded"
          />
          Select all
        </label>
      </div>

      {selected.size > 0 && (
        <div
          className="rounded-xl border px-4 py-2 flex items-center gap-3"
          style={{ backgroundColor: 'var(--color-blue-50)', borderColor: 'var(--color-blue-200)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--color-blue-700)' }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => bulkAction('archive')}
            disabled={bulkLoading}
            className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
          >
            Archive selected
          </button>
          <button
            onClick={() => bulkAction('markRead')}
            disabled={bulkLoading}
            className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
          >
            Mark read
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {items.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>
              No feedback items found.
            </p>
          ) : (
            <div>
              {items.map((item, idx) => {
                const isExpanded = expanded === item.id
                const isUnread = !item.readAt
                return (
                  <div
                    key={item.id}
                    style={{
                      borderBottom: idx < items.length - 1 ? '1px solid var(--border-default)' : 'none',
                      backgroundColor: isExpanded ? 'var(--bg-base)' : 'var(--bg-surface)',
                    }}
                  >
                    <div
                      className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-surface-hover)] relative"
                      onClick={() => setExpanded(isExpanded ? null : item.id)}
                      style={{
                        borderLeft: isUnread ? '3px solid var(--color-blue-500)' : '3px solid transparent',
                      }}
                    >
                      <div
                        className="shrink-0 mt-0.5"
                        onClick={e => { e.stopPropagation(); toggleSelect(item.id) }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded"
                          onClick={e => e.stopPropagation()}
                        />
                      </div>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CategoryBadge category={item.category} />
                          <StatusBadge status={item.status} />
                          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {item.user?.displayName ?? item.user?.name ?? 'Anonymous'}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            · {timeAgo(item.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {truncate(item.message)}
                        </p>
                      </div>

                      <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>

                    {isExpanded && (
                      <ExpandedRow
                        item={item}
                        apiBase={apiBase}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border text-sm transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            ← Prev
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Page {page} of {totalPages} · {total} total
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border text-sm transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
