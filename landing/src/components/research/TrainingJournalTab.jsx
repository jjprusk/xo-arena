// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Training Journal tab body — mounted as a Profile-page accordion section
 * (see ProfilePage.jsx). Surfaces the Sprint-2 Research-Log endpoints in
 * a single tabbed view:
 *
 *   - My notes      → existing TrainingSessionNote rows, with publish/unpublish
 *   - My entries    → ResearchLogEntry CRUD + publish/unpublish
 *   - Community     → published HelpDoc rows (source = 'community-note')
 *
 * Markdown export is a sibling action button — anchors at
 * `/api/v1/research/export.md` with `download="training-journal.md"`.
 *
 * Sprint 2 of doc/Research_Log_Plan.md §3 steps 9–11.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import PublishNoteModal from './PublishNoteModal.jsx'

const ENTRY_CATEGORIES = ['PLANNING', 'RETROSPECTIVE', 'OBSERVATION', 'OTHER']

function fmt(iso) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return String(iso ?? '')
  }
}

function parseTags(raw) {
  return (raw || '').split(',').map(t => t.trim()).filter(Boolean)
}

// ── Subviews ──────────────────────────────────────────────────────────────

function NotesPanel({ openPublish }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const tok = await getToken()
      const r = await api.research.listNotes({ limit: 100 }, tok)
      setNotes(r.notes || [])
    } catch (err) {
      setError(err?.message || 'Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function unpublish(noteId) {
    try {
      const tok = await getToken()
      await api.research.unpublishNote(noteId, tok)
      await refresh()
    } catch (err) {
      setError(err?.message || 'Unpublish failed')
    }
  }

  if (loading) return <div className="text-sm opacity-70">Loading notes…</div>
  if (error)   return <div className="text-sm" style={{ color: '#fca5a5' }}>{error}</div>
  if (notes.length === 0) {
    return (
      <div className="text-sm opacity-70">
        No notes yet. Add notes from the Sessions tab on a training run; they&apos;ll appear here.
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {notes.map(note => (
        <li
          key={note.id}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs opacity-60">{fmt(note.createdAt)} · {note.outcome}</span>
            <div className="flex gap-1">
              {note.sharedWithCommunity ? (
                <button
                  type="button"
                  onClick={() => unpublish(note.id)}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'rgba(245,158,11,0.18)', color: '#fcd34d' }}
                  aria-label="Unpublish note"
                >Unpublish</button>
              ) : (
                <button
                  type="button"
                  onClick={() => openPublish('note', note, refresh)}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'rgba(99,102,241,0.22)', color: '#c7d2fe' }}
                  aria-label="Publish note"
                >Publish…</button>
              )}
            </div>
          </div>
          <div className="whitespace-pre-wrap break-words">{note.body}</div>
          {(note.tags || []).length > 0 ? (
            <div className="mt-1 text-xs opacity-70">tags: {note.tags.join(', ')}</div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function EntryComposer({ onCreated }) {
  const [title, setTitle] = useState('')
  const [body, setBody]   = useState('')
  const [category, setCategory] = useState('OBSERVATION')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.')
      return
    }
    setBusy(true); setError(null)
    try {
      const tok = await getToken()
      const r = await api.research.createEntry({
        title:    title.trim(),
        body:     body.trim(),
        category,
        tags:     parseTags(tags),
      }, tok)
      onCreated?.(r.entry)
      setTitle(''); setBody(''); setTags(''); setCategory('OBSERVATION')
    } catch (err) {
      setError(err?.message || 'Failed to add entry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-lg border px-3 py-3 space-y-2"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder="Entry title"
        className="w-full px-2 py-1 rounded text-sm"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
      />
      <textarea
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you learn / decide / observe?"
        className="w-full px-2 py-1 rounded text-sm"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
      />
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-sm px-2 py-1 rounded"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
          aria-label="Category"
        >
          {ENTRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tags (comma-separated)"
          className="flex-1 min-w-[10rem] px-2 py-1 rounded text-sm"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="text-sm px-3 py-1 rounded font-medium"
          style={{ background: 'rgb(99,102,241)', color: 'white' }}
        >{busy ? 'Saving…' : 'Add entry'}</button>
      </div>
      {error ? <div className="text-xs" style={{ color: '#fca5a5' }}>{error}</div> : null}
    </div>
  )
}

function EntriesPanel({ openPublish }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const tok = await getToken()
      const r = await api.research.listEntries({
        limit: 100,
        ...(categoryFilter ? { category: categoryFilter } : {}),
      }, tok)
      setEntries(r.entries || [])
    } catch (err) {
      setError(err?.message || 'Failed to load entries')
    } finally {
      setLoading(false)
    }
  }, [categoryFilter])

  useEffect(() => { refresh() }, [refresh])

  async function remove(id) {
    if (!window.confirm('Delete this entry?')) return
    try {
      const tok = await getToken()
      await api.research.deleteEntry(id, tok)
      await refresh()
    } catch (err) {
      setError(err?.message || 'Delete failed')
    }
  }

  async function unpublish(id) {
    try {
      const tok = await getToken()
      await api.research.unpublishEntry(id, tok)
      await refresh()
    } catch (err) {
      setError(err?.message || 'Unpublish failed')
    }
  }

  return (
    <div className="space-y-3">
      <EntryComposer onCreated={refresh} />

      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Filter:</label>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-sm px-2 py-1 rounded"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
        >
          <option value="">All categories</option>
          {ENTRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-sm opacity-70">Loading entries…</div>
      ) : error ? (
        <div className="text-sm" style={{ color: '#fca5a5' }}>{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-sm opacity-70">No entries yet.</div>
      ) : (
        <ul className="space-y-2">
          {entries.map(entry => (
            <li
              key={entry.id}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs opacity-60">{fmt(entry.createdAt)} · {entry.category}</span>
                <div className="flex gap-1">
                  {entry.sharedWithCommunity ? (
                    <button
                      type="button"
                      onClick={() => unpublish(entry.id)}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(245,158,11,0.18)', color: '#fcd34d' }}
                    >Unpublish</button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openPublish('entry', entry, refresh)}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(99,102,241,0.22)', color: '#c7d2fe' }}
                    >Publish…</button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(entry.id)}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: 'rgba(255,255,255,0.08)' }}
                  >Delete</button>
                </div>
              </div>
              <div className="font-medium mb-1">{entry.title}</div>
              <div className="whitespace-pre-wrap break-words">{entry.body}</div>
              {(entry.tags || []).length > 0 ? (
                <div className="mt-1 text-xs opacity-70">tags: {entry.tags.join(', ')}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CommunityPanel() {
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tagFilter, setTagFilter] = useState('')

  const refresh = useCallback(async (opts = {}) => {
    setLoading(true); setError(null)
    try {
      const tok = await getToken()
      const r = await api.research.listCommunity({
        limit: 20,
        ...(tagFilter ? { tag: tagFilter } : {}),
        ...(opts.appendFrom
          ? { cursorCreatedAt: opts.appendFrom.createdAt, cursorId: opts.appendFrom.id }
          : {}),
      }, tok)
      if (opts.appendFrom) {
        setItems(prev => [...prev, ...(r.items || [])])
      } else {
        setItems(r.items || [])
      }
      setCursor(r.nextCursor)
    } catch (err) {
      setError(err?.message || 'Failed to load community feed')
    } finally {
      setLoading(false)
    }
  }, [tagFilter])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <label className="opacity-70">Tag:</label>
        <input
          type="text"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="e.g. q-learning"
          className="text-sm px-2 py-1 rounded"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
        />
      </div>

      {loading && items.length === 0 ? (
        <div className="text-sm opacity-70">Loading community feed…</div>
      ) : error ? (
        <div className="text-sm" style={{ color: '#fca5a5' }}>{error}</div>
      ) : items.length === 0 ? (
        <div className="text-sm opacity-70">No community entries yet.</div>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map(item => (
              <li
                key={item.id}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
              >
                <div className="text-xs opacity-60 mb-1">
                  {fmt(item.createdAt)} · {item.category}
                  {item.author?.displayName ? ` · by ${item.author.displayName}` : ' · anonymous'}
                </div>
                <div className="font-medium">{item.title}</div>
                <div className="whitespace-pre-wrap break-words mt-1">{item.body}</div>
                {(item.tags || []).length > 0 ? (
                  <div className="mt-1 text-xs opacity-70">tags: {item.tags.join(', ')}</div>
                ) : null}
              </li>
            ))}
          </ul>
          {cursor ? (
            <button
              type="button"
              onClick={() => refresh({ appendFrom: cursor })}
              className="text-sm px-3 py-1 rounded"
              style={{ background: 'rgba(255,255,255,0.08)' }}
              disabled={loading}
            >{loading ? 'Loading…' : 'Load more'}</button>
          ) : null}
        </>
      )}
    </div>
  )
}

// ── Outer tab ──────────────────────────────────────────────────────────────

export default function TrainingJournalTab() {
  const [tab, setTab] = useState('notes')
  const [publishCtx, setPublishCtx] = useState(null) // { kind, item, onAfter }
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState(null)

  // shareNotesWithGuide preference (Sprint 2 §2.4). Stored as a key inside
  // User.preferences Json — absent === OFF.
  const [shareWithGuide, setShareWithGuide] = useState(false)
  const [shareToggleBusy, setShareToggleBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tok = await getToken()
        const r = await api.research.getPreferences(tok)
        if (!cancelled) setShareWithGuide(!!r.shareNotesWithGuide)
      } catch { /* leave default OFF */ }
    })()
    return () => { cancelled = true }
  }, [])

  async function toggleShareWithGuide() {
    const next = !shareWithGuide
    setShareWithGuide(next) // optimistic
    setShareToggleBusy(true)
    try {
      const tok = await getToken()
      await api.research.patchPreferences({ shareNotesWithGuide: next }, tok)
    } catch {
      setShareWithGuide(!next) // rollback
    } finally {
      setShareToggleBusy(false)
    }
  }

  function openPublish(kind, item, onAfter) {
    setPublishCtx({ kind, item, onAfter })
    setPublishError(null)
  }

  async function confirmPublish() {
    if (!publishCtx) return
    setPublishBusy(true); setPublishError(null)
    try {
      const tok = await getToken()
      if (publishCtx.kind === 'note') {
        await api.research.publishNote(publishCtx.item.id, tok)
      } else {
        await api.research.publishEntry(publishCtx.item.id, tok)
      }
      await publishCtx.onAfter?.()
      setPublishCtx(null)
    } catch (err) {
      let msg = err?.message || 'Publish failed'
      if (err?.status === 503) msg = 'Community publishing is currently disabled.'
      if (err?.status === 429) msg = 'Weekly publish limit reached. Try again later.'
      setPublishError(msg)
    } finally {
      setPublishBusy(false)
    }
  }

  const tabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className="px-3 py-1.5 text-sm rounded-t"
      style={{
        background:   tab === id ? 'var(--bg-elevated)' : 'transparent',
        borderBottom: tab === id ? '2px solid rgb(99,102,241)' : '2px solid transparent',
        color:        tab === id ? 'white' : 'rgba(255,255,255,0.7)',
      }}
      aria-current={tab === id ? 'page' : undefined}
      role="tab"
    >{label}</button>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div role="tablist" className="flex gap-1">
          {tabBtn('notes',     'My notes')}
          {tabBtn('entries',   'My entries')}
          {tabBtn('community', 'Community')}
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs flex items-center gap-1.5 cursor-pointer" title="When ON, your private + community-published notes flow into the Guide's answers.">
            <input
              type="checkbox"
              checked={shareWithGuide}
              onChange={toggleShareWithGuide}
              disabled={shareToggleBusy}
              aria-label="Share notes with Guide"
            />
            <span>Share with Guide</span>
          </label>
          <a
            href={api.research.exportUrl()}
            download="training-journal.md"
            className="text-xs px-2 py-1 rounded"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >Export .md</a>
        </div>
      </div>

      <div role="tabpanel">
        {tab === 'notes'     ? <NotesPanel     openPublish={openPublish} /> : null}
        {tab === 'entries'   ? <EntriesPanel   openPublish={openPublish} /> : null}
        {tab === 'community' ? <CommunityPanel /> : null}
      </div>

      {publishCtx ? (
        <PublishNoteModal
          kind={publishCtx.kind}
          item={publishCtx.item}
          busy={publishBusy}
          error={publishError}
          onCancel={() => { if (!publishBusy) setPublishCtx(null) }}
          onConfirm={confirmPublish}
        />
      ) : null}
    </div>
  )
}
