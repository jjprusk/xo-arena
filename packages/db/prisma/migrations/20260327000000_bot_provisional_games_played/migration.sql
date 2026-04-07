-- Rename botCalibrating → botProvisional, add botGamesPlayed
ALTER TABLE "users"
  RENAME COLUMN "botCalibrating" TO "botProvisional";

ALTER TABLE "users"
  ADD COLUMN "botGamesPlayed" INTEGER NOT NULL DEFAULT 0;
