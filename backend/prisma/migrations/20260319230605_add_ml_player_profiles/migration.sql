-- CreateTable
CREATE TABLE "ml_player_profiles" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gamesRecorded" INTEGER NOT NULL DEFAULT 0,
    "movePatterns" JSONB NOT NULL DEFAULT '{}',
    "openingPreferences" JSONB NOT NULL DEFAULT '{}',
    "tendencies" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ml_player_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ml_player_profiles_modelId_userId_key" ON "ml_player_profiles"("modelId", "userId");

-- AddForeignKey
ALTER TABLE "ml_player_profiles" ADD CONSTRAINT "ml_player_profiles_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ml_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
