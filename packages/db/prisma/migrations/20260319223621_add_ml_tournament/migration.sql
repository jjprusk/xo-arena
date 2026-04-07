-- CreateTable
CREATE TABLE "ml_tournaments" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "modelIds" JSONB NOT NULL,
    "gamesPerPair" INTEGER NOT NULL DEFAULT 50,
    "results" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ml_tournaments_pkey" PRIMARY KEY ("id")
);
