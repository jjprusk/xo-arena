// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { configurePvp } from '@xo-arena/xo'
import { connectSocket, disconnectSocket, getSocket } from './lib/socket.js'
import { getToken } from './lib/getToken.js'
import { useSoundStore } from './store/soundStore.js'
import { perfMark } from './lib/perfLog.js'

perfMark('main:module-evaluated')

// Wire socket, token, and sound into the shared PvP store
configurePvp({
  connectSocket,
  disconnectSocket,
  getSocket,
  getToken,
  playSound: (key) => useSoundStore.getState().play(key),
})

perfMark('main:before-render')
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
