-- Sprint 3 of doc/Research_Log_Plan.md:
-- Materialised export view over TrainingSessionNote + ResearchLogEntry,
-- refreshed nightly via truncate-and-insert (no FKs — disposable).

CREATE TABLE "research_log_exports" (
    "id"                  TEXT NOT NULL,
    "type"                TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "body"                TEXT NOT NULL,
    "outcome"             TEXT,
    "title"               TEXT,
    "category"            TEXT,
    "tags"                TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedWithCommunity" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt"         TIMESTAMP(3),
    "helpDocId"           TEXT,
    "sourceCreatedAt"     TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt"     TIMESTAMP(3) NOT NULL,
    "exportedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_log_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_log_exports_userId_idx"
    ON "research_log_exports"("userId");
CREATE INDEX "research_log_exports_type_idx"
    ON "research_log_exports"("type");
CREATE INDEX "research_log_exports_sharedWithCommunity_publishedAt_idx"
    ON "research_log_exports"("sharedWithCommunity", "publishedAt");
