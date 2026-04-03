import React, { useEffect, useRef } from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { getToken } from '../lib/getToken.js'
import { api } from '../lib/api.js'

export default function GettingStartedModal({ isOpen, onClose }) {
  const { data: session } = useOptimisticSession()
  const iframeRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // When the modal opens, determine whether to show the FAQ hint.
  // For authenticated users: check the server flag (stored in preferences JSON).
  // For guests: fall back to localStorage — best-effort only.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function checkAndMaybeShowHint() {
      const iframe = iframeRef.current
      if (!iframe) return

      const isAuth = !!session?.user

      if (isAuth) {
        try {
          const token = await getToken()
          const { faqHintSeen } = await api.users.getHints(token)
          if (cancelled) return
          if (!faqHintSeen) {
            // Mark seen first so a fast re-open won't double-show
            api.users.markFaqHint(token).catch(() => {})
            iframe.contentWindow?.postMessage({ type: 'show-faq-hint' }, '*')
          }
        } catch {
          // Network hiccup — fall through silently; hint just won't show
        }
      } else {
        // Guest path: localStorage flag
        if (!localStorage.getItem('faqHintShown')) {
          localStorage.setItem('faqHintShown', '1')
          iframe.contentWindow?.postMessage({ type: 'show-faq-hint' }, '*')
        }
      }
    }

    // The iframe may still be loading when the modal first opens.
    // Send the message both on iframe load and immediately (in case it's cached).
    const iframe = iframeRef.current
    function onLoad() { if (!cancelled) checkAndMaybeShowHint() }
    iframe?.addEventListener('load', onLoad)
    checkAndMaybeShowHint()

    return () => {
      cancelled = true
      iframe?.removeEventListener('load', onLoad)
    }
  }, [isOpen, session])

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
