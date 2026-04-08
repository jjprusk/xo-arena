import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { configurePvp } from '@xo-arena/xo'
import { connectSocket, disconnectSocket, getSocket } from './lib/socket.js'
import { getToken } from './lib/getToken.js'

// Wire socket + token into the shared PvP store (no sound on the landing site)
configurePvp({ connectSocket, disconnectSocket, getSocket, getToken })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
