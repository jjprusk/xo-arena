import React, { useState, useEffect, useRef } from 'react'
const isStaging = import.meta.env.VITE_ENV === 'staging'
const LANDING_URL = import.meta.env.VITE_LANDING_URL || 'http://localhost:5174'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { getToken } from '../../lib/getToken.js'
import { api } from '../../lib/api.js'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import MuteToggle from '../ui/MuteToggle.jsx'
import AuthModal from '../auth/AuthModal.jsx'
import GuestWelcomeModal from '../auth/GuestWelcomeModal.jsx'
import UserButton from '../auth/UserButton.jsx'
import SignedIn from '../auth/SignedIn.jsx'
import SignedOut from '../auth/SignedOut.jsx'
import { useGameStore } from '../../store/gameStore.js'
import { usePvpStore } from '../../store/pvpStore.js'
import { useRolesStore } from '../../store/rolesStore.js'
import { useSoundStore } from '../../store/soundStore.js'
import FeedbackButton from '../feedback/FeedbackButton.jsx'
import NamePromptModal from '../NamePromptModal.jsx'
import IdleLogoutManager from './IdleLogoutManager.jsx'
import AccomplishmentPopup from '../AccomplishmentPopup.jsx'
import GuideOrb from '../guide/GuideOrb.jsx'
import GuidePanel from '../guide/GuidePanel.jsx'
import { useGuideStore } from '../../store/guideStore.js'
import { useNotifSoundStore } from '../../store/notifSoundStore.js'
import { getSocket, connectSocket } from '../../lib/socket.js'
import { useJourneyAutoOpen } from '../../lib/useJourneyAutoOpen.js'
import { AppNav } from '@xo-arena/nav'

const BASE = import.meta.env.VITE_API_URL ?? ''
const XO_URL = import.meta.env.VITE_XO_URL ?? 'https://xo-frontend-prod.fly.dev'

const BOTTOM_NAV = [
  { to: '/play',        label: 'Play',    icon: '⊞' },
  { to: '/gym',         label: 'Gym',     icon: '⚡' },
  { to: '/leaderboard', label: 'Ranks',   icon: '★' },
  { to: '/puzzles',     label: 'Puzzles', icon: '◈' },
]

const PLATFORM_URL       = import.meta.env.VITE_PLATFORM_URL ?? 'https://aiarena.callidity.com'
const PLATFORM_ADMIN_URL = `${PLATFORM_URL}/admin`

