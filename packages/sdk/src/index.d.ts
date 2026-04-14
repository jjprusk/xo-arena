/**
 * @callidity/sdk — Platform contract types
 *
 * Every game package must satisfy the GameContract interface.
 * The platform creates a GameSDK instance and passes it into the game component.
 * Bots implement BotInterface so the platform can dispatch moves and run training.
 */

import type { ComponentType } from 'react'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A player seated at a table (human or bot). */
export interface Player {
  id: string
  displayName: string
  isBot: boolean
}

/** Outcome of a completed game, reported via sdk.signalEnd(). */
export interface GameResult {
  /** Player IDs in finishing order (winner first). Empty for draws. */
  rankings: string[]
  /** True when the game ends with no winner. */
  isDraw: boolean
  /**
   * Optional free-form data the game wants stored on the match record.
   * Use only for game-specific metadata (e.g. score, move count).
   * Do not duplicate rankings or isDraw here.
   */
  metadata?: Record<string, unknown>
}

/** A single move event delivered to all active subscribers. */
export interface MoveEvent {
  playerId: string
  move: unknown        // game-defined move representation
  /** Board state after this move has been applied. */
  state: unknown
  /** ISO timestamp from the server at the moment the move was committed. */
  timestamp: string
}

/** Game-level configuration set at table creation. Values are game-defined. */
export type GameSettings = Record<string, unknown>

// ---------------------------------------------------------------------------
// GameSession — passed as a prop into every game component
// ---------------------------------------------------------------------------

/**
 * Session context the platform provides to the game component.
 * Read-only from the game's perspective; mutate via sdk methods only.
 */
export interface GameSession {
  /** Stable identifier for this table/match. */
  tableId: string
  /** Game identifier matching GameMeta.id (e.g. 'xo', 'connect4'). */
  gameId: string
  /** All players seated at the table. */
  players: Player[]
  /**
   * The authenticated user viewing this game.
   * Null when the viewer is not signed in (public spectator).
   */
  currentUserId: string | null
  /**
   * True when currentUserId is NOT one of the seated players.
   * Games must disable input and hide private state when this is true.
   */
  isSpectator: boolean
  /** Settings chosen at table creation. */
  settings: GameSettings
}

// ---------------------------------------------------------------------------
// GameSDK — the platform interface the game component calls into
// ---------------------------------------------------------------------------

/**
 * SDK object passed as a prop into every game component.
 * Created and managed by the platform; one instance per active table.
 */
export interface GameSDK {
  /**
   * Submit a move for the current player.
   * The platform validates the move, commits it, and broadcasts it via onMove.
   * Throws if it is not the current player's turn or the game has ended.
   */
  submitMove(move: unknown): void

  /**
   * Register a handler that fires whenever any player makes a move.
   * Returns an unsubscribe function — call it in a useEffect cleanup.
   *
   * @example
   * useEffect(() => sdk.onMove(event => setState(event.state)), [sdk])
   */
  onMove(handler: (event: MoveEvent) => void): () => void

  /**
   * Signal that the game has ended.
   * Call this once when win/draw/forfeit is detected inside the game component.
   * The platform records the result, updates ELO, and handles table cleanup.
   */
  signalEnd(result: GameResult): void

  /**
   * Return the current list of seated players.
   * Identical to session.players but reflects mid-game changes (e.g. forfeits).
   */
  getPlayers(): Player[]

  /**
   * Return the table's GameSettings as configured at creation.
   */
  getSettings(): GameSettings

  /**
   * Register a handler that receives a live move feed for spectators.
   * Functionally equivalent to onMove but signals spectator intent to the platform.
   * Returns an unsubscribe function.
   */
  spectate(handler: (event: MoveEvent) => void): () => void

  /**
   * Return a lightweight snapshot of the current board state.
   * Called by the platform to populate Table.previewState after each move.
   * Must be cheap — avoid deep clones or complex computation.
   * The shape is game-defined and opaque to the platform.
   */
  getPreviewState(): unknown

  /**
   * Return the portion of game state visible to the given player.
   * Required for hidden-information games (Poker: hole cards are private).
   * For fully public games (XO, Connect4) this can return the full state.
   * The platform calls this before sending state to each client.
   */
  getPlayerState(playerId: string): unknown
}

