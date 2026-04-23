// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * ActionMenu — the "⋯" kebab dropdown used for per-row actions in
 * admin lists. Extracted from AdminTournamentsPage so other admin
 * surfaces (AdminTemplatesPage, future pages) share one implementation.
 *
 * Props:
 *   trigger  ReactElement — the visible click target (e.g. a "⋯" button).
 *                           Cloned internally to intercept onClick.
 *   items    Array<{ label, onSelect?, href?, state?, disabled?,
 *                    tone? ('default'|'danger'|'warn'), hint? }>
 *            Falsy entries are skipped — lets callers do conditional
 *            items with `condition && { label, onSelect }`.
 *   align    'left' | 'right' — side of the trigger the menu opens on.
 *
 * Closes on outside click, Escape, and after selecting an item.
 */
import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

export function ActionMenu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = items.filter(Boolean)
  const toneColor = {
    default: 'var(--text-primary)',
    danger:  'var(--color-red-600)',
    warn:    'var(--color-amber-700)',
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      {React.cloneElement(trigger, {
        onClick: (e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(o => !o)
          trigger.props.onClick?.(e)
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      })}
      {open && visible.length > 0 && (
        <div
          role="menu"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 min-w-[11rem] rounded-lg border py-1 z-30 shadow-lg`}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        >
          {visible.map((item, idx) => {
            const color = toneColor[item.tone ?? 'default']
            const disabled = !!item.disabled
            const base = 'w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'
            if (item.href && !disabled) {
              return (
                <Link
                  key={idx}
                  to={item.href}
                  state={item.state}
                  role="menuitem"
                  className={base + ' no-underline'}
                  style={{ color }}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              )
            }
            return (
              <button
                key={idx}
                role="menuitem"
                type="button"
                disabled={disabled}
                onClick={() => { setOpen(false); item.onSelect?.() }}
                className={base}
                style={{ color }}
                title={item.hint}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The standard "⋯" kebab button used as an ActionMenu trigger. Matches
 * the visual used in AdminTournamentsPage: bordered square with a
 * three-dot glyph.
 */
export function ActionMenuTrigger({ 'aria-label': ariaLabel = 'Actions' } = {}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="inline-flex items-center justify-center w-8 h-8 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
    >
      <span className="text-lg leading-none">⋯</span>
    </button>
  )
}
