-- Research Log Sprint 1 — TrainingSessionNote + NoteOutcome enum.
--
-- See doc/Research_Log_Plan.md §§2.1, 3 (Sprint 1). Additive only — no
-- backfill needed; empty table is fine on first deploy. The denormalized
-- userId on the note row carries ownership end-to-end, avoiding a per-write
-- JOIN through TrainingSession.modelId → BotSkill.createdBy (the
-- TrainingSession row itself has no direct userId).

CREATE TYPE "NoteOutcome" AS ENUM ('SUCCESS', 'PLATEAU', 'REGRESSION', 'INCONCLUSIVE');

CREATE TABLE "training_session_notes" (
    "id"                  TEXT           NOT NULL,
    "userId"              TEXT           NOT NULL,
    "sessionId"           TEXT           NOT NULL,
    "body"                TEXT           NOT NULL,
    "outcome"             "NoteOutcome"  NOT NULL,
    "tags"                TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sharedWithCommunity" BOOLEAN        NOT NULL DEFAULT false,
    "publishedAt"         TIMESTAMP(3),
    "helpDocId"           TEXT,
    "createdAt"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3)   NOT NULL,
    CONSTRAINT "training_session_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_session_notes_userId_fkey"    FOREIGN KEY ("userId")    REFERENCES "users"("id")              ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "training_session_notes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id")  ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "training_session_notes_helpDocId_key"
  ON "training_session_notes"("helpDocId");

CREATE INDEX "training_session_notes_userId_createdAt_idx"
  ON "training_session_notes"("userId", "createdAt");

CREATE INDEX "training_session_notes_sessionId_idx"
  ON "training_session_notes"("sessionId");

CREATE INDEX "training_session_notes_sharedWithCommunity_publishedAt_idx"
  ON "training_session_notes"("sharedWithCommunity", "publishedAt");
