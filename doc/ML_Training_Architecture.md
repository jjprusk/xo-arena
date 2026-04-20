<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# ML Training Architecture

## Overview

Neural model training moves server-side (PyTorch), with trained weights exported as ONNX
and loaded in the browser for inference. Tabular algorithms remain browser-trained — the
small state space of XO makes in-browser training practical, and it gives users a
fast, private, interactive training experience as a differentiator from server-trained bots.

---

## Model Classification

| Algorithm | Training | Inference | Rationale |
|-----------|----------|-----------|-----------|
| DQN | Server (PyTorch) | Client (ONNX) | Neural network; Connect 4 / Pong require server compute |
| AlphaZero | Server (PyTorch) | Client (ONNX) | Neural network; MCTS + value/policy nets |
| Policy Gradient | Server (PyTorch) | Client (ONNX) | Neural network |
| Neural Net (generic) | Server (PyTorch) | Client (ONNX) | Neural network |
| Q-Learning (tabular) | Client (JS, browser) | Client (JS, browser) | Q-table only; XO state space fits in browser |
| SARSA (tabular) | Client (JS, browser) | Client (JS, browser) | Same as Q-learning |
| Minimax | N/A | Client (JS, browser) | Deterministic; no training |
| Rule-based | N/A | Client (JS, browser) | Deterministic; no training |
| Monte Carlo | N/A | Client (JS, browser) | Pure search; no learned weights |

**Product framing:**
- **Local bots** (Q-learning, SARSA) — train in your browser, instant feedback, fully
  private. Available for XO only; disabled for games with larger state spaces.
- **Server bots** (DQN, AlphaZero, Policy Gradient) — submit a training job, get notified
  when ready. Required for Connect 4 and Pong.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Browser                                              │
│                                                       │
│  ┌─────────────────────┐   ┌────────────────────┐    │
│  │  Local training UI  │   │  ONNX inference    │    │
│  │  (Q-learning, SARSA)│   │  (DQN, AZ, PG)     │    │
│  │  JS — unchanged     │   │  onnxruntime-web   │    │
│  └─────────────────────┘   └────────┬───────────┘    │
│                                     │ fetch model     │
└─────────────────────────────────────┼────────────────┘
                                      │ GET /api/v1/models/:jobId/file
┌─────────────────────────────────────┼────────────────┐
│  Node API (existing)                │                 │
│                                     │                 │
│  POST /api/v1/bot-skills/:id/train ─┤                 │
│  GET  /api/v1/training-jobs/:id     │                 │
│  GET  /api/v1/models/:jobId/file ───┘ (streams bytes) │
│                                     │                 │
│  On POST /train:                    │                 │
│    create TrainingJob row           │                 │
│    spin up Fly Machine via API ─────┼──────────────┐  │
└─────────────────────────────────────┼──────────────┼──┘
                                      │              │
┌─────────────────────────────────────┼──────────────▼──┐
│  Fly Machine (ephemeral, per job)                      │
│                                                        │
│  - Receives JOB_ID as env var                          │
│  - Marks TrainingJob RUNNING                           │
│  - Runs PyTorch training                               │
│  - torch.onnx.export → bytes                          │
│  - Writes ONNX bytes to ModelArtifact table (bytea)    │
│  - Marks TrainingJob COMPLETED, sets modelUrl          │
│  - Inserts UserNotification row                        │
│  - Exits (machine terminates)                          │
└────────────────────────────────────────────────────────┘
```

**Key properties:**
- No persistent worker process — machines spin up on demand and exit when done
- No external file storage — ONNX bytes live in Postgres (`ModelArtifact.bytes bytea`)
- All inference runs client-side via ONNX Runtime Web — no per-move server roundtrip
- `modelUrl` is a Node API endpoint (`/api/v1/models/:jobId/file`); browser fetches once per session

---

## Data Model

### New: `TrainingJob`

```prisma
model TrainingJob {
  id           String    @id @default(cuid())
  userId       String
  botSkillId   String
  gameId       String
  algorithm    String    // 'dqn' | 'alphazero' | 'policy_gradient'
  config       Json      // epochs, learningRate, hiddenLayers, etc.
  status       TrainingStatus @default(QUEUED)
  progress     Int       @default(0)   // 0–100
  etaSeconds   Int?
  startedAt    DateTime?
  completedAt  DateTime?
  errorMessage String?
  modelUrl     String?   // ONNX file URL, set on completion
  createdAt    DateTime  @default(now())

  user     User     @relation(fields: [userId], references: [id])
  botSkill BotSkill @relation(fields: [botSkillId], references: [id])
}

