-- Add demotion opt-out tracking to player_classifications
-- A player may opt out of demotion once per review period.
-- demotionOptOutUsedAt records when they used it; the review
-- logic skips demotion if this timestamp falls within the current period.
ALTER TABLE "player_classifications" ADD COLUMN "demotionOptOutUsedAt" TIMESTAMP(3);
