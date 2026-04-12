-- CreateEnum
CREATE TYPE "TournamentMode" AS ENUM ('PVP', 'BOT_VS_BOT', 'MIXED');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('OPEN', 'PLANNED', 'FLASH');

-- CreateEnum
CREATE TYPE "BracketType" AS ENUM ('SINGLE_ELIM', 'ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('REGISTERED', 'ACTIVE', 'ELIMINATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ResultNotifPref" AS ENUM ('AS_PLAYED', 'END_OF_TOURNAMENT');

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "tournamentId" TEXT,
ADD COLUMN     "tournamentMatchId" TEXT;

-- CreateTable
CREATE TABLE "tournaments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "game" TEXT NOT NULL,
    "mode" "TournamentMode" NOT NULL,
    "format" "TournamentFormat" NOT NULL,
    "bracketType" "BracketType" NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "minParticipants" INTEGER NOT NULL DEFAULT 2,
    "maxParticipants" INTEGER,
    "bestOfN" INTEGER NOT NULL DEFAULT 3,
    "botMinGamesPlayed" INTEGER,
    "allowNonCompetitiveBots" BOOLEAN NOT NULL DEFAULT false,
    "allowSpectators" BOOLEAN NOT NULL DEFAULT true,
    "replayRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "registrationOpenAt" TIMESTAMP(3),
    "registrationCloseAt" TIMESTAMP(3),
    "noticePeriodMinutes" INTEGER,
    "durationMinutes" INTEGER,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "autoOptOutAfterMissed" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seedPosition" INTEGER,
    "eloAtRegistration" DOUBLE PRECISION,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'REGISTERED',
    "resultNotifPref" "ResultNotifPref" NOT NULL DEFAULT 'AS_PLAYED',
    "finalPosition" INTEGER,
    "finalPositionPct" DOUBLE PRECISION,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_rounds" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_matches" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "participant1Id" TEXT,
    "participant2Id" TEXT,
    "winnerId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "drawResolution" TEXT,
    "p1Wins" INTEGER NOT NULL DEFAULT 0,
    "p2Wins" INTEGER NOT NULL DEFAULT 0,
    "drawGames" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournaments_status_idx" ON "tournaments"("status");

-- CreateIndex
CREATE INDEX "tournaments_game_idx" ON "tournaments"("game");

-- CreateIndex
CREATE INDEX "tournaments_createdById_idx" ON "tournaments"("createdById");

-- CreateIndex
CREATE INDEX "tournament_participants_tournamentId_idx" ON "tournament_participants"("tournamentId");

-- CreateIndex
CREATE INDEX "tournament_participants_userId_idx" ON "tournament_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_tournamentId_userId_key" ON "tournament_participants"("tournamentId", "userId");

-- CreateIndex
CREATE INDEX "tournament_rounds_tournamentId_idx" ON "tournament_rounds"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_rounds_tournamentId_roundNumber_key" ON "tournament_rounds"("tournamentId", "roundNumber");

-- CreateIndex
CREATE INDEX "tournament_matches_tournamentId_idx" ON "tournament_matches"("tournamentId");

-- CreateIndex
CREATE INDEX "tournament_matches_roundId_idx" ON "tournament_matches"("roundId");

-- CreateIndex
CREATE INDEX "games_tournamentId_idx" ON "games"("tournamentId");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_tournamentMatchId_fkey" FOREIGN KEY ("tournamentMatchId") REFERENCES "tournament_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_rounds" ADD CONSTRAINT "tournament_rounds_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "tournament_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
