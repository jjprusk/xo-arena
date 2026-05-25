// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * @callidity/game-connect-four — Connect Four game package.
 *
 * SDK contract surface declared here. Phase B1 ships:
 *   - engine (logic.js) + serializer (serializer.js) — chunk 1
 *   - meta + botInterface (this file's exports) — chunk 2
 *   - master solver (master.js) wired into the Master persona — chunk 3
 *
 * B2 adds the React `default` export (GameComponent) and `PreviewComponent`.
 * Until then this package is headless — fully usable from a Node script,
 * not yet renderable in the browser.
 *
 * Engine logic stays in this package; the platform sees only the SDK
 * contract surface declared here. SDK extensions for C4 (matchFormat,
 * masterStrategy) live in `packages/sdk/src/index.d.ts` per the plan's
 * policy in `doc/Connect_Four_Implementation_Plan.md`.
 */

export * from './logic.js'
export * from './serializer.js'
export { meta }          from './meta.js'
export { botInterface }  from './botInterface.js'
// Master-tier solver is re-exported for direct programmatic use (e.g.
// puzzle generation, training-vs-master eval). Most callers should go
// through `botInterface.makeMove` with the master persona.
export {
  bestMove as masterBestMove,
  masterSearch,
  masterEvaluate,
  createTT,
  DEFAULT_MASTER_DEPTH,
} from './master.js'