enum TrainingStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
  PRUNED    // completed job whose ModelArtifact bytes have been deleted
}
```

### Updated: `BotSkill`

Replace `latestModelUrl String?` with `activeJobId String?` — a FK to the
`TrainingJob` the user has selected as their current model. Client resolves the
model URL via the active job. Falls back to minimax if null.

**Version retention:** an admin-configurable limit (default 5) controls how many
completed `TrainingJob` rows (and their `ModelArtifact` bytes) are kept per
`BotSkill`. When a new job completes and the count exceeds the limit, the oldest
completed jobs are pruned — their `ModelArtifact` bytes deleted, job rows marked
`PRUNED`. The active job is never pruned regardless of age.

### New: `ModelArtifact`

```prisma
model ModelArtifact {
  id           String   @id @default(cuid())
  trainingJobId String  @unique
  bytes        Bytes
  sizeBytes    Int
  createdAt    DateTime @default(now())

  trainingJob  TrainingJob @relation(fields: [trainingJobId], references: [id])
}
```

ONNX model bytes stored directly in Postgres. Suitable for models up to ~10MB (all
current and planned algorithms are well under this). If a future model exceeds this,
migrate to Cloudflare R2 at that point.

---

## API

### `POST /api/v1/bot-skills/:id/train`

Body: `{ algorithm, config: { epochs, learningRate, ... } }`

- Validates user owns the skill
- Rejects if user already has a QUEUED or RUNNING job (one active job per user)
- Creates `TrainingJob` row with `status: QUEUED`
- Returns `{ jobId }`

### `GET /api/v1/training-jobs/:id`

Returns `{ id, status, progress, etaSeconds, modelUrl, errorMessage }`

Used by the UI to poll status (every 5s while RUNNING).

### `PATCH /api/v1/bot-skills/:id`

Body: `{ activeJobId }`

- Validates user owns the skill and the job is COMPLETED and belongs to this skill
- Updates `BotSkill.activeJobId`
- Returns `{ activeJobId }`

### `GET /api/v1/models/:jobId/file`

Streams `ModelArtifact.bytes` from DB with `Content-Type: application/octet-stream`.
Used by ONNX Runtime Web: `InferenceSession.create('/api/v1/models/:jobId/file')`.

---

## ONNX Tensor Spec

All models use the same tensor convention regardless of game or algorithm:

| | Name | Shape | dtype |
|---|------|-------|-------|
| Input | `"input"` | `[1, env.input_size]` | `float32` |
| Output | `"output"` | `[1, env.output_size]` | `float32` |

**Worker export (all games):**
```python
dummy = torch.zeros(1, env.input_size)
torch.onnx.export(model, dummy, path,
  input_names=["input"],
  output_names=["output"])
```

**Client inference (all games):**
```js
const { output } = await session.run({
  input: new Tensor('float32', encodeBoard(board, mark), [1, inputSize])
})
```

`inputSize` and `outputSize` are stored on `BotSkill` (or derived from `gameId` + `algorithm`) so the client doesn't need to inspect the ONNX file.

---

## Game Environment Interface

All game environments implement a shared Python base class. Training algorithms
(DQN, AlphaZero, PPO) work against this interface — adding a new game means
implementing the interface, not changing the training code.

```python
class GameEnvironment(ABC):
    @abstractmethod
    def reset(self) -> np.ndarray:
        """Return initial encoded state."""

    @abstractmethod
    def step(self, action: int) -> tuple[np.ndarray, float, bool]:
        """Apply action. Return (next_state, reward, done)."""

    @abstractmethod
    def legal_actions(self) -> list[int]:
        """Return indices of currently legal actions."""

    @abstractmethod
    def encode_state(self, perspective: int) -> np.ndarray:
        """Encode board from the given player's perspective."""

    @property
    @abstractmethod
    def input_size(self) -> int:
        """Flattened state vector length (ONNX input shape: [1, input_size])."""

    @property
    @abstractmethod
    def output_size(self) -> int:
        """Action space size (ONNX output shape: [1, output_size])."""
