-- Phase 3.7a stage 3 — drop the deprecated recurrence columns from tournaments.
-- TournamentTemplate is now the canonical home for recurrence config; an
-- occurrence's link back to its template is exclusively `templateId`.
--
-- Before this migration these columns were dual-written (POST /api/tournaments
-- shim + PATCH mirror). Stage 1 cut every operational reader over to templateId
-- / TournamentTemplate. Stage 2 split the create endpoints. Stage 3 (this
-- migration + matching Prisma schema change) removes the columns.
--
-- Non-reversible — run only after all services using the old Prisma client
-- have been redeployed.

ALTER TABLE "tournaments" DROP COLUMN "isRecurring";
ALTER TABLE "tournaments" DROP COLUMN "recurrenceInterval";
ALTER TABLE "tournaments" DROP COLUMN "recurrenceEndDate";
ALTER TABLE "tournaments" DROP COLUMN "recurrencePaused";
ALTER TABLE "tournaments" DROP COLUMN "autoOptOutAfterMissed";
