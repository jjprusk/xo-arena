-- Phase 1.7: MLModel → BotSkill, per-game ELO (GameElo), terminology rename
-- This migration:
--   1. Renames ml_models → bot_skills
--   2. Renames qtable → weights, drops eloRating, adds botId + gameId
--   3. Converts algorithm column from enum to text with normalised values
--   4. Renames ml_checkpoints.qtable → weights, drops eloRating
--   5. Drops MLAlgorithm and MLModelStatus enums, creates BotSkillStatus
--   6. Creates game_elo table and migrates eloRating from users
--   7. Drops eloRating from users, renames mlModelLimit → skillLimit

-- ─── 1. Rename ml_models → bot_skills ────────────────────────────────────────

ALTER TABLE "ml_models" RENAME TO "bot_skills";

-- ─── 2. Convert algorithm from enum to text ───────────────────────────────────

ALTER TABLE "bot_skills" ALTER COLUMN "algorithm" TYPE TEXT;
UPDATE "bot_skills" SET "algorithm" =
  CASE "algorithm"
    WHEN 'Q_LEARNING'      THEN 'qlearning'
    WHEN 'SARSA'           THEN 'sarsa'
    WHEN 'MONTE_CARLO'     THEN 'montecarlo'
    WHEN 'POLICY_GRADIENT' THEN 'policygradient'
    WHEN 'DQN'             THEN 'dqn'
    WHEN 'ALPHA_ZERO'      THEN 'alphazero'
    ELSE 'qlearning'
  END;

-- ─── 3. Rename qtable → weights, add botId + gameId, drop eloRating ──────────

ALTER TABLE "bot_skills" RENAME COLUMN "qtable" TO "weights";
ALTER TABLE "bot_skills" ADD COLUMN "bot_id"  TEXT;
ALTER TABLE "bot_skills" ADD COLUMN "game_id" TEXT NOT NULL DEFAULT 'xo';
ALTER TABLE "bot_skills" DROP COLUMN "elo_rating";

-- Populate botId from users whose botModelId matches this skill
UPDATE "bot_skills" bs
SET "bot_id" = u."id"
FROM "users" u
WHERE u."bot_model_id" = bs."id" AND u."is_bot" = true;

-- Unique constraint on (botId, gameId) — NULLs in bot_id are excluded by Postgres
CREATE UNIQUE INDEX "bot_skills_bot_id_game_id_key"
  ON "bot_skills"("bot_id", "game_id")
  WHERE "bot_id" IS NOT NULL;

-- ─── 4. Update ml_checkpoints ─────────────────────────────────────────────────

ALTER TABLE "ml_checkpoints" RENAME COLUMN "qtable" TO "weights";
ALTER TABLE "ml_checkpoints" DROP COLUMN "elo_rating";

-- ─── 5. Rename MLModelStatus → BotSkillStatus enum ───────────────────────────

ALTER TYPE "MLModelStatus" RENAME TO "BotSkillStatus";
DROP TYPE IF EXISTS "MLAlgorithm";

-- ─── 6. Create game_elo table ─────────────────────────────────────────────────

CREATE TABLE "game_elo" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "game_id"      TEXT NOT NULL,
  "rating"       DOUBLE PRECISION NOT NULL DEFAULT 1200,
  "games_played" INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_elo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_elo_user_id_game_id_key" ON "game_elo"("user_id", "game_id");
CREATE INDEX "game_elo_user_id_idx"              ON "game_elo"("user_id");

ALTER TABLE "game_elo" ADD CONSTRAINT "game_elo_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 7. Migrate eloRating from users → game_elo ──────────────────────────────

INSERT INTO "game_elo" ("id", "user_id", "game_id", "rating", "games_played")
SELECT gen_random_uuid()::TEXT, "id", 'xo', "elo_rating", 0
FROM "users";

-- ─── 8. Drop eloRating from users, rename mlModelLimit → skillLimit ──────────

ALTER TABLE "users" DROP COLUMN "elo_rating";
ALTER TABLE "users" RENAME COLUMN "ml_model_limit" TO "skill_limit";
