-- Add per-model lifetime training episode cap.
-- Default 100,000 applies to all existing models.
ALTER TABLE "ml_models" ADD COLUMN "maxEpisodes" INTEGER NOT NULL DEFAULT 100000;
