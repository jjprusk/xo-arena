-- Phase 3.7a.2 — Bot displayName hybrid uniqueness.
--
-- Goal: prevent impersonation of platform-reserved (built-in) bots and
-- prevent one owner from having two bots with the same name. Cross-owner
-- collisions ARE allowed — users can each have their own "Rusty" — and
-- the UI disambiguates "Rusty · @joe" / "Rusty · built-in" in any
-- mixed-owner list (picker, rankings, tournament brackets, etc.).
--
-- Schema:
--   users.isBot = true AND users.botOwnerId IS NULL  → built-in or orphan
--   users.isBot = true AND users.botOwnerId IS NOT NULL → user-owned bot
--
-- Two partial unique indexes, both case-insensitive:
--
--   1. UNIQUE (LOWER(displayName)) WHERE isBot=true AND botOwnerId IS NULL
--      No two unowned bots share a name. Protects built-ins
--      (Rusty/Copper/Sterling/Magnus) from being impersonated by
--      orphan bots.
--
--   2. UNIQUE (botOwnerId, LOWER(displayName)) WHERE isBot=true
--                                              AND botOwnerId IS NOT NULL
--      One owner cannot have two bots with the same name.
--
-- Case-insensitive matching (LOWER(...)) avoids "Rusty" vs "RUSTY"
-- workarounds. Duplicate detection in the bot-create API uses the
-- same LOWER comparison.

-- ── 1. Clean up test-orphan bots ────────────────────────────────────────────
-- E2E and stress-test harnesses created many unowned bots (names like
-- "E2E Bot B", "dummy", "i2", etc.) that were never reaped. The unowned
-- unique index below cannot be created while duplicates exist. Built-in
-- bots (Rusty/Copper/Sterling/Magnus) are preserved.
--
-- Four FKs to users are ON DELETE RESTRICT (not CASCADE), so we must
-- delete dependent rows explicitly before deleting the User rows.
-- `games_player2Id_fkey`, `games_winnerId_fkey`, and `feedback_userId_fkey`
-- are SET NULL — they self-handle.

-- 1a. Games where the test-orphan bot was player1. player1 is required,
-- so we delete the game row (cascades kill moves, participants, etc.).
DELETE FROM games WHERE "player1Id" IN (
  SELECT id FROM users
  WHERE "isBot" = true AND "botOwnerId" IS NULL
    AND "displayName" NOT IN ('Rusty','Copper','Sterling','Magnus')
);

-- 1b. TournamentParticipant rows for test-orphan bots.
DELETE FROM tournament_participants WHERE "userId" IN (
  SELECT id FROM users
  WHERE "isBot" = true AND "botOwnerId" IS NULL
    AND "displayName" NOT IN ('Rusty','Copper','Sterling','Magnus')
);

-- 1c. TournamentSeedBot rows for test-orphan bots.
DELETE FROM tournament_seed_bots WHERE "userId" IN (
  SELECT id FROM users
  WHERE "isBot" = true AND "botOwnerId" IS NULL
    AND "displayName" NOT IN ('Rusty','Copper','Sterling','Magnus')
);

-- 1d. TournamentTemplateSeedBot rows for test-orphan bots.
DELETE FROM tournament_template_seed_bots WHERE "userId" IN (
  SELECT id FROM users
  WHERE "isBot" = true AND "botOwnerId" IS NULL
    AND "displayName" NOT IN ('Rusty','Copper','Sterling','Magnus')
);

-- 1e. Finally delete the User rows.
DELETE FROM users
WHERE "isBot" = true
  AND "botOwnerId" IS NULL
  AND "displayName" NOT IN ('Rusty', 'Copper', 'Sterling', 'Magnus');

-- ── 2. Partial unique indexes ───────────────────────────────────────────────
CREATE UNIQUE INDEX "users_bot_displayname_unowned_key"
  ON users (LOWER("displayName"))
  WHERE "isBot" = true AND "botOwnerId" IS NULL;

CREATE UNIQUE INDEX "users_bot_displayname_by_owner_key"
  ON users ("botOwnerId", LOWER("displayName"))
  WHERE "isBot" = true AND "botOwnerId" IS NOT NULL;
