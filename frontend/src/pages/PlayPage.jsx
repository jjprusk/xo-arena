import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.js'
import { usePvpStore } from '../store/pvpStore.js'
import { cachedFetch } from '../lib/api.js'
import ModeSelection from '../components/game/ModeSelection.jsx'
import GameBoard from '../components/game/GameBoard.jsx'
import RoomLobby from '../components/room/RoomLobby.jsx'
import PvPBoard from '../components/room/PvPBoard.jsx'
import IdleWarningPopup from '../components/pvp/IdleWarningPopup.jsx'

export default function PlayPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const joinSlug = searchParams.get('join')
  const spectateSlug = searchParams.get('spectate')

  const { status: pvaiStatus, mode: pvaiMode } = useGameStore()
  const {
    status: pvpStatus, joinRoom, role, slug, isAutoRoom, displayName,
    abandoned, kicked, myMark, reset,
  } = usePvpStore()

  const inviteUrl = slug ? `${window.location.origin}/play?join=${slug}` : ''

  // Warm the bot cache in the background so "Challenge a Bot" opens instantly.
  useEffect(() => { cachedFetch('/bots', 5 * 60_000).refresh.catch(() => {}) }, [])

  // Prefetch Gym chunks during idle time so navigating Play → Gym is instant.
  // Importing TrainTab also pulls in the recharts vendor-charts chunk as a dep.
  useEffect(() => {
    const fire = () => {
      import('../components/gym/gymShared.jsx').catch(() => {})
      import('../components/gym/TrainTab.jsx').catch(() => {})
    }
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(fire)
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(fire, 2000)
    return () => clearTimeout(id)
  }, [])

  // Auto-create a room on arrival (unless joining or spectating via link)
  useEffect(() => {
    if (spectateSlug) {
      if (pvpStatus === 'idle') joinRoom(spectateSlug, 'spectator')
    } else if (joinSlug) {
      if (pvpStatus === 'idle') joinRoom(joinSlug, 'player')
    } else if (pvpStatus === 'idle') {
      usePvpStore.getState().createRoom({ auto: true })
    }
  }, [pvpStatus])

  // Room abandoned (idle) — navigate to lobby after brief notification
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => {
      reset()
      navigate('/play', { replace: true })
    }, 3000)
    return () => clearTimeout(id)
  }, [abandoned])

  // Kicked (spectator idle) — navigate away immediately
  useEffect(() => {
    if (!kicked) return
    reset()
    navigate('/play', { replace: true })
  }, [kicked])

  // PvP flow — only show RoomLobby for manually created rooms
  if (pvpStatus === 'waiting' && role === 'host' && !isAutoRoom) return <RoomLobby />
  if (pvpStatus === 'waiting' && role === 'guest') return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      <p style={{ color: 'var(--text-secondary)' }}>Joining room…</p>
    </div>
  )

  if (pvpStatus === 'playing' || pvpStatus === 'finished') {
    // Room abandoned — show the message overlay instead of the board
    if (abandoned) {
      const iSelf = myMark != null  // players have a mark; spectators don't
      const wasMe = iSelf && abandoned.absentUserId === null  // we can't easily compare without userId
      return (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="text-4xl">💤</div>
          <p className="text-lg font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
            Room ended due to inactivity
          </p>
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            No result recorded. Returning to lobby…
          </p>
        </div>
      )
    }

    return (
      <>
        <div className="flex flex-col items-center w-full max-w-md mx-auto">
          <PvPBoard />
        </div>
        <IdleWarningPopup />
      </>
    )
  }

  // PvAI / AI-vs-AI flow
  const inGame = pvaiStatus !== 'idle' && (pvaiMode === 'pvai' || pvaiMode === 'aivai')
  if (inGame) return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto gap-4">
      <GameBoard roomName={displayName} />
      <InviteBar inviteUrl={inviteUrl} />
    </div>
  )

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      <ModeSelection
        inviteUrl={inviteUrl}
        roomName={displayName}
        onPvpJoin={(s) => usePvpStore.getState().joinRoom(s, 'player')}
      />
    </div>
  )
}

function InviteBar({ inviteUrl }) {
  const [copied, setCopied] = useState(false)
  if (!inviteUrl) return null
  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  return (
    <button
      onClick={handleCopy}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>👥</span>
      <span className="flex-1 text-left truncate font-mono" style={{ color: 'var(--text-muted)' }}>{inviteUrl}</span>
      <span className="font-semibold shrink-0" style={{ color: copied ? 'var(--color-teal-600)' : 'var(--color-blue-600)' }}>
        {copied ? '✓ Copied' : 'Invite'}
      </span>
    </button>
  )
}
