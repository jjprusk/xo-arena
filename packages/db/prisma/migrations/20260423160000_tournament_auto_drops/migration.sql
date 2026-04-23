-- Phase 3.7a.6 — append-only audit log for sweep-dropped tournaments.
-- Sweep hard-deletes unfilled bot-only tournaments (Phase 3.5); this row
-- captures the drop before the delete so admins retain visibility as a
-- health signal. No FKs — originalTournamentId may reference a row that
-- no longer exists.

CREATE TABLE "tournament_auto_drops" (
    "id"                   TEXT         NOT NULL,
    "originalTournamentId" TEXT,
    "templateId"           TEXT,
    "name"                 TEXT         NOT NULL,
    "game"                 TEXT         NOT NULL,
    "minParticipants"      INTEGER      NOT NULL,
    "participantCount"     INTEGER      NOT NULL,
    "droppedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournament_auto_drops_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tournament_auto_drops_droppedAt_idx" ON "tournament_auto_drops"("droppedAt");
