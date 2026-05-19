-- A3a.2 — TrainingSession audit + TrainingCheckpoint + TrainingMetric.
--
-- Additive only. Existing TrainingSession rows keep working; new fields
-- default to NULL / 0. Downstream A3a items (preset UI, ETA gating,
-- multi-curve eval, checkpoint resume) read these fields when they land.
--
-- Two new tables:
--   • training_checkpoints — persisted every N episodes so a crashed
--     worker can resume from the latest snapshot instead of restarting.
--   • training_metrics     — time-series eval points (one row per
--     opponent curve per eval call) feeding the stacked W/D/L chart.

-- ── TrainingSession new columns ───────────────────────────────────────────
ALTER TABLE "training_sessions" ADD COLUMN "preset"              TEXT;
ALTER TABLE "training_sessions" ADD COLUMN "expectedDurationMs"  INTEGER;
ALTER TABLE "training_sessions" ADD COLUMN "approvalStatus"      TEXT;
ALTER TABLE "training_sessions" ADD COLUMN "approvalRequestedAt" TIMESTAMP(3);
ALTER TABLE "training_sessions" ADD COLUMN "approvedAt"          TIMESTAMP(3);
ALTER TABLE "training_sessions" ADD COLUMN "approvedById"        TEXT;
ALTER TABLE "training_sessions" ADD COLUMN "pausedAt"            TIMESTAMP(3);
ALTER TABLE "training_sessions" ADD COLUMN "checkpointEpisode"   INTEGER;

CREATE INDEX "training_sessions_approvalStatus_idx" ON "training_sessions"("approvalStatus");

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── training_checkpoints ──────────────────────────────────────────────────
CREATE TABLE "training_checkpoints" (
    "id"           TEXT NOT NULL,
    "sessionId"    TEXT NOT NULL,
    "episodeNum"   INTEGER NOT NULL,
    "weights"      JSONB NOT NULL,
    "runtimeState" JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "training_checkpoints_sessionId_episodeNum_key"
    ON "training_checkpoints"("sessionId", "episodeNum");
CREATE INDEX "training_checkpoints_sessionId_idx"
    ON "training_checkpoints"("sessionId");

ALTER TABLE "training_checkpoints" ADD CONSTRAINT "training_checkpoints_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── training_metrics ──────────────────────────────────────────────────────
CREATE TABLE "training_metrics" (
    "id"            TEXT NOT NULL,
    "sessionId"     TEXT NOT NULL,
    "episodeNum"    INTEGER NOT NULL,
    "opponentLabel" TEXT NOT NULL,
    "wins"          INTEGER NOT NULL DEFAULT 0,
    "draws"         INTEGER NOT NULL DEFAULT 0,
    "losses"        INTEGER NOT NULL DEFAULT 0,
    "asFirstMover"  BOOLEAN,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "training_metrics_sessionId_opponentLabel_episodeNum_idx"
    ON "training_metrics"("sessionId", "opponentLabel", "episodeNum");

ALTER TABLE "training_metrics" ADD CONSTRAINT "training_metrics_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
