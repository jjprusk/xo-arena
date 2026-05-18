-- A1.5b — atomic slug rename: 'xo' → 'tic-tac-toe'
--
-- Updates every column that stores the TTT game slug. Six tables hold this
-- value today:
--   game_elo.game_id              (snake_case via @map)
--   bot_skills.game_id            (snake_case via @map, has DEFAULT)
--   tournaments.game              (column literally named "game")
--   tournament_templates.game
--   tournament_auto_drops.game
--   tables."gameId"               (camelCase, no @map)
--
-- The BotSkill default value is also flipped from 'xo' to 'tic-tac-toe' so new
-- rows created via Prisma's default get the canonical slug.
--
-- Code-side, GAME_IDS.TIC_TAC_TOE flips from 'xo' to 'tic-tac-toe' in the same
-- deploy, and LEGACY_SLUG_MAP inverts so URL paths/body params still bearing
-- 'xo' continue to resolve via the slug-validator middleware.

UPDATE "game_elo"             SET "game_id" = 'tic-tac-toe' WHERE "game_id" = 'xo';
UPDATE "bot_skills"           SET "game_id" = 'tic-tac-toe' WHERE "game_id" = 'xo';
UPDATE "tournaments"          SET "game"    = 'tic-tac-toe' WHERE "game"    = 'xo';
UPDATE "tournament_templates" SET "game"    = 'tic-tac-toe' WHERE "game"    = 'xo';
UPDATE "tournament_auto_drops" SET "game"   = 'tic-tac-toe' WHERE "game"    = 'xo';
UPDATE "tables"               SET "gameId"  = 'tic-tac-toe' WHERE "gameId"  = 'xo';

-- Flip the BotSkill column default so future inserts via Prisma default use
-- the canonical slug. (Existing schema default flipped in the Prisma model.)
ALTER TABLE "bot_skills" ALTER COLUMN "game_id" SET DEFAULT 'tic-tac-toe';
