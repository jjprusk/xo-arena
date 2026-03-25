# XO Arena — Stress Tests

Uses [k6](https://k6.io). Install: `brew install k6`

## Running

```bash
# All scenarios against local dev server (default)
./stress/run.sh

# Single scenario
k6 run stress/scenarios/ai-moves.js

# Against staging/prod
BASE_URL=https://your-backend.railway.app k6 run stress/scenarios/ai-moves.js
```

## Scenarios

| File | What it tests |
|------|---------------|
| `ai-moves.js` | Concurrent AI move requests (all difficulties + minimax) |
| `ml-export.js` | Concurrent model weight downloads (frontend cache warm-up) |
| `websocket-pvp.js` | Socket.io PvP room creation + game play |
| `api-read.js` | Public read endpoints: leaderboard, puzzles, room list |
| `auth-sync.js` | User sync burst (JWT auth path) |

## Thresholds

Tests fail if:
- p95 response time > 500 ms (read endpoints)
- p95 response time > 1 s (AI move / ML export)
- WebSocket connection error rate > 1%
- HTTP error rate > 1%
