// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Shared date/time pickers for admin surfaces.
 *
 * Why custom instead of `<input type="datetime-local">`:
 *   Safari's datetime-local widget is broken on some macOS versions —
 *   it displays the time with am/pm but writes 24h, which silently
 *   corrupts user input. The two-input pattern below splits the value
 *   into ISO date + 24h time and combines them for the caller.
 *
 * Three exports:
 *   <DateTimePicker value onChange />   — YYYY-MM-DDTHH:mm   (datetime)
 *   <DatePicker     value onChange />   — YYYY-MM-DD          (date-only)
 *   <LocalTZ        value />            — pure read-only string like
 *                                          "(14:00 EDT / 18:00 UTC)"
 *
 * Tournament admin (h) — replaces bare `<input type="date">` and
 * `<input type="datetime-local">` inside admin forms.
 */
import React from 'react'

const FIELD_STYLE = {
  backgroundColor: 'var(--bg-base)',
  borderColor:     'var(--border-default)',
  color:           'var(--text-primary)',
}

const INPUT_CLASS = 'px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-blue-300)] transition-colors'

export function DatePicker({ value = '', onChange, ...rest }) {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={`${INPUT_CLASS} w-full`}
      style={FIELD_STYLE}
      {...rest}
    />
  )
}

export default function DateTimePicker({ value = '', onChange }) {
  const datePart = value ? value.slice(0, 10) : ''
  const timePart = value ? value.slice(11, 16) : ''

  function handleDate(e) {
    const d = e.target.value
    if (!d) { onChange(''); return }
    onChange(`${d}T${timePart || '00:00'}`)
  }
  function handleTime(e) {
    const t = e.target.value
    if (datePart) onChange(`${datePart}T${t || '00:00'}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        type="date"
        value={datePart}
        onChange={handleDate}
        className={`${INPUT_CLASS} flex-1 min-w-[9rem]`}
        style={FIELD_STYLE}
      />
      <input
        type="time"
        value={timePart}
        onChange={handleTime}
        className={`${INPUT_CLASS} w-36 shrink-0`}
        style={FIELD_STYLE}
      />
    </div>
  )
}

/**
 * Read-only hint showing the resolved local-TZ + UTC for a YYYY-MM-DDTHH:mm
 * value. Returns null if value is empty/invalid. Use beneath a
 * DateTimePicker so admins can sanity-check "this is 14:00 in my browser →
 * 18:00 UTC for tournament participants."
 */
export function LocalTZ({ value, className = '' }) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null

  const pad = n => String(n).padStart(2, '0')
  const local = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const utc   = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  // Browser's short TZ name (e.g. EDT, PST) — falls back to numeric offset
  // when the runtime can't resolve a friendly name.
  const tzName =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(d).find(p => p.type === 'timeZoneName')?.value
    ?? 'local'

  return (
    <span
      className={`text-[10px] tabular-nums ${className}`}
      style={{ color: 'var(--text-muted)' }}
    >
      {local} {tzName} / {utc} UTC
    </span>
  )
}
