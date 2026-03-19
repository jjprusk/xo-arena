import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'
import { useThemeStore } from './store/themeStore.js'

// Apply persisted theme before first render
useThemeStore.getState().init()

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const tree = (
  <StrictMode>
    <App />
  </StrictMode>
)

createRoot(document.getElementById('root')).render(
  CLERK_KEY ? <ClerkProvider publishableKey={CLERK_KEY}>{tree}</ClerkProvider> : tree,
)
