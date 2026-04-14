// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useGameStore } from '../store/gameStore.js'
import { usePvpStore } from '../store/pvpStore.js'

/**
 * Returns true when the user is actively in a game (hva or hvh).
 * Used to block Guide auto-open mid-game while still allowing the orb to pulse.
 */
export function useIsInGame() {
  const hvaStatus = useGameStore(s => s.status)
  const hvhStatus = usePvpStore(s => s.status)
  return hvaStatus === 'playing' || hvhStatus === 'playing'
}
