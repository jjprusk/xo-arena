-- CreateEnum
CREATE TYPE "MLAlgorithm" AS ENUM ('Q_LEARNING', 'SARSA', 'MONTE_CARLO', 'POLICY_GRADIENT', 'DQN', 'ALPHA_ZERO');

-- CreateEnum
CREATE TYPE "MLModelStatus" AS ENUM ('IDLE', 'TRAINING');

-- CreateEnum
CREATE TYPE "TrainingMode" AS ENUM ('SELF_PLAY', 'VS_MINIMAX', 'VS_HUMAN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EpisodeOutcome" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateTable
CREATE TABLE "ml_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "algorithm" "MLAlgorithm" NOT NULL DEFAULT 'Q_LEARNING',
    "qtable" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL,
    "status" "MLModelStatus" NOT NULL DEFAULT 'IDLE',
    "totalEpisodes" INTEGER NOT NULL DEFAULT 0,
    "eloRating" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ml_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "mode" "TrainingMode" NOT NULL,
    "iterations" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_episodes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "episodeNum" INTEGER NOT NULL,
    "outcome" "EpisodeOutcome" NOT NULL,
    "totalMoves" INTEGER NOT NULL,
    "avgQDelta" DOUBLE PRECISION NOT NULL,
    "epsilon" DOUBLE PRECISION NOT NULL,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "training_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_checkpoints" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "episodeNum" INTEGER NOT NULL,
    "qtable" JSONB NOT NULL,
    "epsilon" DOUBLE PRECISION NOT NULL,
    "eloRating" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_benchmark_results" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vsRandom" JSONB NOT NULL,
    "vsEasy" JSONB NOT NULL,
    "vsMedium" JSONB NOT NULL,
    "vsHard" JSONB NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "ml_benchmark_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ml_elo_history" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "eloRating" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "opponentId" TEXT,
    "opponentType" TEXT NOT NULL,
    "outcome" "EpisodeOutcome" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_elo_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_sessions_modelId_idx" ON "training_sessions"("modelId");

-- CreateIndex
CREATE INDEX "training_episodes_sessionId_idx" ON "training_episodes"("sessionId");

-- CreateIndex
CREATE INDEX "ml_checkpoints_modelId_idx" ON "ml_checkpoints"("modelId");

-- CreateIndex
CREATE INDEX "ml_benchmark_results_modelId_idx" ON "ml_benchmark_results"("modelId");

-- CreateIndex
CREATE INDEX "ml_elo_history_modelId_idx" ON "ml_elo_history"("modelId");

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ml_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_episodes" ADD CONSTRAINT "training_episodes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_checkpoints" ADD CONSTRAINT "ml_checkpoints_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ml_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_benchmark_results" ADD CONSTRAINT "ml_benchmark_results_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ml_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ml_elo_history" ADD CONSTRAINT "ml_elo_history_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ml_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
