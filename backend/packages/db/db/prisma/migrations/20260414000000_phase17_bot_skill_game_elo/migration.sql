-- Phase 1.7: MLModel → BotSkill, per-game ELO (GameElo), terminology rename
-- NOTE: This migration is idempotent-safe. Several steps (table rename, column
-- renames on bot_skills, algorithm normalisation) were applied to the dev DB
-- manually before this migration was written. The SQL below handles each step
-- conditionally so it works against both clean and partially-migrated databases.

-- ─── 1. Rename ml_models → bot_skills (skip if already renamed) ──────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ml_models' AND table_schema = 'public') THEN
    ALTER TABLE "ml_models" RENAME TO "bot_skills";
  END IF;
END $$;

-- ─── 2. Convert algorithm column to text and normalise values ─────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_skills' AND column_name = 'algorithm'
    AND data_type != 'text'
  ) THEN
    ALTER TABLE "bot_skills" ALTER COLUMN "algorithm" TYPE TEXT;
  END IF;
END $$;

UPDATE "bot_skills" SET "algorithm" =
  CASE "algorithm"
    WHEN 'Q_LEARNING'      THEN 'qlearning'
    WHEN 'SARSA'           THEN 'sarsa'
    WHEN 'MONTE_CARLO'     THEN 'montecarlo'
    WHEN 'POLICY_GRADIENT' THEN 'policygradient'
    WHEN 'DQN'             THEN 'dqn'
    WHEN 'ALPHA_ZERO'      THEN 'alphazero'
    ELSE algorithm
  END
WHERE "algorithm" IN ('Q_LEARNING','SARSA','MONTE_CARLO','POLICY_GRADIENT','DQN','ALPHA_ZERO');

-- ─── 3. Rename qtable → weights on bot_skills (skip if already renamed) ───────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_skills' AND column_name = 'qtable'
  ) THEN
    ALTER TABLE "bot_skills" RENAME COLUMN "qtable" TO "weights";
  END IF;
END $$;

-- ─── 4. Add botId + gameId columns (skip if already present) ─────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_skills' AND column_name = 'bot_id'
  ) THEN
    ALTER TABLE "bot_skills" ADD COLUMN "bot_id" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bot_skills' AND column_name = 'game_id'
  ) THEN
    ALTER TABLE "bot_skills" ADD COLUMN "game_id" TEXT NOT NULL DEFAULT 'xo';
  END IF;
END $$;

-- ─── 5. Drop eloRating from bot_skills ───────────────────────────────────────

ALTER TABLE "bot_skills" DROP COLUMN IF EXISTS "eloRating";
ALTER TABLE "bot_skills" DROP COLUMN IF EXISTS "elo_rating";

-- ─── 6. Populate botId from users ────────────────────────────────────────────

UPDATE "bot_skills" bs
SET "bot_id" = u."id"
FROM "users" u
WHERE u."botModelId" = bs."id" AND u."isBot" = true AND bs."bot_id" IS NULL;

-- ─── 7. Unique index on (botId, gameId) ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "bot_skills_bot_id_game_id_key"
  ON "bot_skills"("bot_id", "game_id")
  WHERE "bot_id" IS NOT NULL;

-- ─── 8. Update ml_checkpoints ────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ml_checkpoints' AND column_name = 'qtable'
  ) THEN
    ALTER TABLE "ml_checkpoints" RENAME COLUMN "qtable" TO "weights";
  END IF;
END $$;

ALTER TABLE "ml_checkpoints" DROP COLUMN IF EXISTS "eloRating";
ALTER TABLE "ml_checkpoints" DROP COLUMN IF EXISTS "elo_rating";

-- ─── 9. Rename enum MLModelStatus → BotSkillStatus ───────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MLModelStatus') THEN
    ALTER TYPE "MLModelStatus" RENAME TO "BotSkillStatus";
  END IF;
END $$;

DROP TYPE IF EXISTS "MLAlgorithm" CASCADE;

-- ─── 10. Create game_elo table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "game_elo" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "game_id"      TEXT NOT NULL,
  "rating"       DOUBLE PRECISION NOT NULL DEFAULT 1200,
  "games_played" INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "game_elo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "game_elo_user_id_game_id_key" ON "game_elo"("user_id", "game_id");
CREATE INDEX IF NOT EXISTS "game_elo_user_id_idx"              ON "game_elo"("user_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'game_elo_user_id_fkey'
  ) THEN
    ALTER TABLE "game_elo" ADD CONSTRAINT "game_elo_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 11. Migrate eloRating from users → game_elo ─────────────────────────────

INSERT INTO "game_elo" ("id", "user_id", "game_id", "rating", "games_played")
SELECT gen_random_uuid()::TEXT, "id", 'xo', "eloRating", 0
FROM "users"
WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'eloRating'
)
ON CONFLICT ("user_id", "game_id") DO NOTHING;

-- ─── 12. Drop eloRating from users, rename mlModelLimit → skillLimit ──────────

ALTER TABLE "users" DROP COLUMN IF EXISTS "eloRating";
ALTER TABLE "users" DROP COLUMN IF EXISTS "elo_rating";

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'mlModelLimit'
  ) THEN
    ALTER TABLE "users" RENAME COLUMN "mlModelLimit" TO "skillLimit";
  END IF;
END $$;
