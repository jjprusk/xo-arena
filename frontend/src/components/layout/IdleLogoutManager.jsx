import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { usePvpStore } from '../../store/pvpStore.js'
import { useGymStore } from '../../store/gymStore.js'
import { api } from '../../lib/api.js'
import { signOut } from '../../lib/auth-client.js'
import { clearTokenCache } from '../../lib/getToken.js'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
// Throttle resets: ignore activity events that come within 10s of the last one
const RESET_THROTTLE_MS = 10_000

/**
 * Mounts invisibly on all pages. Tracks user inactivity app-wide.
 * After idleWarnMinutes of no input, shows a "Still there?" warning with a countdown.
 * If the user doesn't respond within idleGraceMinutes, signs them out.
 *
 * Suppressed (timer paused/cleared) when:
 *  - User is not authenticated
 *  - A PvP game is in progress (the room idle timer handles that case)
 *  - A Gym training session is actively running
 */
export default function IdleLogoutManager() {
  const { data: session } = useOptimisticSession()
  const pvpStatus  = usePvpStore(s => s.status)
  const isTraining = useGymStore(s => s.isTraining)
  const navigate   = useNavigate()

  const [config, setConfig]     = useState(null)  // { idleWarnMs, idleGraceMs }
  const [warning, setWarning]   = useState(false)  // is the warning popup visible?
  const [remaining, setRemaining] = useState(null)  // countdown seconds

  const warnTimerRef   = useRef(null)
  const graceTimerRef  = useRef(null)
  const countdownRef   = useRef(null)
  const lastResetRef   = useRef(Date.now())

  const isAuthenticated = !!session?.user
  const suppressed = !isAuthenticated || pvpStatus === 'playing' || isTraining

  // Fetch config once
  useEffect(() => {
    api.config.getSessionIdle()
      .then(({ idleWarnMinutes, idleGraceMinutes }) => {
        setConfig({
          idleWarnMs:  idleWarnMinutes  * 60_000,
          idleGraceMs: idleGraceMinutes * 60_000,
        })
      })
      .catch(() => setConfig({ idleWarnMs: 30 * 60_000, idleGraceMs: 5 * 60_000 }))
  }, [])

  const clearAllTimers = useCallback(() => {
    clearTimeout(warnTimerRef.current)
    clearTimeout(graceTimerRef.current)
    clearInterval(countdownRef.current)
    warnTimerRef.current  = null
    graceTimerRef.current = null
    countdownRef.current  = null
  }, [])

  const doLogout = useCallback(async () => {
    clearAllTimers()
    setWarning(false)
    clearTokenCache()
    try { await signOut() } catch { /* best effort */ }
    navigate('/', { replace: true })
  }, [clearAllTimers, navigate])

  const startWarnTimer = useCallback(() => {
    if (!config) return
    clearAllTimers()
    setWarning(false)

    warnTimerRef.current = setTimeout(() => {
      setWarning(true)
      setRemaining(Math.round(config.idleGraceMs / 1000))

      // Tick the countdown every second
      countdownRef.current = setInterval(() => {
        setRemaining(r => {
          if (r == null || r <= 1) return r
          return r - 1
        })
      }, 1000)

      // Grace timer — auto-logout if no response
      graceTimerRef.current = setTimeout(doLogout, config.idleGraceMs)
    }, config.idleWarnMs)
  }, [config, clearAllTimers, doLogout])

  // Called when user acknowledges the warning
  const handleStayLoggedIn = useCallback(() => {
    startWarnTimer()
  }, [startWarnTimer])

  // Reset idle timer on any activity (throttled)
  const handleActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastResetRef.current < RESET_THROTTLE_MS) return
    lastResetRef.current = now
    if (!warning) startWarnTimer()
  }, [warning, startWarnTimer])

  // Start/stop timer when suppression state or config changes
  useEffect(() => {
    if (suppressed || !config) {
      clearAllTimers()
      setWarning(false)
      return
    }
    startWarnTimer()
    return clearAllTimers
  }, [suppressed, config]) // eslint-disable-line react-hooks/exhaustive-deps

  // Attach / detach activity listeners
  useEffect(() => {
    if (suppressed || !config) return
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handleActivity, { passive: true }))
    return () => ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handleActivity))
  }, [suppressed, config, handleActivity])

  if (!warning) return null

  const graceSec   = config ? Math.round(config.idleGraceMs / 1000) : 300
  const fraction   = remaining != null && graceSec > 0 ? remaining / graceSec : 0
  const urgent     = remaining != null && remaining <= 60

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }}
    >
      <div
        className="rounded-2xl border p-6 flex flex-col items-center gap-4 max-w-xs w-full mx-4 shadow-2xl"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        <div className="text-3xl">⏱️</div>

        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Still there?
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            You've been inactive for a while. We'll sign you out automatically to keep your account secure.
          </p>
        </div>

        {/* Countdown */}
        <div className="flex flex-col items-center gap-1 w-full">
          <span
            className="text-2xl font-bold tabular-nums transition-colors"
            style={{ color: urgent ? 'var(--color-red-500)' : 'var(--text-primary)' }}
          >
            {remaining != null ? `${remaining}s` : '—'}
          </span>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-default)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(0, fraction * 100).toFixed(1)}%`,
                backgroundColor: urgent ? 'var(--color-red-500)' : 'var(--color-blue-500)',
              }}
            />
          </div>
        </div>

        <div className="flex gap-3 w-full">
          <button
            onClick={handleStayLoggedIn}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            Stay logged in
          </button>
          <button
            onClick={doLogout}
            className="px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