// ---------------------------------------------------------------------------
// GameMeta — static metadata exported from every game package
// ---------------------------------------------------------------------------

/**
 * Game-specific CSS custom property overrides scoped to the game container.
 *
 * The platform applies these as inline styles on the element that wraps the game component,
 * giving each game its own visual identity without affecting platform-level tokens.
 *
 * Token naming convention: prefix all keys with '--game-' to avoid colliding with
 * platform tokens like '--color-*', '--bg-*', '--border-*'.
 *
 * Values may reference platform tokens via var() — the platform CSS variables
 * cascade into the container, so var(--color-blue-600) resolves correctly and
 * adapts automatically when dark mode is toggled.
 *
 * Import platformDefaultTheme from '@callidity/sdk' to explicitly declare that
 * your game uses the platform's default aesthetic.
 */
export interface GameTheme {
  /**
   * CSS custom property overrides applied in all color modes.
   * Keys should start with '--game-'.
   */
  tokens?: Record<string, string>
  /**
   * Additional overrides applied only in light mode, merged on top of tokens.
   * Use when a token needs a different raw value in light vs dark.
   * Not needed when token values reference platform vars (they adapt automatically).
   */
  light?: Record<string, string>
  /**
   * Additional overrides applied only in dark mode, merged on top of tokens.
   * Use when a token needs a different raw value in dark mode.
   * Not needed when token values reference platform vars (they adapt automatically).
   */
  dark?: Record<string, string>
}

/**
 * Layout preferences the game declares so the platform can size its container correctly.
 * Games should not hardcode their own container width — declare it here instead.
 *
 * Width mappings applied by the platform shell:
 *   compact  → max-w-sm  (384px)  — small grids, e.g. Tic-Tac-Toe
 *   standard → max-w-md  (448px)  — default; most turn-based games
 *   wide     → max-w-2xl (672px)  — broader boards, e.g. Connect4, Chess
 *   fullscreen → max-w-full       — complex strategy games needing the full viewport
 */
export interface GameLayout {
  /**
   * Preferred container width.
   * The platform applies the corresponding Tailwind max-w class to the game wrapper.
   * Defaults to 'standard' if omitted.
   */
  preferredWidth?: 'compact' | 'standard' | 'wide' | 'fullscreen'

  /**
   * Aspect ratio hint as a CSS ratio string (e.g. '1/1', '7/6', '4/3').
   * The platform uses this to pre-allocate vertical space and avoid layout shift
   * while the game component loads. Optional — omit for variable-height games.
   */
  aspectRatio?: string
}

export interface GameMeta {
  /**
   * Stable, lowercase identifier used throughout the platform.
   * Must be unique across all registered games. Examples: 'xo', 'connect4', 'poker'.
   */
  id: string

  /** Human-readable game title displayed in UI (e.g. 'Tic-Tac-Toe'). */
  title: string

  /** One-sentence description shown on the Tables page and game detail views. */
  description: string

  /** Path or URL to the game's icon. Displayed on table cards. */
  icon?: string

  /** Minimum number of players required to start a game. */
  minPlayers: number

  /** Maximum number of players allowed at the table. */
  maxPlayers: number

  /**
   * Layout preferences for the platform container.
   * Declare your game's preferred width here instead of hardcoding max-w in GameComponent.
   * Defaults to standard (max-w-md) if omitted.
   */
  layout?: GameLayout

  /**
   * Game-specific CSS custom property overrides.
   * The platform scopes these to the game container element as inline styles.
   * Omit to inherit platform defaults with no game-specific color overrides.
   * Use platformDefaultTheme from '@callidity/sdk' to explicitly declare default appearance.
   */
  theme?: GameTheme

  /**
   * True if the game supports bot opponents via BotInterface.makeMove.
   * If false, the platform will not offer bot-vs-human table options for this game.
   */
  supportsBots: boolean

  /**
   * True if the game supports bot skill training via BotInterface.train.
   * Enables the Gym tab in the platform shell.
   */
  supportsTraining: boolean

  /**
   * True if the game ships a puzzle set via BotInterface.puzzles.
   * Enables the Puzzles tab in the platform shell.
   */
  supportsPuzzles: boolean

