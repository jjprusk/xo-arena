-- Phase 4: Open/Flash/Round Robin/Recurring

CREATE TYPE "RegistrationMode" AS ENUM ('SINGLE', 'RECURRING');
CREATE TYPE "RecurrenceInterval" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

ALTER TABLE "tournament_participants"
  ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'SINGLE';

ALTER TABLE "tournaments"
  ADD COLUMN "recurrenceInterval" "RecurrenceInterval",
  ADD COLUMN "recurrenceEndDate" TIMESTAMP(3);

CREATE TABLE "recurring_tournament_registrations" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "missedCount" INTEGER NOT NULL DEFAULT 0,
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recurring_tournament_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_tournament_registrations_templateId_userId_key"
  ON "recurring_tournament_registrations"("templateId", "userId");
CREATE INDEX "recurring_tournament_registrations_templateId_idx"
  ON "recurring_tournament_registrations"("templateId");
CREATE INDEX "recurring_tournament_registrations_userId_idx"
  ON "recurring_tournament_registrations"("userId");
