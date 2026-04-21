-- Phase 3.4: Add tournament context + bot context columns to Table.
-- Additive only — no data migration needed; all columns are nullable
-- (except isHvb which defaults to false).

-- Tournament context
ALTER TABLE "tables" ADD COLUMN "tournamentMatchId" TEXT;
ALTER TABLE "tables" ADD COLUMN "tournamentId" TEXT;
ALTER TABLE "tables" ADD COLUMN "bestOfN" INTEGER;

-- Bot context
ALTER TABLE "tables" ADD COLUMN "isHvb" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tables" ADD COLUMN "botUserId" TEXT;
ALTER TABLE "tables" ADD COLUMN "botSkillId" TEXT;

-- Indexes for fast lookups
CREATE INDEX "tables_tournamentMatchId_idx" ON "tables"("tournamentMatchId");
CREATE INDEX "tables_botUserId_idx" ON "tables"("botUserId");
