import React, { useEffect } from 'react'

export default function GettingStartedModal({ isOpen, onClose, showHint = false }) {
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const src = showHint ? '/getting-started.html?hint=1' : '/getting-started.html'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full rounded-2xl overflow-hidden shadow-2xl"
        style={{ maxWidth: 980, maxHeight: '90vh', backgroundColor: '#090c18' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-4 z-10 text-2xl leading-none hover:opacity-70 transition-opacity"
          style={{ color: 'rgba(255,255,255,0.5)' }}
          aria-label="Close"
        >
          ×
        </button>
        <iframe
          src={src}
          title="Guide"
          scrolling="no"
          style={{ width: '100%', aspectRatio: '960/720', border: 'none', display: 'block', maxHeight: '85vh' }}
        />
      </div>
    </div>
  )
}
