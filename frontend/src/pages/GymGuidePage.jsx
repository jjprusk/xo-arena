import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function GymGuidePage() {
  const [content, setContent] = useState(null)

  useEffect(() => {
    fetch('/bot-training-guide.md')
      .then(r => r.text())
      .then(setContent)
  }, [])

  function handleDownload() {
    const a = Object.assign(document.createElement('a'), {
      href: '/bot-training-guide.md',
      download: 'Bot_Training_Guide.md',
    })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-8">
        <Link
          to="/ml"
          className="text-sm font-medium flex items-center gap-1"
          style={{ color: 'var(--color-blue-600)' }}
        >
          ← Back to Gym
        </Link>
        <button
          onClick={handleDownload}
          className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        >
          Download .md
        </button>
      </div>

      {/* Rendered markdown */}
      {content == null
        ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        : (
          <div className="prose-guide">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )
      }
    </div>
  )
}
