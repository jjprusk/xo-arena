// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Feature-detects the browser capabilities our CSS pipeline requires.
 *
 * Effective minimums:
 *   Chrome/Edge 111+ (March 2023) — color-mix()
 *   Firefox 113+     (May 2023)   — color-mix()
 *   Safari 16.4+     (March 2023) — color-mix() in srgb parses reliably
 *
 * We pick color-mix as the canary because:
 *   (a) Tailwind v4 + our hand-rolled theme tokens use it heavily, and an
 *       old engine that can't parse it drops the entire stylesheet rule
 *       block containing it — the failure mode the user saw on Safari 14.
 *   (b) Every browser version that lacks color-mix also lacks Tailwind v4's
 *       @theme + @layer directives, so a single check covers both.
 *
 * Use this BEFORE mounting React so the branded upgrade screen is the first
 * thing a user on an unsupported browser sees, not a raw unstyled page.
 */
export function isBrowserSupported() {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  try {
    // CSS.supports has two signatures: (property, value) and (fullDeclaration).
    // We use the two-arg form for color-mix because the property-facing
    // support (can I USE color-mix in `background`?) is what we actually rely
    // on. Safari 14 returns false here; Safari 16.4+ returns true.
    return CSS.supports('background', 'color-mix(in srgb, red, blue)')
  } catch {
    return false
  }
}