```

| Game | `input_size` | `output_size` | Notes |
|------|-------------|---------------|-------|
| XO | 9 | 9 | Tabular only — env defined for completeness |
| Connect 4 | 42 | 7 | 6×7 board; action = column |
| Checkers | TBD | TBD | Phase 5+ |
| Pong | TBD | TBD | Continuous obs → feature encoding or frame stack |
| Card games | TBD | TBD | Hidden information requires separate treatment |

Pong and card games have different observation structures (continuous, partial
information) and will need additional interface methods when implemented. The base
class is intentionally minimal to stay clean across board games first.

---

## Python Worker

**Stack:** Python 3.11, PyTorch, `onnx`, `psycopg2` (direct DB access).
Deployed as an on-demand **Fly Machine** — no persistent process. The Node API
creates a machine via the Fly Machines API when a job is queued; the machine runs
to completion and exits.

**Invocation (Node API → Fly Machines API):**
```js
// Called by POST /api/v1/bot-skills/:id/train after creating the TrainingJob row
await fly.machines.create('xo-ml-worker', {
  env: { JOB_ID: job.id, DATABASE_URL: process.env.DATABASE_URL }
})
```

**Per-job flow:**
1. Read `JOB_ID` from env; fetch job row from DB
2. Mark `status = RUNNING`, set `startedAt`
3. Instantiate game environment + PyTorch model for `(gameId, algorithm)`
4. Train; update `progress` and `etaSeconds` every N epochs
5. `torch.onnx.export(model, dummy_input, ...)` → bytes in memory
6. Write bytes to `ModelArtifact` table
7. Mark `status = COMPLETED`, set `completedAt`, set `modelUrl = /api/v1/models/{jobId}/file`
8. Update `BotSkill.activeJobId` to this job (first completed job for this skill only;
   subsequent jobs require user action to promote)
9. Prune oldest completed jobs for this skill if count exceeds admin retention limit;
   delete their `ModelArtifact` bytes, mark status `PRUNED`
10. Insert `UserNotification` row
10. Exit (machine terminates automatically)

**On error:** mark `status = FAILED`, write `errorMessage`, notify user, exit non-zero.

**ETA estimation:** pre-computed lookup `(gameId, algorithm, epochs)` → median seconds
from historical runs. Shows "estimating…" until 10% complete on first run of a new config.

---

## Client Inference

Replace `getMoveForModel` / skill server with ONNX Runtime Web:

```js
import { InferenceSession, Tensor } from 'onnxruntime-web'

// Load once per skill, cache in Map
// modelUrl = /api/v1/models/:activeJobId/file (from BotSkill.activeJob)
const session = await InferenceSession.create(skill.activeJob.modelUrl)

