// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { useThemeStore } from '../../store/themeStore.js'

const OPTIONS = [
  { value: 'light', label: '☀' },
  { value: 'dark', label: '☾' },
  { value: 'system', label: '⊙' },
]

export default function ThemeToggle() {
  const { theme, setTheme } = useThemeStore()

  return (
    <div className="flex items-center rounded-full border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-label={`${value} mode`}
          className={`px-2 py-1 text-sm transition-colors ${
            theme === value
              ? 'bg-[var(--color-blue-600)] text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
