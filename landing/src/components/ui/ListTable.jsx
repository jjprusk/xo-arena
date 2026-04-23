// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useRef, useEffect, useState } from 'react'

export function UserAvatar({ user, size = 'md' }) {
  const sizeClass = { xs: 'w-5 h-5 text-[9px]', sm: 'w-7 h-7 text-xs', md: 'w-8 h-8 text-xs', lg: 'w-10 h-10 text-sm' }[size] ?? 'w-8 h-8 text-xs'
  return (
    <div className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center overflow-hidden font-bold select-none`}
      style={{ backgroundColor: 'var(--color-blue-50)', border: '1.5px solid var(--color-blue-100)', color: 'var(--color-blue-600)' }}>
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" /> : (user?.displayName?.[0] ?? '?').toUpperCase()}
    </div>
  )
}

export function SearchBar({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)' }}>
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full pl-8 pr-8 py-2 rounded-lg border text-sm focus:outline-none transition-colors"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
      {value && (
        <button type="button" onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ color: 'var(--text-muted)' }} aria-label="Clear search">✕</button>
      )}
    </div>
  )
}

export function ListTable({ children, maxHeight, fitViewport = false, fill = false, bottomPadding = 24, topOffset = 0, className = '', columns }) {
  const outerRef = useRef(null)
  const [dynamicMax, setDynamicMax] = useState(null)

  useEffect(() => {
    if (!fitViewport) return
    let rafId = null
    const update = () => {
      if (!outerRef.current) return
      const rawTop = outerRef.current.getBoundingClientRect().top
      const top = Math.max(rawTop, topOffset)
      const available = window.innerHeight - top - bottomPadding
      setDynamicMax(Math.max(120, available) + 'px')
    }
    const onEvent = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => { rafId = null; update() })
    }
    update()
    window.addEventListener('resize', onEvent)
    window.addEventListener('scroll', onEvent, { passive: true })
    return () => {
      window.removeEventListener('resize', onEvent)
      window.removeEventListener('scroll', onEvent)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [fitViewport, bottomPadding, topOffset])

  const effective = fitViewport ? dynamicMax : maxHeight
  const outerStyle = { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }

  // `fill` mode: the ListTable stretches to 100% of its parent (which must be
  // a bounded flex child — e.g. `flex-1 min-h-0` inside a `flex-col` viewport
  // container). The thead stays pinned at the top and only the tbody region
  // scrolls. Unlike `fitViewport` this does not measure from window.innerHeight,
  // so it cannot drift as the outer page scrolls.
  if (fill) {
    const childArray = React.Children.toArray(children)
    const thead = childArray.find(c => c.type === 'thead')
    const bodyChildren = childArray.filter(c => c.type !== 'thead')
    const colgroup = columns?.length ? (
      <colgroup>{columns.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
    ) : null

    return (
      <div ref={outerRef} className={`rounded-xl border overflow-hidden flex flex-col h-full min-h-0 ${className}`} style={outerStyle}>
        {thead && (
          <div className="overflow-x-auto shrink-0">
            <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
              {colgroup}{thead}
            </table>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
            {colgroup}{bodyChildren}
          </table>
        </div>
      </div>
    )
  }

  if (effective) {
    const childArray = React.Children.toArray(children)
    const thead = childArray.find(c => c.type === 'thead')
    const bodyChildren = childArray.filter(c => c.type !== 'thead')
    const colgroup = columns?.length ? (
      <colgroup>{columns.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
    ) : null

    return (
      <div ref={outerRef} className={`rounded-xl border overflow-hidden ${className}`} style={outerStyle}>
        <div className="overflow-x-auto">
          {thead && (
            <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
              {colgroup}{thead}
            </table>
          )}
          <div style={{ overflowY: 'auto', maxHeight: effective }}>
            <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
              {colgroup}{bodyChildren}
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={outerRef} className={`rounded-xl border overflow-hidden ${className}`} style={outerStyle}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    </div>
  )
}

export function ListTh({ children, align = 'left', className = '', style: extraStyle }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      className={`sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${alignClass} ${className}`}
      style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '2px solid var(--border-default)', color: 'var(--text-muted)', ...extraStyle }}
    >
      {children}
    </th>
  )
}

export function ListTr({ children, dimmed = false, last = false, onClick, className = '', style: extraStyle }) {
  // Inline backgroundColor passed via `style` wins over the class-based
  // `bg-[var(--bg-surface)]` below, so callers can tint rows (e.g. live
  // tournaments) without fighting Tailwind specificity.
  return (
    <tr
      onClick={onClick}
      className={`transition-colors bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ opacity: dimmed ? 0.55 : 1, borderBottom: last ? 'none' : '1px solid var(--border-default)', ...extraStyle }}
    >
      {children}
    </tr>
  )
}

