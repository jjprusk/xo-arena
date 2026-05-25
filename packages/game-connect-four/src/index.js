// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * @callidity/game-connect-four — Connect Four game package.
 *
 * Phase B1 ships engine + serializer only. Subsequent B-sprints add the
 * SDK contract surface:
 *   - B1.4 + B1.5 → meta export + botInterface (minimax tiers + training hooks)
 *   - B1.6        → master solver (perfect play, off-ladder)
 *   - B2         → GameComponent (UI) and BoardPreview
 *
 * Engine logic stays in this package — the platform sees only the SDK
 * contract surface declared above. If platform code needs something C4-
 * specific, the SDK gets extended (per the policy in
 * `doc/Connect_Four_Implementation_Plan.md`).
 */

export * from './logic.js'
export * from './serializer.js'