// Per-move inference
function getMove(board, mark) {
  return session.run({
    input: new Tensor('float32', encodeBoard(board, mark), [1, inputSize])
  }).then(({ output }) => {
    const scores = Array.from(output.data)
    return legalMoves.reduce((best, i) => scores[i] > scores[best] ? i : best, legalMoves[0])
  })
}
```

**Fallback:** if `skill.activeJobId` is null (no job promoted yet), fall back
to minimax so the bot is always playable.

---

## UX

### Training submission (bot detail page)

1. Algorithm selector (DQN / AlphaZero / Policy Gradient)
2. Config form (epochs, learning rate — sensible defaults per algorithm)
3. "Train" button → `POST .../train` → shows job status card inline

### Job status card (while RUNNING)

- Progress bar (0–100% from `TrainingJob.progress`)
- ETA countdown ("~12 min remaining") from `etaSeconds`; "estimating…" until 10% complete
- "Cancel" button → `DELETE /training-jobs/:id`
- Polls every 5s until COMPLETED or FAILED

### Completion

- In-app notification: "Your bot is ready to play"
- First-ever completed job for a skill is auto-promoted (sets `activeJobId`)
- Subsequent jobs appear in the version history list — user must promote manually

### Version history (bot detail page)

List of all non-PRUNED completed jobs for this skill, newest first:

| Version | Algorithm | Epochs | Completed | |
|---------|-----------|--------|-----------|---|
| v3 ✓ active | DQN | 2,000 | Apr 19 | — |
| v2 | DQN | 1,000 | Apr 12 | Use this version |
| v1 | DQN | 500 | Apr 5 | Use this version |

- "Use this version" → `PATCH /api/v1/bot-skills/:id` `{ activeJobId }` — instant switch, no retraining
- Active job row shows "active" badge; no promote button
- PRUNED jobs are omitted from the list entirely

---

## Implementation Phases

> **Prerequisite:** Connect 4 must be built and playable via the game SDK before
> Phase 2 begins. The Python worker's `GameEnvironment` must mirror the JS game
> logic exactly, and a working board UI is required to test the trained bot.
> Phase 1 (infrastructure only) has no game dependency and can be built at any time,
> but practically it makes sense to batch it with Phase 2 once Connect 4 is ready.

### Phase 1 — Backend infrastructure *(no UI, no client changes, no training runs)*

Pure plumbing — no game environment, no model. The goal is a working job queue
before any algorithm depends on it.

- `TrainingJob` schema + migration (including `CANCELLED` status)
- `POST /api/v1/bot-skills/:id/train` and `GET /api/v1/training-jobs/:id` endpoints
- `DELETE /api/v1/training-jobs/:id` cancel endpoint (sets `status: CANCELLED`)
- Python worker: poll loop + job lifecycle (QUEUED → RUNNING → COMPLETED/FAILED)
- Worker stub: exports a trivial ONNX model (single linear layer, random weights),
  writes bytes to `ModelArtifact`, sets `modelUrl` — exercises the full
  machine → DB → notification → client fetch flow end-to-end
- `UserNotification` dispatch on completion
- Integration tests: job creation, status polling, cancellation, notification dispatch

### Phase 2 — Connect 4 DQN *(first real training algorithm)*

Connect 4, not XO, is the first real product feature here. XO is already covered by
local tabular training; users have no need for a server-trained XO bot.

- Connect 4 game environment — custom, implementing the shared `GameEnvironment` interface (see below)
- DQN implementation: experience replay, target network, epsilon-greedy
- ONNX export: `torch.onnx.export` with fixed input shape `[1, 42]` (6×7 board)
- Worker updates `progress` and `etaSeconds` every 50 epochs
- ETA lookup table seeded from test runs on worker hardware
- Disable local training option on bot creation for Connect 4

### Phase 3 — Client inference switch

- Add `onnxruntime-web` to `landing/package.json`
- Update `getMoveForModel` to fetch `latestModelUrl` and run ONNX session
- Minimax fallback when `latestModelUrl` is null
- Remove any TF.js neural training code from client bundle (if present)

### Phase 4 — UX

- Training config form + job status card on bot detail page
- ETA countdown from `etaSeconds`; "estimating…" until 10% complete on first run of a config
- Cancel button (calls DELETE endpoint; worker checks `status` before each epoch batch)
- In-app notification on completion ("Your bot is ready to play")

### Phase 5 — Expand algorithms + games

- AlphaZero and Policy Gradient for Connect 4
- Pong environment + PPO
- Disable local training option on bot creation for Pong

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Model file hosting | Postgres `bytea` via `ModelArtifact` table; Node API streams to browser | No external storage; suitable for models ≤10MB; migrate to R2 if needed |
| Worker deployment | On-demand Fly Machine per job; exits on completion | No persistent worker process; pay only for training time |
| Concurrency | One active job per user globally | Prevents abuse; simple to enforce |
| Model versioning | `BotSkill.activeJobId` FK; user promotes any completed job as active | Full history without extra columns; natural rollback |
| Version retention | Admin-configurable max per BotSkill (default 5); active job never pruned | Caps DB storage growth; admin can tune per usage |
| Retraining | Creates a new `TrainingJob`; active model unchanged until user promotes new job | No downtime between versions |
| ONNX tensor names | Standardized `"input"` / `"output"` across all games | Single client inference path; no per-game tensor name logic |
| Game environment library | Custom `GameEnvironment` base class | No Gymnasium/PettingZoo dependency; extensible to all future games via interface |
| Tabular algorithms | Stay browser-trained (JS) | XO state space fits; local training is a product feature |
| First real training target | Connect 4 DQN (Phase 2), not XO DQN | XO is fully served by local tabular bots; Connect 4 is the first game that genuinely needs server compute |
| Phase 1 scope | Infrastructure only — stub ONNX output, no real algorithm | Validates job queue, ONNX upload, and notification flow on trivial output before any algorithm depends on it |
| TF.js migration plan | Superseded — do not implement | Direction changed; ONNX replaces TF.js for neural inference |

---

## Out of Scope

- Moving tabular algorithms (Q-learning, SARSA) to server — intentionally kept local
- GPU training on the worker — CPU is sufficient for XO and Connect 4 at current scale
- Streaming training progress via WebSocket — DB polling every 5s is sufficient
- Multiple concurrent training jobs per user