const APP_URLS = { landing: LANDING_URL, xo: XO_URL }

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session, isPending: sessionPending } = useOptimisticSession()
  const isAdmin = session?.user?.role === 'admin'
  const rolesStore = useRolesStore()
  const isSupport = !isAdmin && rolesStore.hasRole('SUPPORT')
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalView, setAuthModalView] = useState('sign-in')
  const [namePrompt, setNamePrompt] = useState(null) // { userId, currentName } | null
  const [unreadCount, setUnreadCount] = useState(0)
  const [accomplishments, setAccomplishments] = useState([])
  const prevUserId = useRef(null)
  const myPresenceIdRef = useRef(null)

  // Guest welcome modal — shown once to non-authenticated first-time visitors
  const [guestWelcomeOpen, setGuestWelcomeOpen] = useState(false)
  useEffect(() => {
    if (sessionPending) return
    if (session?.user) return
    if (localStorage.getItem('xo_guest_welcome_seen')) return
    setGuestWelcomeOpen(true)
  }, [sessionPending, session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function closeGuestWelcome() {
    localStorage.setItem('xo_guest_welcome_seen', '1')
    setGuestWelcomeOpen(false)
  }

  function openRegisterFromWelcome() {
    localStorage.setItem('xo_guest_welcome_seen', '1')
    setGuestWelcomeOpen(false)
    setAuthModalView('sign-up')
    setAuthModalOpen(true)
  }

  useJourneyAutoOpen()

  // Close the guide panel whenever the user navigates
  useEffect(() => {
    useGuideStore.getState().close()
  }, [location.pathname])

  // Fetch roles when user signs in; clear on sign-out
  useEffect(() => {
    const userId = session?.user?.id ?? null
    if (userId && userId !== prevUserId.current) {
      rolesStore.fetch()
      prevUserId.current = userId
    } else if (!userId && prevUserId.current) {
      rolesStore.clear()
      prevUserId.current = null
    }
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll unread-count every 60s to seed the badge on sign-in (no chime — only socket chimes)
  useEffect(() => {
    if (!isAdmin && !isSupport) return
    const endpoint = isAdmin
      ? '/api/v1/admin/feedback/unread-count'
      : '/api/v1/support/feedback/unread-count'
    async function poll() {
      try {
        const token = await getToken()
        const headers = {}
        if (token) headers['Authorization'] = `Bearer ${token}`
        const res = await fetch(`${BASE}${endpoint}`, { headers })
        if (!res.ok) return
        const { count = 0 } = await res.json()
        setUnreadCount(count)
      } catch {}
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => clearInterval(id)
  }, [isAdmin, isSupport]) // eslint-disable-line react-hooks/exhaustive-deps

  // Socket.io feedback:new listener — increments badge and plays chime
  useEffect(() => {
    if (!isAdmin && !isSupport) return
    const socket = getSocket()
    function onFeedbackNew() {
      useSoundStore.getState().play('win')
      setUnreadCount(n => n + 1)
    }
    socket.on('feedback:new', onFeedbackNew)
    return () => { socket.off('feedback:new', onFeedbackNew) }
  }, [isAdmin, isSupport])

  // Clear badge when the user visits their feedback inbox
  useEffect(() => {
    if (isAdmin && location.pathname === '/admin/feedback') setUnreadCount(0)
    if (isSupport && location.pathname === '/support') setUnreadCount(0)
  }, [location.pathname, isAdmin, isSupport])

  // Sync the signed-in user to our DB — once per browser session to avoid a
  // round trip on every page navigation (sessionStorage survives nav, not tab close).
  // Also fetches any pending accomplishment notifications queued while offline.
  useEffect(() => {
    if (!session?.user?.id) return
    if (sessionStorage.getItem('xo_synced') === session.user.id) return
    getToken()
      .then(token => {
        if (!token) return
        return api.users.sync(token).then(({ user }) => {
          sessionStorage.setItem('xo_synced', session.user.id)
          if (user && !user.nameConfirmed) {
            setNamePrompt({ userId: user.id, currentName: user.displayName })
          }
          // Fetch notifications queued while the user was offline
          return api.users.notifications(token).then(({ notifications }) => {
            const pending = (notifications ?? []).filter(n => !n.deliveredAt)
            if (pending.length > 0) setAccomplishments(pending)
          }).catch(() => {})
        })
      })
      .catch(() => {})
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate GuideStore on sign-in; open panel if journey is incomplete; reset on sign-out.
  // Also subscribe the socket to the user's personal room so guide:journeyStep / guide:notification events arrive.
  useEffect(() => {
    if (session?.user?.id) {
      useGuideStore.getState().hydrate().then(() => {
        // Don't auto-open on pages where the guide would obscure gameplay
        if (window.location.pathname.startsWith('/play')) return
        const { journeyProgress } = useGuideStore.getState()
        const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
        if (!dismissedAt && completedSteps.length < 8) {
          useGuideStore.getState().open()
        }
      })
      // Connect socket and explicitly subscribe — covers the case where the socket
      // was already connected (so 'connect' won't fire) or reconnects mid-await.
      getToken().then(token => {
        if (!token) return
        const socket = connectSocket(token)
        // If already connected, 'connect' won't fire — subscribe directly.
        // If not yet connected, the 'connect' handler in the effect below will do it.
        if (socket.connected) socket.emit('user:subscribe', { authToken: token })
      }).catch(() => {})
    } else {
      useGuideStore.getState().reset()
    }
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time guide:notification events → GuideStore
  useEffect(() => {
    const socket = getSocket()

    // Persistent connect handler — fires on every connect/reconnect so user:subscribe
    // is re-sent after backend restarts without needing a page reload.
    async function onConnect() {
      const token = await getToken()
      if (token) socket.emit('user:subscribe', { authToken: token })
    }
    socket.on('connect', onConnect)
    if (socket.connected) onConnect()

    // Presence keepalive — fallback re-subscribe in case no broadcast arrives
    // for an extended period (e.g. no other users connecting or disconnecting).
    const keepalive = setInterval(async () => {
      if (!socket.connected) return
      const token = await getToken()
      if (token) socket.emit('user:subscribe', { authToken: token })
    }, 3 * 60_000)

    // Server confirms our presence DB userId — store it so we can detect self-removal.
    function onSubscribed({ userId }) {
      myPresenceIdRef.current = userId
    }
    socket.on('guide:subscribed', onSubscribed)

    function onOnlineUsers({ users }) {
      useGuideStore.getState().setOnlineUsers(users)
      // If the server no longer has us in the broadcast, re-subscribe immediately.
      // This self-heals any silent presence drop without requiring a page refresh.
      const myId = myPresenceIdRef.current
      if (myId && socket.connected && !users.some(u => u.userId === myId)) {
        getToken().then(token => {
          if (token) socket.emit('user:subscribe', { authToken: token })
        }).catch(() => {})
      }
    }
    socket.on('guide:onlineUsers', onOnlineUsers)

    function onGuideNotification(notif) {
      useGuideStore.getState().addNotification(notif)
      useNotifSoundStore.getState().play()
      // Auto-open panel for urgent types if not mid-game
      if (notif.type === 'flash' || notif.type === 'match_ready') {
        const { panelOpen } = useGuideStore.getState()
        const { status: pvaiStatus } = useGameStore.getState()
        const { status: pvpStatus } = usePvpStore.getState()
        const inGame = pvaiStatus === 'playing' || pvpStatus === 'playing'
        if (!panelOpen && !inGame) useGuideStore.getState().open()
      }
    }
    socket.on('guide:notification', onGuideNotification)

    function onJourneyStep({ completedSteps }) {
      useGuideStore.getState().applyJourneyStep({ completedSteps })
      // Open the guide to celebrate the completed step — game is already over (won/draw)
      // so we're not interrupting active play
      const { status: pvaiStatus } = useGameStore.getState()
      const { status: pvpStatus } = usePvpStore.getState()
      const inGame = pvaiStatus === 'playing' || pvpStatus === 'playing'
      if (!inGame) useGuideStore.getState().open()
    }
    socket.on('guide:journeyStep', onJourneyStep)

    return () => {
      clearInterval(keepalive)
      socket.off('connect',            onConnect)
      socket.off('guide:subscribed',   onSubscribed)
      socket.off('guide:onlineUsers',  onOnlineUsers)
      socket.off('guide:notification', onGuideNotification)
      socket.off('guide:journeyStep',  onJourneyStep)
    }
  }, [])

  // Real-time accomplishment events pushed from the server over Socket.IO
  useEffect(() => {
    const socket = getSocket()
    function onAccomplishment(notif) {
      setAccomplishments(prev => [...prev, notif])
    }
    socket.on('accomplishment', onAccomplishment)
    return () => { socket.off('accomplishment', onAccomplishment) }
  }, [])

  function handleDismissAccomplishment(id) {
    getToken()
      .then(token => api.users.deliverNotifications([id], token))
      .catch(() => {})
    setAccomplishments(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div className="flex flex-col min-h-dvh relative">
      {/* Mountain background — xo.aiarena game site has its own visual identity distinct from the aiarena platform */}
      {/* The Colosseum background applies to aiarena.callidity.com (platform + admin), not the game sites */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none select-none"
        style={{
          zIndex: 0,
          opacity: 'var(--photo-opacity)',
          backgroundImage: 'url(/mountain-bg.jpg)',
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center 30%',
        }}
      />
      <AppNav
        appId="xo"
        appUrls={APP_URLS}
        subnav="xo"
        isStaging={isStaging}
        extrasSlot={<><MuteToggle /><ThemeToggle /></>}
        rightSlot={
          <>
            <SignedOut>
              <button
                onClick={() => setAuthModalOpen(true)}
                className="text-sm font-medium px-3 py-1.5 rounded-lg transition-all hover:brightness-110 active:scale-[0.97]"
                style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', color: 'white' }}
              >
                Sign in
              </button>
            </SignedOut>
            <AuthModal isOpen={authModalOpen} onClose={() => { setAuthModalOpen(false); setAuthModalView('sign-in') }} defaultView={authModalView} />
            <SignedIn>
              <GuideOrb />
              <UserButton afterSignOutUrl="/play" adminUrl={PLATFORM_ADMIN_URL} />
            </SignedIn>
          </>
        }
      />

      {/* Main content */}
      <main key={location.key} className="xo-page-transition flex-1 px-6 md:px-8 py-6 pb-20 md:pb-6 relative" style={{ zIndex: 1 }}>
        <Outlet />
      </main>

      {/* Mobile bottom nav — XO game-site specific shortcuts */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {BOTTOM_NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors ${
                isActive ? 'text-[var(--color-blue-600)]' : 'text-[var(--text-secondary)]'
              }`
            }
          >
            <span className="text-lg leading-none">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Feedback button — hidden for support users, hidden on mobile during active game */}
      {!isSupport && (
        <FeedbackButton appId="xo-arena" apiBase="/api/v1" hideWhenPlaying />
      )}

      {/* Unread feedback toast for admin/support */}
      {unreadCount > 0 && (isAdmin || isSupport) && (
        <FeedbackToast
          count={unreadCount}
          inboxPath={isAdmin ? '/admin/feedback' : '/support'}
          onDismiss={() => setUnreadCount(0)}
          navigate={navigate}
        />
      )}

      <GuestWelcomeModal
        isOpen={guestWelcomeOpen}
        onClose={closeGuestWelcome}
        onRegister={openRegisterFromWelcome}
      />
      <NamePromptModal
        isOpen={!!namePrompt}
        userId={namePrompt?.userId}
        currentName={namePrompt?.currentName}
        onSave={() => setNamePrompt(null)}
        onSkip={() => setNamePrompt(null)}
      />
      {accomplishments.length > 0 && (
        <AccomplishmentPopup
          notification={accomplishments[0]}
          onDismiss={() => handleDismissAccomplishment(accomplishments[0].id)}
        />
      )}
      <SignedIn>
        <GuidePanel isAdmin={isAdmin} />
      </SignedIn>
      <IdleLogoutManager />
    </div>
  )
}

function FeedbackToast({ count, inboxPath, onDismiss, navigate }) {
  return (
    <div
      className="fixed bottom-20 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--color-blue-200)', boxShadow: 'var(--shadow-md)' }}
    >
      <span className="text-lg">💬</span>
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {count} new feedback {count === 1 ? 'item' : 'items'}
        </div>
        <button
          onClick={() => { onDismiss(); navigate(inboxPath) }}
          className="text-xs underline"
          style={{ color: 'var(--color-blue-600)' }}
        >
          View feedback
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="ml-1 p-1 rounded hover:bg-[var(--bg-surface-hover)]"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
