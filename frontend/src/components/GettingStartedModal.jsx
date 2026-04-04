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
  // This is more reliable than onLoad because we know the message listener
  // inside getting-started.html is registered before we send 'show-faq-hint'.
  useEffect(() => {
    if (!isOpen || !showHint) return
    function onMessage(e) {
      if (e.data?.type !== 'getting-started-ready') return
      if (hintSentRef.current) return
      hintSentRef.current = true
      iframeRef.current?.contentWindow?.postMessage({ type: 'show-faq-hint' }, '*')
    }
    window.addEventListener('message', onMessage)
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
