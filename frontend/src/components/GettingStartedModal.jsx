import React, { useEffect, useRef } from 'react'

export default function GettingStartedModal({ isOpen, onClose, showHint = false }) {
  const iframeRef = useRef(null)
  const hintSentRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Reset the sent-guard whenever the modal closes so it can show again if needed
  useEffect(() => {
    if (!isOpen) hintSentRef.current = false
  }, [isOpen])

  // Listen for the iframe's 'ready' handshake, then send the hint trigger.
  // We also check readyState immediately in case the iframe loaded from cache
  // before this effect registered its listener (React 18 fires effects after paint,
  // which can lose the race against a fast cached load).
  useEffect(() => {
    if (!isOpen || !showHint) return
    const iframe = iframeRef.current
    function sendHint() {
      if (hintSentRef.current) return
      hintSentRef.current = true
      iframe?.contentWindow?.postMessage({ type: 'show-faq-hint' }, '*')
    }
    function onMessage(e) {
      if (e.data?.type !== 'getting-started-ready') return
      sendHint()
    }
    window.addEventListener('message', onMessage)
    // Fallback: if the iframe already finished loading before we registered,
    // the 'getting-started-ready' message was lost — send the hint now.
    try {
      if (iframe?.contentDocument?.readyState === 'complete') sendHint()
    } catch {}
    return () => window.removeEventListener('message', onMessage)
  }, [isOpen, showHint])

  if (!isOpen) return null

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
          ref={iframeRef}
          src="/getting-started.html"
          title="Getting Started"
          scrolling="no"
          style={{ width: '100%', aspectRatio: '960/720', border: 'none', display: 'block', maxHeight: '85vh' }}
        />
      </div>
    </div>
  )
}