  /**
   * Built-in bot personas bundled with this game.
   * Platform uses these to populate bot opponent options at table creation.
   * Empty array if supportsBots is false.
   */
  builtInBots: BotPersona[]
}

// ---------------------------------------------------------------------------
// GameContract — the full interface every game package must satisfy
// ---------------------------------------------------------------------------

/**
 * A game package must satisfy this contract:
 *
 *   export default GameComponent     // React component
 *   export { meta }                  // GameMeta
 *   export { botInterface }          // BotInterface (if supportsBots: true)
 *
 * The platform loads games via React.lazy:
 *   React.lazy(() => import('@callidity/game-xo'))
 */
export interface GameContract {
  /**
   * The game's React component. Receives session + sdk as props.
   * Must support both rendering modes:
   *   - Focused: active player, full viewport, platform chrome hidden
   *   - Chrome-present: spectator or idle, nav + sidebar visible
   * The platform sets the mode automatically based on session.isSpectator.
   */
  default: ComponentType<{ session: GameSession; sdk: GameSDK }>

  /** Static metadata. */
  meta: GameMeta

  /**
   * Bot and training implementation.
   * Required when meta.supportsBots is true.
   * Optional otherwise — the platform will not attempt to use it.
   */
  botInterface?: BotInterface
}

// ---------------------------------------------------------------------------
// BotInterface — the contract every game's AI implementation must satisfy
// ---------------------------------------------------------------------------

/** A named bot personality bundled with the game (or constructed at runtime for custom bots). */
export interface BotPersona {
  /**
   * Stable identifier (e.g. 'minimax-easy', 'ql-trained').
   * Current makeMove implementations dispatch on this field.
   * Future: platform will construct custom personas where id may be synthetic —
   * implementations should migrate to dispatching on algorithm + difficulty instead.
   */
  id: string
  /** Display name shown to players (e.g. 'Easy Bot', 'Trained AI'). */
  name: string
  /** Short description of the bot's playstyle. */
  description: string
  /**
   * Rough difficulty level for UI presentation and future makeMove dispatch.
   * Use this (not id) when the logic varies by difficulty.
   */
  difficulty: 'beginner' | 'easy' | 'medium' | 'hard' | 'expert'
  /**
   * Algorithm driving this persona (e.g. 'minimax', 'qlearning', 'alphazero').
   * Use this (not id) when the logic varies by algorithm.
   */
  algorithm: string
}

/** Configuration for a training session, returned by BotInterface.getTrainingConfig. */
export interface TrainingConfig {
  /** Algorithm to use. Must match an algorithm implemented in packages/ai. */
  algorithm: string
  /** Suggested default episode count. User may override in the Gym UI. */
  defaultEpisodes: number
  /**
   * Algorithm-specific hyperparameter schema.
   * The platform renders these as controls in the Gym UI.
   * Each key maps to a parameter definition.
   */
  hyperparameters: Record<string, HyperparameterDef>
}

/**
 * Resolved training parameters passed into BotInterface.train().
 * Built by the platform after the user configures and starts a session in the Gym UI.
 * Also the natural shape to log or store for training history.
 */
export interface TrainingRun {
  /** Algorithm to use — must match a key the game's train() implementation recognises. */
  algorithm: string
  /** Number of episodes to run. */
  episodes: number
  /**
   * Resolved hyperparameter values keyed by the same names as TrainingConfig.hyperparameters.
   * e.g. { learningRate: 0.3, discountFactor: 0.9, decayMethod: 'cosine' }
   */
  params: Record<string, unknown>
}

/** Describes a single configurable hyperparameter for Gym UI rendering. */
export interface HyperparameterDef {
  label: string
  type: 'number' | 'select' | 'boolean'
  default: unknown
  /** For type: 'number' */
  min?: number
  max?: number
  step?: number
  /** For type: 'select' */
  options?: Array<{ value: string; label: string }>
  description?: string
}

/** Progress update emitted during training. */
export interface TrainingProgress {
  episode: number
  totalEpisodes: number
  outcome: 'WIN' | 'LOSS' | 'DRAW'
  epsilon?: number
  avgQDelta?: number
}