export function ListTd({ children, align = 'left', className = '', style: extraStyle }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
  return (
    <td className={`px-4 py-3 ${alignClass} ${className}`} style={{ color: 'var(--text-secondary)', ...extraStyle }}>
      {children}
    </td>
  )
}

/**
 * Compute the visible page buttons as a sparse sequence with ellipses.
 * Strategy: always show first, last, and a window around the current page.
 * Example: current=7, total=20 → [1, '…', 5, 6, 7, 8, 9, '…', 20]
 */
function paginationRange(page, totalPages, siblings = 1) {
  const first = 1
  const last  = totalPages
  const start = Math.max(first + 1, page - siblings)
  const end   = Math.min(last - 1,  page + siblings)

  const pages = [first]
  if (start > first + 1) pages.push('…')
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < last - 1) pages.push('…')
  if (last > first) pages.push(last)
  return pages
}

export function ListPagination({ page, totalPages, total, limit, onPageChange, noun = 'results', showPageNumbers = true }) {
  if (totalPages <= 1 && total <= limit) return null
  const from  = total === 0 ? 0 : (page - 1) * limit + 1
  const to    = Math.min(page * limit, total)
  const pages = showPageNumbers ? paginationRange(page, totalPages) : null

  const btnBase = 'min-w-[2.25rem] px-2 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-35'
  const btnStyle = { borderColor: 'var(--border-default)', color: 'var(--text-primary)' }
  const activeStyle = { borderColor: 'var(--color-primary)', color: 'white', backgroundColor: 'var(--color-primary)' }

  return (
    <div className="flex items-center justify-center gap-4 flex-wrap">
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {total === 0 ? `No ${noun}` : `${from}–${to} of ${total} ${noun}`}
      </span>
      <div className="flex items-center gap-1 flex-wrap">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          className={`${btnBase} hover:bg-[var(--bg-surface-hover)]`}
          style={btnStyle}
          aria-label="First page"
          title="First page"
        >«</button>
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={`${btnBase} hover:bg-[var(--bg-surface-hover)]`}
          style={btnStyle}
          aria-label="Previous page"
          title="Previous page"
        >‹</button>
        {showPageNumbers && pages.map((p, i) => (
          typeof p === 'number' ? (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`${btnBase} tabular-nums ${p === page ? '' : 'hover:bg-[var(--bg-surface-hover)]'}`}
              style={p === page ? activeStyle : btnStyle}
              aria-current={p === page ? 'page' : undefined}
            >{p}</button>
          ) : (
            <span key={`ellipsis-${i}`} className="px-1 text-sm" style={{ color: 'var(--text-muted)' }}>…</span>
          )
        ))}
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className={`${btnBase} hover:bg-[var(--bg-surface-hover)]`}
          style={btnStyle}
          aria-label="Next page"
          title="Next page"
        >›</button>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className={`${btnBase} hover:bg-[var(--bg-surface-hover)]`}
          style={btnStyle}
          aria-label="Last page"
          title="Last page"
        >»</button>
      </div>
    </div>
  )
}
