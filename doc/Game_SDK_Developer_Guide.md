<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# AI Arena — Game SDK Developer Guide

> This document is the authoritative reference for building games on the AI Arena platform.
> It covers the full game contract, SDK methods, bot and training interfaces, and publishing workflow.
> Game implementations — including the XO reference implementation — should be built and reviewed against this document alone.

---

## Contents

1. [Overview](#overview)
2. [Package Structure](#package-structure)
3. [The Game Contract](#the-game-contract)
4. [GameMeta](#gamemeta)
   - [Layout](#layout)
   - [Theme](#theme)
5. [GameSession](#gamesession)
6. [GameSDK](#gamesdk)
   - submitMove · onMove · signalEnd · getPlayers · getSettings · spectate · getPreviewState · getPlayerState
7. [Rendering Modes](#rendering-modes)
8. [Game Component](#game-component)
9. [BotInterface](#botinterface)
   - Bot Personas · makeMove · getTrainingConfig · train · serializeState · deserializeMove
10. [GymComponent](#gymcomponent)
11. [Puzzles](#puzzles)
12. [Using packages/ai](#using-packagesai)
13. [Multiple Skills Per Bot](#multiple-skills-per-bot)
14. [Publishing to GitHub Packages](#publishing-to-github-packages)

**Addendum — XO Reference Implementation**

- [XO Refactoring Checklist](#xo-refactoring-checklist)
- [Type Reference](#type-reference)

---

## Overview

AI Arena is a multi-game platform. Games are independent packages that implement a strict contract. The platform loads any registered game via `React.lazy` and provides a runtime SDK object for all platform communication.

A game package has three responsibilities:

1. **Render the game** — a React component that receives `session` and `sdk` as props
2. **Describe itself** — a `meta` export with game metadata
3. **Support bots** — a `botInterface` export with AI and training logic (required if `meta.supportsBots` is true)

Games have no knowledge of sockets, auth, routing, or platform internals. All platform communication goes through the SDK.

---

## Package Structure

```
packages/game-xo/
  package.json
  src/
    index.js          -- package entry point (exports default, meta, botInterface)
    GameComponent.jsx -- the playable React component
    meta.js           -- GameMeta export
    botInterface.js   -- BotInterface export
    logic.js          -- pure game logic (no platform dependencies)
    adapters.js       -- AI input/output adapters for packages/ai algorithms
```

### package.json

```json
{
  "name": "@callidity/game-xo",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

### Entry point (src/index.js)

```js
export { default } from './GameComponent.jsx'
export { meta }         from './meta.js'
export { botInterface } from './botInterface.js'
```

The platform loads the package via:

```js
React.lazy(() => import('@callidity/game-xo'))
```

---

## The Game Contract

Every game package must satisfy this shape:

```ts
{
  default:      React.ComponentType<{ session: GameSession; sdk: GameSDK }>
  meta:         GameMeta
  botInterface?: BotInterface   // required when meta.supportsBots is true
}
```

---

## GameMeta

Static metadata the platform reads at registration time.

```js
// src/meta.js
export const meta = {
  id:               'xo',
  title:            'Tic-Tac-Toe',
  description:      'Classic 3x3 strategy game. First to three in a row wins.',
  icon:             '/icons/xo.svg',
  minPlayers:       2,
  maxPlayers:       2,
  layout: {
    preferredWidth: 'compact',   // max-w-sm — small square board
    aspectRatio:    '1/1',       // pre-allocates square space while loading
  },
  supportsBots:     true,
  supportsTraining: true,
  supportsPuzzles:  true,
  builtInBots:      [ /* BotPersona[] — see Bot Personas section */ ],
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable, lowercase, unique across all games. Used as a key throughout the platform. |
| `title` | `string` | Human-readable name shown in UI. |
| `description` | `string` | One sentence shown on table cards and game detail views. |
| `icon` | `string?` | Path or URL to game icon. |
| `minPlayers` | `number` | Minimum seated players to start. |
| `maxPlayers` | `number` | Maximum players allowed at the table. |
| `layout` | `GameLayout?` | Container sizing preferences. Defaults to `standard` if omitted. See Layout below. |
| `supportsBots` | `boolean` | Enables bot opponent options at table creation. |
| `supportsTraining` | `boolean` | Enables Gym tab in the platform shell. |
| `supportsPuzzles` | `boolean` | Enables Puzzles tab in the platform shell. |
| `builtInBots` | `BotPersona[]` | Bot personalities bundled with the game. Empty array if `supportsBots` is false. |

### Layout

Games declare their preferred container width via `meta.layout` instead of hardcoding `max-w-*` classes inside `GameComponent`. The platform reads this at render time and applies the correct Tailwind class to the wrapper.

```ts
interface GameLayout {
  preferredWidth?: 'compact' | 'standard' | 'wide' | 'fullscreen'
  aspectRatio?:    string   // CSS ratio string, e.g. '1/1', '7/6', '4/3'
}
```

| `preferredWidth` | Tailwind class | Width | Use case |
|---|---|---|---|
| `compact` | `max-w-sm` | 384 px | Small grids — Tic-Tac-Toe, Checkers |
| `standard` | `max-w-md` | 448 px | Default; most turn-based games |
| `wide` | `max-w-2xl` | 672 px | Broader boards — Connect4, Chess |
| `fullscreen` | `max-w-full` | viewport | Complex strategy games |

`aspectRatio` is an optional hint the platform uses to pre-allocate vertical space before the game component finishes loading, preventing layout shift. Use a CSS ratio string (`'1/1'`, `'7/6'`, `'4/3'`). Omit it for variable-height games.

**GameComponent must not apply its own `max-w-*` class.** The platform container is already sized; adding a width constraint inside the component creates double-nesting and breaks the wide/fullscreen modes.

### Theme

Games declare visual identity via `meta.theme`. The platform applies these as CSS custom properties (inline styles) scoped to the game container element. This gives each game its own color identity without polluting global platform tokens.

```ts
interface GameTheme {
  tokens?: Record<string, string>   // applied in all color modes
  light?:  Record<string, string>   // merged on top of tokens in light mode only
  dark?:   Record<string, string>   // merged on top of tokens in dark mode only
}
```

Token keys should start with `--game-` to avoid collisions with platform tokens (`--color-*`, `--bg-*`, etc.).

Token values may reference platform CSS variables via `var()`. Since platform variables already adapt when dark mode is toggled (via the `.dark` class on `<html>`), `light`/`dark` overrides are only needed when a token value is a raw color rather than a `var()` reference.

**Platform default tokens** (what games get when no theme is declared or when using `platformDefaultTheme`):

| Token | Light & Dark value | Purpose |
|---|---|---|
| `--game-mark-x` | `var(--color-blue-600)` → `#1A6FD4` | X player mark color |
| `--game-mark-o` | `var(--color-teal-600)` → `#1D9E75` | O player mark color |
| `--game-cell-win-bg` | `var(--color-amber-100)` → `#FAEEDA` | Winning cell background |
| `--game-cell-win-border` | `var(--color-amber-500)` → `#D4891E` | Winning cell border |

**Usage — explicitly declare platform defaults:**

```js
import { platformDefaultTheme } from '@callidity/sdk'

export const meta = {
  // ...
  theme: platformDefaultTheme,
}
```

**Usage — custom game identity:**

```js
theme: {
  tokens: {
    '--game-mark-x': '#e63946',    // red discs (raw value — requires dark override if needed)
    '--game-mark-o': '#f4d03f',    // yellow discs
    '--game-board-bg': '#1a5276',  // game-specific token consumed by GameComponent
  },
  dark: {
    '--game-mark-x': '#ff6b6b',    // lighter red for dark mode legibility
  },
}
```

**Usage — spread defaults and override one token:**

```js
import { platformDefaultTheme } from '@callidity/sdk'

theme: {
  ...platformDefaultTheme,
  tokens: {
    ...platformDefaultTheme.tokens,
    '--game-mark-x': 'var(--color-red-600)',   // red X, everything else unchanged
  },
}
```

**In GameComponent**, reference `var(--game-*)` tokens instead of hardcoded platform tokens:

```js
// Do this — reads from the game container's scoped tokens
const MARK_COLOR = { X: 'var(--game-mark-x)', O: 'var(--game-mark-o)' }

// Not this — bypasses the theme system
const MARK_COLOR = { X: 'var(--color-blue-600)', O: 'var(--color-teal-600)' }
```

---

## GameSession

The platform passes a `session` prop into every game component. It is read-only — never mutate it directly; use SDK methods instead.

```ts
interface GameSession {
  tableId:       string           // stable identifier for this table/match
  gameId:        string           // matches meta.id
  players:       Player[]         // all seated players
  currentUserId: string | null    // authenticated viewer; null for public spectators
  isSpectator:   boolean          // true when currentUserId is not a seated player
  settings:      GameSettings     // table configuration set at creation
}

interface Player {
  id:          string
  displayName: string
  isBot:       boolean
}

type GameSettings = Record<string, unknown>  // game-defined keys
```

**`isSpectator`** is the key field for rendering mode. See Rendering Modes below.

---

## GameSDK

The SDK object is passed as a prop alongside `session`. It is the only channel between a game and the platform.

```ts
interface GameSDK {
  submitMove(move: unknown): void
  onMove(handler: (event: MoveEvent) => void): () => void
  signalEnd(result: GameResult): void
  getPlayers(): Player[]
  getSettings(): GameSettings
  spectate(handler: (event: MoveEvent) => void): () => void
  getPreviewState(): unknown
  getPlayerState(playerId: string): unknown
}
```

### sdk.submitMove(move)

Submit a move for the current player. The platform validates, commits, and broadcasts it.

- Throws if it is not the current player's turn
- Throws if the game has already ended
- `move` is game-defined — any JSON-serializable value

```js
// XO example: move is the cell index 0-8
sdk.submitMove(cellIndex)
```

### sdk.onMove(handler) --> unsubscribe

Register a handler that fires for every move (own or opponent). Returns an unsubscribe function for `useEffect` cleanup.

```js
useEffect(() => {
  return sdk.onMove(event => {
    setBoard(event.state.board)
    setCurrentTurn(event.state.currentTurn)
  })
}, [sdk])
```

```ts
interface MoveEvent {
  playerId:  string    // who made the move
  move:      unknown   // the move value as passed to submitMove
  state:     unknown   // full game state after this move
  timestamp: string    // ISO timestamp from the server
}
```

### sdk.signalEnd(result)

Signal that the game has ended. Call exactly once when win, draw, or forfeit is detected.

The platform records the result, updates ELO, and handles table cleanup.

```js
sdk.signalEnd({
  rankings: [winnerId, loserId],  // ordered: winner first
  isDraw:   false,
})

// Draw:
sdk.signalEnd({ rankings: [], isDraw: true })
```

```ts
interface GameResult {
  rankings:  string[]                    // player IDs, winner first; empty for draws
  isDraw:    boolean
  metadata?: Record<string, unknown>     // optional game-specific data (score, move count, etc.)
}
```

### sdk.getPlayers() --> Player[]

Returns the current seated players. Equivalent to `session.players` but reflects mid-game changes such as forfeits.

### sdk.getSettings() --> GameSettings

Returns the table's configuration as set at creation. Values are game-defined.

```js
// Table creation might set: { timeControlSeconds: 30 }
const { timeControlSeconds } = sdk.getSettings()
```

### sdk.spectate(handler) --> unsubscribe

Identical to `onMove` but signals spectator intent to the platform. Use this instead of `onMove` when the viewer is not an active player.

```js
useEffect(() => {
  if (session.isSpectator) {
    return sdk.spectate(event => setBoard(event.state.board))
  }
  return sdk.onMove(event => setBoard(event.state.board))
}, [sdk, session.isSpectator])
```

### sdk.getPreviewState() --> unknown

Return a lightweight snapshot of the current board state. The platform calls this after each move to update the table card thumbnail on the Tables page.

- Must be cheap and synchronous
- Return only what is needed to render a preview — not the full game state
- Shape is game-defined and opaque to the platform

```js
// XO example
sdk.getPreviewState = () => ({ board: [...board] })
```

### sdk.getPlayerState(playerId) --> unknown

Return the portion of game state visible to the given player. Required for hidden-information games. For fully public games (XO, Connect4) return the full state.

The platform calls this before sending state to each client, ensuring players only see what they are entitled to see.

```js
// XO: fully public — all players see the same state
sdk.getPlayerState = (playerId) => ({ board, currentTurn, winner })

// Poker (example): hole cards are private
sdk.getPlayerState = (playerId) => ({
  communityCards,
  pot,
  holeCards: playerId === ownerId ? myHoleCards : null,
})
```

---

## Rendering Modes

The platform shell operates in two modes, derived automatically from `session.isSpectator`:

| Mode | When | What the platform does |
|---|---|---|
| **Focused** | `isSpectator === false` (active player) | Full viewport, nav and sidebar hidden, floating "Back to Arena" escape affordance shown |
| **Chrome-present** | `isSpectator === true` (spectator, observer, replay viewer) | Nav and table context sidebar visible, game rendered in the content area |

**The game does not receive a mode prop.** It reads `session.isSpectator` directly.

Required game behaviour by mode:

- **Focused:** all input enabled; game fills available space
- **Chrome-present:** all input disabled; game renders in a constrained content area; no cursor changes suggesting interactivity

```jsx
// Pattern for handling both modes
function GameComponent({ session, sdk }) {
  const canPlay = !session.isSpectator

  return (
    <div className={session.isSpectator ? 'game-spectator' : 'game-focused'}>
      <Board
        onCellClick={canPlay ? handleCellClick : undefined}
        interactive={canPlay}
      />
    </div>
  )
}
```

---

## Game Component

The default export is a standard React component. It receives exactly two props: `session` and `sdk`.

```jsx
// src/GameComponent.jsx
export default function GameComponent({ session, sdk }) {
  const [board, setBoard] = useState(Array(9).fill(null))
  const [currentTurn, setCurrentTurn] = useState('X')

  // Subscribe to moves
  useEffect(() => {
    return sdk.onMove(event => {
      setBoard(event.state.board)
      setCurrentTurn(event.state.currentTurn)
    })
  }, [sdk])

  function handleCellClick(index) {
    if (session.isSpectator) return
    sdk.submitMove(index)
  }

  return (
    <Board
      board={board}
      onCellClick={handleCellClick}
      interactive={!session.isSpectator}
    />
  )
}
```

**Rules:**
- No direct socket calls — all communication through `sdk`
- No platform imports (`auth`, `router`, `notificationStore`, etc.)
- No hardcoded player marks — derive from `session.players` and `session.currentUserId`
- `signalEnd` must be called exactly once when the game concludes

---

## BotInterface

Required when `meta.supportsBots` is true. Exported as a named export from the package entry point.

```js
export const botInterface = {
  makeMove,
  getTrainingConfig,
  train,
  serializeState,
  deserializeMove,
  personas,
  GymComponent,
  puzzles,
}
```

### Bot Personas

A persona is a named bot personality bundled with the game. The platform displays personas as opponent choices at table creation.

```js
export const personas = [
  {
    id:         'minimax-easy',
    name:       'Easy Bot',
    description:'Makes mistakes on purpose. Good for beginners.',
    difficulty: 'easy',
    algorithm:  'minimax',
  },
  {
    id:         'minimax-hard',
    name:       'Perfect Play',
    description:'Never loses. Uses full-depth minimax.',
    difficulty: 'expert',
    algorithm:  'minimax',
  },
  {
    id:         'ql-trained',
    name:       'Trained AI',
    description:'Learns from experience. Improves with training.',
    difficulty: 'medium',
    algorithm:  'qlearning',
  },
]
```

```ts
interface BotPersona {
  id:          string    // stable identifier
  name:        string    // display name
  description: string    // short playstyle description
  difficulty:  'beginner' | 'easy' | 'medium' | 'hard' | 'expert'
  algorithm:   string    // 'minimax' | 'qlearning' | 'alphazero' | etc.
}
```

**Dispatch guidance:**

Current implementations may dispatch on `persona.id`. Future platform versions will support custom personas constructed at runtime — migrate dispatch to `persona.algorithm` + `persona.difficulty` when that work lands.

```js
// Current: dispatch on id
function makeMove(state, playerId, persona, weights) {
  if (persona.id === 'minimax-easy') return minimaxBot(state, { depth: 2 })
  if (persona.id === 'minimax-hard') return minimaxBot(state, { depth: 9 })
  if (persona.id === 'ql-trained')   return qlBot(state, weights)
}

// Future-ready: dispatch on algorithm + difficulty
function makeMove(state, playerId, persona, weights) {
  if (persona.algorithm === 'minimax') {
    const depth = { easy: 2, medium: 5, hard: 7, expert: 9 }[persona.difficulty]
    return minimaxBot(state, { depth })
  }
  if (persona.algorithm === 'qlearning') return qlBot(state, weights)
}
```

### botInterface.makeMove(state, playerId, persona, weights) --> move

Called server-side by the platform whenever a bot must act. Must be **synchronous** and **stateless**.

```ts
makeMove(
  state:    unknown,          // current game state
  playerId: string,           // the bot's player ID
  persona:  BotPersona,       // which persona is playing
  weights:  unknown | null,   // trained skill weights, or null if untrained
): unknown                    // a move value suitable for sdk.submitMove
```

```js
function makeMove(state, playerId, persona, weights) {
  const mark = getMarkForPlayer(state, playerId)  // derive 'X' or 'O' from state

  if (persona.algorithm === 'minimax') {
    return minimaxMove(state.board, mark, persona.difficulty)
  }

  if (persona.algorithm === 'qlearning') {
    if (!weights) return randomMove(state.board)  // fallback if untrained
    const engine = new QLearningEngine()
    engine.loadQTable(weights)
    return engine.chooseAction(state.board, false)  // false = exploit only
  }
}
```

### botInterface.getTrainingConfig() --> TrainingConfig

Called once when the Gym tab is opened. Returns the schema of algorithms and hyperparameters available for this game.

```ts
interface TrainingConfig {
  algorithm:       string                          // default algorithm
  defaultEpisodes: number
  hyperparameters: Record<string, HyperparameterDef>
}

interface HyperparameterDef {
  label:       string
  type:        'number' | 'select' | 'boolean'
  default:     unknown
  min?:        number      // for type: 'number'
  max?:        number
  step?:       number
  options?:    Array<{ value: string; label: string }>  // for type: 'select'
  description?: string
}
```

```js
function getTrainingConfig() {
  return {
    algorithm:       'qlearning',
    defaultEpisodes: 5000,
    hyperparameters: {
      learningRate: {
        label:   'Learning Rate',
        type:    'number',
        default: 0.3,
        min:     0.01,
        max:     1.0,
        step:    0.01,
      },
      discountFactor: {
        label:   'Discount Factor',
        type:    'number',
        default: 0.9,
        min:     0.5,
        max:     1.0,
        step:    0.01,
      },
      decayMethod: {
        label:   'Epsilon Decay',
        type:    'select',
        default: 'exponential',
        options: [
          { value: 'exponential', label: 'Exponential' },
          { value: 'linear',      label: 'Linear' },
          { value: 'cosine',      label: 'Cosine' },
        ],
      },
    },
  }
}
```

The platform renders these as form controls in the Gym UI. The user adjusts values and hits Train. The platform then calls `train()` with a `TrainingRun` containing the resolved values.

### botInterface.train(run, currentWeights, onProgress) --> Promise\<TrainingResult\>

Runs a training session server-side. May be long-running. Must call `onProgress` periodically so the platform can stream updates to the Gym UI.

```ts
interface TrainingRun {
  algorithm: string
  episodes:  number
  params:    Record<string, unknown>  // resolved hyperparameter values
}

interface TrainingProgress {
  episode:        number
  totalEpisodes:  number
  outcome:        'WIN' | 'LOSS' | 'DRAW'
  epsilon?:       number
  avgQDelta?:     number
}

interface TrainingResult {
  episodesCompleted: number
  winRate:           number
  lossRate:          number
  drawRate:          number
  finalEpsilon?:     number
  weights:           unknown  // serialized weights to be stored in BotSkill.weights
}
```

```js
async function train(run, currentWeights, onProgress) {
  const engine = new QLearningEngine({
    learningRate:   run.params.learningRate,
    discountFactor: run.params.discountFactor,
    decayMethod:    run.params.decayMethod,
  })

  if (currentWeights) engine.loadQTable(currentWeights)

  let wins = 0, losses = 0, draws = 0

  for (let i = 1; i <= run.episodes; i++) {
    const result = runEpisode(engine, 'both', null)

    if (result.outcome === 'WIN')  wins++
    if (result.outcome === 'LOSS') losses++
    if (result.outcome === 'DRAW') draws++

    if (i % 100 === 0) {
      onProgress({
        episode:       i,
        totalEpisodes: run.episodes,
        outcome:       result.outcome,
        epsilon:       engine.epsilon,
        avgQDelta:     result.avgQDelta,
      })
    }
  }

  return {
    episodesCompleted: run.episodes,
    winRate:           wins   / run.episodes,
    lossRate:          losses / run.episodes,
    drawRate:          draws  / run.episodes,
    finalEpsilon:      engine.epsilon,
    weights:           engine.toJSON(),
  }
}
```

**Resuming training:** `currentWeights` is the previously stored value from `BotSkill.weights`. Pass `null` on first training. The platform handles persistence — the game just receives weights in and returns updated weights out.

### botInterface.serializeState(state) --> unknown

Convert the current game state to a format suitable for storage and replay. Called by the platform on each move to build the move stream.

```js
function serializeState(state) {
  return {
    board:       state.board,
    currentTurn: state.currentTurn,
    winner:      state.winner,
  }
}
```

### botInterface.deserializeMove(raw) --> move

Convert a raw stored move back to the game's move representation. Used during replay and when re-hydrating state.

```js
function deserializeMove(raw) {
  return Number(raw)  // XO moves are cell indices stored as numbers
}
```

---

## GymComponent

The game's training UI. Rendered in the Gym tab of the platform shell. Required when `meta.supportsTraining` is true.

The platform passes a `GymProps` object:

```ts
interface GymProps {
  botId:               string           // bot being trained
  gameId:              string
  currentWeights:      unknown | null   // existing weights from BotSkill.weights
  onTrainingComplete:  (result: TrainingResult) => void
  onProgress?:         (progress: TrainingProgress) => void
}
```

The `GymComponent` is responsible for rendering training controls, triggering `botInterface.train()`, and calling `onTrainingComplete` when done. The platform persists the result.

```jsx
export function GymComponent({ botId, gameId, currentWeights, onTrainingComplete, onProgress }) {
  const [config, setConfig] = useState(null)

  useEffect(() => {
    setConfig(botInterface.getTrainingConfig())
  }, [])

  async function handleStartTraining(userParams) {
    const run = {
      algorithm: config.algorithm,
      episodes:  userParams.episodes,
      params:    userParams,
    }
    const result = await botInterface.train(run, currentWeights, onProgress)
    onTrainingComplete(result)
  }

  return <TrainingForm config={config} onStart={handleStartTraining} />
}
```

---

## Puzzles

The game's curated puzzle set. Rendered in the Puzzles tab. Required when `meta.supportsPuzzles` is true.

```ts
interface Puzzle {
  id:           string
  title:        string
  description:  string
  difficulty:   'beginner' | 'intermediate' | 'advanced'
  initialState: unknown   // game-defined starting board position
  solution:     unknown   // correct move or array of equivalent moves
  playerMark:   string    // which player is to move ('X', 'O', etc.)
}
```

```js
export const puzzles = [
  {
    id:           'xo-p1',
    title:        'Win in One',
    description:  'X can win immediately. Find the move.',
    difficulty:   'beginner',
    initialState: { board: ['X', 'O', 'X', null, 'O', null, null, null, null], currentTurn: 'X' },
    solution:     6,   // cell index
    playerMark:   'X',
  },
  // ...
]
```

The platform renders puzzles using the game component with input restricted to a single move, then calls `deserializeMove` to compare the player's move against `solution`.

---

## Using packages/ai

`packages/ai` is the platform-level shared AI library. Games import algorithms from it — they do not re-implement them.

**Available algorithms:**

| Class | Algorithm | Best for |
|---|---|---|
| `QLearningEngine` | Q-Learning (tabular) | Small state spaces (XO, Connect4) |
| `SARSAEngine` | SARSA (tabular) | Same as Q-Learning |
| `DQNEngine` | Deep Q-Network | Larger state spaces |
| `NeuralNet` | Supervised neural net | Pattern recognition |
| `MonteCarloEngine` | Monte Carlo Tree Search | Strategy games |
| `PolicyGradientEngine` | Policy Gradient | Complex environments |
| `AlphaZeroEngine` | AlphaZero (MCTS + neural net) | Strongest play, highest compute |
| `minimaxImplementation` | Minimax + alpha-beta | Perfect play in small trees |
| `ruleBasedImplementation` | Heuristic rules | Fast, predictable difficulty |

**Import:**

```js
import { QLearningEngine, runEpisode, AlphaZeroEngine } from '@xo-arena/ai'
```

**Game adapters** (game-specific, implemented in `adapters.js`):

The algorithms are general-purpose. Games provide three adapter functions:

```js
// serializeState: board --> model input (for neural net / DQN / AlphaZero)
function serializeState(board) {
  return board.map(cell => cell === 'X' ? 1 : cell === 'O' ? -1 : 0)
  // XO: 9-element vector. Connect4 would be 42-element, etc.
}

// deserializeMove: model output --> valid move index
function deserializeMove(output) {
  // output is a probability distribution over all actions
  // mask illegal moves (occupied cells) then take the argmax
  return legalMoves.reduce((best, idx) => output[idx] > output[best] ? idx : best)
}

// getLegalMoves: needed by MCTS, minimax, masked softmax
function getLegalMoves(board) {
  return board.map((cell, i) => cell === null ? i : -1).filter(i => i >= 0)
}
```

---

## Multiple Skills Per Bot

Each bot can hold one skill per game:

- **XO bot** can have an XO skill (weights trained on XO)
- The same bot, when Connect4 ships, can earn a Connect4 skill
- Skills are independent — training XO does not affect Connect4

One skill per `(botId, gameId)` — enforced by a unique constraint. The skill records which algorithm was used (`BotSkill.algorithm`), so `makeMove` always knows how to deserialize the weights.

If a user wants the same game trained with a different algorithm, they create a new bot. Each bot has one identity, one playstyle, one algorithm per game.

---

## Publishing to GitHub Packages

Game packages are published to the `@callidity` scope on GitHub Packages.

**`.npmrc` (in the game package root):**

```
@callidity:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**Publish:**

```bash
npm publish
```

**Platform consumes:**

```js
// bundled path (default — game ships with the platform)
React.lazy(() => import('@callidity/game-xo'))

// split-out path (game deployed as a separate service)
React.lazy(() => import(/* @vite-ignore */ 'https://games.aiarena.com/xo/bundle.js'))
```

Switching between paths is a one-line registry change. All games start bundled. A game is split out only when it warrants its own deployment.

---

## XO Refactoring Checklist

XO is the reference implementation. Use this checklist to verify compliance:

### GameContract exports
- [ ] `export default GameComponent` — React component, no platform imports
- [ ] `export { meta }` — all GameMeta fields populated including `builtInBots`, `layout`, and `theme`
- [ ] `export { botInterface }` — full BotInterface implemented

### GameComponent
- [ ] Receives only `{ session, sdk }` props
- [ ] No hardcoded `max-w-*` width class — container sizing is declared in `meta.layout`
- [ ] Color tokens reference `var(--game-*)` — not hardcoded `var(--color-*)` platform tokens
- [ ] No direct socket.io calls
- [ ] No auth imports
- [ ] Subscribes to moves via `sdk.onMove` or `sdk.spectate`
- [ ] Submits moves via `sdk.submitMove`
- [ ] Calls `sdk.signalEnd` exactly once at game end
- [ ] Respects `session.isSpectator` — disables input when true
- [ ] Derives player mark from `session.players` + `session.currentUserId` (no hardcoding)

### GameSDK integration
- [ ] `sdk.getPreviewState()` returns a lightweight board snapshot
- [ ] `sdk.getPlayerState(playerId)` returns full state (XO is public information)
- [ ] `sdk.getSettings()` used for any table-level config (time control, etc.)

### BotInterface
- [ ] `makeMove` is synchronous, stateless, accepts `(state, playerId, persona, weights)`
- [ ] `makeMove` dispatches on `persona.id` (plan to migrate to `persona.algorithm`)
- [ ] `makeMove` falls back to a default bot when `weights` is null
- [ ] `getTrainingConfig` returns config for all supported algorithms (Q-Learning, SARSA, DQN, Minimax, Rule-based, Monte Carlo, Neural Net, Policy Gradient, AlphaZero)
- [ ] `train` is async, calls `onProgress` every ~100 episodes, returns `TrainingResult` with `weights`
- [ ] `train` accepts `currentWeights` to resume from an existing skill
- [ ] `serializeState` and `deserializeMove` are implemented
- [ ] `personas` array is non-empty
- [ ] `GymComponent` renders training controls and calls `onTrainingComplete`
- [ ] `puzzles` array is populated

### Packages
- [ ] No imports from `frontend/`, `backend/`, or `landing/` — standalone package only
- [ ] Game logic in `logic.js` is pure (no side effects, no platform dependencies)
- [ ] AI adapters in `adapters.js` implement `serializeState`, `deserializeMove`, `getLegalMoves`

---

## Type Reference

All types are defined in `packages/sdk/src/index.d.ts`.

| Type | Purpose |
|---|---|
| `GameContract` | Full shape a game package must export |
| `GameMeta` | Static game metadata |
| `GameLayout` | Container width and aspect ratio preferences |
| `GameTheme` | Scoped CSS custom property overrides for game-specific color identity |
| `GameSession` | Runtime session context passed to game component |
| `GameSDK` | Platform interface the game calls into |
| `Player` | A seated player (human or bot) |
| `GameResult` | Outcome reported via `signalEnd` |
| `MoveEvent` | A single move delivered to subscribers |
| `GameSettings` | Table configuration |
| `BotInterface` | Full bot and training contract |
| `BotPersona` | Named bot personality |
| `TrainingConfig` | Hyperparameter schema for Gym UI rendering |
| `TrainingRun` | Resolved training parameters passed into `train()` |
| `HyperparameterDef` | Single control descriptor for Gym UI |
| `TrainingProgress` | In-session progress update |
| `TrainingResult` | Final training output including weights |
| `GymProps` | Props passed into GymComponent by the platform |
| `Puzzle` | A single puzzle position |

---

## Addendum — XO (Tic-Tac-Toe) Reference Implementation

> This is the complete source of `@callidity/game-xo` — the platform's first game and the reference implementation of the SDK contract. Read this alongside the contract spec above. Everything here is a concrete example of a concept described in the main body.
>
> Package location: `packages/game-xo/src/`

---

### src/index.js

The package entry point. Satisfies the `GameContract` shape exactly.

```js
export { default }      from './GameComponent.jsx'
export { meta }         from './meta.js'
export { botInterface } from './botInterface.js'
```

---

### src/meta.js

```js
import { platformDefaultTheme } from '@callidity/sdk'

export const meta = {
  id:               'xo',
  title:            'Tic-Tac-Toe',
  description:      'Classic 3×3 strategy game. First to get three in a row wins.',
  minPlayers:       2,
  maxPlayers:       2,
  layout: {
    preferredWidth: 'compact',
    aspectRatio:    '1/1',
  },
  theme: platformDefaultTheme,
  supportsBots:     true,
  supportsTraining: true,
  supportsPuzzles:  true,
  builtInBots: [
    { id: 'minimax-novice',        name: 'Rusty',      description: 'Makes mistakes on purpose. Great for beginners.',        difficulty: 'easy',    algorithm: 'minimax'    },
    { id: 'minimax-intermediate',  name: 'Copper',     description: 'A decent challenge. Will punish obvious mistakes.',       difficulty: 'medium',  algorithm: 'minimax'    },
    { id: 'minimax-advanced',      name: 'Sterling',   description: 'Plays well. Difficult to beat without a solid strategy.', difficulty: 'hard',    algorithm: 'minimax'    },
    { id: 'minimax-master',        name: 'Magnus',     description: 'Perfect play. Never loses.',                             difficulty: 'expert',  algorithm: 'minimax'    },
    { id: 'rule-novice',           name: 'Rookie',     description: 'Rule-based with beginner-level heuristics.',             difficulty: 'beginner',algorithm: 'rule_based' },
    { id: 'ql-trained',            name: 'Trained AI', description: 'Learns from experience. Strength depends on training.',  difficulty: 'medium',  algorithm: 'qlearning'  },
  ],
}
```

---

### src/logic.js

Pure game logic — no platform dependencies. Re-exports shared primitives from `@xo-arena/ai` and adds XO-specific helpers.

```js
export {
  getWinner,
  isBoardFull,
  getEmptyCells,
  opponent,
  WIN_LINES,
} from '@xo-arena/ai'

/** Return the mark ('X' or 'O') for the current user from the session. */
export function getMyMark(session) {
  return session?.settings?.marks?.[session?.currentUserId] ?? null
}

/** Initial game state for a new round. */
export function initialGameState() {
  return {
    board:       Array(9).fill(null),
    currentTurn: 'X',
    status:      'playing',
    winner:      null,
    winLine:     null,
    scores:      { X: 0, O: 0 },
    round:       1,
  }
}
```

---

### src/adapters.js

Bridges between XO's board representation and the general-purpose AI algorithms in `@xo-arena/ai`.

```js
import { getEmptyCells } from '@xo-arena/ai'

/**
 * Serialize board state for neural-net / DQN / AlphaZero.
 * Returns a 9-element array: 1 = player mark, -1 = opponent, 0 = empty.
 */
export function serializeState(state, playerMark = 'X') {
  const board = Array.isArray(state) ? state : state.board
  return board.map(cell => {
    if (cell === null)        return 0
    if (cell === playerMark)  return 1
    return -1
  })
}

/** Deserialize a stored move back to a cell index (0-8). */
export function deserializeMove(raw) {
  return Number(raw)
}

/** Return legal move indices (empty cells). Used by MCTS, minimax, policy gradient. */
export function getLegalMoves(state) {
  const board = Array.isArray(state) ? state : state.board
  return getEmptyCells(board)
}
```

---

### src/GameComponent.jsx

The game's React component. Receives `{ session, sdk }` only — no platform imports.

```jsx
import React, { useState, useEffect, useRef } from 'react'
import { initialGameState } from './logic.js'

const MARK_COLOR = {
  X: 'var(--game-mark-x)',
  O: 'var(--game-mark-o)',
}

const REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '🤔', '👏', '💀']

export default function GameComponent({ session, sdk }) {
  const [gameState, setGameState]         = useState(initialGameState())
  const [incomingReaction, setReaction]   = useState(null)
  const [showReactions, setShowReactions] = useState(false)
  const [showForfeit, setShowForfeit]     = useState(false)
  const [idleWarning, setIdleWarning]     = useState(null)
  const [lastCell, setLastCell]           = useState(null)

  const signalledRef  = useRef(false)
  const reactionTimer = useRef(null)

  const { board, currentTurn, status, winner, winLine, scores, round } = gameState

  const myMark   = session?.settings?.marks?.[session?.currentUserId]
                ?? session?.settings?.myMark
                ?? null
  const isPlayer = !session?.isSpectator && myMark !== null
  const isMyTurn = isPlayer && status === 'playing' && currentTurn === myMark

  // Subscribe to moves
  useEffect(() => {
    const unsub = session?.isSpectator
      ? sdk.spectate(handleMoveEvent)
      : sdk.onMove(handleMoveEvent)
    return unsub
  }, [sdk, session?.isSpectator])

  // XO-specific SDK extensions (optional — not present in replay/test SDKs)
  useEffect(() => {
    if (!sdk.onReaction) return
    const unsub = sdk.onReaction(({ emoji }) => {
      clearTimeout(reactionTimer.current)
      setReaction({ emoji, id: Date.now() })
      reactionTimer.current = setTimeout(() => setReaction(null), 2500)
    })
    return () => { unsub?.(); clearTimeout(reactionTimer.current) }
  }, [sdk])

  useEffect(() => {
    if (!sdk.onIdleWarning) return
    return sdk.onIdleWarning(({ secondsRemaining }) => setIdleWarning({ secondsRemaining }))
  }, [sdk])

  function handleMoveEvent(event) {
    // null move = new round starting; reset state and signalEnd guard
    if (event.move === null) {
      setGameState(event.state)
      setLastCell(null)
      signalledRef.current = false
      return
    }
    setGameState(event.state)
    setLastCell(event.move)
    setTimeout(() => setLastCell(null), 350)

    // Signal end exactly once when the game concludes
    if (event.state.status === 'finished' && !signalledRef.current) {
      signalledRef.current = true
      sdk.signalEnd({
        rankings: event.state.winner
          ? sortByWinner(session?.players ?? [], event.state.winner, session?.settings?.marks)
          : [],
        isDraw: !event.state.winner,
      })
    }
  }

  function sortByWinner(players, winnerMark, marks) {
    return [...players]
      .sort((a, b) => (marks?.[a.id] === winnerMark ? -1 : 1))
      .map(p => p.id)
  }

  function handleCellClick(index) {
    if (!isMyTurn || board[index] !== null) return
    sdk.submitMove(index)
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <PlayerStrip session={session} myMark={myMark} />

      {/* Score strip */}
      <div className="w-full flex items-center justify-between px-2">
        <ScorePill mark="X" score={scores.X} highlight={myMark === 'X'} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Round {round}</span>
        <ScorePill mark="O" score={scores.O} highlight={myMark === 'O'} />
      </div>

      {/* Turn / result indicator */}
      <div className="flex items-center gap-2 h-8">
        {status === 'playing' && (
          <>
            <span className="font-bold" style={{ color: MARK_COLOR[currentTurn] }}>{currentTurn}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {session?.isSpectator ? `${currentTurn}'s turn` : isMyTurn ? 'Your turn' : "Opponent's turn"}
            </span>
          </>
        )}
        {status === 'finished' && winner && (
          <span className="font-bold" style={{
            color: session?.isSpectator
              ? MARK_COLOR[winner]
              : winner === myMark ? 'var(--color-teal-600)' : 'var(--color-red-600)',
          }}>
            {session?.isSpectator ? `${winner} wins!` : winner === myMark ? 'You win! 🎉' : 'Opponent wins!'}
          </span>
        )}
        {status === 'finished' && !winner && (
          <span className="font-bold" style={{ color: 'var(--color-amber-600)' }}>Draw!</span>
        )}
      </div>

      {/* Board */}
      <div className="grid grid-cols-3 gap-2 w-full" aria-label="Tic-tac-toe board">
        {board.map((cell, i) => {
          const isWin      = winLine?.includes(i)
          const isPlayable = isMyTurn && cell === null && status === 'playing'
          const isNew      = lastCell === i
          return (
            <button
              key={i}
              onClick={() => handleCellClick(i)}
              aria-label={`Cell ${i + 1}${cell ? `, ${cell}` : ''}`}
              disabled={!isPlayable}
              className={[
                'aspect-square flex items-center justify-center rounded-xl text-4xl font-bold border-2 transition-all select-none',
                isWin ? 'bg-[var(--game-cell-win-bg)] border-[var(--game-cell-win-border)]'
                      : 'bg-[var(--bg-surface)] border-[var(--border-default)]',
                isNew      ? 'scale-[1.08]' : '',
                isPlayable ? 'hover:bg-[var(--bg-surface-hover)] hover:scale-[1.04] active:scale-[0.97] cursor-pointer'
                           : 'cursor-default',
              ].join(' ')}
              style={{
                minHeight:  'clamp(72px, 24vw, 88px)',
                fontFamily: 'var(--font-display)',
                color:      cell ? MARK_COLOR[cell] : 'transparent',
              }}
            >
              {cell || '·'}
            </button>
          )
        })}
      </div>

      {/* Reactions, forfeit, idle warning, game-end actions omitted for brevity — */}
      {/* see packages/game-xo/src/GameComponent.jsx for the full implementation  */}
    </div>
  )
}

function PlayerStrip({ session, myMark }) {
  if (!session) return null
  const opponent = session.players?.find(p => p.id !== session.currentUserId)
  if (!opponent) return null
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
      <span style={{ color: 'var(--text-muted)' }}>vs</span>
      <span className="font-medium">{opponent.displayName}</span>
      {opponent.isBot && <span className="badge badge-bot text-xs">BOT</span>}
    </div>
  )
}

function ScorePill({ mark, score, highlight }) {
  return (
    <div className={`flex items-center gap-2 ${highlight ? 'font-bold' : ''}`}>
      <span style={{ fontFamily: 'var(--font-display)', color: MARK_COLOR[mark], fontSize: highlight ? '1.25rem' : '1rem' }}>
        {mark}
      </span>
      <span className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{score}</span>
    </div>
  )
}
```

---

### src/botInterface.js

```js
import {
  minimaxImplementation, QLearningEngine, SarsaEngine,
  DQNEngine, AlphaZeroEngine, runEpisode, getEmptyCells, ruleBasedMove,
} from '@xo-arena/ai'
import { meta } from './meta.js'
import { serializeState, deserializeMove, getLegalMoves } from './adapters.js'
import { GymComponent } from './GymComponent.jsx'
import { puzzles } from './puzzles.js'

function makeMove(state, playerId, persona, weights) {
  const board = Array.isArray(state) ? state : state.board
  const mark  = state.marks?.[playerId] ?? state.currentTurn ?? 'X'
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1

  if (persona.algorithm === 'minimax') {
    const diffMap = { beginner: 'novice', easy: 'novice', medium: 'intermediate', hard: 'advanced', expert: 'master' }
    return minimaxImplementation.move(board, diffMap[persona.difficulty] ?? 'intermediate', mark)
  }
  if (persona.algorithm === 'rule_based') {
    return ruleBasedMove(board, mark, weights?.rules ?? [])
  }
  if (persona.algorithm === 'qlearning') {
    if (!weights) return empty[Math.floor(Math.random() * empty.length)]
    const engine = new QLearningEngine()
    engine.loadQTable(weights)
    return engine.chooseAction(board, false)
  }
  if (persona.algorithm === 'dqn') {
    if (!weights) return empty[Math.floor(Math.random() * empty.length)]
    const engine = new DQNEngine({ stateSize: 9, actionSize: 9 })
    engine.loadWeights(weights)
    const qVals = engine.predict(serializeState(board, mark))
    return empty.reduce((best, idx) => qVals[idx] > qVals[best] ? idx : best, empty[0])
  }
  // Fallback — random legal move
  return empty[Math.floor(Math.random() * empty.length)]
}

function getTrainingConfig() {
  return {
    algorithm:       'qlearning',
    defaultEpisodes: 5000,
    hyperparameters: {
      algorithm:      { label: 'Algorithm',      type: 'select', default: 'qlearning',
                        options: [
                          { value: 'qlearning',      label: 'Q-Learning' },
                          { value: 'sarsa',          label: 'SARSA' },
                          { value: 'dqn',            label: 'Deep Q-Network (DQN)' },
                          { value: 'montecarlo',     label: 'Monte Carlo' },
                          { value: 'policygradient', label: 'Policy Gradient' },
                          { value: 'alphazero',      label: 'AlphaZero' },
                        ]},
      learningRate:   { label: 'Learning Rate',   type: 'number', default: 0.3,  min: 0.01, max: 1.0,  step: 0.01 },
      discountFactor: { label: 'Discount Factor', type: 'number', default: 0.9,  min: 0.5,  max: 1.0,  step: 0.01 },
      epsilonStart:   { label: 'Epsilon Start',   type: 'number', default: 1.0,  min: 0.1,  max: 1.0,  step: 0.05 },
      epsilonMin:     { label: 'Epsilon Min',     type: 'number', default: 0.05, min: 0.0,  max: 0.5,  step: 0.01 },
      decayMethod:    { label: 'Epsilon Decay',   type: 'select', default: 'exponential',
                        options: [
                          { value: 'exponential', label: 'Exponential' },
                          { value: 'linear',      label: 'Linear' },
                          { value: 'cosine',      label: 'Cosine' },
                        ]},
    },
  }
}

async function train(run, currentWeights, onProgress) {
  const { episodes, params } = run
  const algo = params.algorithm ?? run.algorithm ?? 'qlearning'

  const engine = algo === 'sarsa'
    ? new SarsaEngine({ learningRate: params.learningRate ?? 0.3, discountFactor: params.discountFactor ?? 0.9,
                        epsilonStart: params.epsilonStart ?? 1.0, epsilonMin: params.epsilonMin ?? 0.05,
                        decayMethod: params.decayMethod ?? 'exponential', totalEpisodes: episodes })
    : new QLearningEngine({ learningRate: params.learningRate ?? 0.3, discountFactor: params.discountFactor ?? 0.9,
                            epsilonStart: params.epsilonStart ?? 1.0, epsilonMin: params.epsilonMin ?? 0.05,
                            decayMethod: params.decayMethod ?? 'exponential', totalEpisodes: episodes })

  if (currentWeights) engine.loadQTable(currentWeights)

  let wins = 0, losses = 0, draws = 0
  const interval = Math.max(1, Math.floor(episodes / 100))

  for (let i = 1; i <= episodes; i++) {
    const result = runEpisode(engine, 'both', null)
    if (result.outcome === 'WIN')  wins++
    if (result.outcome === 'LOSS') losses++
    if (result.outcome === 'DRAW') draws++
    if (i % interval === 0 || i === episodes) {
      onProgress({ episode: i, totalEpisodes: episodes, outcome: result.outcome,
                   epsilon: engine.epsilon, avgQDelta: result.avgQDelta })
      await new Promise(r => setTimeout(r, 0))
    }
  }

  return {
    episodesCompleted: episodes,
    winRate:  wins   / episodes,
    lossRate: losses / episodes,
    drawRate: draws  / episodes,
    finalEpsilon: engine.epsilon,
    weights: engine.toJSON(),
  }
}

export const botInterface = {
  makeMove,
  getTrainingConfig,
  train,
  serializeState,
  deserializeMove,
  personas: meta.builtInBots,
  GymComponent,
  puzzles,
}
```

> `GymComponent.jsx` and `puzzles.js` follow the contracts defined in the GymComponent and Puzzles sections of this guide. See `packages/game-xo/src/` for their full source.
