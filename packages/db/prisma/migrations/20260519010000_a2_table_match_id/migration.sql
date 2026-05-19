-- A2.4 — `tables.matchId` column + FK to `matches`.
--
-- Lets the server identify mid-match tables (so the game-2 rematch-in-place
-- code can target the right Match row) without scanning. Nullable: casual
-- and tournament tables stay NULL. Mirrors the existing `tournamentMatchId`
-- column.

ALTER TABLE "tables" ADD COLUMN "matchId" TEXT;

CREATE INDEX "tables_matchId_idx" ON "tables"("matchId");

ALTER TABLE "tables" ADD CONSTRAINT "tables_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
