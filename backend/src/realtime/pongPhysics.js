/**
 * Pong physics — pure functions, no I/O.
 * Shared between server (game loop) and client (preview / interpolation).
 *
 * Logical board: 800 × 600 units.
 */

export const BOARD_W      = 800
export const BOARD_H      = 600
export const PADDLE_W     = 12
export const PADDLE_H     = 80
export const BALL_R       = 8
export const P1_X         = 24          // left paddle centre-x
export const P2_X         = BOARD_W - 24 // right paddle centre-x
export const SCORE_LIMIT  = 7
export const TICK_MS      = 33          // ~30 fps
export const DT           = TICK_MS / 1000
export const PADDLE_SPEED = 380         // px / s
export const BALL_SPEED_0 = 420         // px / s initial
export const BALL_SPEED_MAX = 900       // px / s cap

// ── State factory ─────────────────────────────────────────────────────────────

export function createGameState() {
  return {
    ball:    spawnBall(),
    paddles: [
      { y: BOARD_H / 2, dy: 0 },   // index 0 — P1 left
      { y: BOARD_H / 2, dy: 0 },   // index 1 — P2 right
    ],
    score:   { p1: 0, p2: 0 },
    status:  'playing',
    winner:  null,   // null | 0 (P1) | 1 (P2)
    tick:    0,
  }
}

function spawnBall(lastWinner = null) {
  // Serve toward whoever just lost (or random on first serve)
  const angle = (Math.random() * 25 + 25) * (Math.PI / 180)
  const xDir  = lastWinner === 0 ? -1 : lastWinner === 1 ? 1 : (Math.random() < 0.5 ? 1 : -1)
  const yDir  = Math.random() < 0.5 ? 1 : -1
  return {
    x:  BOARD_W / 2,
    y:  BOARD_H / 2,
    vx: Math.cos(angle) * BALL_SPEED_0 * xDir,
    vy: Math.sin(angle) * BALL_SPEED_0 * yDir,
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export function tick(state) {
  if (state.status !== 'playing') return state

  // 1. Move paddles
  const paddles = state.paddles.map(p => ({
    ...p,
    y: clamp(p.y + p.dy * PADDLE_SPEED * DT, PADDLE_H / 2, BOARD_H - PADDLE_H / 2),
  }))

  // 2. Move ball
  let { x, y, vx, vy } = state.ball
  x += vx * DT
  y += vy * DT

  // 3. Top / bottom wall bounce
  if (y - BALL_R <= 0)        { y = BALL_R;            vy =  Math.abs(vy) }
  if (y + BALL_R >= BOARD_H)  { y = BOARD_H - BALL_R;  vy = -Math.abs(vy) }

  // 4. Paddle collisions
  ;({ x, y, vx, vy } = checkPaddle(x, y, vx, vy, paddles[0], P1_X, 'left'))
  ;({ x, y, vx, vy } = checkPaddle(x, y, vx, vy, paddles[1], P2_X, 'right'))

  // 5. Scoring
  let score   = { ...state.score }
  let lastWinner = null
  if (x + BALL_R < 0)       { score.p2++;  lastWinner = 1 }
  if (x - BALL_R > BOARD_W) { score.p1++;  lastWinner = 0 }

  const ball = lastWinner !== null ? spawnBall(lastWinner) : { x, y, vx, vy }

  // 6. End condition
  let status = 'playing'
  let winner = null
  if (score.p1 >= SCORE_LIMIT) { status = 'finished'; winner = 0 }
  if (score.p2 >= SCORE_LIMIT) { status = 'finished'; winner = 1 }

  return { ...state, ball, paddles, score, status, winner, tick: state.tick + 1 }
}

function checkPaddle(x, y, vx, vy, paddle, px, side) {
  const halfW = PADDLE_W / 2
  const halfH = PADDLE_H / 2

  if (side === 'left' && vx < 0
      && x - BALL_R <= px + halfW
      && x + BALL_R >= px - halfW
      && y >= paddle.y - halfH
      && y <= paddle.y + halfH) {
    x  = px + halfW + BALL_R
    vx = Math.abs(vx) * 1.05
    vy = vy + paddle.dy * 60
    ;({ vx, vy } = capSpeed(vx, vy))
  }

  if (side === 'right' && vx > 0
      && x + BALL_R >= px - halfW
      && x - BALL_R <= px + halfW
      && y >= paddle.y - halfH
      && y <= paddle.y + halfH) {
    x  = px - halfW - BALL_R
    vx = -Math.abs(vx) * 1.05
    vy = vy + paddle.dy * 60
    ;({ vx, vy } = capSpeed(vx, vy))
  }

  return { x, y, vx, vy }
}

function capSpeed(vx, vy) {
  const speed = Math.hypot(vx, vy)
  if (speed > BALL_SPEED_MAX) {
    vx *= BALL_SPEED_MAX / speed
    vy *= BALL_SPEED_MAX / speed
  }
  return { vx, vy }
}

// ── Input ─────────────────────────────────────────────────────────────────────

export function setPaddleDir(state, playerIndex, direction) {
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
  const paddles = state.paddles.map((p, i) => i === playerIndex ? { ...p, dy } : p)
  return { ...state, paddles }
}

// ── Interpolation helper (client-side) ────────────────────────────────────────

/**
 * Linear interpolation between two game states.
 * t = 0 → prev, t = 1 → next.
 */
export function interpolate(prev, next, t) {
  if (!prev || !next) return next ?? prev
  return {
    ...next,
    ball: {
      x:  lerp(prev.ball.x,  next.ball.x,  t),
      y:  lerp(prev.ball.y,  next.ball.y,  t),
      vx: next.ball.vx,
      vy: next.ball.vy,
    },
    paddles: next.paddles.map((p, i) => ({
      ...p,
      y: lerp(prev.paddles[i]?.y ?? p.y, p.y, t),
    })),
  }
}

function lerp(a, b, t) { return a + (b - a) * t }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
