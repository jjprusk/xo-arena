-- Add ELO rating to users
ALTER TABLE "users" ADD COLUMN "eloRating" DOUBLE PRECISION NOT NULL DEFAULT 1200;

-- Create user ELO history table
CREATE TABLE "user_elo_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eloRating" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "opponentType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_elo_history_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX "user_elo_history_userId_idx" ON "user_elo_history"("userId");

-- Foreign key
ALTER TABLE "user_elo_history" ADD CONSTRAINT "user_elo_history_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
