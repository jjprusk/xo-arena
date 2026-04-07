import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { usePvpStore } from '../../store/pvpStore.js'
import { useGymStore } from '../../store/gymStore.js'
import { api } from '../../lib/api.js'
import { signOut } from '../../lib/auth-client.js'
import { clearTokenCache } from '../../lib/getToken.js'
import { disconnectSocket } from '../../lib/socket.js'

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
 *
 * Uses Page Visibility API to compensate for browser timer throttling when
 * the tab is in the background.
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
  // Wall-clock timestamps for Page Visibility catch-up
  const warnDeadlineRef  = useRef(null)  // when the warn timer should fire
  const graceDeadlineRef = useRef(null)  // when auto-logout should fire
  // Synchronous mirror of `warning` state — lets handleActivity check instantly
  // without waiting for React to re-render (avoids race with mousemove on tab focus)
  const warningRef = useRef(false)

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
    warnDeadlineRef.current  = null
    graceDeadlineRef.current = null
  }, [])

  const doLogout = useCallback(async () => {
    clearAllTimers()
    warningRef.current = false
    setWarning(false)
    clearTokenCache()
    disconnectSocket()
    try { await signOut() } catch { /* best effort */ }
    navigate('/', { replace: true })
  }, [clearAllTimers, navigate])

  // Start the grace-period countdown + auto-logout timer.
  // Called when the warn timer fires (or immediately on visibility if overdue).
  const startGrace = useCallback((graceMs) => {
    clearTimeout(graceTimerRef.current)
    clearInterval(countdownRef.current)

    const graceSec = Math.round(graceMs / 1000)
    warningRef.current = true  // set synchronously before React re-renders
    setWarning(true)
    setRemaining(graceSec)
    graceDeadlineRef.current = Date.now() + graceMs

    countdownRef.current = setInterval(() => {
      setRemaining(r => {
        if (r == null || r <= 1) return r
        return r - 1
      })
    }, 1000)

    graceTimerRef.current = setTimeout(doLogout, graceMs)
  }, [doLogout])

  const startWarnTimer = useCallback(() => {
    if (!config) return
    clearAllTimers()
    warningRef.current = false
    setWarning(false)
    setRemaining(null)

    warnDeadlineRef.current = Date.now() + config.idleWarnMs
    warnTimerRef.current = setTimeout(() => {
      warnTimerRef.current   = null
      warnDeadlineRef.current = null
      startGrace(config.idleGraceMs)
    }, config.idleWarnMs)
  }, [config, clearAllTimers, startGrace])

  // Called when user acknowledges the warning
  const handleStayLoggedIn = useCallback(() => {
    startWarnTimer()
  }, [startWarnTimer])

  // Reset idle timer on any activity (throttled).
  // Uses warningRef (not warning state) to avoid a race where mousemove fires
  // immediately after visibilitychange before React has committed the new state.
  const handleActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastResetRef.current < RESET_THROTTLE_MS) return
    lastResetRef.current = now
    if (!warningRef.current) startWarnTimer()
  }, [startWarnTimer])

  // Checks whether any deadline has passed and acts on it.
  // Called both from the Page Visibility handler and the heartbeat interval so
  // that screensavers (which don't hide the tab) are also caught.
  const checkDeadlines = useCallback(() => {
    const now = Date.now()

    if (graceDeadlineRef.current) {
      if (now >= graceDeadlineRef.current) {
        doLogout()
      } else {
        const remainingSec = Math.ceil((graceDeadlineRef.current - now) / 1000)
        setRemaining(remainingSec)
        clearTimeout(graceTimerRef.current)
        graceTimerRef.current = setTimeout(doLogout, graceDeadlineRef.current - now)
      }
      return
    }

    if (warnDeadlineRef.current) {
      if (now >= warnDeadlineRef.current) {
        clearTimeout(warnTimerRef.current)
        warnTimerRef.current    = null
        warnDeadlineRef.current = null
        startGrace(config.idleGraceMs)
      } else {
        const remaining = warnDeadlineRef.current - now
        clearTimeout(warnTimerRef.current)
        warnTimerRef.current = setTimeout(() => {
          warnTimerRef.current    = null
          warnDeadlineRef.current = null
          startGrace(config.idleGraceMs)
        }, remaining)
      }
    }
  }, [config, doLogout, startGrace])

  // Page Visibility API — catches background-tab timer throttling.
  useEffect(() => {
    if (suppressed || !config) return
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') checkDeadlines()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [suppressed, config, checkDeadlines])

  // Heartbeat — catches screensaver-induced timer throttling where the tab
  // stays "visible" so visibilitychange never fires.
  useEffect(() => {
    if (suppressed || !config) return
    const id = setInterval(checkDeadlines, 30_000)
    return () => clearInterval(id)
  }, [suppressed, config, checkDeadlines])

  // Start/stop timer when suppression state or config changes
  useEffect(() => {
    if (suppressed || !config) {
      clearAllTimers()
      warningRef.current = false
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
