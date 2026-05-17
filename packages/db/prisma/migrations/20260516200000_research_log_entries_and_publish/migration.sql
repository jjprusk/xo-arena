-- Sprint 2 of doc/Research_Log_Plan.md:
--   1. Add ResearchLogEntry table + ResearchEntryCategory enum
--   2. Add HelpDoc.source (default 'guide') + HelpDoc.ownerId (nullable FK)

-- CreateEnum
CREATE TYPE "ResearchEntryCategory" AS ENUM ('PLANNING', 'RETROSPECTIVE', 'OBSERVATION', 'OTHER');

-- CreateTable
CREATE TABLE "research_log_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" "ResearchEntryCategory" NOT NULL,
    "sharedWithCommunity" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "helpDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_log_entries_helpDocId_key" ON "research_log_entries"("helpDocId");

-- CreateIndex
CREATE INDEX "research_log_entries_userId_createdAt_idx" ON "research_log_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "research_log_entries_sharedWithCommunity_publishedAt_idx" ON "research_log_entries"("sharedWithCommunity", "publishedAt");

-- AddForeignKey
ALTER TABLE "research_log_entries" ADD CONSTRAINT "research_log_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: HelpDoc.source + HelpDoc.ownerId
ALTER TABLE "help_docs" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'guide';
ALTER TABLE "help_docs" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "help_docs_source_idx" ON "help_docs"("source");

-- CreateIndex
CREATE INDEX "help_docs_ownerId_idx" ON "help_docs"("ownerId");

-- AddForeignKey
ALTER TABLE "help_docs" ADD CONSTRAINT "help_docs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
