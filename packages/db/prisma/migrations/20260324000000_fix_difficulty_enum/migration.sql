-- Fix Difficulty enum: replace EASY/MEDIUM/HARD with NOVICE/INTERMEDIATE/ADVANCED/MASTER
-- No existing game rows use the old values, so a type rename is safe.

-- 1. Add the new values (cannot remove old ones from a live PostgreSQL enum,
--    but the application will never write EASY/MEDIUM/HARD going forward)
ALTER TYPE "Difficulty" ADD VALUE IF NOT EXISTS 'NOVICE';
ALTER TYPE "Difficulty" ADD VALUE IF NOT EXISTS 'INTERMEDIATE';
ALTER TYPE "Difficulty" ADD VALUE IF NOT EXISTS 'ADVANCED';
ALTER TYPE "Difficulty" ADD VALUE IF NOT EXISTS 'MASTER';
