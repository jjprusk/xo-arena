-- Phase 3: Tables (front-door concept replacing ad-hoc rooms)

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('FORMING', 'ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "tables" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'FORMING',
    "createdById" TEXT NOT NULL,
    "minPlayers" INTEGER NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isTournament" BOOLEAN NOT NULL DEFAULT false,
    "seats" JSONB NOT NULL,
    "previewState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tables_status_idx" ON "tables"("status");

-- CreateIndex
CREATE INDEX "tables_gameId_idx" ON "tables"("gameId");

-- CreateIndex
CREATE INDEX "tables_createdById_idx" ON "tables"("createdById");

-- CreateIndex
CREATE INDEX "tables_isTournament_idx" ON "tables"("isTournament");
