import React from 'react'

// ── UserAvatar ──────────────────────────────────────────────────────────────
// Consistent avatar across all user/player lists. Shows photo if available,
// otherwise the first letter of the display name on a tinted background.
//
// sizes: 'xs' (20px) | 'sm' (28px) | 'md' (32px) | 'lg' (40px)

export function UserAvatar({ user, size = 'md' }) {
  const sizeClass = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
  }[size] ?? 'w-8 h-8 text-xs'

  return (
    <div
      className={`${sizeClass} rounded-full shrink-0 flex items-center justify-center overflow-hidden font-bold select-none`}
      style={{
        backgroundColor: 'var(--color-blue-50)',
        border: '1.5px solid var(--color-blue-100)',
        color: 'var(--color-blue-600)',
      }}
    >
      {user?.avatarUrl
        ? <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
        : (user?.displayName?.[0] ?? '?').toUpperCase()
      }
    </div>
  )
}

// ── SearchBar ───────────────────────────────────────────────────────────────
// Styled search input with a leading icon and an inline clear button.
// Debouncing is the caller's responsibility.

export function SearchBar({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      {/* magnifying glass */}
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        width="14" height="14" viewBox="0 0 16 16" fill="none"
        style={{ color: 'var(--text-muted)' }}
      >
        <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-8 py-2 rounded-lg border text-sm focus:outline-none transition-colors"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── ListTable ───────────────────────────────────────────────────────────────
// Outer shell. Provides the rounded border, shadow, and horizontal scroll.
// Pass maxHeight (e.g. "60vh") to enable vertical scroll with a sticky header.

export function ListTable({ children, maxHeight, className = '' }) {
  return (
    <div
      className={`rounded-xl border overflow-hidden ${className}`}
      style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div
        className="overflow-x-auto"
        style={maxHeight ? { overflowY: 'auto', maxHeight } : undefined}
      >
        <table className="w-full text-sm border-collapse">
          {children}
        </table>
      </div>
    </div>
  )
}

// ── ListTh ──────────────────────────────────────────────────────────────────
// Header cell. Uppercase label, muted color, sticky when inside a scrollable table.
// align: 'left' | 'center' | 'right'  (default: 'left')

export function ListTh({ children, align = 'left', className = '', style: extraStyle }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      className={`sticky top-0 z-10 px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${alignClass} ${className}`}
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '2px solid var(--border-default)',
        color: 'var(--text-muted)',
        ...extraStyle,
      }}
    >
      {children}
    </th>
  )
}

// ── ListTr ──────────────────────────────────────────────────────────────────
// Data row. Provides hover state and the dividing border between rows.
// dimmed: reduces opacity (e.g. banned users, inactive bots)
// last: omits the bottom border on the final row

export function ListTr({ children, dimmed = false, last = false, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors hover:bg-[var(--bg-surface-hover)] ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{
        opacity: dimmed ? 0.55 : 1,
        borderBottom: last ? 'none' : '1px solid var(--border-default)',
      }}
    >
      {children}
    </tr>
  )
}

// ── ListTd ──────────────────────────────────────────────────────────────────
// Data cell. Consistent padding and text color.
// align: 'left' | 'center' | 'right'

export function ListTd({ children, align = 'left', className = '', style: extraStyle }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
  return (
    <td
      className={`px-4 py-3 ${alignClass} ${className}`}
      style={{ color: 'var(--text-secondary)', ...extraStyle }}
    >
      {children}
    </td>
  )
}

// ── ListPagination ──────────────────────────────────────────────────────────
// Pagination row. Shows a record count on the left and Prev/Next on the right.
// Pass noun (e.g. "users", "bots") to customise the count label.

export function ListPagination({ page, totalPages, total, limit, onPageChange, noun = 'results' }) {
  if (totalPages <= 1 && total <= limit) return null

  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {total === 0
          ? `No ${noun}`
          : `${from}–${to} of ${total} ${noun}`
        }
      </span>

      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-35 transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          ← Prev
        </button>
        <span
          className="px-3 py-1.5 text-xs tabular-nums rounded-lg border"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)' }}
        >
          {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-35 transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          Next →
        </button>
      </div>
    </div>
  )
}
