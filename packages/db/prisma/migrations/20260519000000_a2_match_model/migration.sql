-- A2.1 — Match model for ranked best-of-N play
--
-- Adds a new `matches` table (parent) with child rows on `games` via the
-- new `match_id` FK. Tournament games keep using `tournament_match_id`;
-- casual games leave both NULL. Schema design notes live in
-- Connect_Four_Implementation_Plan.md §A2.
--
-- Internally re-uses the existing `MatchStatus` enum (PENDING / IN_PROGRESS
-- / COMPLETED / CANCELLED). PENDING == FORMING in plan-doc parlance.
-- A new `MatchFormat` enum carries the best-of-N shape (just RANKED_BO2
-- today; tournament BO3 stays on `tournament_matches`).

-- CreateEnum
CREATE TYPE "MatchFormat" AS ENUM ('RANKED_BO2');

-- CreateTable
CREATE TABLE "matches" (
    "id"           TEXT NOT NULL,
    "game_id"      TEXT NOT NULL,
    "format"       "MatchFormat" NOT NULL DEFAULT 'RANKED_BO2',
    "status"       "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "player1_id"   TEXT NOT NULL,
    "player2_id"   TEXT NOT NULL,
    "winner_id"    TEXT,
    "p1_wins"      INTEGER NOT NULL DEFAULT 0,
    "p2_wins"      INTEGER NOT NULL DEFAULT 0,
    "draw_games"   INTEGER NOT NULL DEFAULT 0,
    "seed"         TEXT NOT NULL,
    "started_at"   TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matches_game_id_idx"    ON "matches"("game_id");
CREATE INDEX "matches_status_idx"     ON "matches"("status");
CREATE INDEX "matches_player1_id_idx" ON "matches"("player1_id");
CREATE INDEX "matches_player2_id_idx" ON "matches"("player2_id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_player1_id_fkey"
    FOREIGN KEY ("player1_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_player2_id_fkey"
    FOREIGN KEY ("player2_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_id_fkey"
    FOREIGN KEY ("winner_id")  REFERENCES "users"("id") ON DELETE SET NULL  ON UPDATE CASCADE;

-- Wire `games` to `matches`. matchId/matchSequence are nullable — casual
-- games stay NULL, tournament games stay NULL (they keep using
-- tournament_match_id).
ALTER TABLE "games" ADD COLUMN "matchId"       TEXT;
ALTER TABLE "games" ADD COLUMN "matchSequence" INTEGER;

CREATE INDEX "games_matchId_idx" ON "games"("matchId");

ALTER TABLE "games" ADD CONSTRAINT "games_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
