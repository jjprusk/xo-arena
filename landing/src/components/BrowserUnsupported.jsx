// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Branded "your browser is too old" screen.
 *
 * Rendered BEFORE the rest of the React tree mounts when
 * `isBrowserSupported()` returns false (see main.jsx). Uses ONLY inline
 * styles — no Tailwind, no CSS custom properties, no web fonts — because
 * the reason we're here is exactly that the browser couldn't parse our
 * stylesheet. Plain rgb() colors; system font stack.
 *
 * Keep the copy short, friendly, and jargon-free: unsophisticated users
 * on old Macs + old Windows boxes will land here.
 */
import React from 'react'

const BROWSERS = [
  { name: 'Chrome',  min: '111+', url: 'https://www.google.com/chrome/',   note: 'Works on Mac, Windows, iOS, Android' },
  { name: 'Safari',  min: '16.4+', url: 'https://support.apple.com/en-us/HT204416', note: 'Update via System Settings → General → Software Update' },
  { name: 'Edge',    min: '111+', url: 'https://www.microsoft.com/edge',   note: 'Works on Mac, Windows' },
  { name: 'Firefox', min: '113+', url: 'https://www.mozilla.org/firefox/', note: 'Works on Mac, Windows, iOS, Android' },
]

export default function BrowserUnsupported() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        color: 'rgb(36, 60, 96)',
        background: 'rgb(241, 239, 232)',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 16 }}>⚔️</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 12px', color: 'rgb(36, 60, 96)' }}>
          AI Arena needs a newer browser
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 28px', color: 'rgb(68, 68, 68)' }}>
          Your browser is too old to run this app correctly. Please update or switch to one of the browsers below, then reload this page.
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', textAlign: 'left' }}>
          {BROWSERS.map((b) => (
            <li
              key={b.name}
              style={{
                padding: '14px 16px',
                marginBottom: 10,
                background: '#fff',
                border: '1px solid rgb(208, 206, 199)',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {b.name} <span style={{ color: 'rgb(127, 127, 127)', fontWeight: 400 }}>· {b.min}</span>
                </div>
                <div style={{ fontSize: 13, color: 'rgb(103, 101, 97)', marginTop: 2 }}>{b.note}</div>
              </div>
              <a
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '8px 14px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  background: 'rgb(74, 111, 165)',
                  borderRadius: 8,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Get it
              </a>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: 12, color: 'rgb(127, 127, 127)', margin: 0 }}>
          If you just updated your browser, reload this page to continue.
        </p>
      </div>
    </div>
  )
}
