-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'SUGGESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPPORT';

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL DEFAULT 'xo-arena',
    "userId" TEXT,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'OTHER',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "screenshotData" TEXT,
    "userAgent" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_replies" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_appId_idx" ON "feedback"("appId");

-- CreateIndex
CREATE INDEX "feedback_status_idx" ON "feedback"("status");

-- CreateIndex
CREATE INDEX "feedback_createdAt_idx" ON "feedback"("createdAt");

-- CreateIndex
CREATE INDEX "feedback_readAt_idx" ON "feedback"("readAt");

-- CreateIndex
CREATE INDEX "feedback_archivedAt_idx" ON "feedback"("archivedAt");

-- CreateIndex
CREATE INDEX "feedback_replies_feedbackId_idx" ON "feedback_replies"("feedbackId");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_replies" ADD CONSTRAINT "feedback_replies_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
