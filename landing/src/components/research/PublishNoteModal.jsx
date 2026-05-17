// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Confirmation modal for publishing a Research-Log note or entry to the
 * community lane (`HelpDoc.source = 'community-note'`).
 *
 * Shows a side-by-side diff: original vs. server-scrubbed body. The scrub
 * preview is computed client-side via lib/research/pii.js, which mirrors
 * the backend regex set (server is the source of truth at publish time).
 *
 * Sprint 2 of doc/Research_Log_Plan.md §2.3 step 4 / §3 step 10.
 */

import React, { useMemo, useState } from 'react'
import { scrubForPublishPreview } from '../../lib/research/pii.js'

const KIND_LABEL = {
  email:   'Email',
  phone:   'Phone',
  ipv4:    'IPv4',
  ipv6:    'IPv6',
  card:    'Credit card',
  address: 'Address',
}

export default function PublishNoteModal({ kind, item, onCancel, onConfirm, busy = false, error = null }) {
  const [confirmed, setConfirmed] = useState(false)

  const { scrubbed, matches } = useMemo(() => {
    return scrubForPublishPreview(item?.body ?? '')
  }, [item?.body])

  const titleScrub = useMemo(() => {
    if (kind !== 'entry' || !item?.title) return { scrubbed: '', matches: [] }
    return scrubForPublishPreview(item.title)
  }, [kind, item?.title])

  const totalMatches = matches.length + titleScrub.matches.length

  // Count by kind so the chip row is stable.
  const counts = {}
  for (const m of [...matches, ...titleScrub.matches]) {
    counts[m.kind] = (counts[m.kind] ?? 0) + 1
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'entry' ? 'Publish entry' : 'Publish note'}
      style={{
        position: 'fixed', inset: 0, zIndex: 1400,
        background: 'rgba(8,12,22,0.78)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel?.() }}
    >
      <div
        className="rounded-2xl border w-full max-w-3xl"
        style={{
          backgroundColor: '#0f1626',
          borderColor:     'rgba(99,102,241,0.45)',
          boxShadow:       '0 24px 80px rgba(0,0,0,0.55)',
          color:           'white',
        }}
      >
        <div className="px-6 pt-5 pb-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
          <h2 className="text-lg font-semibold">
            Publish {kind === 'entry' ? 'entry' : 'note'} to the community
          </h2>
          <p className="text-sm opacity-75 mt-1">
            Once published, anyone using AI Arena can read and reference this content. We&apos;ll
            redact the items below before saving. Personal names are NOT auto-detected — please
            review the preview yourself.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {kind === 'entry' && item?.title ? (
            <div>
              <div className="text-xs opacity-60 uppercase tracking-wide mb-1">Title</div>
              <div className="font-medium">{titleScrub.scrubbed || item.title}</div>
            </div>
          ) : null}

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs opacity-60 uppercase tracking-wide mb-1">Original</div>
              <pre
                className="text-sm whitespace-pre-wrap break-words rounded p-3 max-h-64 overflow-auto"
                style={{ background: 'rgba(0,0,0,0.35)' }}
              >{item?.body ?? ''}</pre>
            </div>
            <div>
              <div className="text-xs opacity-60 uppercase tracking-wide mb-1">
                What we&apos;ll publish
              </div>
              <pre
                className="text-sm whitespace-pre-wrap break-words rounded p-3 max-h-64 overflow-auto"
                style={{ background: 'rgba(99,102,241,0.10)' }}
              >{scrubbed}</pre>
            </div>
          </div>

          <div className="text-xs">
            {totalMatches === 0 ? (
              <span className="opacity-75">No automatic redactions detected.</span>
            ) : (
              <span>
                <span className="font-medium">Will redact:</span>{' '}
                {Object.entries(counts).map(([k, n], i) => (
                  <span key={k} className="inline-block ml-1 px-2 py-0.5 rounded"
                        style={{ background: 'rgba(245,158,11,0.18)', color: '#fcd34d' }}>
                    {KIND_LABEL[k] || k} × {n}
                  </span>
                ))}
              </span>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
            />
            <span>
              I&apos;ve reviewed the preview. There are no personal names, account handles, or
              other sensitive details I need to remove first.
            </span>
          </label>

          {error ? (
            <div className="text-sm" style={{ color: '#fca5a5' }}>{error}</div>
          ) : null}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2"
             style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed || busy}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{
              background: confirmed && !busy ? 'rgb(99,102,241)' : 'rgba(99,102,241,0.30)',
              color: 'white',
              cursor: confirmed && !busy ? 'pointer' : 'not-allowed',
            }}
          >{busy ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </div>
  )
}
