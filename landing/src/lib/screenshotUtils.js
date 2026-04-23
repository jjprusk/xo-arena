// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Screenshot capture and compression utilities for the feedback widget.
 * Ported from the retired frontend/ app (Phase 3.0) when the feedback
 * button was re-added to the landing app.
 */

export function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

/**
 * Compresses an image data URL to a JPEG with a maximum width and quality
 * setting. Keeps POST /api/v1/feedback payloads small enough to not trigger
 * the backend's body-size limit when screenshots are included.
 */
export function compressImage(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
