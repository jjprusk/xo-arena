// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * BotFilterBar — controlled filter inputs for the bot directory + picker.
 *
 * Owns no state. Caller supplies `value` (current filter snapshot) and
 * `onChange(nextFilters)`. URL-param sync is the consumer's job — that
 * way the same bar can be used inside a modal that doesn't need URL
 * state, or on a full page that does.
 *
 * Filter shape mirrors `useBots()`:
 *   { gameId?, eloMin?, eloMax?, owner?: 'mine' | 'community' | 'all', search? }
 *
 * `showOwnerToggle` defaults to true; pass false on surfaces where the
 * owner scope is fixed (e.g. "Add to my tournament" — always 'all').
 */
import React from 'react'

const OWNER_TABS = [
  { key: 'mine',      label: 'My bots'   },
  { key: 'community', label: 'Community' },
  { key: 'all',       label: 'All bots'  },
]

export default function BotFilterBar({
  value = {},
  onChange,
  showOwnerToggle = true,
  // Hide the "My bots" tab when the caller is a guest (rendered as 0
  // results otherwise). Defaults true; pass false when no signed-in user.
  ownerToggleAllowsMine = true,
}) {
  const update = (patch) => onChange?.({ ...value, ...patch })

  const tabs = ownerToggleAllowsMine
    ? OWNER_TABS
    : OWNER_TABS.filter(t => t.key !== 'mine')

  const activeOwner = value.owner ?? 'all'
  const eloMin = value.eloMin ?? ''
  const eloMax = value.eloMax ?? ''

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      data-testid="bot-filter-bar"
    >
      {showOwnerToggle && (
        <div className="inline-flex rounded-lg border overflow-hidden self-start" style={{ borderColor: 'var(--border-default)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => update({ owner: t.key })}
              className="px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                backgroundColor: activeOwner === t.key ? 'var(--color-slate-100)' : 'transparent',
                color:           activeOwner === t.key ? 'var(--text-primary)'   : 'var(--text-muted)',
              }}
              data-active={activeOwner === t.key ? 'true' : 'false'}
              data-testid={`bot-filter-owner-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Search by name
          </span>
          <input
            type="text"
            value={value.search ?? ''}
            onChange={e => update({ search: e.target.value })}
            placeholder="e.g. Sterling"
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            data-testid="bot-filter-search"
          />
        </label>

        <label className="flex flex-col gap-1 w-24">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            ELO min
          </span>
          <input
            type="number"
            value={eloMin}
            onChange={e => {
              const v = e.target.value
              update({ eloMin: v === '' ? undefined : Number(v) })
            }}
            min="0"
            placeholder="—"
            className="px-2 py-2 rounded-lg border text-sm tabular-nums"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            data-testid="bot-filter-elo-min"
          />
        </label>
        <label className="flex flex-col gap-1 w-24">
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            ELO max
          </span>
          <input
            type="number"
            value={eloMax}
            onChange={e => {
              const v = e.target.value
              update({ eloMax: v === '' ? undefined : Number(v) })
            }}
            min="0"
            placeholder="—"
            className="px-2 py-2 rounded-lg border text-sm tabular-nums"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            data-testid="bot-filter-elo-max"
          />
        </label>

        <button
          type="button"
          onClick={() => onChange?.({})}
          className="px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          data-testid="bot-filter-reset"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
