-- CreateTable
CREATE TABLE "tournament_seed_bots" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_seed_bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournament_seed_bots_tournamentId_idx" ON "tournament_seed_bots"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_seed_bots_tournamentId_userId_key" ON "tournament_seed_bots"("tournamentId", "userId");

-- AddForeignKey
ALTER TABLE "tournament_seed_bots" ADD CONSTRAINT "tournament_seed_bots_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_seed_bots" ADD CONSTRAINT "tournament_seed_bots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
