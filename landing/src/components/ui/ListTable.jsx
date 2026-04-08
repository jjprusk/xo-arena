import React, { useRef, useEffect, useState } from 'react'

export function ListTable({ children, maxHeight, fitViewport = false, bottomPadding = 24, topOffset = 0, className = '', columns }) {
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

export function ListTr({ children, dimmed = false, last = false, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ opacity: dimmed ? 0.55 : 1, borderBottom: last ? 'none' : '1px solid var(--border-default)' }}
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

export function ListPagination({ page, totalPages, total, limit, onPageChange, noun = 'results' }) {
  if (totalPages <= 1 && total <= limit) return null
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {total === 0 ? `No ${noun}` : `${from}–${to} of ${total} ${noun}`}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-35 transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >← Prev</button>
        <span className="px-3 py-1.5 text-xs tabular-nums rounded-lg border" style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)' }}>
          {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-35 transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >Next →</button>
      </div>
    </div>
  )
}