/** Summary returned when a training session completes. */
export interface TrainingResult {
  episodesCompleted: number
  winRate: number
  lossRate: number
  drawRate: number
  finalEpsilon?: number
  /**
   * Serialized weights to be stored in BotSkill.weights.
   * The platform persists this value; the game is responsible for the schema.
   */
  weights: unknown
}

/** Props passed by the platform into the game's GymComponent. */
export interface GymProps {
  /** Bot user ID for the bot being trained. */
  botId: string
  /** Game identifier. */
  gameId: string
  /**
   * Current persisted weights for this bot's skill (from BotSkill.weights).
   * Null if the bot has never been trained for this game.
   */
  currentWeights: unknown | null
  /** Called by GymComponent when training completes. Platform persists the result. */
  onTrainingComplete: (result: TrainingResult) => void
  /** Called to stream progress updates to the platform UI during training. */
  onProgress?: (progress: TrainingProgress) => void
}

/**
 * A single puzzle — a pre-set board position with a known best move.
 * The platform renders puzzles in the Puzzles tab using the game component.
 */
export interface Puzzle {
  id: string
  title: string
  description: string
  /** Difficulty shown in the Puzzles tab. */
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  /**
   * Initial board state in the game's own representation.
   * Passed directly to the game component via session.
   */
  initialState: unknown
  /**
   * The correct move(s). Used to evaluate the player's answer.
   * Game-defined; may be a single value or an array of equivalent solutions.
   */
  solution: unknown
  /** Which player is to move in this puzzle position. */
  playerMark: string
}

/**
 * The complete bot and training interface a game must export.
 *
 * The platform calls:
 *   - makeMove() server-side for every bot turn
 *   - getTrainingConfig() when opening the Gym tab
 *   - train() in a server worker when the user starts a session
 *   - serializeState() / deserializeMove() for move storage and replay
 *
 * The game component receives GymComponent via the Gym tab in the platform shell.
 */
export interface BotInterface {
  /**
   * Choose a move for the given board state.
   * Called server-side; must be synchronous and stateless.
   *
   * @param state    Current board state in the game's own representation.
   * @param playerId The bot player's ID (used to determine which mark the bot holds).
   * @param persona  The full BotPersona object. Current implementations may use only
   *                 persona.id to dispatch to their internal logic. Future platform
   *                 versions will support custom personas (arbitrary algorithm/difficulty
   *                 combinations) — implementations should plan to use persona.algorithm
   *                 and persona.difficulty rather than persona.id when that work lands.
   * @param weights  Persisted skill weights (null if untrained — fall back to default AI).
   * @returns        A move value in the game's own representation.
   */
  makeMove(
    state: unknown,
    playerId: string,
    persona: BotPersona,
    weights: unknown | null,
  ): unknown

  /**
   * Return the training configuration for this game.
   * The platform calls this once when the Gym tab is opened.
   */
  getTrainingConfig(): TrainingConfig

  /**
   * Run a training session and return the result.
   * Called in a server worker; may be long-running.
   * Must call onProgress periodically so the platform can stream updates to the UI.
   *
   * @param run          Resolved training parameters chosen by the user in the Gym UI.
   * @param currentWeights  Existing weights to continue from (null = start fresh).
   * @param onProgress   Callback to emit progress events.
   */
  train(
    run: TrainingRun,
    currentWeights: unknown | null,
    onProgress: (progress: TrainingProgress) => void,
  ): Promise<TrainingResult>

  /**
   * Serialize the current game state to a storable representation.
   * Used for replay storage and bot state transfer.
   */
  serializeState(state: unknown): unknown

  /**
   * Deserialize a raw stored move back to the game's move representation.
   * Used during replay and when re-hydrating state.
   */
  deserializeMove(raw: unknown): unknown

  /**
   * Named bot personalities this game ships with.
   * Must be non-empty when BotInterface is exported.
   */
  personas: BotPersona[]

  /**
   * Gym UI component for this game.
   * Rendered in the Gym tab of the platform shell.
   * Required when meta.supportsTraining is true.
   */
  GymComponent?: ComponentType<GymProps>

  /**
   * Curated puzzle set for this game.
   * Required when meta.supportsPuzzles is true.
   */
  puzzles?: Puzzle[]
}
