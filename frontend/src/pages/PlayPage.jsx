import React, { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.js'
import { usePvpStore } from '../store/pvpStore.js'
import ModeSelection from '../components/game/ModeSelection.jsx'
import GameBoard from '../components/game/GameBoard.jsx'
import RoomLobby from '../components/room/RoomLobby.jsx'
import PvPBoard from '../components/room/PvPBoard.jsx'

export default function PlayPage() {
  const [searchParams] = useSearchParams()
  const joinSlug = searchParams.get('join')

  const { status: pvaiStatus, mode: pvaiMode } = useGameStore()
  const { status: pvpStatus, joinRoom, role, slug, isAutoRoom, displayName } = usePvpStore()

  const inviteUrl = slug ? `${window.location.origin}/play?join=${slug}` : ''

  // Auto-create a room on arrival (unless joining via invite link)
  useEffect(() => {
    if (joinSlug) {
      if (pvpStatus === 'idle') joinRoom(joinSlug, 'player')
    } else if (pvpStatus === 'idle') {
      usePvpStore.getState().createRoom({ auto: true })
    }
  }, [pvpStatus])

  // PvP flow — only show RoomLobby for manually created rooms
  if (pvpStatus === 'waiting' && role === 'host' && !isAutoRoom) return <RoomLobby />
  if (pvpStatus === 'waiting' && role === 'guest') return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      <p style={{ color: 'var(--text-secondary)' }}>Joining room…</p>
    </div>
  )
  if (pvpStatus === 'playing' || pvpStatus === 'finished') return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      <PvPBoard />
    </div>
  )

  // PvAI flow
  const inGame = pvaiStatus !== 'idle' && pvaiMode === 'pvai'
  if (inGame) return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      <GameBoard inviteUrl={inviteUrl} />
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
