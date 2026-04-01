/**
 * Screenshot capture and compression utilities for the feedback system.
 */

/**
 * Returns true when the viewport width is below the mobile breakpoint (< 768px).
 */
export function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768
}

/**
 * Compresses an image data URL to a JPEG with a maximum width and quality setting.
 *
 * @param {string} dataUrl   Source image as a base64 data URL
 * @param {number} maxWidth  Maximum output width in pixels (default 800)
 * @param {number} quality   JPEG quality 0–1 (default 0.7)
 * @returns {Promise<string>} Compressed JPEG data URL
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
    img.onerror = () => reject(new Error('Failed to load image for compression'))
    img.src = dataUrl
  })
}
