// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isBrowserSupported } from './lib/checkBrowserSupport.js'
import BrowserUnsupported from './components/BrowserUnsupported.jsx'

// Gate BEFORE importing index.css / App / anything that touches Tailwind v4.
// On Safari 14 / Chrome <111 / Firefox <113 the app's stylesheet fails to
// parse (color-mix, @theme, @layer), which previously produced an unstyled
// HTML flash. Short-circuiting here means an old browser sees ONE screen:
// a branded upgrade prompt with no external CSS dependencies.
if (!isBrowserSupported()) {
  createRoot(document.getElementById('root')).render(<BrowserUnsupported />)
} else {
  // Dynamic import so the heavy chunk (index.css, App, socket, sound store)
  // doesn't even get fetched on unsupported browsers.
  await import('./main.supported.jsx')
}
