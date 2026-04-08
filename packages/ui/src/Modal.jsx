import React, { useEffect } from 'react'

const MAX_WIDTHS = { sm: '24rem', md: '28rem', lg: '36rem' }

/**
 * Reusable modal wrapper with backdrop blur, slide-up animation,
 * Escape-to-close, and aria-modal accessibility attribute.
 *
 * @param {boolean}  isOpen   - Controls visibility.
 * @param {function} onClose  - Called when backdrop clicked or Escape pressed.
 * @param {node}     children - Modal content.
 * @param {string}   maxWidth - 'sm' | 'md' | 'lg' (default: 'sm')
 */
export default function Modal({ isOpen, onClose, children, maxWidth = 'sm' }) {
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-card w-full"
        style={{ maxWidth: MAX_WIDTHS[maxWidth] ?? MAX_WIDTHS.sm }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
