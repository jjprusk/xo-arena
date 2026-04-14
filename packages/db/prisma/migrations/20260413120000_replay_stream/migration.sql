-- Phase 1.6: Replay stream storage and Tournament replayRetentionDays removal.
-- moveStream stores a compact JSON array of moves for replay; purged by TTL job.
-- isTournament denormalises tournament membership for efficient TTL-bucket queries.
-- replayRetentionDays moves to SystemConfig (replay.casualRetentionDays / replay.tournamentRetentionDays).

-- AlterTable games
ALTER TABLE "games" ADD COLUMN "isTournament" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "games" ADD COLUMN "moveStream" JSONB;

-- Backfill isTournament from existing foreign key
UPDATE "games" SET "isTournament" = TRUE WHERE "tournamentId" IS NOT NULL;

-- AlterTable tournaments — remove per-tournament retention (now a global admin setting)
ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "replayRetentionDays";
