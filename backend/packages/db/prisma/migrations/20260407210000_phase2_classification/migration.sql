-- Phase 2: Player Classification

CREATE TYPE "ClassificationTier" AS ENUM ('RECRUIT', 'CONTENDER', 'VETERAN', 'ELITE', 'CHAMPION', 'LEGEND');

CREATE TABLE "player_classifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "ClassificationTier" NOT NULL DEFAULT 'RECRUIT',
    "merits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "player_classifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "player_classifications_userId_key" ON "player_classifications"("userId");

CREATE TABLE "merit_transactions" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "tournamentId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "merit_transactions_classificationId_idx" ON "merit_transactions"("classificationId");
CREATE INDEX "merit_transactions_tournamentId_idx" ON "merit_transactions"("tournamentId");

CREATE TABLE "classification_history" (
    "id" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "fromTier" "ClassificationTier",
    "toTier" "ClassificationTier" NOT NULL,
    "reason" TEXT NOT NULL,
    "tournamentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "classification_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "classification_history_classificationId_idx" ON "classification_history"("classificationId");

CREATE TABLE "merit_thresholds" (
    "id" TEXT NOT NULL,
    "bandMin" INTEGER NOT NULL,
    "bandMax" INTEGER,
    "pos1" INTEGER NOT NULL,
    "pos2" INTEGER NOT NULL,
    "pos3" INTEGER NOT NULL,
    "pos4" INTEGER NOT NULL,
    CONSTRAINT "merit_thresholds_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "player_classifications" ADD CONSTRAINT "player_classifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merit_transactions" ADD CONSTRAINT "merit_transactions_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "player_classifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_history" ADD CONSTRAINT "classification_history_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "player_classifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
